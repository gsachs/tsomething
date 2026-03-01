---
status: pending
priority: p2
issue_id: "031"
tags: [security, content, favicon, code-review]
dependencies: []
---

# 031 — Favicon src URL Scheme Not Validated

## Problem Statement
`applyFaviconOverlay` reads the page's `<link rel="icon">` href and assigns it directly to `img.src` without validating the URL scheme. A page could set its favicon to a `data:` URI containing a very large image, causing excessive memory use during canvas compositing. While `javascript:` URIs on `<img src>` are blocked by browsers and trigger `img.onerror`, the lack of a scheme check is a defense-in-depth gap.

## Findings
`content/content.js`, inside `faviconOverlay.apply()` — `img.src = src` after reading `src` from `linkEl.href` with no scheme validation.

## Proposed Solutions
Option A — Validate scheme before assigning (Recommended):
```js
const ALLOWED_SCHEMES = ["http:", "https:", "data:"];
if (src && ALLOWED_SCHEMES.some(s => src.startsWith(s))) {
  img.src = src;
} else {
  drawOverlay(); // dot-only fallback
}
```

Option B — Rely on browser's existing `img.src` safety (`javascript:` is ignored, `onerror` fires). Pros: no change needed for the `javascript:` case specifically. Cons: `data:` bomb risk remains.

## Technical Details
- **Affected file:** `content/content.js`

## Acceptance Criteria
- [ ] `javascript:` favicon URLs trigger the dot-only fallback, not an img.src assignment
- [ ] `data:` URLs larger than a reasonable threshold (or all non-image data: URLs) are rejected

## Work Log
- 2026-03-01: Identified by security-sentinel
