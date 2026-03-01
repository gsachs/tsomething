---
status: pending
priority: p3
issue_id: "052"
tags: [simplicity, css, code-review]
dependencies: []
---

# 052 — Dead CSS rules in popup.css and content.css

## Problem Statement
Three dead CSS rules identified:
1. `.btn-primary.break-mode` in popup.css — the class `break-mode` is removed from elStart in renderTimerState but never added anywhere. Rule is unreachable.
2. Default `background: var(--muted)` on `.progress-fill` in popup.css — the fill is 0% wide when no mode class is present (idle), so the background color is never visible.
3. `transition: height 0.3s ease` in content.css on `#pomo-bar-root` — the bar height changes from 4px to 6px in fullscreen. A 2px transition over 0.3s is imperceptible. The transition fires on every fullscreen entry/exit for no user-visible benefit.

## Findings
[popup/popup.css] — `.btn-primary.break-mode` rule; `.progress-fill` default background.
[content/content.css] — `transition: height 0.3s ease` on `#pomo-bar-root`.

## Proposed Solutions
**Option A — Delete all three dead/useless rules (Recommended)**

**Option B — Leave as-is. No functional impact, only file bloat.**

## Technical Details
- **Affected file:** `popup/popup.css`; `content/content.css`

## Acceptance Criteria
- [ ] `.btn-primary.break-mode` rule removed from popup.css
- [ ] Default background on `.progress-fill` removed (or confirmed unreachable and documented)
- [ ] `transition: height` removed from content.css

## Work Log
- 2026-03-01: Identified by code-review agent
