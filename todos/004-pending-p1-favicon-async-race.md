---
status: pending
priority: p1
issue_id: "004"
tags: [code-review, race-condition, content-script, favicon]
dependencies: []
---

# 004 — Stale favicon color applied after mode transition

## Problem Statement

`applyFaviconOverlay` loads the page favicon asynchronously. If a mode transition occurs while the image is loading (work → break fires immediately after via `onSessionComplete`), two concurrent image loads are in flight. If the first (work, red) resolves after the second (break, green), the favicon shows red during a break — permanently misleading the user about their session state. The entire purpose of the favicon overlay is at-a-glance mode signalling.

## Findings

**File:** `content/content.js`, lines 56–106

**Failure sequence:**
1. Work session ends. `applyState(mode="work")` → `applyFaviconOverlay("work")` → `img.src = favicon`. Image begins loading (slow network / CDN throttle).
2. Break auto-starts immediately. New `UPDATE_BAR` arrives. `applyState(mode="break")` → `applyFaviconOverlay("break")` → second `img.src` set.
3. First `img.onload` (work, red) resolves first if second was cache-hit during load. Writes red dot to favicon.
4. Second `img.onload` (break, green) resolves. Corrects to green.

Steps 3 and 4 can swap order depending on cache vs network timing. When they swap, a **red favicon is permanently displayed during a break** until the next mode change.

**Second failure:** `removeFaviconOverlay()` sets `originalFaviconHref = null`. If an in-flight `img.onload` resolves after this, `drawOverlay()` calls `setFaviconDataUrl()`, re-applying the overlay on an already-unbound tab.

## Proposed Solutions

**Option A — Generation counter (Recommended)**
```js
let _faviconGen = 0;

function applyFaviconOverlay(mode) {
  const gen = ++_faviconGen;
  // ... setup ...
  img.onload = () => {
    if (gen !== _faviconGen) return; // superseded
    ctx.drawImage(img, 0, 0, size, size);
    drawOverlay();
  };
  img.onerror = () => {
    if (gen !== _faviconGen) return;
    drawOverlay();
  };
}

function removeFaviconOverlay() {
  ++_faviconGen; // invalidate any in-flight load
  // ... existing restore logic
}
```
Pros: 12 lines, no dependencies, cancels all pending loads on any subsequent call. Cons: None.

**Option B — AbortController per load**
Use `AbortController` on the image fetch. More idiomatic but `new Image()` does not support AbortController directly — would require `fetch()` + `createObjectURL`, significantly more complex.

## Technical Details

- **Affected file:** `content/content.js:56–106`
- **Reproducible:** Throttle favicon endpoint to "Slow 3G" in DevTools, trigger work-to-break transition

## Acceptance Criteria

- [ ] If `applyFaviconOverlay("work")` is immediately followed by `applyFaviconOverlay("break")`, only green dot appears
- [ ] `removeFaviconOverlay()` called mid-load restores original favicon, does not re-apply overlay
- [ ] No visible flicker on mode transitions with cached favicons

## Work Log

- 2026-03-01: Identified by julik-frontend-races-reviewer agent
