---
status: pending
priority: p3
issue_id: "012"
tags: [code-review, simplicity, background, content-script, popup]
dependencies: ["005", "008"]
---

# 012 — Code simplification batch: 8 small cleanups

## Problem Statement

Eight small simplification opportunities identified by code-simplicity and architecture reviewers. Each is 1–5 lines. Best addressed in a single pass.

## Findings & Proposed Fixes

### A — `tick()` reimplements `currentElapsed()` inline
**File:** `background/background.js:61`
```js
// Before:
state.elapsedMs = Date.now() - state.startTimestamp;

// After (use existing helper):
state.elapsedMs = currentElapsed();
```

### B — `sessionDuration` exposed in `publicState` but unused by any consumer
**File:** `background/background.js:297`
Remove: `sessionDuration: state.sessionDuration,`

### C — Dead `build_notes.txt` file
Delete `/Users/dev0/sandbox/claude/tsomething/build_notes.txt`.

### D — `updateBadge` calls `setBadgeBackgroundColor` every tick (color never changes mid-session)
**File:** `background/background.js:284–286`
Move `setBadgeBackgroundColor` into `startSession()` only:
```js
function startSession(mode) {
  // ...
  browser.browserAction.setBadgeBackgroundColor({
    color: mode === "work" ? "#E05A4A" : "#52C78E",
  });
  // ...
}
// Remove from updateBadge()
```

### E — `lastIsBound` module variable is redundant; `isBound` already tracks previous state
**File:** `content/content.js:8, 130, 141`
Remove `let lastIsBound = false`. Replace condition with:
```js
const shouldBind = nowBound && state.mode !== "idle";
if (shouldBind && (!isBound || state.mode !== lastMode)) {
  applyFaviconOverlay(state.mode);
} else if (!shouldBind && isBound) {
  removeFaviconOverlay();
}
isBound = shouldBind;
```

### F — `currentBoundTabId` in popup.js is a shadow copy of `elBind.classList.contains("bound")`
**File:** `popup/popup.js:29, 48, 112–118`
```js
// Remove: let currentBoundTabId = null;
// Remove: currentBoundTabId = boundTabId; (in renderTimerState)
// Simplify handler:
elBind.addEventListener("click", () => {
  const type = elBind.classList.contains("bound") ? "UNBIND_TAB" : "BIND_TAB";
  browser.runtime.sendMessage({ type });
});
```

### G — `fmtDuration` and `formatTime` duplicate the ms→min:sec conversion math
**File:** `popup/popup.js:31–36, 124–129`
```js
function msToMinSec(ms, round) {
  const s = round ? Math.round(ms / 1000) : Math.ceil(ms / 1000);
  return [Math.floor(s / 60), s % 60];
}
function formatTime(ms) {
  const [m, s] = msToMinSec(ms, false);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function fmtDuration(ms) {
  const [m, s] = msToMinSec(ms, true);
  return `${m}:${String(s).padStart(2, "0")}`;
}
```

### H — Tab click uses N closures; one delegated listener suffices
**File:** `popup/popup.js:5–14`
```js
document.querySelector(".tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  if (btn.dataset.tab === "history") loadHistory();
});
```

## Technical Details

- **Affected files:** `background/background.js`, `content/content.js`, `popup/popup.js`, root
- **Net LOC reduction:** ~30 lines
- **Risk:** Low — all changes are local substitutions with no behavior change

## Acceptance Criteria

- [ ] All 8 items addressed in one commit
- [ ] Extension still loads in Firefox without errors
- [ ] Timer, binding, history, and settings all function correctly after changes

## Work Log

- 2026-03-01: Identified by code-simplicity-reviewer and architecture-strategist agents
