---
title: "feat: Multi-timer pool — parallel Pomodoros per tab"
type: feat
status: completed
date: 2026-03-01
origin: docs/brainstorms/2026-03-01-multi-timer-brainstorm.md
---

# feat: Multi-timer pool — parallel Pomodoros per tab

## Overview

Replace the current single-timer state singleton with a `Map<tabId, TimerInstance>` pool.
Each tab gets its own independent timer, progress bar, and favicon overlay. Timers run in
parallel; completing a session on any tab advances a single shared `pomodoroCount`. The popup
always shows the timer belonging to the currently-focused tab. The badge tracks the focused
tab's timer and switches automatically on tab focus.

This is a significant architectural refactor of `background/background.js`. The other two
files (`content.js`, `content.css`) require no changes. `popup.js` requires one small change:
it must learn its own `tabId` on open and include it in every outgoing message.

See brainstorm: `docs/brainstorms/2026-03-01-multi-timer-brainstorm.md`

---

## Problem Statement

Today exactly one timer can be active at a time. A user who works across two projects on
two different tabs must stop timer A, switch to tab B, and start timer B. Their context on
tab A is lost. The single `state` singleton, a single `tickInterval`, and single `boundTabId`
all enforce this constraint structurally. Removing it requires replacing the singleton with
a keyed pool.

---

## Proposed Solution

### Timer Instance

Each timer instance is a plain object that contains the per-tab fields currently on `state`:

```js
// background/background.js

function createTimerInstance(tabId) {
  return {
    tabId,
    mode: "idle",
    startTimestamp: null,
    elapsedMs: 0,
    sessionDuration: null,
    autoPaused: false,
    sessionStart: null,
    sessionDomain: null,
    tickInterval: null,   // handle returned by setInterval
  };
}
```

`tickInterval` moves into the instance — each timer runs its own 1 Hz `setInterval`.

### The Pool

```js
const timers = new Map(); // Map<tabId, TimerInstance>
```

The `state` singleton and the module-level `let tickInterval = null` are removed.

### Shared Globals (unchanged)

```js
let settings       = { ...DEFAULT_SETTINGS };
let pomodoroCount  = 0;             // moved from per-instance to module scope
let _historyChain  = Promise.resolve();
let _lastBadgeText = null;          // tracks badge for the focused tab
let _activityCheckGen   = 0;
let _activityCheckTimer = null;
let initialized    = false;
```

`pomodoroCount` was previously inside `state`. It moves to module scope because it is shared
across all instances (see brainstorm: shared count decision).

---

## Technical Approach

### Phase 1 — Instance Factory + Pool

**`background/background.js`**

1. Delete the `const state = { ... }` declaration (lines 29–39) and `let tickInterval = null` (line 42).
2. Add `createTimerInstance(tabId)` factory as defined above.
3. Add `const timers = new Map()`.
4. Add `let pomodoroCount = 0` at module scope.

No functional changes yet — this phase is purely structural.

---

### Phase 2 — Refactor All State-Touching Functions to Accept an Instance

Every function that currently closes over `state` must accept `inst` as a parameter.
`pomodoroCount` and `settings` are accessed directly from module scope (unchanged pattern).

**Signature changes (background/background.js):**

```js
// Elapsed helpers
function currentElapsed(inst)   // was: reads state.mode, state.autoPaused, etc.
function progress(inst)
function remaining(inst)

// Tick
function startTick(inst)        // sets inst.tickInterval = setInterval(() => tick(inst), 1000)
function stopTick(inst)         // clearInterval(inst.tickInterval); inst.tickInterval = null
function tick(inst)             // calls broadcastState(inst) or onSessionComplete(inst)

// Session lifecycle
async function startSession(inst, mode)   // was: startSession(mode)
function stopSession(inst)
function onSessionComplete(inst)
function skipBreak(inst)
function resetToIdle(inst)      // on completion: timers.delete(inst.tabId) [see Phase 4]

// Tab activity
function checkBoundTabActivity()  // iterates timers pool — signature unchanged externally

// History
function finalizeWorkSession(inst, fullyCompleted)
async function logSession(inst, completed, pctComplete)

// UI / IPC
function publicState(inst)
function broadcastState(inst)   // sends UPDATE_BAR to inst.tabId; STATE_UPDATE to popup
function updateBadge(inst)      // inst may be undefined (no timer on focused tab → clear badge)

// Persistence
async function persistState()   // serializes entire timers pool + pomodoroCount
function safePersist()          // unchanged wrapper
```

