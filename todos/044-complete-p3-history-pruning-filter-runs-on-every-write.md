---
status: pending
priority: p3
issue_id: "044"
tags: [performance, background, history, code-review]
dependencies: []
---

# 044 — History pruning filter runs on every write

## Problem Statement
`appendToHistory` runs the 7-day cutoff filter (`history.filter(e => e.startTime > cutoff)`) on every append — once per session completion (~every 25 min). The filter is O(n) in history size. It should run only on startup (in init) and the read path, not on every write.

## Findings
[background/background.js] `appendToHistory` — filter at line ~264 runs on every write.

## Proposed Solutions
**Option A — Move filter to init() and GET_HISTORY handler (Recommended)**
Remove the filter from `appendToHistory`; add it to `init()` (after loading history) and optionally to the `GET_HISTORY` handler before returning results. The write path becomes a pure push+set.

**Option B — Run the filter once daily instead of on every write (more complex scheduling).**

## Technical Details
- **Affected file:** `background/background.js`, `appendToHistory`, `init()`

## Acceptance Criteria
- [ ] appendToHistory no longer filters on write
- [ ] init() prunes history on startup
- [ ] 7-day rolling window is maintained correctly

## Work Log
- 2026-03-01: Identified by code-review agent
