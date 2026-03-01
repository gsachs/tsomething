---
status: pending
priority: p3
issue_id: "042"
tags: [performance, content, favicon, code-review]
dependencies: []
---

# 042 — Canvas allocated per faviconOverlay.apply() call

## Problem Statement
`faviconOverlay.apply()` creates a new HTMLCanvasElement and Image on every call. Canvas allocation involves pixel buffer allocation (~4KB for 32x32). Across a session cycle (idle→work→break→work→break→longBreak) this creates ~5 canvas+image pairs. Small but unnecessary.

## Findings
[content/content.js] inside faviconOverlay IIFE — `const canvas = document.createElement("canvas")` inside apply().

## Proposed Solutions
**Option A — Hoist canvas to IIFE scope (Recommended)**
```js
const _canvas = document.createElement("canvas");
_canvas.width = 32; _canvas.height = 32;
const _ctx = _canvas.getContext("2d");
// In apply(): use _canvas and _ctx; call _ctx.clearRect(0,0,32,32) at start
```

**Option B — Leave as-is (impact is negligible for ~4 calls/hour).**

## Technical Details
- **Affected file:** `content/content.js`, faviconOverlay IIFE, `apply()` function

## Acceptance Criteria
- [ ] canvas is reused across apply() calls
- [ ] favicon overlay renders correctly

## Work Log
- 2026-03-01: Identified by code-review agent
