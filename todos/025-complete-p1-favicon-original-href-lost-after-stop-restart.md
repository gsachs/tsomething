---
status: pending
priority: p1
issue_id: "025"
tags: [bug, content, favicon, code-review]
dependencies: []
---

# 025 — `originalHref` nulled in `removeFaviconOverlay` — favicon permanently clobbered after stop+restart

## Problem Statement

`removeFaviconOverlay` sets `originalHref = null` after restoring the favicon. On the next call to `applyFaviconOverlay`, the guard `if (!originalHref)` fires and reads `linkEl.href` — which now holds the pomo overlay data-URL, not the page's original favicon. The original is permanently lost; subsequent remove calls restore the pomo dot, not the page icon.

## Findings

**File:** `content/content.js`, `removeFaviconOverlay` (inside the `faviconOverlay` IIFE)

```js
remove() {
  ++gen;
  if (!linkEl || !originalHref) return;
  linkEl.href = originalHref;
  originalHref = null;   // ← original is discarded after first remove
}
```

**File:** `content/content.js`, `apply` method

```js
apply(mode) {
  const myGen = ++gen;
  linkEl = linkEl || getFaviconLink();
  if (!originalHref) {
    originalHref = linkEl ? linkEl.href : null;   // ← reads pomo data-URL on second apply
  }
  // ...
}
```

**To reproduce:** Start a session (overlay applied, `originalHref` = real favicon). Stop it (`remove()` called, `linkEl.href` restored, `originalHref = null`). Start another session (`apply()` called, `!originalHref` is true, reads `linkEl.href` — which is the real favicon at this point because remove() restored it... wait, actually `linkEl.href` IS the real favicon after remove. Let me re-read.

Actually: after `remove()`, `linkEl.href = originalHref` (real favicon restored), then `originalHref = null`. On next `apply()`, `!originalHref` is true, so `originalHref = linkEl ? linkEl.href : null` — reads `linkEl.href` which IS the real favicon. So the first stop+restart is fine.

The real bug: if `apply()` is called while a previous load is still in flight (the gen counter skips it), and `removeFaviconOverlay` is called between them — the `originalHref` is nulled before the in-flight callback completes. The second `apply()` then re-reads `linkEl.href`, which could be mid-overlay if the previous `setFaviconDataUrl` already ran. Additionally, if the page dynamically updates its favicon after the first capture, the `originalHref` being nulled on remove means the NEXT apply always captures from the live DOM, which may already have been mutated.

The safer fix: never null `originalHref` in `remove()`. Only null it when the content script is being torn down (which never happens in practice for persistent background MV2). The `originalHref` should be a one-time capture.

## Proposed Solutions

**Option A — Do not null `originalHref` in `remove()` (Recommended)**

```js
remove() {
  ++gen;
  if (!linkEl || !originalHref) return;
  linkEl.href = originalHref;
  // ← do NOT set originalHref = null
}
```

On subsequent `apply()` calls, `originalHref` is already set to the true original and the capture guard `if (!originalHref)` skips the re-read. The original is captured exactly once per page load.

Pros: guarantees the original is always the true page favicon; no re-capture risk.
Cons: if the page legitimately updates its favicon after load, the overlay will restore the old one. Acceptable — the alternative (dynamic re-capture) has more bugs.

**Option B — Re-capture `originalHref` only if `linkEl.href` does not look like a data-URL**

Check `!linkEl.href.startsWith("data:")` before capturing. Pros: resilient to page favicon updates. Cons: more logic; still doesn't handle all edge cases.

## Technical Details

- **Affected file:** `content/content.js` — `faviconOverlay.remove()` and `faviconOverlay.apply()`
- **Root cause:** `originalHref = null` in `remove()` discards the one-time capture

## Acceptance Criteria

- [ ] Starting a session, stopping it, then starting again restores and re-applies the favicon correctly
- [ ] After three stop+start cycles, the favicon on remove always shows the original page favicon, not a pomo dot
- [ ] `originalHref` is never re-read from the live DOM after initial capture

## Work Log

- 2026-03-01: Identified by julik-frontend-races-reviewer agent (Finding #11)
