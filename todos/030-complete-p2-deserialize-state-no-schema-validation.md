---
status: pending
priority: p2
issue_id: "030"
tags: [security, background, persistence, code-review]
dependencies: []
---

# 030 — deserializeState Performs No Schema Validation

## Problem Statement
`deserializeState` merges raw storage data via `Object.assign(state, s)` without validating field types or values. Corrupted storage (profile manipulation, extension update schema mismatch, development accident) could inject unexpected values: `state.mode` driving wrong timer behavior, `state.boundTabId` being a non-integer passed to `browser.tabs.sendMessage`, numeric fields being NaN causing division-by-zero in `durationFor`. Security-sentinel and architecture-strategist both flagged this.

## Findings
`background/background.js`, `deserializeState`: `Object.assign(state, s)` — no field validation before merge.

## Proposed Solutions
Option A — Apply a whitelist + type validation step before `Object.assign`, similar to `sanitizeSettings` (Recommended):
```js
function validateStoredState(s) {
  const VALID_MODES = ["idle", "work", "break", "longBreak"];
  if (!VALID_MODES.includes(s.mode)) s.mode = "idle";
  if (!Number.isFinite(s.elapsedMs) || s.elapsedMs < 0) s.elapsedMs = 0;
  if (s.boundTabId !== null && !Number.isInteger(s.boundTabId)) s.boundTabId = null;
  if (!Number.isFinite(s.sessionDuration) || s.sessionDuration <= 0) s.sessionDuration = null;
  if (!Number.isInteger(s.pomodoroCount) || s.pomodoroCount < 0) s.pomodoroCount = 0;
  return s;
}
// In deserializeState: Object.assign(state, validateStoredState(s));
```

Option B — Accept the risk (only the extension can write to its own storage). Pros: no change. Cons: fails silently on corrupt or versioned data.

## Technical Details
- **Affected file:** `background/background.js`

## Acceptance Criteria
- [ ] `deserializeState` validates `mode` is one of 4 allowed strings
- [ ] Numeric fields validated as finite integers within expected ranges
- [ ] `boundTabId` validated as integer or null
- [ ] Corrupt storage produces graceful idle state, not a crash

## Work Log
- 2026-03-01: Identified by security-sentinel and architecture-strategist
