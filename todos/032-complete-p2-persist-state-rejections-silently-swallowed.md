---
status: pending
priority: p2
issue_id: "032"
tags: [reliability, background, storage, code-review]
dependencies: []
---

# 032 — persistState Rejections Silently Swallowed at All Call Sites

## Problem Statement
`persistState()` is async but called without `await` and without `.catch()` at all 6 call sites. If storage fails (disk full, private browsing quota), the rejection is silently swallowed, the timer continues running with no persisted state, and the next browser restart cannot recover the session. The user loses their progress with no indication anything went wrong.

## Findings
`background/background.js` — `persistState()` called fire-and-forget at lines ~131 (startSession), ~183 (resetToIdle), ~193 (bindToCurrentTab), ~201 (unbindTab), ~222 and ~224 (checkBoundTabActivity).

## Proposed Solutions
Option A — Add a `.catch` to log or handle storage failures (Recommended):
```js
function safePersist() {
  persistState().catch((err) => {
    console.error("[pomo] persistState failed:", err);
    // Optionally: notify user or set a flag
  });
}
// Replace all persistState() call sites with safePersist()
```

Option B — Await `persistState()` at call sites (requires making callers async). Pros: proper error propagation. Cons: ripples through the call graph.

## Technical Details
- **Affected file:** `background/background.js`

## Acceptance Criteria
- [ ] A storage failure does not produce an unhandled promise rejection
- [ ] Storage failures are logged (console.error) for debugging
- [ ] Timer continues operating correctly when storage is unavailable

## Work Log
- 2026-03-01: Identified by reliability-reviewer
