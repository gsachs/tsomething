---
status: pending
priority: p2
issue_id: "007"
tags: [code-review, architecture, background, tab-binding, history]
dependencies: []
---

# 007 — BIND_TAB mid-session orphans favicon overlay and logs wrong domain

## Problem Statement

If the user binds a new tab during a running work session, two things go wrong: (1) the old bound tab's favicon overlay may not be restored if the tab is unreachable, and (2) `state.sessionDomain` still reflects the original tab's domain — the history entry will log the wrong domain for the session.

## Findings

**Files:** `background/background.js:162–168`, `content/content.js:132–138`

**Domain issue:** `sessionDomain` is set inside `startSession()` via an async `tabs.get()` call. If `BIND_TAB` arrives mid-session, `bindToCurrentTab()` changes `state.boundTabId` but does NOT update `state.sessionDomain`. The next time `broadcastState()` fires, the old tab gets `isBoundTab: false` and `removeFaviconOverlay()` is called — but only if the tab is reachable. If the old tab is in a background window and its content script is unresponsive, the `.catch(() => {})` silently swallows the failure and the overlay persists.

**Simplest fix — define the problem out of existence:** Disable the "Bind to tab" button while a session is active. The bind action only makes sense at idle. This removes both issues at their root.

## Proposed Solutions

**Option A — Disable bind during active session (Recommended)**
In `popup.js` `renderTimerState`, disable the bind button during non-idle modes:
```js
elBind.disabled = (mode !== "idle");
elBind.classList.toggle("disabled", mode !== "idle");
```
And in CSS:
```css
.btn-bind:disabled { opacity: 0.4; cursor: default; }
```
This defines the error state out of existence with zero additional logic.

**Option B — Update sessionDomain on mid-session bind**
In `bindToCurrentTab()`, if `state.mode !== "idle"`, also update `state.sessionDomain`:
```js
function bindToCurrentTab() {
  browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    if (!tabs.length) return;
    state.boundTabId = tabs[0].id;
    if (state.mode !== "idle") {
      try { state.sessionDomain = new URL(tabs[0].url).hostname; }
      catch { state.sessionDomain = null; }
    }
    persistState();
    broadcastState();
  });
}
```
Pros: Allows mid-session rebinding. Cons: Doesn't fix the orphaned favicon problem.

## Technical Details

- **Affected files:** `background/background.js:162–168`, `popup/popup.js:renderTimerState`

## Acceptance Criteria

- [ ] "Bind to tab" button is visually disabled and non-functional during active work or break sessions
- [ ] Binding works correctly when timer is idle
- [ ] After binding at idle and starting a session, the correct domain is logged

## Work Log

- 2026-03-01: Identified by architecture-strategist agent