**Implementation note — `onSessionComplete(inst)`:**

`onSessionComplete` calls `startSession(inst, nextBreak)` at the end.
`startSession` is `async`. `onSessionComplete` must `await` it for the break session to
correctly snapshot the domain before `broadcastState`. Change `onSessionComplete` to `async`:

```js
async function onSessionComplete(inst) {
  stopTick(inst);
  if (inst.mode === "work") finalizeWorkSession(inst, true);

  const wasWork = inst.mode === "work";
  const pomosSnap = pomodoroCount; // snapshot before possible reset
  notify(wasWork, pomosSnap);

  if (wasWork) {
    const nextBreak = pomosSnap >= settings.longBreakInterval ? "longBreak" : "break";
    if (nextBreak === "longBreak") pomodoroCount = 0;
    await startSession(inst, nextBreak);   // inst reused — same tab gets the break
  } else {
    // Break finished — remove instance; tab returns to idle
    timers.delete(inst.tabId);
    broadcastState(inst);  // sends idle state to bar and popup
    safePersist();
    updateBadge(undefined); // focused tab now has no timer
  }
}
```

**`logSession(inst, ...)` snapshot before await:**

```js
async function logSession(inst, completed, pctComplete) {
  const snapshot = {       // synchronous capture before any await
    mode:      inst.mode,
    domain:    inst.sessionDomain,
    startTime: inst.sessionStart,
    elapsed:   Math.round(currentElapsed(inst)),
  };
  if (snapshot.mode === "idle") return;
  const entry = { type: snapshot.mode, domain: snapshot.domain, ... };
  await appendToHistory(entry);
}
```

`_historyChain` remains module-level — all instances serialize through it (see brainstorm:
"_historyChain serialization prevents concurrent write races across instances").

---

### Phase 3 — Message Routing

#### Popup → Background: tabId via popup startup

The popup does not have a `sender.tab.id` (it is an extension page, not a tab). The popup
must learn its associated tab on open and include `tabId` in every outgoing message.

**`popup/popup.js` — add tab identification (top of file):**

```js
let currentTabId = null;

// On popup open: identify the active tab
browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  currentTabId = tab?.id ?? null;
  return browser.runtime.sendMessage({ type: "GET_STATE", tabId: currentTabId });
}).then((state) => {
  renderTimerState(state);
  loadSettings(state.settings);
});
```

**All action messages include `tabId`:**

```js
elStart.addEventListener("click", () => {
  browser.runtime.sendMessage({ type: "START", tabId: currentTabId });
});
elStop.addEventListener("click", () => {
  browser.runtime.sendMessage({ type: "STOP", tabId: currentTabId });
});
elSkip.addEventListener("click", () => {
  browser.runtime.sendMessage({ type: "SKIP_BREAK", tabId: currentTabId });
});
```

**STATE_UPDATE filtering — popup ignores updates for other tabs:**

```js
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "STATE_UPDATE" && msg.tabId === currentTabId) {
    renderTimerState(msg.state);
  }
});
```

#### Background routing — by `msg.tabId`

The message handler resolves the target instance for every action:

```js
function resolveInstance(tabId) {
  // returns existing instance or a fresh idle one for the tab
  if (!timers.has(tabId)) {
    const inst = createTimerInstance(tabId);
    timers.set(tabId, inst);
  }
  return timers.get(tabId);
}
```

