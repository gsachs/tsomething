---
status: pending
priority: p1
issue_id: "024"
tags: [bug, background, lifecycle, code-review]
dependencies: []
---

# 024 — `initialized` never set to `true` when session completes on startup — all commands rejected during auto-break

## Problem Statement

When `init()` restores a session that completed while the browser was closed, it calls `onSessionComplete()` and then returns early — never setting `initialized = true`. The background is fully running (a break session is now ticking), but every subsequent message from the popup is rejected with `{ error: "not ready" }`. The user cannot stop or interact with the auto-started break session.

## Findings

**File:** `background/background.js`, lines 402–411

```js
async function init() {
  // ...
  if (stored.timerState && stored.timerState.mode !== "idle") {
    const result = deserializeState(stored.timerState);
    if (result === "completed") { onSessionComplete(); return; }  // ← returns without setting initialized
    startTick();
    updateBadge();
  }
  initialized = true;   // ← never reached when result === "completed"
}
```

`onSessionComplete()` calls `startSession("break")`, which calls `broadcastState()`, prompting the popup to respond. The popup's `START`, `STOP`, `BIND_TAB` messages all hit the guard at line 421:

```js
if (!initialized && msg.type !== "CONTENT_READY" && msg.type !== "GET_STATE") {
  reply({ error: "not ready" });
  return false;
}
```

The popup renders correctly (GET_STATE is exempted), but the user's Stop button fires a STOP message that is silently rejected. The timer runs a break session the user cannot stop.

## Proposed Solutions

**Option A — Set `initialized = true` before calling `onSessionComplete()` (Recommended)**

```js
initialized = true;   // ← set unconditionally before the if block
if (stored.timerState && stored.timerState.mode !== "idle") {
  const result = deserializeState(stored.timerState);
  if (result === "completed") { onSessionComplete(); return; }
  startTick();
  updateBadge();
}
```

Pros: one-line fix; `initialized` is set before any message can arrive.
Cons: none — initialization is complete at the point `deserializeState` returns.

**Option B — Add `initialized = true` immediately after `onSessionComplete()` call**

```js
if (result === "completed") { onSessionComplete(); initialized = true; return; }
```

Pros: surgical change. Cons: easy to miss on future refactors.

## Technical Details

- **Affected file:** `background/background.js`, lines 402–411
- **Symptom:** STOP, START, BIND_TAB, SKIP_BREAK all return `{ error: "not ready" }` after a browser restart where a work session completed while the browser was closed
- **Trigger:** browser closed mid-session → session duration exceeded → browser reopened

## Acceptance Criteria

- [ ] After browser restart with an elapsed-complete session, the background sets `initialized = true`
- [ ] The popup's Stop button successfully sends STOP and receives `{ ok: true }` during the auto-started break
- [ ] `GET_STATE` still returns correct state during this window

## Work Log

- 2026-03-01: Identified by architecture-strategist and julik-frontend-races-reviewer agents
