---
status: pending
priority: p3
issue_id: "060"
tags: [code-quality, content, css, naming, code-review]
dependencies: []
---

# 060 — Magic numbers in favicon overlay drawing and z-index

## Problem Statement

The favicon overlay drawing code contains several magic numbers whose geometric meaning is not self-evident. `size - 7` (arc center offset), `6` (dot radius), and `1.5` (stroke width) appear as bare literals with no named constants or comments. A maintainer wanting to adjust the dot size must figure out that changing `6` requires also adjusting `size - 7` (otherwise the dot clips the edge). The z-index value `2147483647` in CSS is also a magic number — though widely recognized as `INT32_MAX`, it warrants a comment for unfamiliar readers.

## Findings

**File:** `content/content.js`, inside `faviconOverlay.apply()` → `drawOverlay` inner function:

```js
const size = 32;
// ...
ctx.arc(size - 7, size - 7, 6, 0, Math.PI * 2);  // ← size-7 and 6 are magic
ctx.lineWidth = 1.5;                                // ← 1.5 is magic
```

The relationship between `size - 7` (center) and `6` (radius) is geometrically coupled: the dot sits 1px from the bottom-right corner (`size - 7 + 6 = size - 1`). Changing the radius without adjusting the center moves the dot off-canvas. This coupling is invisible.

**File:** `content/content.css`, line 9:

```css
z-index: 2147483647;  /* no comment */
```

## Proposed Solutions

**Option A — Named constants for the JS magic numbers; comment for the CSS z-index (Recommended)**

```js
// In content.js, inside the faviconOverlay IIFE or at module scope:
const FAVICON_SIZE = 32;
const DOT_RADIUS = 6;
const DOT_MARGIN = 1;  // px gap between dot edge and canvas edge
const DOT_CENTER = FAVICON_SIZE - DOT_RADIUS - DOT_MARGIN;  // = 25, derived not magic
const DOT_STROKE_WIDTH = 1.5;

// In drawOverlay:
ctx.arc(DOT_CENTER, DOT_CENTER, DOT_RADIUS, 0, Math.PI * 2);
ctx.lineWidth = DOT_STROKE_WIDTH;
```

The derivation `FAVICON_SIZE - DOT_RADIUS - DOT_MARGIN` makes the geometric relationship explicit. Changing `DOT_RADIUS` without adjusting `DOT_CENTER` would require updating the formula, but the formula itself documents the constraint.

For the CSS:

```css
z-index: 2147483647; /* INT32_MAX — ensures bar renders above all page content */
```

**Option B — Comments only (no named constants)**

```js
ctx.arc(size - 7, size - 7, 6, 0, Math.PI * 2);
// center = size-7: places dot 1px from bottom-right edge (6 radius + 1 margin)
// radius = 6: adjust center offset in sync if changing
ctx.lineWidth = 1.5;  // stroke width for white border ring
```

Pros: less refactoring. Cons: the coupling between center and radius is still not structurally enforced.

## Technical Details

- **Affected file:** `content/content.js` — `drawOverlay` inner function inside `faviconOverlay.apply`
- **Affected file:** `content/content.css` — line 9, z-index declaration
- **No logic changes** — purely naming/documentation

## Acceptance Criteria

- [ ] `size - 7` and `6` in `ctx.arc` are replaced with named constants or explained by a derivation comment
- [ ] The geometric relationship (radius + margin = distance from edge) is visible in code
- [ ] `z-index: 2147483647` has a comment explaining it is INT32_MAX for guaranteed topmost position
- [ ] Favicon overlay renders identically

## Work Log

- 2026-03-01: Identified by code-reviewer agent (Advisory Note #12)