Updated switch cases (background/background.js):

```js
case "GET_STATE": {
  const inst = timers.get(msg.tabId);   // may be undefined — no timer for this tab
  reply(inst ? publicState(inst) : idlePublicState());
  return false;
}

case "START": {
  const inst = resolveInstance(msg.tabId);
  const mode = ["work","break","longBreak"].includes(msg.mode) ? msg.mode : "work";
  startSession(inst, mode);
  reply({ ok: true });
  return false;
}

case "STOP": {
  const inst = timers.get(msg.tabId);
  if (!inst || inst.mode === "idle") { reply({ ok: false, reason: "not running" }); return false; }
  stopSession(inst);
  timers.delete(msg.tabId);
  reply({ ok: true });
  return false;
}

case "SKIP_BREAK": {
  const inst = timers.get(msg.tabId);
  if (!inst || (inst.mode !== "break" && inst.mode !== "longBreak")) {
    reply({ ok: false, reason: "not in break" }); return false;
  }
  skipBreak(inst);
  timers.delete(msg.tabId);
  reply({ ok: true });
  return false;
}
```

**Add `idlePublicState()` helper for tabs with no timer:**

```js
function idlePublicState() {
  return {
    mode: "idle",
    progress: 0,
    remaining: settings.workDuration * 60000,
    autoPaused: false,
    pomodoroCount,
    boundTabId: null,
    settings: { ...settings },
  };
}
```

#### Content → Background: routing via `sender.tab.id`

Content scripts use `CONTENT_READY`. `sender.tab.id` is available. The handler replies with
the instance state for that tab (or idle state if no instance exists):

```js
case "CONTENT_READY": {
  const inst = timers.get(sender.tab.id);
  reply({ tabId: sender.tab.id, state: inst ? publicState(inst) : idlePublicState() });
  return false;
}
```

#### `broadcastState(inst)` — includes `tabId`

```js
function broadcastState(inst) {
  const ps = publicState(inst);
  // Push to the content script on this tab
  browser.tabs.sendMessage(inst.tabId, {
    type: "UPDATE_BAR",
    state: ps,
  }).catch(() => {});
  // Push to popup — only the popup for this tab will apply it (filtered by tabId)
  browser.runtime.sendMessage({ type: "STATE_UPDATE", tabId: inst.tabId, state: ps }).catch(() => {});
}
```

Remove the `isBoundTab` field — it is no longer meaningful (every timer is inherently bound
to its own tab).

**`BIND_TAB` / `UNBIND_TAB`:** Remove from the popup UI (the bind button). Keep as agent-only
IPC for programmatic use. `BIND_TAB` with a `tabId` creates/moves an instance. `UNBIND_TAB`
removes an instance gracefully (calls `finalizeWorkSession(false)` if work was running).

---

### Phase 4 — Event Listeners

**`browser.tabs.onRemoved`:**

```js
browser.tabs.onRemoved.addListener((tabId) => {
  const inst = timers.get(tabId);
  if (!inst) return;
  finalizeWorkSession(inst, false);
  timers.delete(tabId);
  safePersist();
});
```

**`browser.tabs.onActivated` / `browser.windows.onFocusChanged`:**

Both remain connected to `scheduleActivityCheck`. Add badge update on activation:

```js
browser.tabs.onActivated.addListener(({ tabId }) => {
  updateBadge(timers.get(tabId)); // undefined if no timer on newly-focused tab
  scheduleActivityCheck();
});
```

**`checkBoundTabActivity` — iterates pool:**

```js
function checkBoundTabActivity() {
  if (timers.size === 0) return;
  const myGen = ++_activityCheckGen;

  browser.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => {
    if (myGen !== _activityCheckGen) return;
    const activeTabId = tabs.length > 0 ? tabs[0].id : null;

    for (const [tabId, inst] of timers) {
      if (inst.mode === "idle") continue;
      const isActive = tabId === activeTabId;

      if (isActive && inst.autoPaused) {
        inst.startTimestamp = Date.now() - inst.elapsedMs;
        inst.autoPaused = false;
        broadcastState(inst);
        safePersist();
      } else if (!isActive && !inst.autoPaused) {
        inst.elapsedMs = Date.now() - inst.startTimestamp;
        inst.autoPaused = true;
        broadcastState(inst);
        safePersist();
      }
    }
  });
}
```

