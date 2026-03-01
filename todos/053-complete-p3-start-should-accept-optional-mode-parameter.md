---
status: pending
priority: p3
issue_id: "053"
tags: [agent-native, background, ipc, code-review]
dependencies: []
---

# 053 — START message should accept optional mode parameter

## Problem Statement
The `START` message always starts a work session (`startSession("work")`). `startSession` already supports "break" and "longBreak" as modes, but there is no message to invoke them directly. An agent cannot start a break session programmatically without first completing a work session — making testing or state recovery harder.

## Findings
[background/background.js] — `case "START": startSession("work");` — mode is hardcoded.

## Proposed Solutions
**Option A — Accept optional mode with validation and fallback to "work" (Recommended)**
```js
case "START": {
  const mode = ["work", "break", "longBreak"].includes(msg.mode) ? msg.mode : "work";
  startSession(mode);
  reply({ ok: true });
  return false;
}
```
Popup sends `{ type: "START" }` without mode — defaults to "work", unchanged.

**Option B — Leave as-is; agents can only start work sessions. Acceptable if break-start is not a required agent capability.**

## Technical Details
- **Affected file:** `background/background.js`, `START` message handler

## Acceptance Criteria
- [ ] `{ type: "START", mode: "break" }` starts a break session
- [ ] `{ type: "START" }` (no mode) still starts a work session
- [ ] Invalid mode values default to "work"

## Work Log
- 2026-03-01: Identified by code-review agent
