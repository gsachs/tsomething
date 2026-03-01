---
status: pending
priority: p3
issue_id: "018"
tags: [performance, content, code-review]
dependencies: []
---

# 018 — bar.querySelector("#pomo-bar-fill") re-queried every tick; reference already available at creation

## Problem Statement

`updateBar` calls `bar.querySelector("#pomo-bar-fill")` on every invocation — once per second during a session. `createBar` creates the `fill` element and appends it to `bar`, but immediately discards the reference. The DOM query in the hot path is unnecessary.

## Findings

**File:** `content/content.js`, line 13–24, `createBar`

```js
function createBar() {
  const root = document.createElement("div");
  root.id = "pomo-bar-root";
  root.setAttribute("data-mode", "idle");

  const fill = document.createElement("div");
  fill.id = "pomo-bar-fill";
  root.appendChild(fill);

  document.body.prepend(root);
  return root;   // ← `fill` reference discarded here
}
```

**File:** `content/content.js`, line 31

```js
bar.querySelector("#pomo-bar-fill").style.width = ...;  // ← re-queried every tick
```

At 1 Hz this is negligible in isolation, but it is an avoidable DOM traversal in the hot path and a sign that `createBar`'s return type does not expose what callers need.

## Proposed Solutions

**Option A — Capture fill as a second module-level reference (Simplest)**

```js
const bar = document.createElement("div");
bar.id = "pomo-bar-root";
bar.setAttribute("data-mode", "idle");

const barFill = document.createElement("div");
barFill.id = "pomo-bar-fill";
bar.appendChild(barFill);
document.body.prepend(bar);

// updateBar:
function updateBar(state) {
  const mode = state.autoPaused ? "paused" : state.mode;
  bar.setAttribute("data-mode", mode);
  barFill.style.width = state.mode === "idle" ? "0%" : `${state.progress * 100}%`;
}
```

Eliminate the `createBar` function and inline the two-element construction. Pros: zero querySelector in hot path; removes needless function abstraction for a one-time setup.
Cons: slightly more top-level statements.

**Option B — Return { root, fill } from createBar**

```js
function createBar() {
  // ...
  return { root, fill };
}
const { root: bar, fill: barFill } = createBar();
```

Pros: keeps creation logic in a function. Cons: two names to manage for what is really one widget.

## Technical Details

- **Affected file:** `content/content.js`, lines 13–33
- **querySelector at line 31 eliminated entirely**

## Acceptance Criteria

- [ ] `updateBar` sets `barFill.style.width` directly, no `querySelector` call
- [ ] Bar and fill are created with the same DOM structure as before
- [ ] Fullscreen handler still references `bar` (root) correctly

## Work Log

- 2026-03-01: Identified by design-reviewer agent (Violation 5, P5 recommendation)