**Auto-pause behavior implication:** With multiple timers, only the focused tab's timer runs;
all others auto-pause when their tab is not the active window. This is correct for a focus
tracker — you can only work on one tab at a time — and consistent with the existing auto-pause
semantics.

**`updateBadge(inst)`:**

```js
function updateBadge(inst) {
  if (!inst || inst.mode === "idle") {
    if (_lastBadgeText !== "") {
      browser.browserAction.setBadgeText({ text: "" });
      _lastBadgeText = "";
    }
    return;
  }
  const mins = Math.ceil(remaining(inst) / 60000);
  const label = inst.mode === "work" ? String(mins) : inst.mode === "longBreak" ? "LB" : "B";
  if (label !== _lastBadgeText) {
    browser.browserAction.setBadgeText({ text: label });
    _lastBadgeText = label;
  }
  browser.browserAction.setBadgeBackgroundColor({
    color: inst.mode === "work" ? "#E05A4A" : "#52C78E",
  });
}
```

Badge color must also update when the focused tab changes — the old code set it once per
`startSession`. Now it's set in `updateBadge` each time it changes.

---

### Phase 5 — Persistence Migration

#### New Storage Schema

```js
// NEW — timerStates is a plain object keyed by tabId (string)
{
  timerStates: {
    "42": { mode, startTimestamp, elapsedMs, sessionDuration,
            autoPaused, sessionStart, sessionDomain },
    "57": { mode, ... }
  },
  pomodoroCount: 6,    // moved out of per-instance
  settings: { ... },
  history:  [ ... ]
}
```

