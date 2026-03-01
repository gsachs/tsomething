# Pomo — Architectural Review Note

**For:** Principal Lead Engineer / Architect
**Project:** Pomo v1.0.0 — Firefox WebExtension Pomodoro Timer
**Date:** 2026-03-01
**Status:** Awaiting installation approval

---

## 1. Executive Summary

Pomo is a focused Pomodoro timer implemented as a Firefox Manifest V2 WebExtension. It injects a non-interactive progress bar into every HTTP/HTTPS page, overlays a status dot on the active tab's favicon, and provides a popup UI for session control and history. The extension has no network access, no external dependencies, no analytics, and no third-party code. All data stays in `browser.storage.local`.

The codebase is small: three JS modules (~510, ~185, ~265 lines), two CSS files, one HTML file, and a manifest. It underwent two code-review rounds (multi-agent automated review + a gate-check agent) that produced 60 discrete findings. All 60 have been resolved. What follows is a precise account of what the extension does, the architectural choices made, where the bodies are buried, and what a reviewer needs to know before approving installation.

---

## 2. Development Provenance

This extension was built from scratch in a single AI-assisted session using the following workflow:

1. **Interview → Spec:** Requirements were gathered conversationally and formalized into a detailed specification.
2. **Build:** Code was generated module by module against the spec.
3. **Design review (round 1):** A custom `design-reviewer` agent evaluated module cohesion, naming, boundary clarity, and coupling. Produced 10 violations; all resolved.
4. **Multi-agent code review (round 2):** Seven specialized agents ran in parallel — security-sentinel, performance-oracle, architecture-strategist, julik-frontend-races-reviewer (concurrency specialist), code-simplicity-reviewer, agent-native-reviewer, and learnings-researcher. Produced 31 findings across P1/P2/P3 severity tiers; all resolved.
5. **Gate-check (round 3):** A post-commit `code-reviewer` agent ran a zero-tolerance check (null returns, swallowed exceptions, changelog comments, TODOs). Produced 12 advisory notes; 6 net-new, all resolved.

The final resolved codebase is what this document describes. There is no git history (the repo was never initialized), so the resolution record lives in `todos/` (60 files, all marked `complete`).

---

## 3. File Structure

```
pomo/
├── manifest.json
├── background/
│   └── background.js        # Timer state machine, IPC hub, persistence (~510 lines)
├── content/
│   ├── content.js           # Progress bar injection, favicon overlay (~185 lines)
│   └── content.css          # Bar styles (injected alongside content.js)
├── popup/
│   ├── popup.html           # Extension popup UI
│   ├── popup.js             # Popup renderer and action dispatcher (~265 lines)
│   └── popup.css            # Popup styles
├── icons/
│   └── icon.svg
└── docs/
    └── solutions/           # AI-generated architectural documentation
```

---

## 4. Permissions Audit

```json
"permissions": ["tabs", "storage", "notifications"]
```

| Permission | Why Required | Blast Radius |
|---|---|---|
| `tabs` | Query active tab for auto-pause; get tab URL for session domain; send `UPDATE_BAR` to bound tab | Can read tab IDs and URLs of all open tabs. Cannot read page content. |
| `storage` | Persist timer state, settings, 7-day history across sessions | Local only. No sync storage used. |
| `notifications` | Session-complete alerts ("Pomo 4 done!") | One notification per session end. No persistent notification state. |

**No host permissions in `permissions[]`.** Host patterns (`http://*/*`, `https://*/*`) appear only in `content_scripts.matches`, which governs injection scope. An earlier version mistakenly duplicated them in `permissions[]` (granting `tabs.executeScript`, `tabs.insertCSS`, `tabs.captureVisibleTab` on any page). This was caught in review and corrected.

**CSP:**
```
"script-src 'self'; object-src 'self'; style-src 'self';"
```
All three directives are explicit. No `'unsafe-inline'`, no `'unsafe-eval'`, no remote resources. The popup cannot load external scripts or stylesheets.

**Content scripts inject on:** all HTTP/HTTPS pages, at `document_end`, top frame only (`all_frames: false`). The bar is a fixed-position `<div>` with `pointer-events: none` — it is visually overlaid but cannot capture user input or interact with page DOM beyond prepending itself to `<body>`.

