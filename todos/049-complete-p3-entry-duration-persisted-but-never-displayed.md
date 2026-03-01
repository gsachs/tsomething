---
status: pending
priority: p3
issue_id: "049"
tags: [simplicity, background, history, code-review]
dependencies: []
---

# 049 — entry.duration persisted but never displayed

## Problem Statement
History entries store `duration` (the planned full session duration, e.g. 25*60000 ms). The popup history display only shows `elapsed` via `fmtDuration(e.elapsed)`. `pctComplete` is also stored. The `duration` field is never read anywhere. It's dead storage weight on every history entry.

## Findings
[background/background.js] `logSession` — `duration: snapshot.duration` stored but not referenced in `popup/popup.js` history rendering.

## Proposed Solutions
**Option A — Remove duration from the history entry (Recommended)**
Remove `duration` from the history entry. If the planned duration is ever needed, it can be derived from `pctComplete` and `elapsed` (though that's also lossy). The simpler path: just remove it.

**Option B — Keep for future analytics. Cons: YAGNI.**

## Technical Details
- **Affected file:** `background/background.js`, `logSession`

## Acceptance Criteria
- [ ] `duration` field removed from logSession entry object
- [ ] popup history rendering unaffected

## Work Log
- 2026-03-01: Identified by code-review agent