`tickInterval` is excluded from the snapshot (it's a live handle, meaningless to persist).

#### `persistState()`

```js
async function persistState() {
  const timerStates = {};
  for (const [tabId, inst] of timers) {
    const { tickInterval, ...snapshot } = inst;   // exclude live handle
    timerStates[String(tabId)] = snapshot;
  }
  await browser.storage.local.set({ timerStates, pomodoroCount });
}
```

#### `init()` — Schema Migration + Multi-Instance Restore

```js
async function init() {
  const stored = await browser.storage.local.get(
    ["settings", "timerState", "timerStates", "pomodoroCount", "history"]
  );

  // Settings
  if (stored.settings) {
    settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored.settings });
  }

  // History pruning
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const history = (stored.history || []).filter((e) => e.startTime > cutoff);
  if (history.length !== (stored.history || []).length) {
    browser.storage.local.set({ history });
  }

  // Shared count
  pomodoroCount = Number.isInteger(stored.pomodoroCount) ? stored.pomodoroCount : 0;

  // Schema migration: old single timerState → extract pomodoroCount, discard timer
  if (stored.timerState && !stored.timerStates) {
    pomodoroCount = stored.timerState.pomodoroCount || pomodoroCount;
    await browser.storage.local.remove("timerState");
    await browser.storage.local.set({ pomodoroCount });
    // Old single timer is discarded — tab IDs don't survive across browser restarts reliably
  }

  initialized = true;

  // Restore multi-instance state
  if (stored.timerStates) {
    const restorePromises = Object.entries(stored.timerStates).map(async ([tabIdStr, snap]) => {
      const tabId = parseInt(tabIdStr, 10);

      // Verify the tab still exists
      try {
        await browser.tabs.get(tabId);
      } catch {
        return; // tab no longer open — discard this instance
      }

      const inst = createTimerInstance(tabId);
      const completed = deserializeInstance(snap, inst);
      timers.set(tabId, inst);

      if (completed) {
        await onSessionComplete(inst);
      } else if (inst.mode !== "idle") {
        startTick(inst);
        updateBadge(inst);
      }
    });

    await Promise.all(restorePromises);
  }
}
```

#### `deserializeInstance(snap, inst)`

Replaces `deserializeState`. Populates `inst` in place (instead of mutating global `state`).
Returns `boolean` (true = completed offline).

```js
function deserializeInstance(snap, inst) {
  snap = validateStoredState(snap);
  Object.assign(inst, snap);
  inst.tickInterval = null; // not persisted

  if (!snap.autoPaused && snap.startTimestamp) {
    const elapsed = Date.now() - snap.startTimestamp;
    if (elapsed >= snap.sessionDuration) {
      inst.elapsedMs = snap.sessionDuration;
      inst.startTimestamp = Date.now() - snap.sessionDuration;
      return true; // completed offline
    }
    inst.elapsedMs = elapsed;
    inst.startTimestamp = Date.now() - inst.elapsedMs;
  }
  return false;
}
```

`validateStoredState` is unchanged — it does not reference `pomodoroCount` so it works
per-instance without modification.

---

### Phase 6 — Popup: Remove Bind Button

The bind concept is replaced by the implicit per-tab timer. Remove from `popup.html` and
`popup.js`:

- `<button class="btn-bind" id="btn-bind">` and `<span class="bind-status">` elements
- `elBind`, `elBindStatus` element references in `popup.js`
- The bind button `click` listener
- `elBind.disabled = sessionActive` logic in `renderTimerState`
- The `bound` / `bind-status` rendering in `renderTimerState`

Remove from `popup.css`:
- `.btn-bind`, `.btn-bind.bound`, `#btn-bind:disabled` rules

Keep `BIND_TAB` / `UNBIND_TAB` as IPC messages for agent use only.

---

## System-Wide Impact

### Interaction Graph

```
User clicks START on tab B
  → popup.js sends { type: "START", tabId: 42 }
  → background.js onMessage: resolveInstance(42) → creates new TimerInstance
  → startSession(inst, "work")
    → awaits browser.tabs.get(42) → sets inst.sessionDomain
    → startTick(inst) → setInterval(() => tick(inst), 1000)
    → broadcastState(inst)
      → tabs.sendMessage(42, UPDATE_BAR) → content.js on tab 42 → updateBar()
      → runtime.sendMessage(STATE_UPDATE, tabId:42) → popup.js applies if tabId matches
    → safePersist() → persistState() → storage.local.set({ timerStates, pomodoroCount })
    → updateBadge(inst) → setBadgeText("25")

  [1 second later — tick fires]
  → tick(inst): elapsedMs updated → broadcastState(inst) → updateBadge(inst)
  [only tab 42's bar updates; tab A's bar is updated by tab A's own instance tick]
```

### Error Propagation

- `startSession(inst, mode)` is async. Caller `resolveInstance` + message handler must return
  `true` for async reply if needed — or `startSession`'s result can be fire-and-forget if the
  reply does not depend on domain resolution completing.
- `logSession` failure: caught by `.catch` in `finalizeWorkSession`; logged to console;
  `pomodoroCount` already incremented. No rollback. Consistent with current behavior.
- `persistState()` failure: caught by `safePersist()`; logged; timer continues.
- `browser.tabs.get` failure in `startSession`: caught; `inst.sessionDomain = null`. Session
  proceeds with null domain (logged in history entry).

### State Lifecycle Risks

| Risk | Mitigation |
|---|---|
| Two timers complete same tick | `_historyChain` serializes all `appendToHistory` calls |
| rapidSTOP + tab close simultaneously | `timers.delete` is idempotent; `finalizeWorkSession` guards on `inst.mode !== "work"` |
| Instance in map after `resetToIdle` | `resetToIdle` calls `timers.delete(inst.tabId)` — instance removed from pool on idle |
| Stale activity check sees deleted instance | `checkBoundTabActivity` iterates `timers` at query-resolution time — deleted instances won't be in the map |
| `pomodoroCount` double-increment if two instances finalize simultaneously | `finalizeWorkSession` increments synchronously before any `await`; JS is single-threaded in the background page — no data race |

### API Surface Parity

| Message | Old behavior | New behavior |
|---|---|---|
| `START` | Starts global timer | Starts timer for `msg.tabId`; creates instance if none |
| `STOP` | Stops global timer | Stops timer for `msg.tabId`; removes instance |
| `SKIP_BREAK` | Skips global break | Skips break for `msg.tabId`; removes instance |
| `GET_STATE` | Returns global state | Returns instance state for `msg.tabId` or idle state |
| `BIND_TAB` | Associates timer with a tab | Creates instance for `msg.tabId` (agent use only) |
| `UNBIND_TAB` | Disassociates timer | Stops and removes instance for `msg.tabId` |
| `CONTENT_READY` | Returns global state to content script | Returns instance state for `sender.tab.id` |
| `STATE_UPDATE` push | Sent once per tick globally | Sent per-instance tick; includes `tabId` |
| `SAVE_SETTINGS` | Unchanged | Unchanged — settings are global |
| `GET_HISTORY` | Unchanged | Unchanged — history is global |

### Integration Test Scenarios

1. **Parallel timers, independent completion**: Start timer on tab A and tab B. Tab A completes.
   Verify: tab A enters break, tab B continues work, `pomodoroCount` increments by exactly 1,
   history has one new entry.

2. **Badge switches on tab focus**: Start timers on tab A (22 min remaining) and tab B (8 min
   remaining). Focus tab A → badge shows "22". Focus tab B → badge shows "8".

3. **Auto-pause across pool**: Start timers on tabs A and B. Focus tab A. Wait 5 seconds.
   Verify tab A's elapsed advanced by ~5s; tab B's elapsed unchanged (auto-paused).

4. **Closed tab teardown**: Start timer on tab A. Close tab A mid-work-session. Verify:
   `timers.get(tabId)` returns undefined; history has one entry with `completed: false`;
   `pomodoroCount` unchanged.

5. **Browser restart recovery**: Start timers on two tabs. Simulate restart (re-call `init()`
   with mocked storage). Verify: instances restore correctly for tabs that still exist;
   instances for closed tabs are discarded.

---

## Acceptance Criteria

### Functional

- [x] Starting the timer on tab A while tab B's timer is running creates a second independent timer; both progress bars animate
- [x] The popup on tab A shows tab A's timer; popup on tab B shows tab B's timer
- [x] Completing a work session on tab A starts a break on tab A and leaves tab B's timer running
- [x] Every work-session completion increments the shared `pomodoroCount`; `pomodoroCount` is not double-incremented under concurrent completion
- [x] Closing a tab with a running timer logs an abandoned session (`completed: false`) and removes the instance
- [x] The badge shows the focused tab's timer state and switches correctly on tab focus
- [x] All timers except the focused tab's auto-pause when focus changes
- [x] Settings changes take effect on the next new session (in-flight sessions use their computed `sessionDuration`)
- [x] Browser restart restores timer instances for tabs that are still open; instances for closed tabs are silently discarded
- [x] `STOP` and `SKIP_BREAK` return `{ ok: false, reason: "..." }` when the target tab has no active timer
- [x] The popup idle view shows the correct `workDuration` countdown even when no timer is running

### Structural

- [x] `const state = {}` singleton removed from `background/background.js`
- [x] `timers: Map<tabId, TimerInstance>` is the only timer storage
- [x] `pomodoroCount` is module-level, not per-instance
- [x] All session-touching functions accept a `TimerInstance` argument
- [x] `deserializeInstance` replaces `deserializeState` (no `Object.assign` into global `state`)
- [x] Storage key `timerState` (old singular) is migrated to `timerStates` (plural map) on first run
- [x] `popup.js` sends `tabId` with every action message
- [x] `STATE_UPDATE` push includes `tabId`; popup filters by `tabId`
- [x] Bind button removed from popup UI; `BIND_TAB`/`UNBIND_TAB` kept as agent IPC

### Non-Functional

- [x] Multiple `setInterval` handles run in the persistent background page without memory leak
- [x] `persistState` is never called from `tick()` — only on transitions
- [x] `_historyChain` serializes writes from all instances
- [x] Existing `_activityCheckGen` generation counter applies to the whole-pool check (not per-instance)

---

## Dependencies & Prerequisites

- Storage schema change (`timerState` → `timerStates`) is a breaking change for existing
  persisted state. Migration in `init()` must handle both schemas. Users mid-session at
  upgrade time will lose their in-flight timer (it is discarded, not migrated — tab IDs
  don't survive browser restarts reliably anyway).
- No external dependencies. No manifest changes. No new permissions required.

---

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Multiple `setInterval`s consuming CPU | Low | Low | Idle timers excluded; active timers are 1 Hz; browser handles N timers efficiently |
| Race: two instances finalize in same event loop turn | Low | Medium | JS is single-threaded in background page; `_historyChain` serializes writes |
| Storage migration discards in-flight session | Medium | Low | Expected; document in release notes; session was not counted yet |
| Popup tabId stale after tab navigates | Low | Low | tabId is stable across navigations; only changes if popup is opened on a different tab |
| `resolveInstance` creates an instance for every GET_STATE | High | Medium | `GET_STATE` must NOT call `resolveInstance`; use `timers.get(tabId)` (read-only) |

---

## Implementation Commit Sequence

Per CLAUDE.md: "Never mix structural and behavioral changes in the same commit."

1. **Structural commit**: Add `createTimerInstance`, `timers = new Map()`, `pomodoroCount` global;
   refactor all functions to accept `inst`; update `persistState`/`deserializeInstance`.
   The extension still only manages one timer (the `init()` call still wires one instance).

2. **Behavioral commit**: Update message handler routing (`msg.tabId`), `onActivated`/`onFocusChanged`
   badge update, `checkBoundTabActivity` pool iteration, `onRemoved` pool cleanup.

3. **Popup commit**: Add `currentTabId` initialization, `tabId` in outgoing messages, `tabId`
   filter on `STATE_UPDATE`.

4. **UI commit**: Remove bind button from `popup.html`, `popup.js`, `popup.css`.

---

## Future Considerations

- **Timer list panel**: If users want to see all running timers at once, a popup tab showing a
  list of `[tabId, domain, mode, remaining]` rows could be added with minimal background changes.
- **Per-timer settings**: Currently all instances share one `settings` object. A future extension
  could let users configure different durations per tab/domain.
- **MV3 migration**: The multi-instance model makes MV3 migration harder (more state to
  reconstruct on each service-worker wake). Each instance would need to restore from storage
  on every alarm tick. Consider this before committing to the pattern.

---

## Sources & References

### Origin

- **Brainstorm document:** `docs/brainstorms/2026-03-01-multi-timer-brainstorm.md`
  Key decisions carried forward: timer pool (not cap, not persistence-only); shared
  `pomodoroCount`; independent breaks; popup shows current tab's timer; badge tracks focused tab.

### Internal References

- `background/background.js` — full current implementation (510 lines), all functions listed in research
- `popup/popup.js:259` — `GET_STATE` fetch on popup open (add `currentTabId` before this)
- `popup/popup.js:118–133` — all action event listeners (add `tabId` to each `sendMessage`)
- `content/content.js:177` — `CONTENT_READY` handshake (no changes needed)
- `docs/solutions/architecture-patterns/firefox-extension-architecture-and-review-patterns.md` —
  async snapshot pattern, generation counters, IPC targeting, hot-path persistence rules
- `ARCHITECTURE.md` — full system description including storage schema (§7.1), concurrency
  model (§8), and permission analysis (§4)
