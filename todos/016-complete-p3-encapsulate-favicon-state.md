---
status: pending
priority: p3
issue_id: "016"
tags: [architecture, content, code-review, information-hiding]
dependencies: []
---

# 016 — Favicon state and logic scattered across module-level globals; should be a closure

## Problem Statement

Five module-level variables (`originalFaviconHref`, `faviconLinkEl`, `_faviconGen`) and four functions (`getFaviconLink`, `applyFaviconOverlay`, `setFaviconDataUrl`, `removeFaviconOverlay`) collectively form the favicon overlay subsystem but have no encapsulation boundary. Any function in `content.js` can read or mutate this state. The `_faviconGen` counter — an internal cancellation mechanism — is visible at module scope despite being irrelevant to any other concern.

## Findings

**File:** `content/content.js`, lines 5–8

```js
let originalFaviconHref = null;
let faviconLinkEl = null;
let _faviconGen = 0;
// (also: getFaviconLink at line 50, applyFaviconOverlay at 57,
//  setFaviconDataUrl at 112, removeFaviconOverlay at 121)
```

All four favicon functions read/write these shared variables. There is no stated contract: callers must read all four functions to understand what state they depend on and in what order. The generation counter `_faviconGen` is especially internal — it exists only to cancel stale `img.onload` callbacks and is meaningless outside `applyFaviconOverlay` / `removeFaviconOverlay`.

## Proposed Solutions

**Option A — IIFE returning { apply, remove } (Recommended)**

```js
const faviconOverlay = (() => {
  let originalHref = null;
  let linkEl = null;
  let gen = 0;

  function getOrCreateLink() { /* ... */ }
  function drawOverlay(ctx, size, color) { /* ... */ }

  return {
    apply(mode) {
      const myGen = ++gen;
      // ... image load with myGen guard
    },
    remove() {
      ++gen;
      if (!linkEl || !originalHref) return;
      linkEl.href = originalHref;
      originalHref = null;
    },
  };
})();
```

Callers use `faviconOverlay.apply(mode)` and `faviconOverlay.remove()`. The generation counter, link element reference, and original href are all private.

Pros: information hiding enforced structurally; `_faviconGen` disappears from module scope; easy to test or swap.
Cons: slightly more indirection; minimal.

**Option B — Leave as-is, add underscore prefix convention**

Prefix private variables and functions with `_`. Pros: zero code change to logic. Cons: convention is unenforced; doesn't actually hide anything.

## Technical Details

- **Affected file:** `content/content.js`, lines 5–8, 50–126
- **Public surface after change:** `faviconOverlay.apply(mode)`, `faviconOverlay.remove()`
- **Removed from module scope:** `originalFaviconHref`, `faviconLinkEl`, `_faviconGen`, `getFaviconLink`, `setFaviconDataUrl`

## Acceptance Criteria

- [ ] `_faviconGen`, `originalFaviconHref`, `faviconLinkEl` no longer declared at module scope
- [ ] `applyState` calls `faviconOverlay.apply(mode)` and `faviconOverlay.remove()`
- [ ] Race condition guard (generation counter) still works correctly across apply/remove cycles
- [ ] Canvas CORS fallback still works

## Work Log

- 2026-03-01: Identified by design-reviewer agent (Violation 4, P3 recommendation)
