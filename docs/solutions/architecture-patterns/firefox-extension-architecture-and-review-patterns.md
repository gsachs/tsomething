---
title: Firefox Extension Architecture — Patterns and Pitfalls
date: 2026-03-01
problem_type: integration-issues
severity: critical
tags:
  - firefox
  - webextension
  - manifest-v2
  - async
  - state-management
  - security
  - performance
  - ipc
components:
  - background-script
  - content-script
  - popup
status: resolved
---

## Problem Statement

Building a Firefox WebExtension (Manifest V2) that implements a Pomodoro timer with
cross-component state sync, content-script progress injection, and favicon compositing
surfaced 13 architecture, security, and correctness issues that were not visible from
reading any single file in isolation. The bugs shared a common theme: **the mental model
of "it works in isolation" breaking down at component boundaries** — async IPC, concurrent
event handlers, shared mutable state, and cross-origin canvas constraints each created a
distinct failure mode.

Symptoms included:
- Race condition: favicon overlay could render stale color after mode change
- Stale state: `logSession()` read zeroed state after `resetToIdle()` ran concurrently
- Performance: one LevelDB write + O(n_tabs) IPC messages per second from tick
- Security: settings accepted arbitrary keys from untrusted callers; no sender validation
- UX: bind button could be clicked mid-session; popup could render double state updates

---

## Root Cause Analysis

All issues traced to five root causes:

1. **No sender validation** — any extension could inject messages into the background.
2. **Async state capture too late** — mutable state read after `await` in `logSession()`.
3. **Missing cancellation token** — favicon image loads from previous mode completed after new mode started.
4. **Hot-path side effects** — `persistState()` (LevelDB) and `broadcastState()` (IPC to all tabs) called from the 1 Hz tick.
5. **Structural violations** — Command-Query Separation broken; duplicate increment paths for `pomodoroCount`; dead code in the longBreak branch.

---

## Solutions Applied

### Theme 1: Security Hardening

**P1 — Message sender validation (todo 001)**

```js
// Before: no validation — any extension could send commands
browser.runtime.onMessage.addListener((msg, sender, reply) => {
  switch (msg.type) { ... }
});

// After: reject foreign extensions
browser.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id && sender.id !== browser.runtime.id) return false;
  // ...
});
```

**P1 — Settings bounds + allowlist (todo 002, P3 todo 011)**

```js
// Before: raw merge of any keys from msg.settings
settings = { ...settings, ...msg.settings };

// After: destructure to known keys only, then clamp
function sanitizeSettings(raw) {
  return {
    workDuration:        Math.max(1,  Math.min(120, parseInt(raw.workDuration)        || 25)),
    breakDuration:       Math.max(1,  Math.min(60,  parseInt(raw.breakDuration)       || 5)),
    longBreakDuration:   Math.max(1,  Math.min(120, parseInt(raw.longBreakDuration)   || 15)),
    longBreakInterval:   Math.max(1,  Math.min(10,  parseInt(raw.longBreakInterval)   || 4)),
    completionThreshold: Math.max(1,  Math.min(100, parseInt(raw.completionThreshold) || 80)),
  };
}

// SAVE_SETTINGS handler:
const { workDuration, breakDuration, longBreakDuration,
        longBreakInterval, completionThreshold } = msg.settings;
settings = sanitizeSettings({ workDuration, breakDuration,
                               longBreakDuration, longBreakInterval, completionThreshold });
```

Applied in both the `SAVE_SETTINGS` message handler and on load from storage.

---

### Theme 2: Async Correctness

**P1 — State snapshot before await in logSession (todo 003)**

```js
// Before: read state.mode, state.elapsedMs etc. AFTER await — resetToIdle() may have zeroed them
async function logSession(completed, pctComplete) {
  const stored = await browser.storage.local.get("history");
  // ^ state may be "idle" here; state.sessionStart already null
  const entry = { type: state.mode, elapsed: Math.round(currentElapsed()), ... };
}

// After: synchronous snapshot before first await
async function logSession(completed, pctComplete) {
  const snapshot = {
    mode:     state.mode,
    domain:   state.sessionDomain,
    startTime: state.sessionStart,
    duration:  state.sessionDuration,
    elapsed:   Math.round(currentElapsed()),
  };
  if (snapshot.mode === "idle") return;   // guard here, not after await

  const stored = await browser.storage.local.get("history");
  const entry = {
    type:      snapshot.mode,
    domain:    snapshot.domain,
    elapsed:   snapshot.elapsed,
    // ...
  };
}
```

