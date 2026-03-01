---
status: pending
priority: p3
issue_id: "055"
tags: [code-quality, comments, code-review]
dependencies: []
---

# 055 — Delete `// Change N (todo NNN):` changelog annotations from all source files

## Problem Statement

Every significant change made during the review-and-resolve cycle was annotated inline with a comment like `// Change 2 (todo 002): sanitize and clamp all settings fields at boundaries.` These are changelog comments — they describe what was done, not why the code exists. They belong in git history, not in production source. They clutter every function they appear in, will rot as the code evolves, and violate the project's comment standard: "Comments compensate for failure to express intent in code. Necessary evil."

## Findings

**File:** `background/background.js`

Quick count of affected lines: `// Change 1`, `// Change 2`, `// Change 3`, `// Change 4`, `// Change 5`, `// Change 6`, `// Change 7`, `// Change 8` appear across ~19 locations including lines 11, 39, 42, 78, 85, 120, 131, 140, 147, 198, 222, 244, 254, 331, 339, 403, 459, 475.

Example:
```js
// Change 2 (todo 002): sanitize and clamp all settings fields at boundaries.
function sanitizeSettings(raw) { ...
```
```js
// Change 5 (todo 005): persistState removed from hot tick path.
broadcastState();
```
```js
// Change 7 (todo 012): use currentElapsed() for consistency.
state.elapsedMs = currentElapsed();
```

These comments describe the historical reason a change was made, not the current reason the code is written this way. A reader six months from now gets no value from "Change 5 (todo 005)" — they need to know *why* persisting in the tick was bad, not that it was once there and removed.

## Proposed Solutions

**Option A — Delete all `// Change N (todo NNN)` comments; replace with intent-comments where reasoning is non-obvious (Recommended)**

For each deleted annotation, evaluate whether the underlying *why* is worth preserving. If yes, rewrite as a plain intent comment. If the code is self-explanatory after deletion, leave nothing.

Examples:
```js
// Change 5 (todo 005): persistState removed from hot tick path.
broadcastState();

// becomes either:
broadcastState();  // no persistState — writing storage every second is too expensive

// or just:
broadcastState();
```

```js
// Change 7 (todo 012): use currentElapsed() for consistency.
state.elapsedMs = currentElapsed();

// becomes just:
state.elapsedMs = currentElapsed();
```

Pros: source becomes future-facing; historical context lives in `git log` where it belongs.
Cons: slight effort to evaluate each comment individually.

**Option B — Delete all annotations with no replacements**

Pros: faster. Cons: a small number of the comments document non-obvious decisions (e.g., why `broadcastState` sends only to the bound tab).

## Technical Details

- **Affected file:** `background/background.js` (~19 occurrences)
- **Pattern to search:** `// Change \d+ \(todo \d+\):`
- **Action:** delete the comment line entirely, or replace with a forward-looking intent comment

## Acceptance Criteria

- [ ] No `// Change N (todo NNN)` comment strings remain in any source file
- [ ] Any non-obvious decision that was explained by a deleted annotation has a replacement intent comment
- [ ] The architectural note at lines 1-7 of `background.js` is preserved (it is not a changelog comment)

## Work Log

- 2026-03-01: Identified by code-reviewer agent (Advisory Note #1)
