---
status: pending
priority: p2
issue_id: "014"
tags: [architecture, ipc, code-review, background, content]
dependencies: []
---

# 014 — Implicit UPDATE_BAR message protocol breaks silently on publicState() shape changes

## Problem Statement

`UPDATE_BAR` is constructed by spreading `publicState()` directly into the message object (`...ps`), while `STATE_UPDATE` wraps it as `state: ps`. These two consumers of the same data use inconsistent conventions, and the content script must know the internal shape of `publicState()` to read it. If any field is added or removed from `publicState()`, the content script breaks silently with no error.

## Findings

**File:** `background/background.js`, line 345–349

```js
browser.tabs.sendMessage(state.boundTabId, {
  type: "UPDATE_BAR",
  ...ps,           // ← spreads publicState() fields directly
  isBoundTab: true,
}).catch(() => {});
```

**File:** `content/content.js`, line 157–160

```js
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "UPDATE_BAR") {
    applyState(msg, myTabId);   // ← msg IS the state (spread); msg.mode, msg.progress, etc.
  }
});
```

**File:** `background/background.js`, line 352 (STATE_UPDATE — the correct pattern)

```js
browser.runtime.sendMessage({ type: "STATE_UPDATE", state: ps }).catch(() => {});
```

The popup reads `msg.state`; the content script reads `msg` directly. The protocol is defined implicitly by the spread, not by a stated schema.

## Proposed Solutions

**Option A — Align UPDATE_BAR with STATE_UPDATE convention (Recommended)**

```js
// background.js broadcastState():
browser.tabs.sendMessage(state.boundTabId, {
  type: "UPDATE_BAR",
  state: ps,
  isBoundTab: true,
}).catch(() => {});

// content.js listener:
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "UPDATE_BAR") {
    if (myTabId === null) { pendingMsg = msg; return; }
    applyState(msg.state, myTabId);   // ← read msg.state, same as popup
  }
});
```

Pros: both consumers use `msg.state`; protocol is explicit; no silent breaks on schema change.
Cons: two-file change required together.

**Option B — Document the current spread contract**

Add a JSDoc comment defining the exact fields `UPDATE_BAR` carries.
Pros: no code change. Cons: documentation can drift; doesn't fix the inconsistency.

## Technical Details

- **Affected files:** `background/background.js:345–349`, `content/content.js:157–160`
- **Must change together:** background `broadcastState()` and content `onMessage` handler

## Acceptance Criteria

- [ ] `UPDATE_BAR` uses `state: ps` field, not a spread
- [ ] Content script reads `msg.state` consistently with how popup reads `STATE_UPDATE`
- [ ] `applyState` call signature unchanged — only the field path to reach state changes

## Work Log

- 2026-03-01: Identified by design-reviewer agent (Violation 7, P1 recommendation)
