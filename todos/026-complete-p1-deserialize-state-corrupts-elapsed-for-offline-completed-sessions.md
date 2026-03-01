---
status: pending
priority: p1
issue_id: "026"
tags: [bug, background, async, persistence, code-review]
dependencies: []
---

# 026 — `deserializeState` mutates `state.startTimestamp` before `onSessionComplete` → `logSession` records wrong elapsed

## Problem Statement

When a session completes while the browser is closed, `deserializeState` restores the old `startTimestamp` (the original session-start wall clock), then `onSessionComplete()` → `finalizeWorkSession(true)` → `logSession()` calls `currentElapsed()`, which computes `Date.now() - state.startTimestamp`. Since `startTimestamp` is the original pre-close timestamp, `Date.now() - startTimestamp` is now hours (or days) large — far exceeding `sessionDuration`. The history entry records a wildly incorrect elapsed time.

## Findings

**File:** `background/background.js`, `deserializeState`

```js
function deserializeState(s) {
  Object.assign(state, s);   // ← restores old startTimestamp from hours ago
  if (!s.autoPaused && s.startTimestamp) {
    const elapsed = Date.now() - s.startTimestamp;
    if (elapsed >= s.sessionDuration) return "completed";  // ← triggers onSessionComplete
    // ...
  }
  return "resumed";
}
```

**File:** `background/background.js`, `logSession` snapshot

```js
const snapshot = {
  elapsed: Math.round(currentElapsed()),  // ← currentElapsed() = Date.now() - state.startTimestamp
                                           //   which is hours large, not sessionDuration
};
```

The snapshot guard `if (snapshot.mode === "idle") return` does not protect this path — `state.mode` is "work" (restored by `Object.assign`). The session logs as if it took hours.

## Proposed Solutions

**Option A — Clamp `elapsed` in the snapshot to `sessionDuration` (Recommended)**

In `logSession`:

```js
const snapshot = {
  elapsed: Math.round(Math.min(currentElapsed(), state.sessionDuration || Infinity)),
};
```

This is a one-line defensive clamp that prevents absurd elapsed values regardless of how the session ended.

**Option B — Set `state.startTimestamp = Date.now() - s.sessionDuration` before returning "completed"**

Reanchor the timestamp so `currentElapsed()` returns exactly `sessionDuration` when called from `onSessionComplete`:

```js
if (elapsed >= s.sessionDuration) {
  state.elapsedMs = s.sessionDuration;
  state.startTimestamp = Date.now() - s.sessionDuration;
  return "completed";
}
```

Pros: fixes the root cause rather than the symptom; `currentElapsed()` returns the correct value.
Cons: slightly more complex.

## Technical Details

- **Affected file:** `background/background.js`, `deserializeState` and/or `logSession`
- **Trigger:** browser closed during a work session; browser reopened after session duration would have elapsed
- **Effect:** history entry records elapsed time of hours instead of ~25 minutes

## Acceptance Criteria

- [ ] When a session completes offline, the history entry records `elapsed` equal to `sessionDuration`, not `Date.now() - old_startTimestamp`
- [ ] The logged `pctComplete` is 100 for offline-completed sessions

## Work Log

- 2026-03-01: Identified by julik-frontend-races-reviewer agent (Finding #3)
