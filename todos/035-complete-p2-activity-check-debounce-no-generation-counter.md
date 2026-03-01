---
status: pending
priority: p2
issue_id: "035"
tags: [bug, background, race-condition, code-review]
dependencies: []
---

# 035 — Activity Check Debounce Has No Generation Counter, Enabling Race Condition

## Problem Statement
`checkBoundTabActivity` is async (calls `browser.tabs.query`), and `scheduleActivityCheck` debounces it to 50ms. However, if the browser is slow and a previous `tabs.query` is still in flight when the debounce fires again, both queries resolve independently and whichever completes last wins — potentially inverting the pause state. A rapid alt-tab sequence can leave the timer paused when the bound tab is active, or running when it isn't.

## Findings
`background/background.js`, `checkBoundTabActivity` and `scheduleActivityCheck`:
```js
function checkBoundTabActivity() {
  // ...
  browser.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => {
    const isActive = tabs.length > 0 && tabs[0].id === state.boundTabId;
    if (isActive && state.autoPaused) {
      // resume
    } else if (!isActive && !state.autoPaused) {
      // pause
    }
  });
}
```
No generation counter. Two in-flight queries can mutate `state.autoPaused` in indeterminate order.

## Proposed Solutions
Option A — Add a generation counter to `checkBoundTabActivity` (Recommended):
```js
let _activityCheckGen = 0;
function checkBoundTabActivity() {
  if (state.boundTabId === null || state.mode === "idle") return;
  const myGen = ++_activityCheckGen;
  browser.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => {
    if (myGen !== _activityCheckGen) return;   // stale — discard
    const isActive = tabs.length > 0 && tabs[0].id === state.boundTabId;
    // ... rest of logic
  });
}
```

Option B — Increase debounce to 200ms to reduce overlap probability. Pros: simpler. Cons: doesn't eliminate the race.

## Technical Details
- **Affected file:** `background/background.js`

## Acceptance Criteria
- [ ] `_activityCheckGen` counter invalidates stale `tabs.query` callbacks
- [ ] Rapid tab switches produce a single final pause/resume state, not oscillation
- [ ] Normal tab switching still triggers correct pause/resume within 200ms

## Work Log
- 2026-03-01: Identified by architecture-strategist