**P1 — Favicon generation counter (todo 004)**

```js
// Before: stale img.onload could overwrite the favicon after the mode changed
function applyFaviconOverlay(mode) {
  const img = new Image();
  img.onload = () => { ctx.drawImage(img, ...); setFaviconDataUrl(...); };
  img.src = src;
}

// After: generation counter cancels stale callbacks
let _faviconGen = 0;

function applyFaviconOverlay(mode) {
  const gen = ++_faviconGen;
  const img = new Image();
  img.onload = () => {
    if (gen !== _faviconGen) return;   // stale — discard
    ctx.drawImage(img, ...);
    setFaviconDataUrl(...);
  };
  img.onerror = () => { if (gen !== _faviconGen) return; drawOverlay(); };
  img.src = src;
}

function removeFaviconOverlay() {
  ++_faviconGen;   // invalidate any in-flight load
  if (!faviconLinkEl || !originalFaviconHref) return;
  faviconLinkEl.href = originalFaviconHref;
  originalFaviconHref = null;
}
```

**P2 — Debounce dual activity-check listeners (todo 006)**

`tabs.onActivated` and `windows.onFocusChanged` both fire within milliseconds of each
other on a simple window-switch, causing two `tabs.query` IPC calls and two potential
`persistState()` writes.

```js
// Before: two listeners each calling checkBoundTabActivity() directly
browser.tabs.onActivated.addListener(checkBoundTabActivity);
browser.windows.onFocusChanged.addListener(checkBoundTabActivity);

// After: shared 50 ms debounce collapses the burst into one check
let _activityCheckTimer = null;
function scheduleActivityCheck() {
  clearTimeout(_activityCheckTimer);
  _activityCheckTimer = setTimeout(checkBoundTabActivity, 50);
}
browser.tabs.onActivated.addListener(scheduleActivityCheck);
browser.windows.onFocusChanged.addListener(scheduleActivityCheck);
```

Also replaced the nested `tabs.query` + `windows.getCurrent` pair with a single atomic
query using `lastFocusedWindow`:

```js
// Before: two async calls, race between them
browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
  browser.windows.getCurrent().then((win) => { /* win.focused check */ });
});

// After: single atomic query
browser.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => {
  const isActive = tabs.length > 0 && tabs[0].id === state.boundTabId;
  // ...
});
```

---

### Theme 3: Performance

**P1 — Remove persistState and broadcastState from tick hot path (todo 005)**

The 1 Hz tick was writing to LevelDB (`persistState`) and broadcasting to every open tab
(`broadcastState`) on every fire — even during a paused session.

```js
// Before: ~60 LevelDB writes/minute + O(n_tabs) IPC/minute
function tick() {
  if (state.autoPaused || state.mode === "idle") return;
  state.elapsedMs = currentElapsed();
  if (state.elapsedMs >= state.sessionDuration) {
    onSessionComplete();
  } else {
    broadcastState();   // ← IPC to ALL tabs
    persistState();     // ← LevelDB write every second
    updateBadge();
  }
}

// After: persist only on genuine transitions; broadcast only to bound tab + popup
function tick() {
  if (state.autoPaused || state.mode === "idle") return;
  state.elapsedMs = currentElapsed();
  if (state.elapsedMs >= state.sessionDuration) {
    state.elapsedMs = state.sessionDuration;
    onSessionComplete();
  } else {
    broadcastState();   // now targeted — bound tab only (see broadcastState below)
    updateBadge();
  }
}

// broadcastState: targeted, not broadcast
function broadcastState() {
  const ps = publicState();
  if (state.boundTabId !== null) {
    browser.tabs.sendMessage(state.boundTabId, {
      type: "UPDATE_BAR", ...ps, isBoundTab: true,
    }).catch(() => {});
  }
  browser.runtime.sendMessage({ type: "STATE_UPDATE", state: ps }).catch(() => {});
}
```

`persistState()` is now called only at genuine state transitions: `startSession`,
`stopSession`, `checkBoundTabActivity` (pause/resume), `bindToCurrentTab`, `unbindTab`,
`resetToIdle`.

`setBadgeBackgroundColor` moved out of tick into `startSession()` — color only changes
when the mode changes, not every second.

**P2 — Eliminate polling; use push + visibility-pull (todo 008)**

