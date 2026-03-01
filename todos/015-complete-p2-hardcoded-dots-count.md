---
status: pending
priority: p2
issue_id: "015"
tags: [ui-bug, popup, code-review, settings]
dependencies: []
---

# 015 — Dot indicators hardcoded to 4 in HTML; mismatches when longBreakInterval != 4

## Problem Statement

The four `<span class="dot">` elements are static in `popup.html`. `renderTimerState` already reads `settings.longBreakInterval` to decide how many dots to fill, but it cannot add or remove dots that don't exist. Setting `longBreakInterval` to 3 or 6 silently produces a wrong display: wrong number of dots are shown, the filled count is either clipped or under-represented.

## Findings

**File:** `popup/popup.html` (dot elements, hardcoded 4)

```html
<div class="dots">
  <span class="dot"></span>
  <span class="dot"></span>
  <span class="dot"></span>
  <span class="dot"></span>
</div>
```

**File:** `popup/popup.js`, lines 64–68

```js
const interval = settings?.longBreakInterval ?? 4;
elDots.forEach((dot, i) => {
  dot.classList.toggle("filled", i < pomodoroCount % interval);
});
```

`elDots` is captured once at startup via `querySelectorAll(".dot")` (line 20). If `longBreakInterval` is 6, `elDots` only has 4 elements; the last two pomodoros of the cycle are never visually represented. If it is 3, the fourth dot is always unfilled but still visible, implying a 4-step cycle.

## Proposed Solutions

**Option A — Generate dots dynamically in renderTimerState (Recommended)**

Remove the static `<span>` elements from HTML (keep the `.dots` container). In `renderTimerState`, regenerate the dot set whenever `interval` changes:

```js
const dotsContainer = document.querySelector(".dots");
// Clear and rebuild if count changed
if (dotsContainer.children.length !== interval) {
  dotsContainer.replaceChildren(
    ...Array.from({ length: interval }, () => {
      const s = document.createElement("span");
      s.className = "dot";
      return s;
    })
  );
}
// Re-query after potential rebuild
dotsContainer.querySelectorAll(".dot").forEach((dot, i) => {
  dot.classList.toggle("filled", i < pomodoroCount % interval);
});
```

Pros: dots always match the configured interval; HTML is simpler.
Cons: minor DOM churn on settings change (acceptable — only on state push, not every tick).

**Option B — Cap/pad dot display to always show 4**

Always show exactly 4 dots regardless of `longBreakInterval`, treating it as a display-only simplification.
Pros: no code change. Cons: misleads users who set a different interval.

## Technical Details

- **Affected files:** `popup/popup.html` (remove static dots), `popup/popup.js:20` (remove `elDots` capture, inline), `popup/popup.js:64–68` (dynamic rebuild)

## Acceptance Criteria

- [ ] Setting `longBreakInterval` to 3 shows 3 dots
- [ ] Setting `longBreakInterval` to 6 shows 6 dots
- [ ] Filled count correctly reflects `pomodoroCount % interval` for any valid interval (1–10)
- [ ] Static `<span class="dot">` elements removed from `popup.html`

## Work Log

- 2026-03-01: Identified by design-reviewer agent (Boundary Analysis #6, P2 recommendation)
