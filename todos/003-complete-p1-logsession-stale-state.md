---
status: pending
priority: p1
issue_id: "003"
tags: [code-review, architecture, race-condition, background, history]
dependencies: []
---

# 003 — logSession reads stale state after resetToIdle clears it

## Problem Statement

`logSession` is an `async` function called fire-and-forget. After its first `await`, the background state has been mutated by `resetToIdle()`. As a result: history entries from `stopSession()` are logged with `elapsed: 0` and `duration: null`. Additionally, on the `init()` recovery path, the `type` field of the logged entry can be `"break"` instead of `"work"` because `startSession` overwrites `state.mode` before the `await` resolves.

## Findings

**File:** `background/background.js`, lines 107–111 and 226–249

**Call sequence that corrupts history:**
```
stopSession()
  → maybeLogWork(false)     // calls logSession — async, NOT awaited
    → logSession(...)       // hits 'await storage.get' and suspends
  → resetToIdle()           // runs synchronously: state.mode = "idle",
                            // state.elapsedMs = 0, state.sessionDuration = null
                            // state.startTimestamp = null

[later] logSession resumes after await:
  → currentElapsed() → returns 0 (mode is "idle")
  → entry.elapsed = 0  ← WRONG
  → entry.duration = null  ← WRONG
```

**Second path (init recovery):**
```
init() → onSessionComplete() → logSession(true, 100)  [hits await]
                             → startSession("break")   [changes state.mode to "break"]
[later] logSession resumes:
  → entry.type = state.mode  ← "break" instead of "work"
```

## Proposed Solutions

**Option A — Snapshot state before first await (Recommended)**
```js
async function logSession(completed, pctComplete) {
  // Capture everything synchronously before any await
  const snapshot = {
    mode: state.mode,
    domain: state.sessionDomain,
    startTime: state.sessionStart,
    duration: state.sessionDuration,
    elapsed: Math.round(currentElapsed()),
  };
  if (snapshot.mode === "idle") return;

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    type: snapshot.mode,
    domain: snapshot.domain,
    startTime: snapshot.startTime,
    endTime: Date.now(),
    duration: snapshot.duration,
    elapsed: snapshot.elapsed,
    completed,
    pctComplete: Math.round(pctComplete),
  };

  const stored = await browser.storage.local.get("history");
  // ... rest unchanged
}
```

**Option B — Await logSession before resetToIdle**
Make `stopSession` and `tabs.onRemoved` await the log:
```js
async function stopSession() {
  if (state.mode === "idle") return;
  await maybeLogWork(false);
  resetToIdle();
}
```
Pros: Correct ordering. Cons: `stopSession` becomes async, propagating async to callers; the popup's `STOP` handler reply is delayed by a storage write. Option A is strictly better.

## Technical Details

- **Affected files:** `background/background.js:107–111`, `226–249`, `340–368`
- **Symptom:** History entries show `elapsed: 0`, `duration: null`, or wrong `type`
- **Reproducible:** Stop a session early, immediately query `GET_HISTORY` — see zeroed entry

## Acceptance Criteria

- [ ] Stopping a 20-minute session early logs correct `elapsed` (~1200000 ms)
- [ ] `duration` field matches the configured work duration
- [ ] `type` is always `"work"` for work sessions regardless of what `startSession` does immediately after
- [ ] `init()` recovery path logs work sessions with `type: "work"`

## Work Log

- 2026-03-01: Identified independently by architecture-strategist and julik-frontend-races-reviewer agents
