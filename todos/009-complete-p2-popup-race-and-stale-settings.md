---
status: pending
priority: p2
issue_id: "009"
tags: [race-condition, code-review, popup]
dependencies: []
---

# 009 — Popup double-renders on open; STATE_UPDATE doesn't refresh settings inputs

## Problem Statement

When the popup opens, it sends `GET_STATE` and also registers a `STATE_UPDATE` listener. The background's next tick fires `broadcastState()` which sends `STATE_UPDATE` to the popup. Both resolve near-simultaneously, calling `renderTimerState` twice with states that differ by up to 1 second — causing a visible countdown jump. Additionally, `loadSettings` is only called from the `GET_STATE` handler, so if the user saves settings while the popup is open, the settings inputs silently show stale values.

## Findings

**File:** `popup/popup.js`, lines 228–243

```js
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "STATE_UPDATE") renderTimerState(msg.state);
  // loadSettings never called from here — stale settings inputs
});

browser.runtime.sendMessage({ type: "GET_STATE" }).then((state) => {
  renderTimerState(state);
  loadSettings(state.settings);  // settings only loaded once on open
});
```

## Proposed Solutions

**Option A — Guard STATE_UPDATE until initial GET_STATE resolves (Recommended)**
```js
let ready = false;

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "STATE_UPDATE" && ready) {
    renderTimerState(msg.state);
    loadSettings(msg.state.settings); // fix stale inputs too
  }
});

browser.runtime.sendMessage({ type: "GET_STATE" }).then((state) => {
  ready = true;
  renderTimerState(state);
  loadSettings(state.settings);
});
```

**Option B — Remove GET_STATE, rely on STATE_UPDATE only**
Don't fetch state on open; wait for the next tick's push. Pros: No double render. Cons: Up to 1 second of stale display on open (blank/wrong countdown until first push arrives).

## Technical Details

- **Affected file:** `popup/popup.js:228–243`

## Acceptance Criteria

- [ ] `renderTimerState` is called at most once per second while popup is open
- [ ] No visible countdown jump immediately after popup opens
- [ ] Changing settings in one popup and re-opening shows updated values in inputs
- [ ] `loadSettings` is called from both `GET_STATE` response and `STATE_UPDATE` handler

## Work Log

- 2026-03-01: Identified by julik-frontend-races-reviewer agent