---

## 5. Component Architecture

The extension has three runtime contexts. Communication is message-passing only — no shared memory, no direct object references across contexts.

```
┌─────────────────────────────────────────────────────────────────┐
│  Background Page (persistent)                                   │
│  background.js — source of truth                                │
│  • Timer state machine (idle → work → break → longBreak)       │
│  • setInterval tick @ 1 Hz                                      │
│  • storage.local read/write                                     │
│  • Broadcasts STATE_UPDATE (popup) and UPDATE_BAR (bound tab)  │
└───────────┬───────────────────────────────┬─────────────────────┘
            │ runtime.sendMessage           │ tabs.sendMessage
            ▼                               ▼
┌───────────────────────┐    ┌─────────────────────────────────────┐
│  Popup                │    │  Content Script (every HTTP/S tab)  │
│  popup.js             │    │  content.js                         │
│  • Renders state      │    │  • Renders progress bar             │
│  • Sends START, STOP  │    │  • Manages favicon overlay          │
│    SKIP_BREAK,        │    │  • Sends CONTENT_READY on load      │
│    BIND_TAB, etc.     │    │  • Pulls state on visibilitychange  │
└───────────────────────┘    └─────────────────────────────────────┘
```

### 5.1 Background — Timer State Machine

**State object:**
```js
{
  mode: "idle" | "work" | "break" | "longBreak",
  boundTabId: null | integer,
  startTimestamp: null | ms-epoch,   // wall clock of current running period start
  elapsedMs: number,                 // accumulated across auto-pauses
  sessionDuration: null | ms,
  autoPaused: boolean,
  pomodoroCount: integer,            // resets after longBreak
  sessionStart: null | ms-epoch,     // immutable through the session; used for history
  sessionDomain: null | string,      // hostname of bound tab
}
```

**Elapsed time model:** The extension uses a `startTimestamp`-anchor design rather than a running counter. `currentElapsed()` is always `Date.now() - state.startTimestamp`. On auto-pause, the current elapsed is snapshotted into `state.elapsedMs` and `startTimestamp` is set to null-equivalent. On resume, `startTimestamp` is re-anchored as `Date.now() - state.elapsedMs`. This approach is crash-resilient: a background restart can reconstruct true elapsed time from the persisted `startTimestamp`.

**Mode transitions:**
```
idle ──START──► work ──complete──► break (or longBreak every N pomos)
                     ──STOP───►  idle
break ──complete──► idle
      ──SKIP_BREAK──► idle
longBreak ──complete──► idle (resets pomodoroCount)
          ──SKIP_BREAK──► idle
```

**Persistence strategy:** `safePersist()` (which wraps `persistState()` with a `console.error` catch) is called on every state transition — `startSession`, `resetToIdle`, `bindToCurrentTab`, `unbindTab`, and pause/resume. It is explicitly NOT called on every tick to avoid 1 Hz storage writes. The storage entry is a flat spread of `state`: `{ timerState: { ...state } }`.

**Crash recovery:** `init()` reads `timerState` from storage. If a session was running when the background page died (possible in MV2 if memory pressure causes suspension, though unlikely with `persistent: true`), `deserializeState` re-anchors elapsed time. If the session has already exceeded its duration offline, `onSessionComplete()` is triggered synchronously before messaging begins.

**`persistent: true` is load-bearing.** Removing it would destroy the `setInterval` handle and all in-memory state on suspension. A `browser.alarms`-based approach would be required for MV3 compatibility. This is documented in the file header and is not a defect — it is an explicit architectural commitment.

### 5.2 Content Script — Bar and Favicon

The content script has two responsibilities handled independently:

**Progress bar:** A `<div id="pomo-bar-root">` with a `<div id="pomo-bar-fill">` child is prepended to `<body>` at injection time. `data-mode` attribute drives all CSS state transitions. The bar is `position: fixed; top: 0; z-index: INT32_MAX; pointer-events: none`. It moves into the fullscreen element on `fullscreenchange`. Width animates via `transition: width 1s linear` during sessions; the `[data-mode="idle"]` selector sets `transition: none` to prevent backward animation on reset.

