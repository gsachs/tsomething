---
status: pending
priority: p3
issue_id: "046"
tags: [simplicity, background, code-review]
dependencies: []
---

# 046 — Double Date.now() call in startSession

## Problem Statement
`startSession` calls `Date.now()` twice in consecutive lines — once for `startTimestamp` and once for `sessionStart`. These are always equal (same synchronous call frame) but use separate calls, wasting a call and creating a naming confusion (two timestamps that mean the same thing captured separately).

## Findings
[background/background.js] `startSession`:
```js
state.startTimestamp = Date.now();
// ...
state.sessionStart = Date.now();
```

## Proposed Solutions
**Option A — Capture once and assign to both (Recommended)**
```js
const now = Date.now();
state.startTimestamp = now;
state.sessionStart = now;
```

**Option B — Leave as-is (negligible cost). Clarity improvement only.**

## Technical Details
- **Affected file:** `background/background.js`, `startSession`

## Acceptance Criteria
- [ ] `Date.now()` called once per `startSession` invocation
- [ ] both `startTimestamp` and `sessionStart` have the same value

## Work Log
- 2026-03-01: Identified by code-review agent
