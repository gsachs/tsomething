---
date: 2026-03-01
topic: multi-timer
---

# Multi-Timer: Parallel Pomodoros per Tab

## What We're Building

Allow multiple Pomodoro timers to run simultaneously, each bound to a different tab.
Today, the extension has a single global state machine — only one timer can be active at a time,
bound to at most one tab. The new model replaces that with a pool of timer instances, one per
bound tab, running independently in parallel.

The primary use case is context switching: a user working on two projects in different tabs
wants a separate progress bar and countdown on each, without stopping one to start the other.

## Why This Approach

Three options were considered:

- **Timer Pool (Map\<tabId, TimerInstance\>)** — chosen. Truly parallel sessions; each tab has
  its own mode, elapsed time, progress bar, and favicon overlay. The existing state machine logic
  is largely preserved; it's refactored from a module-level singleton into per-instance functions.

- **Single timer, tab-local persistence** — rejected. Only one timer runs at a time; tabs
  "remember" their last state. Doesn't meet the requirement of parallel timers.

- **Timer Pool with a concurrency cap** — rejected. Arbitrary limit; no evidence it's needed.

## Key Decisions

- **Shared pomodoro count:** All timers contribute to one global `pomodoroCount`.
  Completing a work session on any tab advances the shared counter.

- **Independent breaks:** When timer A's work session completes, A's tab auto-starts a break.
  All other running timers continue unaffected. The shared count advances but the break
  only lands on the completing tab. This is intentional — the user is doing different things
  on different tabs and doesn't want parallel timers frozen for a break on an unrelated tab.

- **Popup shows current tab's timer:** Opening the popup always shows the timer for whichever
  tab is currently active. If that tab has no timer, the popup shows the idle state with a
  "Start" button (which creates a new timer instance for that tab).

- **Tab close tears down its timer:** When a bound tab is closed, its timer instance is
  removed from the pool. `finalizeWorkSession(false)` is called if the session was in progress,
  consistent with current behavior.

- **Settings remain global:** All timer instances share one settings object. Changing work
  duration affects new sessions on all tabs (in-flight sessions use their already-computed
  `sessionDuration`).

- **History is per-session, shared store:** History entries are written by whichever timer
  completes. The `_historyChain` serialization prevents concurrent write races across instances.

## Architectural Impact

The background changes are the heaviest part. The current `state` singleton becomes a
`Map<tabId, TimerInstance>`. Each `TimerInstance` is a plain object containing the fields
currently in `state` (mode, startTimestamp, elapsedMs, sessionDuration, autoPaused,
sessionStart, sessionDomain) plus its own `tickInterval` handle.

Functions that currently close over `state` (startSession, stopSession, tick, broadcastState, etc.)
are refactored to accept a `TimerInstance` argument or to operate on the instance identified
by the routing message. `pomodoroCount`, `settings`, `_historyChain`, and `_lastBadgeText`
remain module-level globals.

The message handler needs to route incoming messages to the correct instance. The routing key
is `sender.tab.id` for messages from content scripts and the popup's active tab for popup
messages. `GET_STATE` / `STATE_UPDATE` / `START` / `STOP` / `SKIP_BREAK` all need to know
which instance to address.

Content scripts are unchanged — each already runs in its own tab and communicates with its
own progress bar. The only change is that `UPDATE_BAR` is now dispatched per-instance rather
than from the single global tick.

The popup is largely unchanged — it still calls `GET_STATE`, renders a single timer view,
and sends `START`/`STOP` referring to the current tab's instance.

## Resolved Questions

1. **What does the popup show when the current tab has no active timer?**
   → Idle state with a Start button. Creates a new instance for this tab on Start.
   Consistent with today's UX; no new UI needed.

2. **What happens to a timer if its tab navigates to a new URL mid-session?**
   → Timer instance is keyed by tabId, so navigation doesn't destroy it. Domain is
   snapshotted at session start — history records the correct site. No action needed.

3. **Badge behavior with multiple timers running?**
   → Badge always reflects the currently-focused tab's timer. Switches automatically
   on tab focus. Badge color and text match the active-tab instance.

4. **Notification text when multiple timers are running?**
   → Use global count: "Pomo 6 done!" — consistent with today's behavior. The shared
   counter is the source of truth; per-tab count would require new per-instance tracking.

## Next Steps

→ Resolve Open Questions 3 and 4, then `/workflows:plan` for implementation details.