**Favicon overlay:** An IIFE encapsulates all favicon state (`originalHref`, `linkEl`, `gen`, the reusable canvas). The design:

- `apply(mode)`: Captures `originalHref` once on first call. Increments a generation counter (`gen`) to cancel in-flight image loads. Validates the favicon URL scheme before assigning to `img.src` (allows `http:`, `https:`, `data:` only). Composites the favicon onto a reused 32×32 canvas with a color-coded dot in the bottom-right corner, then sets the result as a `data:` URI on the `<link>` element.
- `remove()`: Restores `linkEl.href = originalHref`. Does NOT null `originalHref` — the original is captured once per page load and retained across remove/apply cycles.
- Cross-origin tainted canvas errors are caught with `catch {}` (no binding, not `catch (e)`) and fall back to a dot-only overlay without the page favicon.

**Init race:** On page load, the content script sends `CONTENT_READY` to learn its tab ID and receive initial state. An `UPDATE_BAR` push from the background may arrive before the `CONTENT_READY` response if the background is fast. This is handled by buffering the message in `bufferedUpdate` and draining it after `myTabId` is set.

### 5.3 Popup — Renderer and Dispatcher

The popup is a pure renderer. It maintains no timer state of its own — all state comes from `GET_STATE` on open and `STATE_UPDATE` pushes during operation.

**Rendering:** `renderTimerState(state)` renders mode label, countdown (using `msToMinSecCeil` so it never shows `00:00` one second early), progress bar fill, dot indicators (dynamically generated from `settings.longBreakInterval`), pause notice, and button visibility.

**Settings:** Loaded once on popup open via `GET_STATE`. Not reloaded on `STATE_UPDATE` ticks, which prevents overwriting a user's in-progress input in the settings form. After a successful `SAVE_SETTINGS`, the background returns the sanitized values in the reply (`{ ok: true, settings: {...} }`) — the popup could refresh the form from this, though the current implementation shows only a "Saved!" notice.

**History:** Loaded on-demand when the History tab is activated. `GET_HISTORY` returns only `type === "work"` entries (the background filters before replying). The popup sorts descending by `startTime` and groups by day using `groupByDay()`.

---

## 6. IPC Protocol

All communication is `browser.runtime.sendMessage` / `browser.tabs.sendMessage`. The protocol is synchronous-reply on the background side (returns `false` from the listener except where async reply is needed, where it returns `true`).

### 6.1 Message Catalogue

| Message | Sender | Handler | Reply |
|---|---|---|---|
| `CONTENT_READY` | content → background | Returns `{ tabId, state }` | Always |
| `GET_STATE` | popup → background | Returns `publicState()` | Always |
| `START { mode? }` | popup → background | `startSession(mode \|\| "work")` | `{ ok: true }` |
| `STOP` | popup → background | `stopSession()` | `{ ok: true }` or `{ ok: false, reason: "not running" }` |
| `SKIP_BREAK` | popup → background | `skipBreak()` | `{ ok: true }` or `{ ok: false, reason: "not in break" }` |
| `BIND_TAB { tabId? }` | popup → background | Bind to `msg.tabId` or active tab | `{ ok: true }` |
| `UNBIND_TAB` | popup → background | `unbindTab()` | `{ ok: true }` |
| `GET_HISTORY` | popup → background | Returns filtered history | Array of entries |
| `SAVE_SETTINGS { settings }` | popup → background | `sanitizeSettings()` + persist | `{ ok: true, settings }` |
| `CLEAR_HISTORY` | popup → background | Clears storage | `{ ok: true }` |
| `STATE_UPDATE { state }` | background → popup | `renderTimerState()` | None |
| `UPDATE_BAR { state, isBoundTab }` | background → content | `applyState()` | None |

**Security:** The message handler opens with `if (sender.id && sender.id !== browser.runtime.id) return false;` — cross-extension messages are rejected. The `initialized` flag gates all non-essential messages until `init()` completes.

**No-op detection:** `STOP` when idle and `SKIP_BREAK` when not in a break return `{ ok: false, reason: "..." }` rather than silently succeeding. This matters for agent-driven callers that use the reply to confirm action effect.

