---
status: pending
priority: p2
issue_id: "010"
tags: [code-review, architecture, background]
dependencies: []
---

# 010 — pomodoroCount: dead reset block + CQS violation in maybeLogWork

## Problem Statement

Two related issues in `onSessionComplete` and `maybeLogWork`:

1. **Dead code:** The `if (state.mode === "longBreak") state.pomodoroCount = 0` block on lines 125–127 never executes — when `onSessionComplete` runs for a longBreak, it hits this branch, but at that point `wasWork = false` so it falls through to `resetToIdle()`. The actual reset that matters is at line 134 (`if (nextBreak === "longBreak") state.pomodoroCount = 0`). The dead block misleads readers into thinking long-break completion triggers the reset, when it's actually triggered when the 4th work session completes.

2. **CQS violation:** `maybeLogWork(false)` both logs the session AND increments `pomodoroCount`. This creates two divergent code paths that each increment the counter — `onSessionComplete` at line 118 and `maybeLogWork` at line 223 — creating a conceptual surface for double-increment bugs.

## Findings

**File:** `background/background.js`, lines 113–139 and 218–224

```js
// Lines 125-127 — DEAD CODE (mode is always "work" at this point)
if (state.mode === "longBreak") {
  state.pomodoroCount = 0;
}

// Lines 218-224 — CQS violation
function maybeLogWork(completed) {
  if (state.mode !== "work") return;
  const pct = progress() * 100;
  const counted = pct >= settings.completionThreshold;
  logSession(counted, pct);
  if (counted) state.pomodoroCount++;  // mutation inside a "maybe log" function
}
```

## Proposed Solutions

**Option A — Remove dead block; collapse logging into recordWorkSession (Recommended)**
```js
// Remove lines 125–127 entirely.

// Collapse maybeLogWork + onSessionComplete increment into one function:
function recordWorkSession(fullyCompleted) {
  if (state.mode !== "work") return;
  const pct = fullyCompleted ? 100 : progress() * 100;
  const counted = fullyCompleted || pct >= settings.completionThreshold;
  if (counted) state.pomodoroCount++;
  logSession(counted, pct);
}

// onSessionComplete calls: recordWorkSession(true)
// stopSession and tabs.onRemoved call: recordWorkSession(false)
```
The counter increment happens in one place, the threshold check happens in one place, and the name makes the intent clear.

## Technical Details

- **Affected file:** `background/background.js:113–139, 218–224`

## Acceptance Criteria

- [ ] Dead `if (state.mode === "longBreak")` block removed
- [ ] `pomodoroCount` is incremented in exactly one function
- [ ] Long break still triggers after 4 completed sessions
- [ ] Abandoned sessions at ≥80% still count toward the cycle

## Work Log

- 2026-03-01: Identified by architecture-strategist and code-simplicity-reviewer agents
