---
status: pending
priority: p2
issue_id: "036"
tags: [agent-native, background, ipc, code-review]
dependencies: []
---

# 036 — BIND_TAB Accepts No Explicit Tab ID, Blocking Reliable Agent-Driven Binding

## Problem Statement
`BIND_TAB` resolves the target tab by querying for the currently-active tab in the current window. An agent sending `{ type: "BIND_TAB" }` cannot specify which tab to bind to — it must arrange for the correct tab to be focused first, then send the message, racing against any focus changes. This makes reliable agent-driven binding impossible.

## Findings
`background/background.js`, `bindToCurrentTab`:
```js
function bindToCurrentTab() {
  browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    if (!tabs.length) return;
    state.boundTabId = tabs[0].id;
    // ...
  });
}
```
The BIND_TAB handler calls this unconditionally without reading `msg.tabId`.

## Proposed Solutions
Option A — Accept optional `tabId` in the BIND_TAB message (Recommended):
```js
case "BIND_TAB":
  if (msg.tabId) {
    state.boundTabId = msg.tabId;
    persistState();
    broadcastState();
    reply({ ok: true });
  } else {
    bindToCurrentTab();
    reply({ ok: true });
  }
  return false;
```
UI behavior (popup button) sends `{ type: "BIND_TAB" }` without tabId — unchanged. Agents send `{ type: "BIND_TAB", tabId: 42 }`.

Option B — Document the current-tab dependency. Pros: no code change. Cons: agents must race the window focus to use the feature.

## Technical Details
- **Affected file:** `background/background.js`

## Acceptance Criteria
- [ ] `{ type: "BIND_TAB", tabId: 42 }` binds to tab 42 directly, without querying active tab
- [ ] `{ type: "BIND_TAB" }` (no tabId) still falls back to current-tab query for popup use
- [ ] `{ type: "BIND_TAB", tabId: 42 }` returns `{ ok: true }` synchronously

## Work Log
- 2026-03-01: Identified by agent-native-reviewer