```js
// Before: setInterval polling in content script (O(1) wasted IPC calls/second while hidden)
setInterval(() => {
  browser.runtime.sendMessage({ type: "GET_STATE" }).then(applyState);
}, 1000);

// After: pull only when tab becomes visible; rely on push the rest of the time
document.addEventListener("visibilitychange", () => {
  if (document.hidden || myTabId === null) return;
  browser.runtime.sendMessage({ type: "GET_STATE" })
    .then((state) => { applyState(state, myTabId); })
    .catch(() => {});
});
```

---

### Theme 4: Architecture / Command-Query Separation

**P2 — Consolidate pomodoroCount increment (todo 010)**

`pomodoroCount` was incremented in `onSessionComplete()` and in `maybeLogWork()` independently,
with a dead `longBreak` branch that could never execute but appeared to reset the counter.

```js
// Before: two increment sites, dead reset branch
function onSessionComplete() {
  if (state.mode === "work") {
    state.pomodoroCount++;   // ← increment #1
    maybeLogWork(true);
  } else if (state.mode === "longBreak") {
    state.pomodoroCount = 0;  // ← dead: onSessionComplete only called during work
  }
  // ...
}

function maybeLogWork(completed) {
  const pct = completed ? 100 : progress() * 100;
  if (completed || pct >= settings.completionThreshold) {
    state.pomodoroCount++;   // ← increment #2 — double-counting!
  }
  logSession(completed, pct);
}

// After: single canonical function; longBreak reset moved to the right place
function recordWorkSession(fullyCompleted) {
  if (state.mode !== "work") return;
  const pct = fullyCompleted ? 100 : progress() * 100;
  const counted = fullyCompleted || pct >= settings.completionThreshold;
  if (counted) state.pomodoroCount++;
  logSession(counted, pct);
}

function onSessionComplete() {
  stopTick();
  if (state.mode === "work") recordWorkSession(true);

  const wasWork = state.mode === "work";
  const pomosBeforeReset = state.pomodoroCount;

  notify(wasWork, pomosBeforeReset);

  if (wasWork) {
    const nextBreak = pomosBeforeReset >= settings.longBreakInterval ? "longBreak" : "break";
    if (nextBreak === "longBreak") state.pomodoroCount = 0;   // ← reset in the right place
    startSession(nextBreak);
  } else {
    resetToIdle();
  }
}
```

---

### Theme 5: Robustness

**P2 — Disable bind button during active session (todo 007)**

```js
// After: bind button disabled during active session; communicate via opacity
const sessionActive = mode !== "idle";
elBind.disabled = sessionActive;
elBind.style.opacity = sessionActive ? "0.4" : "";
elBind.style.cursor = sessionActive ? "default" : "";
```

**P2 — Popup double-render guard (todo 009)**

```js
// After: suppress STATE_UPDATE until initial GET_STATE resolves
let popupReady = false;

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "STATE_UPDATE" && popupReady) {
    renderTimerState(msg.state);
    loadSettings(msg.state.settings);
  }
});

browser.runtime.sendMessage({ type: "GET_STATE" }).then((state) => {
  popupReady = true;
  renderTimerState(state);
  loadSettings(state.settings);
});
```

**P3 — Buffer UPDATE_BAR before myTabId is set (todo 013, content side)**

```js
let pendingMsg = null;

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "UPDATE_BAR") {
    if (myTabId === null) { pendingMsg = msg; return; }
    applyState(msg, myTabId);
  }
});

browser.runtime.sendMessage({ type: "CONTENT_READY" }).then((response) => {
  myTabId = response.tabId;
  applyState(response.state, myTabId);
  if (pendingMsg) { applyState(pendingMsg, myTabId); pendingMsg = null; }
}).catch(() => {});
```

**P3 — Unknown message type reply + init gate (todo 013, background side)**

```js
let initialized = false;

// In onMessage handler, before switch:
if (!initialized && msg.type !== "CONTENT_READY" && msg.type !== "GET_STATE") {
  reply({ error: "not ready" });
  return false;
}

// Default branch now replies instead of silently ignoring:
default:
  reply({ error: "unknown message type", type: msg.type });
  return false;
```

**P3 — Replaced innerHTML with DOM API in history renderer (todo 011)**

```js
// Before: history renderer used innerHTML, potential XSS if domain contained HTML
domainEl.innerHTML = e.domain;

// After: textContent only
domain.textContent = e.domain || "unbound";
```

---

## Prevention Strategies

### Design-time checklist for WebExtension components

