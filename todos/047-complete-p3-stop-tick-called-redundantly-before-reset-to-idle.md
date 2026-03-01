---
status: pending
priority: p3
issue_id: "047"
tags: [simplicity, background, code-review]
dependencies: []
---

# 047 — stopTick called redundantly before resetToIdle

## Problem Statement
`stopTick()` is called explicitly in `skipBreak()` and in the break path of `onSessionComplete()`, then `resetToIdle()` is called immediately after — which also calls `stopTick()`. The double call is a no-op (clearing a null timer handle) but adds noise and obscures the fact that `resetToIdle()` is the canonical teardown point.

## Findings
[background/background.js]:
- `skipBreak()`: `stopTick(); resetToIdle();` — stopTick called twice
- `onSessionComplete()` break path: `stopTick()` at ~line 143, then `resetToIdle()` at ~line 165

## Proposed Solutions
**Option A — Remove redundant stopTick() calls that precede resetToIdle() (Recommended)**
Remove the redundant `stopTick()` calls that precede `resetToIdle()`. Let `resetToIdle()` be the sole tick teardown point.

**Option B — Leave as-is (harmless double-call). Clarity improvement only.**

## Technical Details
- **Affected file:** `background/background.js`, `skipBreak()`, `onSessionComplete()`

## Acceptance Criteria
- [ ] `skipBreak` calls only `resetToIdle()`, not `stopTick()` first
- [ ] `resetToIdle()` remains the canonical teardown

## Work Log
- 2026-03-01: Identified by code-review agent
