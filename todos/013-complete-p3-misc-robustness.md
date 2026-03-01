---
status: pending
priority: p3
issue_id: "013"
tags: [code-review, architecture, race-condition, background, content-script]
dependencies: ["003"]
---

# 013 — Robustness batch: message handler default, init guard, UPDATE_BAR buffering

## Problem Statement

Three low-severity robustness gaps that are easy to fix together:

1. **No `default` in message handler** — unknown message types silently hang callers. Manifests as mysterious promise timeouts when extension is updated with old content scripts still running.

2. **No init guard** — messages can arrive (from content scripts connecting on startup) before `init()` completes its storage read. `START` or `STOP` commands would run against uninitialized state.

3. **`UPDATE_BAR` silently discarded before `myTabId` set** — creates a ≤1s delay before the progress bar first reflects accurate state on each page load. Poll (once removed per 008) was the recovery mechanism; without it, a one-time buffer-and-replay is needed.

## Findings

- `background/background.js:372–421`: no `default` in switch
- `background/background.js`: no `initialized` flag
- `content/content.js:157–161`: messages dropped during `CONTENT_READY` round-trip

## Proposed Solutions

### 1 — Default branch in message handler
```js
default:
  reply({ error: "unknown message type", type: msg.type });
  return false;
```

### 2 — Init guard
```js
let initialized = false;

browser.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id && sender.id !== browser.runtime.id) return false; // from 001
  if (!initialized && msg.type !== "CONTENT_READY" && msg.type !== "GET_STATE") {
    reply({ error: "not ready" });
    return false;
  }
  // ... switch
});

init().then(() => { initialized = true; });
```

### 3 — Buffer UPDATE_BAR until myTabId is set
```js
let pendingMsg = null; // only need the last one — these are state snapshots

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "UPDATE_BAR") {
    if (myTabId === null) { pendingMsg = msg; return; }
    applyState(msg, myTabId);
  }
});

browser.runtime.sendMessage({ type: "CONTENT_READY" }).then((response) => {
  myTabId = response.tabId;
  applyState(response.state, myTabId);
  if (pendingMsg) { applyState(pendingMsg, myTabId); pendingMsg = null; }
}).catch(() => {});
```

## Technical Details

- **Affected files:** `background/background.js`, `content/content.js`

## Acceptance Criteria

- [ ] Unknown message types return `{ error: "unknown message type" }` instead of hanging
- [ ] Sending `START` immediately on browser startup (before init completes) returns `{ error: "not ready" }` without corrupting state
- [ ] Progress bar on a freshly loaded page shows correct state within the same frame as page load, not 1 second later

## Work Log

- 2026-03-01: Identified by architecture-strategist and julik-frontend-races-reviewer agents
