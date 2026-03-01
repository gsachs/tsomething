---
status: pending
priority: p2
issue_id: "038"
tags: [ui-bug, content, css, code-review]
dependencies: []
---

# 038 — CSS Fill Transition Animates Backward on Idle Reset

## Problem Statement
The progress bar fill has `transition: width 1s linear`. When a session ends and the mode resets to idle (`updateBar` sets `barFill.style.width = "0%"`), the 1-second transition animates the fill backward from its current progress percentage down to 0%. The user sees the red bar slowly draining away, which is unintended — the reset should be instant.

## Findings
`content/content.css`: `transition: width 1s linear, background-color 0.5s ease;` applied to `#pomo-bar-fill`.
`content/content.js`, `updateBar`: `barFill.style.width = state.mode === "idle" ? "0%" : ...`

## Proposed Solutions
Option A — Suppress the width transition when mode is idle via a CSS attribute selector (Recommended):
```css
#pomo-bar-root[data-mode="idle"] #pomo-bar-fill {
  transition: none;
}
```
`updateBar` already sets `bar.setAttribute("data-mode", mode)`, so the idle mode disables the transition before `barFill.style.width = "0%"` is applied.

Option B — Set `barFill.style.transition = "none"` in JS when going idle, restore on next session start. Pros: no CSS change. Cons: mixes style concerns into JS.

## Technical Details
- **Affected file:** `content/content.css`, `content/content.js`

## Acceptance Criteria
- [ ] Session end resets the bar to 0% width instantly (no animation)
- [ ] Progress animation still works during running sessions
- [ ] Mode transition animation (color change) is unaffected

## Work Log
- 2026-03-01: Identified by ui-reviewer
