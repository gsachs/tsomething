---
status: pending
priority: p3
issue_id: "017"
tags: [code-quality, popup, code-review, abstraction]
dependencies: []
---

# 017 — renderTimerState mixes display rendering with button-visibility state machine

## Problem Statement

`renderTimerState` operates at two abstraction levels simultaneously: it renders display values (label text, countdown, progress fill, dots, pause notice) and manages button visibility as a branching state machine over `mode`. A reader must track both levels at once. The button-visibility block (lines 74–89) is a self-contained `mode`-dispatch concern with no dependency on the rendering values computed above it.

## Findings

**File:** `popup/popup.js`, lines 45–100, `renderTimerState`

```js
function renderTimerState(state) {
  // ... rendering: label, countdown, fill, dots, pause notice ...

  // Button state machine — different abstraction level:
  if (mode === "idle") {
    elStart.classList.remove("hidden");
    elStop.classList.add("hidden");
    elSkip.classList.add("hidden");
    elStart.textContent = "Start";
    elStart.classList.remove("break-mode");
  } else if (mode === "work") {
    elStart.classList.add("hidden");
    elStop.classList.remove("hidden");
    elSkip.classList.add("hidden");
  } else {
    elStart.classList.add("hidden");
    elStop.classList.add("hidden");
    elSkip.classList.remove("hidden");
  }
  // ... then bind button logic ...
}
```

The if/else block on lines 74–89 manages three separate DOM elements based on `mode`. This is a mode-dispatch responsibility, not a rendering responsibility.

## Proposed Solutions

**Option A — Extract updateButtonVisibility(mode) (Recommended)**

```js
function updateButtonVisibility(mode) {
  if (mode === "idle") {
    elStart.classList.remove("hidden");
    elStop.classList.add("hidden");
    elSkip.classList.add("hidden");
    elStart.textContent = "Start";
    elStart.classList.remove("break-mode");
  } else if (mode === "work") {
    elStart.classList.add("hidden");
    elStop.classList.remove("hidden");
    elSkip.classList.add("hidden");
  } else {
    elStart.classList.add("hidden");
    elStop.classList.add("hidden");
    elSkip.classList.remove("hidden");
  }
}

function renderTimerState(state) {
  // ... all rendering ...
  updateButtonVisibility(mode);
  // ... bind button ...
}
```

Pros: `renderTimerState` reads at a uniform abstraction level; `updateButtonVisibility` is independently readable.
Cons: none.

**Option B — Use CSS data-mode to drive button visibility**

Set `data-mode` on a container and use CSS attribute selectors to show/hide buttons.
Pros: eliminates the JS state machine entirely; CSS already uses this pattern for the bar.
Cons: larger change; requires CSS additions.

## Technical Details

- **Affected file:** `popup/popup.js`, lines 74–89
- **New function:** `updateButtonVisibility(mode)` — private, called from `renderTimerState`

## Acceptance Criteria

- [ ] `renderTimerState` calls `updateButtonVisibility(mode)` as a single line
- [ ] `updateButtonVisibility` contains all button show/hide logic
- [ ] Button behavior is identical across all modes

## Work Log

- 2026-03-01: Identified by design-reviewer agent (Violation 8, P4 recommendation)
