---
status: pending
priority: p1
issue_id: "028"
tags: [bug, popup, ux, code-review]
dependencies: []
---

# 028 — `loadSettings` called on every STATE_UPDATE tick — overwrites user's in-progress settings input once per second

## Problem Statement

The `STATE_UPDATE` listener in the popup calls `loadSettings(msg.state.settings)` on every message, which arrives once per second during a running session. `loadSettings` sets `.value` on all five settings input fields. If the user has the settings tab open and is editing a field while the timer is running, their keystrokes are silently overwritten every second.

## Findings

**File:** `popup/popup.js`, `STATE_UPDATE` listener

```js
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "STATE_UPDATE" && popupReady) {
    renderTimerState(msg.state);
    loadSettings(msg.state.settings);   // ← called every second
  }
});
```

**File:** `popup/popup.js`, `loadSettings`

```js
function loadSettings(settings) {
  document.getElementById("s-work").value = settings.workDuration;
  document.getElementById("s-break").value = settings.breakDuration;
  document.getElementById("s-long").value = settings.longBreakDuration;
  document.getElementById("s-interval").value = settings.longBreakInterval;
  document.getElementById("s-threshold").value = settings.completionThreshold;
}
```

Every second, all five `<input>` fields are force-set to the background's current settings values. A user typing "30" in the work-duration field will have their partial input ("3") overwritten with the stored value ("25") one second later.

Settings values are not time-sensitive. They only change when the user explicitly saves via the form submit button. There is no reason to re-apply them on every tick.

## Proposed Solutions

**Option A — Remove `loadSettings` from the `STATE_UPDATE` handler; load only on popup open and after `SAVE_SETTINGS` (Recommended)**

```js
// STATE_UPDATE handler — no loadSettings call:
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "STATE_UPDATE" && popupReady) {
    renderTimerState(msg.state);
    // settings are stable — do not overwrite live inputs
  }
});

// Initial load on popup open:
browser.runtime.sendMessage({ type: "GET_STATE" }).then((state) => {
  popupReady = true;
  renderTimerState(state);
  loadSettings(state.settings);   // ← only here
});

// After successful save (settings-form submit handler):
browser.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: s }).then(() => {
  loadSettings(s);   // ← echo confirmed values back to form
  elSaveNotice.classList.remove("hidden");
  setTimeout(() => elSaveNotice.classList.add("hidden"), 2000);
});
```

Pros: eliminates the UX bug; settings form is stable while editing; no behavioral change for users who don't edit mid-session.
Cons: none.

**Option B — Guard with a dirty-field check**

Skip `loadSettings` if any settings input is focused. Pros: more surgical. Cons: `document.activeElement` check is unreliable across all browsers; doesn't cover partially-typed values in unfocused fields.

## Technical Details

- **Affected file:** `popup/popup.js`, lines 256–260 (STATE_UPDATE listener) and settings-form submit handler
- **UX impact:** user input silently overwritten every second while timer is running

## Acceptance Criteria

- [ ] `loadSettings` is NOT called from the `STATE_UPDATE` listener
- [ ] Settings fields are populated on popup open via `GET_STATE` response
- [ ] Settings fields are populated after a successful `SAVE_SETTINGS` (echoing confirmed values)
- [ ] A user typing in the work-duration field while the timer runs sees their input preserved

## Work Log

- 2026-03-01: Identified by architecture-strategist, performance-oracle, and code-simplicity-reviewer agents
