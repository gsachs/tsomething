---
status: pending
priority: p3
issue_id: "059"
tags: [performance, popup, code-review]
dependencies: []
---

# 059 — `dotsContainer` queried via `document.querySelector` on every `renderTimerState` call

## Problem Statement

`renderTimerState` calls `document.querySelector(".dots")` on every invocation. During a running session, this fires once per second. The `.dots` container is a static element that never moves or changes identity — it should be captured once at module initialization alongside the other `el*` constants, not re-queried on every render.

## Findings

**File:** `popup/popup.js`, `renderTimerState`

```js
function renderTimerState(state) {
  // ...
  const dotsContainer = document.querySelector(".dots");   // ← queried every call
  if (dotsContainer.children.length !== interval) {
    dotsContainer.replaceChildren(...);
  }
  dotsContainer.querySelectorAll(".dot").forEach((dot, i) => {
    dot.classList.toggle("filled", ...);
  });
  // ...
}
```

**File:** `popup/popup.js`, lines 17-25 (established element-caching pattern)

```js
const elLabel     = document.getElementById("session-label");
const elCountdown = document.getElementById("countdown");
const elFill      = document.getElementById("progress-fill");
const elDots      = document.querySelectorAll(".dot");   // ← original cached ref (now dynamic)
const elPause     = document.getElementById("pause-label");
const elStart     = document.getElementById("btn-start");
// ...
```

The `elDots` constant was removed when dots became dynamically generated (todo 015), but the replacement `dotsContainer` reference was not promoted to module scope. Every other interactive element in the popup is captured once at the top of the file. `dotsContainer` is the only one re-queried on every render.

## Proposed Solutions

**Option A — Promote `dotsContainer` to module scope alongside the other `el*` constants (Recommended)**

```js
// At module scope with other el* constants:
const elDotsContainer = document.querySelector(".dots");

// In renderTimerState:
if (elDotsContainer.children.length !== interval) {
  elDotsContainer.replaceChildren(...);
}
elDotsContainer.querySelectorAll(".dot").forEach((dot, i) => {
  dot.classList.toggle("filled", ...);
});
```

Note: `elDotsContainer.querySelectorAll(".dot")` inside `renderTimerState` is still re-queried each time (because the children are dynamically created), but that's unavoidable after a `replaceChildren`. The container ref itself is what should be cached.

Pros: consistent with the established caching pattern; eliminates one document traversal per second.
Cons: none.

**Option B — Leave as-is**

The cost of one `querySelector` per second is negligible in absolute terms. The inconsistency with the established pattern is the stronger argument for fixing it.

## Technical Details

- **Affected file:** `popup/popup.js` — move `document.querySelector(".dots")` from inside `renderTimerState` to module-scope constant block
- **Rename:** `dotsContainer` → `elDotsContainer` to match naming convention of other cached refs

## Acceptance Criteria

- [ ] `document.querySelector(".dots")` does not appear inside `renderTimerState`
- [ ] `elDotsContainer` is declared at module scope alongside `elLabel`, `elCountdown`, etc.
- [ ] Dynamic dot rendering behavior is unchanged

## Work Log

- 2026-03-01: Identified by code-reviewer agent (Advisory Note #9)
