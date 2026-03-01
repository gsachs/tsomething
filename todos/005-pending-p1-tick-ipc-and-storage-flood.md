---
status: pending
priority: p1
issue_id: "005"
tags: [performance, code-review, background]
dependencies: []
---

# 005 — tick() generates O(n_tabs) IPC messages + 1 disk write per second

## Problem Statement

Every second during an active session, `tick()` calls both `broadcastState()` (which issues one `tabs.sendMessage` per open tab across all windows) and `persistState()` (which writes to `browser.storage.local`). With 30 open tabs this is 30 IPC round-trips/second and 1,500 disk writes per 25-minute session. Neither is necessary: unbound tabs only need their progress bar updated when visible (the content script can handle this itself), and `startTimestamp` already anchors state for crash recovery without needing per-second persistence.

## Findings

**File:** `background/background.js`, lines 58–71 (tick), 304–320 (broadcastState), 324–338 (persistState)

**IPC volume:**
| Open tabs | Messages/second | Messages/25-min session |
|-----------|----------------|------------------------|
| 10 | 10 | 15,000 |
| 30 | 30 | 45,000 |
| 100 | 100 | 150,000 |

Most of these fail silently (`.catch(() => {})`) on tabs that have no content script (new tab page, `about:` URLs, extension pages).

**Storage writes:** `browser.storage.local` is backed by LevelDB. Writing every second triggers compaction overhead and is not what the storage API is designed for. `startTimestamp` is already persisted when the session starts — crash recovery can reconstruct `elapsedMs = Date.now() - startTimestamp` without per-second updates.

## Proposed Solutions

**Option A — Target broadcast + remove persistState from tick (Recommended)**

```js
// broadcastState: only push to bound tab + popup
function broadcastState() {
  const ps = publicState();

  if (state.boundTabId !== null) {
    browser.tabs.sendMessage(state.boundTabId, {
      type: "UPDATE_BAR", ...ps, isBoundTab: true,
    }).catch(() => {});
  }

  browser.runtime.sendMessage({ type: "STATE_UPDATE", state: ps }).catch(() => {});
}

// tick: remove persistState() call
function tick() {
  if (state.autoPaused || state.mode === "idle") return;
  state.elapsedMs = Date.now() - state.startTimestamp;

  if (state.elapsedMs >= state.sessionDuration) {
    onSessionComplete();
  } else {
    broadcastState();
    // persistState() REMOVED — startTimestamp persisted at session start
    updateBadge();
  }
}
```

Unbound tabs rely on their existing `poll()` (or, after fixing 008, on `visibilitychange`-triggered pulls). The progress bar in background tabs has zero user value anyway.

**Option B — Throttle broadcast to every 5s for non-bound tabs**
Keep `tabs.query({})` but batch background-tab updates less frequently. Pros: Simpler diff. Cons: Leaves the storage write problem unaddressed; still sends IPC to all tabs.

## Technical Details

- **Affected files:** `background/background.js:58–71, 304–320, 324–338`
- **Complementary fix:** After 008 (eliminate poll), unbound tabs use `visibilitychange` to pull state when they become visible

## Acceptance Criteria

- [ ] During active session, background sends ≤2 messages/second total (bound tab + popup), regardless of total open tab count
- [ ] `persistState` is NOT called inside `tick()`
- [ ] Crash recovery still works: restarting browser mid-session resumes from correct elapsed time
- [ ] Favicon overlay on bound tab continues to update in real time

## Work Log

- 2026-03-01: Identified by performance-oracle and architecture-strategist agents
