---
status: pending
priority: p3
issue_id: "020"
tags: [code-quality, background, code-review, srp]
dependencies: []
---

# 020 — logSession mixes entry construction with storage management; extract appendToHistory

## Problem Statement

`logSession` is responsible for two separable things: building the session entry record (what a session looks like) and managing the history storage array (read, append, prune to 7-day window, write). These are two distinct decisions — the entry schema and the retention policy — that will change independently.

## Findings

**File:** `background/background.js`, lines 256–286, `logSession`

```js
async function logSession(completed, pctComplete) {
  const snapshot = { /* ... */ };
  if (snapshot.mode === "idle") return;

  // Responsibility 1: build the entry record
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

  // Responsibility 2: manage the storage array
  const stored = await browser.storage.local.get("history");
  let history = stored.history || [];
  history.push(entry);
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  history = history.filter((e) => e.startTime > cutoff);
  await browser.storage.local.set({ history });
}
```

If the pruning policy changes (e.g., cap to 200 entries instead of 7 days), `logSession` changes. If the entry schema adds a field (e.g., `pauses: number`), `logSession` also changes. SRP is violated.

## Proposed Solutions

**Option A — Extract appendToHistory(entry) (Recommended)**

```js
async function appendToHistory(entry) {
  const stored = await browser.storage.local.get("history");
  let history = stored.history || [];
  history.push(entry);
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  history = history.filter((e) => e.startTime > cutoff);
  await browser.storage.local.set({ history });
}

async function logSession(completed, pctComplete) {
  const snapshot = { /* ... */ };
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

  await appendToHistory(entry);
}
```

Pros: each function has one reason to change; pruning policy is isolated in `appendToHistory`; entry schema is isolated in `logSession`.
Cons: one more named function.

**Option B — Leave as-is**

Pros: no change. Cons: SRP violation remains; two coupled responsibilities in one function.

## Technical Details

- **Affected file:** `background/background.js`, lines 278–285
- **New function:** `appendToHistory(entry)` — async, handles storage read/modify/write/prune

## Acceptance Criteria

- [ ] `appendToHistory(entry)` handles all storage read/append/prune/write logic
- [ ] `logSession` only builds the entry object and calls `appendToHistory`
- [ ] History pruning behavior (7-day window) is unchanged
- [ ] `CLEAR_HISTORY` handler is unaffected (it uses `browser.storage.local.set` directly, not `logSession`)

## Work Log

- 2026-03-01: Identified by design-reviewer agent (Violation 3, P7 recommendation)
