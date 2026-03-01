---
status: pending
priority: p3
issue_id: "043"
tags: [performance, background, code-review]
dependencies: []
---

# 043 — Badge text sent every tick when unchanged

## Problem Statement
`updateBadge()` calls `browser.browserAction.setBadgeText()` on every tick (1 Hz). The badge label only changes when the remaining minutes value changes — approximately once per minute in work mode. Break mode labels ("B", "LB") never change. This sends ~59 redundant IPC calls per minute to the browser process.

## Findings
[background/background.js] `updateBadge` — no cache of last-emitted label before calling setBadgeText.

## Proposed Solutions
**Option A — Cache last badge label; skip setBadgeText when unchanged (Recommended)**
```js
let _lastBadgeText = null;
function updateBadge() {
  if (state.mode === "idle") {
    if (_lastBadgeText !== "") { browser.browserAction.setBadgeText({ text: "" }); _lastBadgeText = ""; }
    return;
  }
  const mins = Math.ceil(remaining() / 60000);
  const label = state.mode === "work" ? String(mins) : state.mode === "longBreak" ? "LB" : "B";
  if (label !== _lastBadgeText) { browser.browserAction.setBadgeText({ text: label }); _lastBadgeText = label; }
}
```

**Option B — Leave as-is (browser handles deduplication internally). Low priority.**

## Technical Details
- **Affected file:** `background/background.js`, `updateBadge`

## Acceptance Criteria
- [ ] setBadgeText is called at most once per minute in work mode
- [ ] badge still updates correctly on mode change

## Work Log
- 2026-03-01: Identified by code-review agent
