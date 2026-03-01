# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pomo is a Firefox WebExtension (Manifest V2) Pomodoro timer. No build step, no bundler, no npm — plain JS files loaded directly by Firefox.

## Loading and reloading the extension

```bash
# Load for the first time
# Firefox → about:debugging → This Firefox → Load Temporary Add-on → select manifest.json

# Reload after code changes
# Firefox → about:debugging → find Pomo → Reload
```

There are no automated tests. Verification is manual in the browser.

## Key architectural constraint: `persistent: true`

The background page **must** stay `"persistent": true` in `manifest.json`. Each active timer is a live `setInterval` handle inside a `TimerInstance`. If the background is suspended (MV3 service worker model), all handles are destroyed mid-session. Do not remove `persistent: true` without replacing `setInterval` with `browser.alarms`.

## Multi-timer pool model

The extension runs **one `TimerInstance` per tab**, stored in:

```js
const timers = new Map(); // Map<tabId, TimerInstance>
```

`pomodoroCount`, `settings`, `_historyChain`, and `_lastBadgeText` are module-level globals shared across all instances. Every session-touching function accepts `inst` as its first argument — there is no global `state` singleton.

**Message routing:**
- The popup is an extension page (no `sender.tab.id`). It resolves `currentTabId` via `browser.tabs.query` on open and includes `tabId` in every outgoing message.
- `GET_STATE` uses `timers.get(msg.tabId)` — never `resolveInstance()` — to avoid creating ghost instances.
- `resolveInstance(tabId)` creates an instance only for mutating actions (`START`, `BIND_TAB`).
- `STATE_UPDATE` pushes include `tabId`; the popup filters by `msg.tabId === currentTabId`.

## IPC protocol

All three contexts communicate via `browser.runtime.sendMessage` / `browser.tabs.sendMessage`. The background message handler is the only stateful endpoint. Key messages:

| Message | Who sends | tabId required |
|---|---|---|
| `GET_STATE` | popup | yes |
| `START` / `STOP` / `SKIP_BREAK` | popup | yes |
| `BIND_TAB` / `UNBIND_TAB` | agent only | yes |
| `CONTENT_READY` | content script | via `sender.tab.id` |
| `STATE_UPDATE` | background → popup | yes (for filtering) |
| `UPDATE_BAR` | background → content | n/a (targeted by `tabs.sendMessage`) |

## Async hazards — patterns already in place

1. **Snapshot before `await`** — `logSession(inst, ...)` captures `inst.mode`, `inst.sessionDomain`, etc. synchronously before the first `await`. Do not move these reads after any `await`.
2. **`_historyChain`** — all `appendToHistory` calls are serialized through a promise chain. Never `await browser.storage.local.get("history")` outside this chain.
3. **`_activityCheckGen`** — generation counter in `checkBoundTabActivity` discards stale `tabs.query` callbacks. Keep this pattern if modifying focus-change logic.
4. **Favicon generation counter** — `faviconOverlay.apply()` in `content.js` increments `gen`; stale `img.onload` callbacks are silenced.

## Persistence schema

```js
// storage.local keys:
timerStates: { [tabId: string]: TimerInstance snapshot }  // tickInterval excluded
pomodoroCount: number
settings: { workDuration, breakDuration, longBreakDuration, longBreakInterval, completionThreshold }
history: SessionEntry[]
```

`init()` handles schema migration from the old single-key `timerState` (singular). On browser restart, each stored instance is validated with `browser.tabs.get(tabId)`; tabs that no longer exist are silently discarded.

## Security invariants

- Message handler opens with `if (sender.id && sender.id !== browser.runtime.id) return false` — do not remove.
- `SAVE_SETTINGS` destructures only the five known keys before calling `sanitizeSettings()` — do not spread `msg.settings` directly.
- History renderer uses `textContent`, never `innerHTML`.
- Favicon URL scheme is validated against `["http:", "https:", "data:"]` before `img.src` assignment.
- `ctx.drawImage()` on the favicon canvas is wrapped in `try/catch` (CORS taint fallback).

## Review agents (from compound-engineering.local.md)

For significant PRs, run: `security-sentinel`, `performance-oracle`, `architecture-strategist`, `julik-frontend-races-reviewer`, `code-simplicity-reviewer`.
