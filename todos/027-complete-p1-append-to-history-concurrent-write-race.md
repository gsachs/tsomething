---
status: pending
priority: p1
issue_id: "027"
tags: [bug, background, async, history, data-integrity, code-review]
dependencies: []
---

# 027 — `appendToHistory` read-modify-write has no concurrency protection — concurrent calls silently drop entries

## Problem Statement

`appendToHistory` does a read → mutate → write cycle with an `await` between read and write. Two concurrent calls can both read the same stale array, then each write their own version, with the first write's entry silently overwritten by the second. A user who hammers the Stop button and immediately starts a new session could lose a history entry.

## Findings

**File:** `background/background.js`, `appendToHistory`

```js
async function appendToHistory(entry) {
  const stored = await browser.storage.local.get("history");  // ← read
  let history = stored.history || [];
  history.push(entry);                                         // ← mutate
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  history = history.filter((e) => e.startTime > cutoff);
  await browser.storage.local.set({ history });                // ← write
}
```

If two calls are in flight simultaneously:
- Call A reads `[entry1]`, Call B reads `[entry1]`
- Call A writes `[entry1, entryA]`
- Call B writes `[entry1, entryB]`  ← entryA is gone

This can happen when `stopSession` and an `onRemoved` tab handler fire close together, both calling `finalizeWorkSession(false)`.

## Proposed Solutions

**Option A — Serialize via promise chain (Recommended)**

```js
let _historyChain = Promise.resolve();

function appendToHistory(entry) {
  _historyChain = _historyChain.then(async () => {
    const stored = await browser.storage.local.get("history");
    let history = stored.history || [];
    history.push(entry);
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    history = history.filter((e) => e.startTime > cutoff);
    await browser.storage.local.set({ history });
  });
  return _historyChain;
}
```

Pros: guarantees serial writes; simple; no external dependencies.
Cons: writes queue up — a failed write blocks subsequent writes (acceptable since errors are already swallowed).

**Option B — In-memory history array as cache, flush to storage**

Maintain `let _history = null` in memory; `appendToHistory` pushes to the array and schedules a debounced write. Pros: eliminates all storage reads after init. Cons: requires loading history into memory on init; adds state.

## Technical Details

- **Affected file:** `background/background.js`, `appendToHistory`
- **Failure mode:** concurrent calls (rapid stop + tab close) produce a last-writer-wins race
- **Related:** logSession is fire-and-forget (see todo 033)

## Acceptance Criteria

- [ ] Rapid stop → tab close sequence produces two history entries, not one
- [ ] History entries are never silently overwritten
- [ ] `_historyChain` is module-level; all `appendToHistory` calls are serialized through it

## Work Log

- 2026-03-01: Identified by julik-frontend-races-reviewer agent (Finding #1) and security-sentinel agent (Finding #6)