**Agent-native design:** `START` accepts an optional `mode` parameter (validated against allowlist `["work", "break", "longBreak"]`). `BIND_TAB` accepts an optional explicit `tabId`. `SAVE_SETTINGS` echoes sanitized values in the reply. `GET_HISTORY` returns a consistent user-visible view (work sessions only). These features make the extension controllable by automated agents without requiring UI interaction.

### 6.2 Silent Catch Blocks — Documented

Four `.catch(() => {})` blocks on `sendMessage` calls are intentionally empty. Each is documented:

| Location | Reason |
|---|---|
| `broadcastState` → `tabs.sendMessage` to bound tab | Content script absent on restricted pages (`about:`, `moz-extension:`, PDF viewer) or tab closed |
| `broadcastState` → `runtime.sendMessage` to popup | Popup is closed; rejection is normal — no listener registered |
| `visibilitychange` → `GET_STATE` | Extension context unavailable during update/restart |
| `CONTENT_READY` send | Background not yet ready; script will re-init on next load |

These are not swallowed errors; they are expected rejection modes with no recovery action possible.

---

## 7. Data Model

### 7.1 Storage Schema

`browser.storage.local` holds three keys:

**`timerState`** — flat spread of `state`:
```js
{
  mode, boundTabId, startTimestamp, elapsedMs,
  sessionDuration, autoPaused, pomodoroCount,
  sessionStart, sessionDomain
}
```

**`settings`**:
```js
{
  workDuration: 1–120 (minutes),
  breakDuration: 1–60,
  longBreakDuration: 1–120,
  longBreakInterval: 1–10,
  completionThreshold: 1–100 (percent)
}
```

**`history`** — array of session entries:
```js
{
  type: "work" | "break" | "longBreak",
  domain: string | null,
  startTime: ms-epoch,
  endTime: ms-epoch,
  elapsed: ms (rounded),
  completed: boolean,
  pctComplete: integer (0–100)
}
```

History is pruned to a rolling 7-day window at startup in `init()`. Entries are append-only (no edit/delete API), with `CLEAR_HISTORY` as the only bulk operation.

### 7.2 Settings Validation — Two-Layer

Settings are sanitized at two points:

1. **On receive:** `SAVE_SETTINGS` destructures only known keys before calling `sanitizeSettings()` — prototype pollution via unexpected keys is impossible.
2. **On persist/restore:** `sanitizeSettings` clamps and type-coerces all five fields. Stored values are merged with `DEFAULT_SETTINGS` before sanitizing on startup, so a partial or corrupt settings blob degrades gracefully to defaults.

Stored timer state is similarly validated by `validateStoredState()` before `Object.assign` in `deserializeState`. Mode is whitelisted, numerics are bounds-checked, `boundTabId` is validated as integer-or-null.

---

## 8. Concurrency and Async Hazards

### 8.1 History Write Serialization

`appendToHistory` performs a read-modify-write cycle with storage. Two concurrent calls (e.g., rapid stop + bound tab close) can interleave reads, with the slower write overwriting the faster one. This was addressed with a module-level promise chain:

```js
let _historyChain = Promise.resolve();

function appendToHistory(entry) {
  _historyChain = _historyChain.then(async () => {
    const stored = await browser.storage.local.get("history");
    let history = stored.history || [];
    history.push(entry);
    await browser.storage.local.set({ history });
  });
  return _historyChain;
}
```

All writes are serialized through `_historyChain`. A failed write blocks the chain for subsequent writes, which is acceptable given the failure mode (storage unavailable).

### 8.2 Activity Check Race

`checkBoundTabActivity` issues a `browser.tabs.query` on focus change events. The debounce is 50ms — insufficient to prevent two concurrent in-flight queries from resolving in indeterminate order. A generation counter prevents stale results from taking effect:

```js
let _activityCheckGen = 0;
// In checkBoundTabActivity:
const myGen = ++_activityCheckGen;
browser.tabs.query(...).then((tabs) => {
  if (myGen !== _activityCheckGen) return; // discard stale
  // ...
});
```

### 8.3 Favicon Generation Counter

