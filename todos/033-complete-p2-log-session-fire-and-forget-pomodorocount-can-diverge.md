---
status: pending
priority: p2
issue_id: "033"
tags: [reliability, background, history, code-review]
dependencies: []
---

# 033 — logSession Fire-and-Forget Allows pomodoroCount to Diverge from History

## Problem Statement
`logSession` is async but called without `await` from `finalizeWorkSession`. A storage failure in `appendToHistory` produces an unhandled rejection and the history entry is lost. Worse: `state.pomodoroCount` is already incremented synchronously before `logSession` is called — so the count increments even if the history write fails. The count and history can permanently diverge after a single storage error.

## Findings
`background/background.js`, `finalizeWorkSession`:
```js
function finalizeWorkSession(fullyCompleted) {
  if (state.mode !== "work") return;
  const pct = fullyCompleted ? 100 : progress() * 100;
  const counted = fullyCompleted || pct >= settings.completionThreshold;
  if (counted) state.pomodoroCount++;   // ← synchronous, increments even if logSession fails
  logSession(counted, pct);             // ← async, not awaited, errors swallowed
}
```

## Proposed Solutions
Option A — Add `.catch` to `logSession` call to surface failures (Recommended):
```js
logSession(counted, pct).catch((err) => {
  console.error("[pomo] logSession failed:", err);
});
```
The count/history divergence on storage error is an inherent limitation of non-transactional storage; at minimum the failure should be logged.

Option B — Consider rolling back `pomodoroCount` if `logSession` fails. Pros: consistent state. Cons: complex; the session was genuinely completed — the count is correct, only the log write failed.

## Technical Details
- **Affected file:** `background/background.js`

## Acceptance Criteria
- [ ] `logSession` failures produce a console.error, not an unhandled rejection
- [ ] The extension does not crash on storage failure during session logging

## Work Log
- 2026-03-01: Identified by reliability-reviewer
