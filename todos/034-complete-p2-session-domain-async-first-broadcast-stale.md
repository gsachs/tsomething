---
status: pending
priority: p2
issue_id: "034"
tags: [bug, background, state, code-review]
dependencies: []
---

# 034 — sessionDomain Async Resolution Causes First Broadcast to Carry Stale Domain

## Problem Statement
In `startSession`, `state.sessionDomain` is resolved via an async `browser.tabs.get()` call, but `broadcastState()` and `persistState()` fire before that promise resolves. The first STATE_UPDATE and the first persisted snapshot therefore carry the previous session's domain (or null), not the new session's domain. This is the domain that will be logged if the session is stopped within the first tick.

## Findings
`background/background.js`, `startSession`:
```js
function startSession(mode) {
  // ...
  state.sessionDomain = null;  // reset

  browser.tabs.get(state.boundTabId).then((tab) => {
    state.sessionDomain = new URL(tab.url).hostname;   // ← async
  }).catch(() => { state.sessionDomain = null; });

  startTick();
  broadcastState();   // ← fires before tabs.get resolves
  persistState();     // ← persists null domain
}
```

## Proposed Solutions
Option A — Resolve the domain before broadcasting (Recommended):
```js
async function startSession(mode) {
  // ... set up state synchronously ...
  if (state.boundTabId !== null) {
    try {
      const tab = await browser.tabs.get(state.boundTabId);
      state.sessionDomain = new URL(tab.url).hostname;
    } catch { state.sessionDomain = null; }
  }
  startTick();
  broadcastState();
  persistState();
}
```
Pros: first broadcast has correct domain. Cons: startSession becomes async; callers must handle the delay.

Option B — Accept the one-snapshot staleness (domain is correct from the second tick onward). Pros: no change. Cons: if the session is stopped in the first second, history logs the wrong domain.

## Technical Details
- **Affected file:** `background/background.js`

## Acceptance Criteria
- [ ] The first `broadcastState()` after `startSession` carries the correct `sessionDomain`
- [ ] The first persisted snapshot has the correct domain
- [ ] History entries log the correct domain even for sessions stopped within 1 second

## Work Log
- 2026-03-01: Identified by architecture-strategist
