---
status: pending
priority: p3
issue_id: "023"
tags: [architecture, background, code-review, information-hiding, persistence]
dependencies: []
---

# 023 — Elapsed-time representation leaks into persistState and init; needs serializeState/deserializeState

## Problem Statement

The decision of how to represent "running elapsed time" — as a `startTimestamp` wall-clock anchor plus accumulated `elapsedMs` — leaks out of the timer module into both `persistState` (which writes the raw fields) and `init` (which reads them back and recomputes elapsed manually). If this representation ever changes, both `persistState` and `init` must change together, even though neither is conceptually responsible for the elapsed-time strategy.

## Findings

**File:** `background/background.js`, lines 357–371, `persistState`

```js
async function persistState() {
  await browser.storage.local.set({
    timerState: {
      mode: state.mode,
      boundTabId: state.boundTabId,
      startTimestamp: state.startTimestamp,   // ← representation detail
      elapsedMs: state.elapsedMs,             // ← representation detail
      sessionDuration: state.sessionDuration,
      autoPaused: state.autoPaused,
      pomodoroCount: state.pomodoroCount,
      sessionStart: state.sessionStart,
      sessionDomain: state.sessionDomain,
    },
  });
}
```

**File:** `background/background.js`, lines 381–401, `init`

```js
if (!s.autoPaused && s.startTimestamp) {
  const elapsed = Date.now() - s.startTimestamp;          // ← recomputes elapsed
  if (elapsed >= s.sessionDuration) { ... }
  state.elapsedMs = elapsed;
  state.startTimestamp = Date.now() - state.elapsedMs;    // ← reconstructs anchor
}
```

`init` contains timer arithmetic that belongs to the elapsed-time abstraction, not to initialization. If the elapsed representation changes (e.g., storing only `elapsedMs` and `pausedAt` instead of `startTimestamp`), `init` must be updated alongside `currentElapsed()`.

## Proposed Solutions

**Option A — Extract serializeState() / deserializeState(stored) (Recommended)**

```js
function serializeState() {
  return {
    mode: state.mode,
    boundTabId: state.boundTabId,
    startTimestamp: state.startTimestamp,
    elapsedMs: state.elapsedMs,
    sessionDuration: state.sessionDuration,
    autoPaused: state.autoPaused,
    pomodoroCount: state.pomodoroCount,
    sessionStart: state.sessionStart,
    sessionDomain: state.sessionDomain,
  };
}

function deserializeState(s) {
  Object.assign(state, s);
  if (!s.autoPaused && s.startTimestamp) {
    const elapsed = Date.now() - s.startTimestamp;
    if (elapsed >= s.sessionDuration) return "completed";
    state.elapsedMs = elapsed;
    state.startTimestamp = Date.now() - state.elapsedMs;
  }
  return "resumed";
}

// persistState becomes:
async function persistState() {
  await browser.storage.local.set({ timerState: serializeState() });
}

// init becomes:
async function init() {
  const stored = await browser.storage.local.get(["settings", "timerState"]);
  if (stored.settings) settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored.settings });
  if (stored.timerState && stored.timerState.mode !== "idle") {
    const result = deserializeState(stored.timerState);
    if (result === "completed") { onSessionComplete(); return; }
    startTick();
    updateBadge();
  }
  initialized = true;
}
```

Pros: elapsed-time arithmetic lives in one place; `init` is readable at a high level; changing the representation only touches `serializeState`/`deserializeState`/`currentElapsed`.
Cons: two new functions; slight indirection.

**Option B — Leave as-is**

Pros: no change. Cons: representation decision remains spread across three functions.

## Technical Details

- **Affected file:** `background/background.js`, lines 357–401
- **New functions:** `serializeState()` (sync), `deserializeState(s)` (sync, returns `"completed" | "resumed"`)
- **`persistState` and `init` become thin wrappers**

## Acceptance Criteria

- [ ] `persistState` calls `serializeState()` and writes its result; no field listing inline
- [ ] `init`'s restoration path calls `deserializeState()`; no timestamp arithmetic inline in `init`
- [ ] Crash recovery (browser closed mid-session) still works correctly
- [ ] Auto-pause restoration still works correctly

## Work Log

- 2026-03-01: Identified by design-reviewer agent (Violation 2)
