---
status: pending
priority: p2
issue_id: "006"
tags: [race-condition, code-review, background, tab-binding]
dependencies: []
---

# 006 — checkBoundTabActivity race: simultaneous events pause timer while user is on bound tab

## Problem Statement

Both `tabs.onActivated` and `windows.onFocusChanged` call `checkBoundTabActivity`. Each fires an async chain (`tabs.query` → `windows.getCurrent`). When both events fire near-simultaneously (e.g., user alt-tabs back to Firefox and their bound tab is active), the two chains can interleave and resolve in opposite order, leaving the timer **paused while the user is actively watching the bound tab**. There is no visual indication of why the timer paused.

## Findings

**File:** `background/background.js`, lines 178–204

**Failure sequence:**
1. User alt-tabs back to Firefox. `onFocusChanged` fires first (window now focused), `onActivated` fires second.
2. First chain (`onFocusChanged`) starts `tabs.query`. Second chain (`onActivated`) starts `tabs.query`.
3. First chain resolves: sees focused window + bound tab active → `isActive = true` → tries to resume but `autoPaused` is already `false` → no-op.
4. Second chain resolves: but now `windows.getCurrent` was queued after the focus changed and sees an intermediate state → `isActive = false` → **pauses** the running timer.

The nested `tabs.query().then(windows.getCurrent())` is not atomic. The browser's window focus state can change between the two async calls.

## Proposed Solutions

**Option A — Debounce with setTimeout(0) (Recommended)**
```js
let _activityCheckTimer = null;

function scheduleActivityCheck() {
  clearTimeout(_activityCheckTimer);
  _activityCheckTimer = setTimeout(checkBoundTabActivity, 50);
}

browser.tabs.onActivated.addListener(scheduleActivityCheck);
browser.windows.onFocusChanged.addListener(scheduleActivityCheck);
```
50ms collapses all rapid-fire events into one evaluation against settled browser state.

**Option B — Single atomic query**
Replace nested calls with `browser.tabs.query({ active: true, lastFocusedWindow: true })` which returns the active tab in the focused window atomically:
```js
function checkBoundTabActivity() {
  if (state.boundTabId === null || state.mode === "idle") return;
  browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
    const isActive = tab && tab.id === state.boundTabId;
    if (isActive && state.autoPaused) { autoResume(); }
    else if (!isActive && !state.autoPaused) { autoPause(); }
  });
}
```
This also removes the `windows.getCurrent()` call entirely. Pros: Eliminates the nesting, no debounce needed. Cons: `lastFocusedWindow` may have subtle cross-platform differences.

Combining both options is the safest fix.

## Technical Details

- **Affected file:** `background/background.js:178–204`
- **Reproducible:** Hold alt-tab and release while bound tab is the active one

## Acceptance Criteria

- [ ] Alt-tabbing back to a window where the bound tab is active resumes the timer
- [ ] Alt-tabbing away pauses the timer
- [ ] Rapid window-switch sequences do not leave timer in wrong pause state
- [ ] `checkBoundTabActivity` never fires more than once per user gesture

## Work Log

- 2026-03-01: Identified by architecture-strategist and julik-frontend-races-reviewer agents
