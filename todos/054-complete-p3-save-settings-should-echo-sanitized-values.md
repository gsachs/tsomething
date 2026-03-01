---
status: pending
priority: p3
issue_id: "054"
tags: [agent-native, background, ipc, code-review]
dependencies: []
---

# 054 — SAVE_SETTINGS should echo sanitized values in reply

## Problem Statement
`SAVE_SETTINGS` replies `{ ok: true }` without echoing the sanitized settings that were actually applied. If an agent sends `{ workDuration: 999 }` (clamped to 120), it receives `{ ok: true }` and believes 999 was stored. To discover the actual values, the agent must make a second `GET_STATE` call.

## Findings
[background/background.js] — `case "SAVE_SETTINGS": ... reply({ ok: true });` — no settings echo in reply.

## Proposed Solutions
**Option A — Echo post-sanitization settings in reply (Recommended)**
```js
reply({ ok: true, settings: { ...settings } });
```
Adds one spread to an existing reply. Agents can confirm what was stored without a follow-up call.

**Option B — Document that callers should follow up with GET_STATE. Pros: no change. Cons: doubles agent round-trips for settings confirmation.**

## Technical Details
- **Affected file:** `background/background.js`, `SAVE_SETTINGS` message handler

## Acceptance Criteria
- [ ] SAVE_SETTINGS reply includes `settings` field with sanitized values
- [ ] `{ ok: true, settings: { workDuration: 120, ... } }` returned when 999 is clamped
- [ ] Popup SAVE_SETTINGS handler is unaffected (it ignores the reply body)

## Work Log
- 2026-03-01: Identified by code-review agent
