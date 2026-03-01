---
status: pending
priority: p3
issue_id: "057"
tags: [code-quality, background, naming, code-review]
dependencies: []
---

# 057 — `deserializeState` returns stringly-typed sentinel — use named constant or boolean

## Problem Statement

`deserializeState` returns either `"completed"` or `"resumed"` as a string, and the caller string-compares against the literal `"completed"`. This is a fragile contract: a typo in either the return or the comparison produces a silent wrong-branch with no type-system or runtime warning. Two string literals in two places must stay in sync manually.

## Findings

**File:** `background/background.js`, `deserializeState`

```js
function deserializeState(s) {
  Object.assign(state, s);
  if (!s.autoPaused && s.startTimestamp) {
    const elapsed = Date.now() - s.startTimestamp;
    if (elapsed >= s.sessionDuration) return "completed";  // ← string literal
    state.elapsedMs = elapsed;
    state.startTimestamp = Date.now() - state.elapsedMs;
  }
  return "resumed";  // ← string literal
}
```

**File:** `background/background.js`, `init`

```js
const result = deserializeState(stored.timerState);
if (result === "completed") { onSessionComplete(); return; }  // ← string comparison
```

If `deserializeState` ever returns a third state (e.g., `"error"` for corrupt data), the call site silently falls through to `startTick()` and `updateBadge()` without the author noticing that a new branch is needed.

## Proposed Solutions

**Option A — Return a boolean `didComplete` (Simplest, Recommended)**

```js
function deserializeState(s) {
  Object.assign(state, s);
  if (!s.autoPaused && s.startTimestamp) {
    const elapsed = Date.now() - s.startTimestamp;
    if (elapsed >= s.sessionDuration) return true;   // completed
    state.elapsedMs = elapsed;
    state.startTimestamp = Date.now() - state.elapsedMs;
  }
  return false;  // resumed
}

// init:
const sessionCompleted = deserializeState(stored.timerState);
if (sessionCompleted) { onSessionComplete(); return; }
```

Pros: no string literals; boolean is self-documenting for a binary outcome; no new constants needed.
Cons: loses the label "completed" / "resumed" at the call site (mitigated by the variable name `sessionCompleted`).

**Option B — Named constants object**

```js
const RESTORE_RESULT = Object.freeze({ COMPLETED: "completed", RESUMED: "resumed" });

function deserializeState(s) {
  // ...
  if (elapsed >= s.sessionDuration) return RESTORE_RESULT.COMPLETED;
  // ...
  return RESTORE_RESULT.RESUMED;
}

// init:
if (result === RESTORE_RESULT.COMPLETED) { ... }
```

Pros: strings remain readable; typos become `undefined` rather than wrong-branch.
Cons: more ceremony for a two-state binary outcome.

## Technical Details

- **Affected file:** `background/background.js` — `deserializeState` function and its single call site in `init`
- **Effort:** Small — two return statements and one comparison

## Acceptance Criteria

- [ ] `deserializeState` no longer returns raw string literals `"completed"` or `"resumed"`
- [ ] The call site in `init` does not compare against a raw string literal
- [ ] Behavior is identical — session-completed-offline path and resume path unchanged

## Work Log

- 2026-03-01: Identified by code-reviewer agent (Advisory Note #4)