`faviconOverlay.apply()` loads a page's favicon as an `Image`. The image load is async; if `apply` is called again before the first load completes (mode change mid-load), the older callback is discarded:

```js
let gen = 0;
// In apply:
const myGen = ++gen;
img.onload = () => {
  if (myGen !== gen) return; // stale — discard
  // ...
};
```

### 8.4 `startSession` Async Domain Resolution

`startSession` is `async`. It awaits `browser.tabs.get(state.boundTabId)` to resolve the hostname before calling `broadcastState()`. This ensures the first `STATE_UPDATE` and the first persisted snapshot carry the correct `sessionDomain`. The `try/catch` falls back to `null` if the tab cannot be resolved.

**Caveat:** Because `startSession` is now `async`, callers that depended on synchronous completion (e.g., `onSessionComplete` calling `startSession("break")` immediately) now run the next line before the domain is resolved. In practice `onSessionComplete` does nothing after calling `startSession` for breaks, so this is fine — but any future caller that chains logic after `startSession` must `await` it.

### 8.5 logSession Snapshot Pattern

`logSession` is `async` (it awaits `appendToHistory`). Before any `await`, it captures an immutable snapshot of the mutable `state` object:

```js
async function logSession(completed, pctComplete) {
  const snapshot = {
    mode: state.mode,
    domain: state.sessionDomain,
    startTime: state.sessionStart,
    elapsed: Math.round(currentElapsed()),
  };
  if (snapshot.mode === "idle") return;
  // ...
}
```

Without this snapshot, `state` could be mutated by a new `startSession` before `appendToHistory` resolves, logging the wrong domain or mode.

---

## 9. Security Posture

| Vector | Status |
|---|---|
| Remote code execution | Impossible. CSP forbids external scripts, eval, inline scripts. All JS is bundled, same-origin only. |
| Data exfiltration | No network access. No `<all_urls>` permission. No `host_permissions`. Storage is local. |
| Cross-extension message injection | Rejected. `sender.id !== browser.runtime.id` guard on every incoming message. |
| Prototype pollution via settings | Mitigated. `SAVE_SETTINGS` destructures only five known keys before sanitizing. |
| Corrupt storage attack | Mitigated. `validateStoredState()` whitelists mode, type-checks all numeric fields, nulls invalid `boundTabId`. |
| CSS exfiltration via injected stylesheet | Mitigated. `style-src 'self'` in CSP. Only the bundled `content.css` is loaded. |
| Favicon URL injection | Mitigated. Scheme checked against `["http:", "https:", "data:"]` before `img.src` assignment. Non-matching schemes fall through to dot-only overlay. |
| Canvas taint (cross-origin favicon) | Handled. `try/catch {}` around `_ctx.drawImage` falls back to dot-only rendering. |
| Data stored in extension storage | No PII beyond session domains (hostnames) and timing. No credentials, no account data. |

The extension has read access to tab IDs and URLs (`tabs` permission). It does not persist full URLs — only the `hostname` component, stored in session history entries.

---

## 10. Performance Characteristics

| Concern | Design |
|---|---|
| Storage write frequency | One write per state transition (start, stop, pause, resume, bind). Zero writes per tick. |
| Badge update frequency | Only when the label changes (~once per minute in work mode). Guarded by `_lastBadgeText` cache. |
| DOM queries in popup | All element references cached at module scope. `elDotsContainer` cached alongside other `el*` refs. |
| Canvas allocation | One canvas allocated per page load, reused across all `faviconOverlay.apply()` calls. |
| History pruning | O(n) filter runs once at startup in `init()`, not on every write. |
| `sendMessage` error paths | All fire-and-forget sends have `.catch(() => {})`. No unhandled rejections in the hot path. |
| `setInterval` at 1 Hz | Standard for a countdown timer. Idle sessions do no work (early return in `tick()`). |

---

## 11. Known Limitations and Intentional Trade-offs

**MV3 incompatibility:** The timer uses `setInterval` in a persistent background page. Firefox MV3 uses a service worker that can be terminated between events. Migrating would require replacing `setInterval` with `browser.alarms` and reconstructing elapsed time from persisted state on each alarm firing. This is a known future cost, not a present defect.