- [ ] **Sender validation first**: every `onMessage` listener must check `sender.id` before processing.
- [ ] **Snapshot before await**: any async function that reads shared mutable state must capture a snapshot synchronously on entry.
- [ ] **Cancellation tokens for async UI**: use a generation counter (`let gen = 0; const myGen = ++gen`) whenever an async operation (image load, fetch) updates DOM.
- [ ] **No side effects in tick/render**: tick handlers must not persist state or send IPC to all tabs.
- [ ] **Targeted IPC over broadcast**: send messages to specific tabs or the popup, never `browser.tabs.query({})` in a loop per tick.
- [ ] **Debounce paired event listeners**: when two events (`onActivated` + `onFocusChanged`) model the same logical event, collapse them with a single debounce timer.
- [ ] **Single increment site per counter**: any counter with multiple update paths will drift. Consolidate.
- [ ] **textContent not innerHTML** for any user-controlled or domain-derived content.

### Common pitfalls in persistent background pages

1. **Reading state after `await`**: `resetToIdle()` runs synchronously in the same JS turn as `onSessionComplete()`. If `logSession()` awaits storage first, `state.mode` is already `"idle"` when it reads it.

2. **Favicon compositing and CORS**: `ctx.drawImage()` on a cross-origin image taints the canvas. Always wrap in try/catch and fall back to dot-only on error. The `crossOrigin = "anonymous"` attribute helps only if the server sends CORS headers.

3. **`windows.getCurrent()` vs `{ lastFocusedWindow: true }`**: `windows.getCurrent()` in an `onActivated` listener returns the window that *sent the event*, not necessarily the focused one. Use `lastFocusedWindow: true` in `tabs.query` for the correct answer.

4. **Popup open racing background `init()`**: if `init()` is slow (first storage read on a cold start), the popup may open and send messages before `initialized` is true. Gate non-essential messages with the `initialized` flag.

### Review checklist for extension PRs

- [ ] All `onMessage` listeners validate `sender.id`
- [ ] All settings paths call `sanitizeSettings()` before assignment
- [ ] All async functions that touch shared state snapshot first
- [ ] Tick/render handlers are free of I/O
- [ ] `broadcastState()` sends to a specific tab, not all tabs
- [ ] Paired event listeners share a debounce
- [ ] `pomodoroCount` is incremented in exactly one place
- [ ] History rendering uses `textContent`, not `innerHTML`
- [ ] Canvas `drawImage` is wrapped in try/catch
- [ ] `initialized` flag guards messages before `init()` completes

### Test scenarios

1. Start work session → immediately close browser → reopen: timer should resume from correct elapsed time.
2. Bind tab → switch to another tab: timer should pause immediately.
3. Bind tab → switch away → switch back within 50 ms: only one `persistState` call fired.
4. Complete 4 pomodoros: `pomodoroCount` should reach 4 exactly once before reset (not 5 or 8).
5. Stop session at 90% through: session should be counted; count should increment by 1.
6. Send `SAVE_SETTINGS` with `workDuration: 999` and a rogue `__proto__` key: clamped to 120; rogue key discarded.
7. Send a message from a fake extension ID: message silently rejected.
8. Bind to a tab with a favicon from a cross-origin CDN: overlay renders (dot-only fallback, no crash).
9. Open popup while `init()` is still awaiting storage: non-GET_STATE messages return `{ error: "not ready" }`.
10. Tab closes while bound and session is at 60%: session is recorded as abandoned (not counted); `pomodoroCount` unchanged.

---

## Related Resources

- [MDN: WebExtensions background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts)
- [MDN: runtime.onMessage — sender object](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/onMessage)
- [MDN: tabs.query](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/query)
- [MDN: CanvasRenderingContext2D.drawImage — CORS](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage)
- [MDN: Document: visibilitychange event](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event)
- [Firefox Extension Workshop: Manifest V2 vs V3](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/)

---

## Implementation Notes

All fixes were applied in a single pass after a multi-agent code review. The parallel
agent approach (one agent per file: `background.js`, `content.js`, `popup.js`) avoided
merge conflicts. No tests existed; prevention coverage now lives in the checklist above.

The timer accuracy design (wall-clock `startTimestamp` anchor rather than countdown)
proved sound — all review agents confirmed it correctly handles browser-close recovery.
The `currentElapsed()` helper centralizes the `Date.now() - startTimestamp` computation
and is now the single source of truth for all elapsed-time reads.
