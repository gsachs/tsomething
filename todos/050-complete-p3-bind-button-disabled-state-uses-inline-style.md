---
status: pending
priority: p3
issue_id: "050"
tags: [simplicity, popup, css, code-review]
dependencies: []
---

# 050 — Bind button disabled state uses inline style

## Problem Statement
When a session is active, the bind button is disabled via `elBind.style.opacity = "0.4"` and `elBind.style.cursor = "default"` set inline from JavaScript. This bypasses the CSS stylesheet and fights the established pattern where all state is expressed via classes or `data-mode` attributes. `button:disabled` already handles the visual convention for disabled elements.

## Findings
[popup/popup.js] `renderTimerState` — `elBind.style.opacity = sessionActive ? "0.4" : ""; elBind.style.cursor = sessionActive ? "default" : "";`

## Proposed Solutions
**Option A — Move styles to CSS; rely on :disabled selector (Recommended)**
Remove the inline style assignments; add to `popup.css`:
```css
#btn-bind:disabled { opacity: 0.4; cursor: default; }
```
The `elBind.disabled = sessionActive;` line remains and is sufficient.

**Option B — Leave as-is (works correctly). Consistency improvement only.**

## Technical Details
- **Affected file:** `popup/popup.js`, `renderTimerState`; `popup/popup.css`

## Acceptance Criteria
- [ ] `elBind.style.opacity` and `elBind.style.cursor` assignments removed from popup.js
- [ ] `#btn-bind:disabled` CSS rule added
- [ ] bind button visual state unchanged

## Work Log
- 2026-03-01: Identified by code-review agent