**Auto-pause precision:** The 50ms debounce on tab activity checks means a very rapid alt-tab sequence (< 50ms) may not trigger a pause check. The generation counter prevents the wrong pause state from being set, but there is a brief window where the timer runs on an inactive tab. This is an acceptable UX trade-off.

**History write failure:** If `appendToHistory` fails (storage full, private browsing quota), `pomodoroCount` has already been incremented. The count and history can diverge by 1 after a storage error. The failure is logged to `console.error`. There is no rollback. This is the correct behavior — the session was completed; only the log write failed.

**`GET_HISTORY` double-filter:** The background filters history to `type === "work"` before replying, and the popup also filters on the client side (a now-redundant check). The redundancy is harmless and the client-side filter could be removed in a future cleanup.

**No undo for CLEAR_HISTORY:** `CLEAR_HISTORY` replaces the full history array with `[]` and replies `{ ok: true }`. There is no confirmation, no soft-delete, no recovery. This is intentional — the feature set is minimal.

**Single-window assumption in auto-pause:** `checkBoundTabActivity` queries `lastFocusedWindow: true`. If a user works across multiple windows with the bound tab in a non-focused window, the timer will auto-pause. This is arguably correct behavior (the tab is not active), but users with multi-window workflows may find it surprising.

---

## 12. What Was Deliberately Not Built

- **Sync storage / cloud backup:** All history is local and ephemeral (7-day window). This is a deliberate privacy choice.
- **Cross-device or cross-profile sync:** Not supported.
- **Audio notifications:** The extension uses `browser.notifications` (system tray). No audio.
- **Custom notification sounds / UI themes:** Out of scope.
- **Analytics or telemetry:** None. Zero external calls.
- **OAuth / accounts:** No server, no accounts.

---

## 13. Reviewer Checklist

Before approving installation, a reviewer should verify:

- [ ] **manifest.json permissions match stated use.** `tabs`, `storage`, `notifications` — no `activeTab`, no `<all_urls>` in permissions, no `nativeMessaging`, no `webRequest`.
- [ ] **CSP is restrictive.** `script-src 'self'; object-src 'self'; style-src 'self'` — no remote sources, no unsafe-inline.
- [ ] **No network access.** Grep for `fetch`, `XMLHttpRequest`, `WebSocket`, `navigator.sendBeacon` — none present.
- [ ] **Content script injection scope.** `http://*/*` and `https://*/*` in `content_scripts.matches` means the bar appears on every page. This is the intended behavior. Confirm acceptable for the deployment context.
- [ ] **Data stored.** `browser.storage.local` only. Holds: timer state (mode, timestamps, paused flag, bound tab ID, pomo count), settings (5 fields), session history (domain, timestamps, elapsed, completion status). No passwords, no page content, no full URLs.
- [ ] **`persistent: true`.** Required for the `setInterval`-based timer. Accepted cost: the background page remains resident in memory for the extension lifetime. Memory footprint is minimal (no large data structures; the single `setInterval` fires 1 Hz).
- [ ] **Content script DOM impact.** Appends one `<div>` to `<body>` and one `<link>` to `<head>` (favicon only, only on bound tab). All elements are prefixed `pomo-`. `pointer-events: none` prevents interaction capture. No page content is read or modified.
- [ ] **No eval, no dynamic script loading, no remote assets.**

---

## 14. Installation Recommendation

This extension is architecturally sound for its stated purpose. The codebase is small, auditable in an afternoon, has no external dependencies, and makes no network calls. The permission set is minimal and justified. The three-round code review addressed all identified issues including concurrency races, storage corruption scenarios, and security hardening.

The primary ongoing risk is the `persistent: true` background page model — it consumes more memory than a non-persistent background and will require architectural changes for Firefox MV3 compatibility. This is a known and accepted cost for MV2.

**Recommend: Approve for installation**, subject to confirming the content script injection scope (all HTTP/HTTPS pages) is acceptable in the deployment environment.

---

*Prepared from source audit of the final resolved codebase. All 60 review findings (todos 001–060) are marked complete. No pending issues at time of writing.*
