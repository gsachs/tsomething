---
status: pending
priority: p3
issue_id: "040"
tags: [security, background, code-review]
dependencies: []
---

# 040 — Math.random() session ID not cryptographically safe

## Problem Statement
`entry.id` in history uses `Date.now().toString(36) + Math.random().toString(36).slice(2)`. Math.random() is not cryptographically safe. The ID is currently only used as a local key, but if it ever takes on a security role, predictability is a vulnerability.

## Findings
[background/background.js] logSession — `id: Date.now().toString(36) + Math.random().toString(36).slice(2)`

## Proposed Solutions
**Option A — Use crypto.getRandomValues (Recommended)**
```js
const arr = new Uint32Array(2);
crypto.getRandomValues(arr);
const id = arr[0].toString(36) + arr[1].toString(36);
```

**Option B — Leave as-is (no security impact currently). Acceptable short-term.**

## Technical Details
- **Affected file:** `background/background.js`, `logSession`

## Acceptance Criteria
- [ ] session IDs use crypto.getRandomValues
- [ ] IDs remain unique strings

## Work Log
- 2026-03-01: Identified by code-review agent
