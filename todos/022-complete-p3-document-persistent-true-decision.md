---
status: pending
priority: p3
issue_id: "022"
tags: [documentation, background, code-review, architecture]
dependencies: []
---

# 022 — persistent:true architectural decision undocumented; silent breakage if removed

## Problem Statement

`"persistent": true` in `manifest.json` is a load-bearing architectural decision: the entire timer relies on a live `setInterval` handle that survives indefinitely. Removing this flag causes the background page to be suspended between events, silently killing the timer with no error. Nothing in the source code names this dependency or explains why the setting was chosen.

## Findings

**File:** `manifest.json`, line 17

```json
"background": {
  "scripts": ["background/background.js"],
  "persistent": true
}
```

**File:** `background/background.js`, lines 65–68

```js
function startTick() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(tick, 1000);   // ← handle dies if background is suspended
}
```

In MV2, `persistent: false` (the default for event pages) allows the browser to suspend and discard the background page between events. Any live `setInterval`, `setTimeout`, or in-memory state (the `state` object, `tickInterval`) is destroyed on suspension. The Pomodoro timer requires continuous execution; event-page semantics are incompatible with this requirement.

A future maintainer reading only `manifest.json` has no context for this choice and may remove `persistent: true` assuming it is a historical artifact from copy-pasting a template.

## Proposed Solutions

**Option A — Add module-level comment in background.js (Recommended)**

JSON does not support comments, so the decision must be documented in the script that depends on it:

```js
// Pomo background script — timer state machine, persistence, messaging.
//
// ARCHITECTURE NOTE: This script requires `"persistent": true` in manifest.json.
// The timer uses a live setInterval handle (tickInterval). If the background page
// is allowed to suspend (persistent: false / MV3 service worker), the handle and
// all in-memory state are destroyed mid-session. Do not remove persistent: true
// without replacing setInterval with an alarm-based approach (browser.alarms API).
```

Pros: visible at the top of the file most likely to be modified; explains both the constraint and the alternative (alarms API).
Cons: a comment, so it can drift. Acceptable — this is exactly the kind of comment that belongs (constraint from external system).

**Option B — Add to README architecture section**

Document it in the "How it works" section.
Pros: visible to developers onboarding via README. Cons: README may not be consulted during routine maintenance; the comment should live adjacent to the dependent code.

## Technical Details

- **Affected file:** `background/background.js`, line 1 (module-level comment)
- **No logic changes required**

## Acceptance Criteria

- [ ] `background/background.js` top-level comment explains the `persistent: true` requirement
- [ ] Comment names the consequence of removing it (timer dies silently)
- [ ] Comment names the alternative approach (browser.alarms API)

## Work Log

- 2026-03-01: Identified by design-reviewer agent (Violation 10, P9 recommendation)
