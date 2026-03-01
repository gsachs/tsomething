---
status: pending
priority: p2
issue_id: "037"
tags: [agent-native, background, ipc, code-review]
dependencies: []
---

# 037 — STOP and SKIP_BREAK Reply ok:true on No-Op, Misleading Agents

## Problem Statement
`STOP` and `SKIP_BREAK` reply `{ ok: true }` even when they are no-ops (STOP when already idle; SKIP_BREAK when not in a break). An agent relying on this reply to confirm the action succeeded will proceed as if the action took effect when it did not. Detecting the no-op requires a second `GET_STATE` round-trip.

## Findings
`background/background.js`:
- `stopSession()` at line ~135: `if (state.mode === "idle") return;` — silent no-op
- `skipBreak()` at line ~169: `if (state.mode !== "break" && state.mode !== "longBreak") return;` — silent no-op
- Both handlers reply `{ ok: true }` unconditionally after calling the function.

## Proposed Solutions
Option A — Return `{ ok: false, reason: "..." }` from the guard paths (Recommended):
```js
case "STOP":
  if (state.mode === "idle") { reply({ ok: false, reason: "not running" }); return false; }
  stopSession();
  reply({ ok: true });
  return false;

case "SKIP_BREAK":
  if (state.mode !== "break" && state.mode !== "longBreak") {
    reply({ ok: false, reason: "not in break" });
    return false;
  }
  skipBreak();
  reply({ ok: true });
  return false;
```

Option B — Leave as-is; document that callers must check mode via GET_STATE. Pros: no change. Cons: agents cannot detect no-ops without extra round-trips.

## Technical Details
- **Affected file:** `background/background.js`

## Acceptance Criteria
- [ ] `STOP` when idle returns `{ ok: false, reason: "not running" }`
- [ ] `SKIP_BREAK` when in work mode returns `{ ok: false, reason: "not in break" }`
- [ ] Existing popup callers that ignore the reply are unaffected

## Work Log
- 2026-03-01: Identified by agent-native-reviewer
