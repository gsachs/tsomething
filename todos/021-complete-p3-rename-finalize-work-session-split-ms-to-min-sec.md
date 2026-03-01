---
status: pending
priority: p3
issue_id: "021"
tags: [code-quality, background, popup, code-review, naming, cqs]
dependencies: []
---

# 021 — recordWorkSession name hides mutation; msToMinSec boolean parameter signals two functions

## Problem Statement

Two naming/interface violations in one todo (both small, same fix pass):

1. `recordWorkSession` sounds like it "records" (logs) a session, but it also increments `state.pomodoroCount` — a state mutation invisible from the name. Three call sites silently accept this side effect.

2. `msToMinSec(ms, round)` takes a boolean parameter that selects between two rounding behaviors (ceil vs round). Boolean parameters signal that a function does two things; the name does not hint at which rounding applies.

## Findings

**Violation 1 — recordWorkSession**

**File:** `background/background.js`, line 246–252

```js
function recordWorkSession(fullyCompleted) {
  if (state.mode !== "work") return;
  const pct = fullyCompleted ? 100 : progress() * 100;
  const counted = fullyCompleted || pct >= settings.completionThreshold;
  if (counted) state.pomodoroCount++;   // ← hidden mutation
  logSession(counted, pct);
}
```

Call sites at lines 132 (`stopSession`), 141 (`onSessionComplete`), 236 (`tabs.onRemoved`) all trigger the count increment without any indication at the call site that state is mutated.

**Violation 2 — msToMinSec boolean**

**File:** `popup/popup.js`, lines 28–31

```js
function msToMinSec(ms, round) {
  const s = round ? Math.round(ms / 1000) : Math.ceil(ms / 1000);
  return [Math.floor(s / 60), s % 60];
}
```

Called as `msToMinSec(ms, false)` in `formatTime` (ceil, for countdown display) and `msToMinSec(ms, true)` in `fmtDuration` (round, for history display). A reader of either call site must look up the function body to understand what `false` and `true` mean.

## Proposed Solutions

**Option A — Rename + split (Recommended)**

```js
// background.js:
function finalizeWorkSession(fullyCompleted) { ... }

// popup.js — replace one function with two:
function msToMinSecCeil(ms) {
  const s = Math.ceil(ms / 1000);
  return [Math.floor(s / 60), s % 60];
}

function msToMinSecRound(ms) {
  const s = Math.round(ms / 1000);
  return [Math.floor(s / 60), s % 60];
}

// formatTime uses msToMinSecCeil; fmtDuration uses msToMinSecRound
```

Pros: intent visible at every call site; boolean parameter eliminated.
Cons: two functions instead of one (but they serve genuinely different purposes).

**Option B — Rename only `recordWorkSession`; keep boolean**

Rename to `finalizeWorkSession`; leave `msToMinSec` as-is.
Pros: addresses the higher-risk issue (hidden mutation). Cons: boolean parameter remains.

## Technical Details

- **background.js:** rename `recordWorkSession` → `finalizeWorkSession` at line 246 and all three call sites (lines 132, 141, 236)
- **popup.js:** replace `msToMinSec(ms, round)` with `msToMinSecCeil` and `msToMinSecRound`; update `formatTime` and `fmtDuration` callers

## Acceptance Criteria

- [ ] No function named `recordWorkSession` in codebase
- [ ] `finalizeWorkSession` called from `stopSession`, `onSessionComplete`, `tabs.onRemoved` handler
- [ ] `msToMinSec` with a boolean parameter no longer exists
- [ ] `formatTime` calls `msToMinSecCeil`; `fmtDuration` calls `msToMinSecRound`
- [ ] Timer display and history duration formatting are unchanged

## Work Log

- 2026-03-01: Identified by design-reviewer agent (Violations 1 and 6, P8 recommendation)
