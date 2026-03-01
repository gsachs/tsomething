---
status: pending
priority: p3
issue_id: "048"
tags: [simplicity, background, history, code-review]
dependencies: []
---

# 048 — entry.id generated but never consumed

## Problem Statement
History entries have an `id` field generated with `Date.now().toString(36) + Math.random()...`. No code in the codebase reads `entry.id`. `GET_HISTORY` returns entries without any ID-based operations. `CLEAR_HISTORY` replaces the full array. The field is pure dead weight.

## Findings
[background/background.js] `logSession` — `id: Date.now().toString(36) + Math.random().toString(36).slice(2)` — field is written but never read.

## Proposed Solutions
**Option A — Remove the id field from logSession (Recommended)**
Remove the `id` field from the entry object in `logSession`. This also removes the Math.random() call (also flagged in todo 040 — these can be resolved together).

**Option B — Keep as forward-looking infrastructure. Cons: YAGNI — build it when needed.**

## Technical Details
- **Affected file:** `background/background.js`, `logSession`

## Acceptance Criteria
- [ ] `entry.id` removed from logSession
- [ ] Math.random() call removed from logSession
- [ ] existing history entries without id field handled gracefully

## Work Log
- 2026-03-01: Identified by code-review agent
