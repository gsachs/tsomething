---
status: pending
priority: p3
issue_id: "045"
tags: [simplicity, background, code-review]
dependencies: []
---

# 045 — serializeState is a pass-through wrapper

## Problem Statement
`serializeState()` returns a one-to-one field copy of the `state` object. The `state` object is already a plain object with no methods. `serializeState()` adds no abstraction — it's a pass-through. Per project CLAUDE.md: "No pass-through methods. A method that just delegates to another with near-identical signature adds complexity without absorbing it."

## Findings
[background/background.js] `serializeState` — copies every field of `state` one-to-one into a plain object literal.

## Proposed Solutions
**Option A — Replace with a spread in persistState; delete serializeState (Recommended)**
```js
async function persistState() {
  await browser.storage.local.set({ timerState: { ...state } });
}
```
Delete `serializeState`. `deserializeState` keeps doing real work and should remain.

**Option B — Keep serializeState as documentation of the persistence schema. Pros: explicit field list. Cons: CLAUDE.md says pass-throughs are a smell.**

## Technical Details
- **Affected file:** `background/background.js`, `serializeState`, `persistState`

## Acceptance Criteria
- [ ] `serializeState` function removed
- [ ] `persistState` uses `{ ...state }` directly
- [ ] persistence behavior unchanged

## Work Log
- 2026-03-01: Identified by code-review agent
