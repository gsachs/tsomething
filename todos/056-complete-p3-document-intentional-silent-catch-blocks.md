---
status: pending
priority: p3
issue_id: "056"
tags: [code-quality, error-handling, code-review]
dependencies: []
---

# 056 — Document intentional `.catch(() => {})` silences on IPC sendMessage calls

## Problem Statement

Three empty `.catch(() => {})` blocks on `sendMessage` calls silently swallow all errors. The code-reviewer flags these as zero-tolerance violations under the standard ("swallowed exceptions"). In each case the silence is intentional — the error happens on a restricted/missing page — but the code is indistinguishable from an accidental silence. Without a comment, a reviewer must re-derive the reason and a future change could accidentally introduce a real error into the same catch path with no visibility.

Note: `persistState` rejections are a separate concern (todo 032). These are the IPC message silences.

## Findings

**File:** `background/background.js`, `broadcastState`

```js
browser.tabs.sendMessage(state.boundTabId, {
  type: "UPDATE_BAR",
  state: ps,
  isBoundTab: true,
}).catch(() => {});   // ← silent: no explanation
```

This fires on every tick when a tab is bound. It fails silently when:
- The content script is not injected (restricted URLs: `about:`, `moz-extension:`, `chrome:`, PDF viewer)
- The tab was closed between the check and the send

**File:** `background/background.js`, `broadcastState`

```js
browser.runtime.sendMessage({ type: "STATE_UPDATE", state: ps }).catch(() => {});
```

Fails silently when the popup is closed. Expected — the popup registers no listener when closed; the rejection is normal.

**File:** `content/content.js`, `visibilitychange` handler

```js
browser.runtime.sendMessage({ type: "GET_STATE" }).then((state) => {
  applyState(state, myTabId);
}).catch(() => {});
```

Fails silently if the background context is unavailable (extension update in flight, background restarting). Expected but undocumented.

**File:** `content/content.js`, CONTENT_READY handler

```js
browser.runtime.sendMessage({ type: "CONTENT_READY" }).then((response) => {
  myTabId = response.tabId;
  // ...
}).catch(() => {});
```

## Proposed Solutions

**Option A — Add a one-line comment on each `.catch(() => {})` explaining why silence is correct (Recommended)**

```js
// content script absent on restricted pages (about:, PDF, moz-extension:) — expected
}).catch(() => {});

// popup is closed when no listener is registered — expected rejection
}).catch(() => {});

// extension context unavailable (update in flight) — nothing to apply
}).catch(() => {});

// background not yet ready; content script will re-init on next CONTENT_READY
}).catch(() => {});
```

Pros: a reviewer instantly knows silence is intentional, not an oversight; no behavioral change.
Cons: adds 4 comment lines.

**Option B — Replace with named error handler that logs in development**

```js
.catch((e) => { /* expected: content script absent */ });
```

Pros: slightly more explicit binding. Cons: same benefit as a comment with more verbosity.

## Technical Details

- **Affected file:** `background/background.js` (2 catches in `broadcastState`)
- **Affected file:** `content/content.js` (2 catches in `visibilitychange` and `CONTENT_READY` handlers)
- **No logic change required** — comments only

## Acceptance Criteria

- [ ] Each `.catch(() => {})` on a `sendMessage` call has a comment explaining the expected failure mode
- [ ] No behavior change

## Work Log

- 2026-03-01: Identified by code-reviewer agent (Advisory Notes #2, Zero-Tolerance Items)
