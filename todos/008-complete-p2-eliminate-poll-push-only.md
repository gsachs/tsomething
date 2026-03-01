---
status: pending
priority: p2
issue_id: "008"
tags: [code-review, architecture, performance, content-script]
dependencies: ["005"]
---

# 008 — Eliminate redundant content-script poll; adopt push-only model

## Problem Statement

`content.js` runs both a `setInterval(poll, 1000)` pull AND receives `UPDATE_BAR` push messages from the background. The `CONTENT_READY` handshake already gives content scripts their initial state on load. After that, the background's push covers all updates. The poll exists as a fallback but creates redundant `applyState` calls every second on every visible tab, and the `GET_STATE` IPC round-trip it issues is wasted work.

## Findings

**File:** `content/content.js`, lines 146–153

After `CONTENT_READY` completes (line 165–168), `myTabId` is set and the push path is fully established. The `UPDATE_BAR` guard `if (msg.type === "UPDATE_BAR" && myTabId !== null)` handles the brief window before init. The poll's `if (myTabId === null) return` skip makes it purely redundant after init — it skips before init and double-fires after.

**Additionally:** After fix 005 (targeted broadcast to bound tab only), unbound tabs will no longer receive `UPDATE_BAR` pushes. For their progress bar to update when they become visible, they need either a `visibilitychange`-triggered one-shot pull or re-enabled polling gated on `document.hidden`. The solution should address this.

## Proposed Solutions

**Option A — Replace poll with visibilitychange one-shot pull (Recommended)**
```js
// Remove setInterval entirely.
// Replace with a single pull when tab becomes visible:
document.addEventListener("visibilitychange", () => {
  if (document.hidden || myTabId === null) return;
  browser.runtime.sendMessage({ type: "GET_STATE" }).then((state) => {
    applyState(state, myTabId);
  }).catch(() => {});
});
```
Pros: Zero overhead when tab is in background. Correct update the moment user switches to tab. Cons: If the user stares at a tab without switching away/back, the bar doesn't tick. But unbound tabs' bars are cosmetic anyway — the popup badge and popup itself are the accurate displays.

**Option B — Keep poll, gate strictly on bound tab**
```js
function poll() {
  if (document.hidden || myTabId === null) return;
  if (myTabId !== lastKnownBoundTabId) return; // only poll if bound
  browser.runtime.sendMessage({ type: "GET_STATE" }).then((state) => {
    applyState(state, myTabId);
  }).catch(() => {});
}
```
Pros: Bound tab bar ticks accurately. Cons: Adds state variable; bound tab already gets pushed updates after fix 005.

## Technical Details

- **Affected files:** `content/content.js:146–153`
- **Depends on:** 005 (targeted broadcast)
- **Removes:** `GET_STATE` poll path from the background message handler can be kept (popup still uses it on open)

## Acceptance Criteria

- [ ] No `setInterval` in content.js
- [ ] Bar updates correctly when user switches to a previously-background tab
- [ ] No redundant `applyState` calls on the bound tab (push path is the only source)
- [ ] Background `GET_STATE` handler still functions for popup

## Work Log

- 2026-03-01: Identified by architecture-strategist, performance-oracle, and code-simplicity-reviewer agents
