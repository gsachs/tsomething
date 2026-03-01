---
status: pending
priority: p1
issue_id: "001"
tags: [security, code-review, background]
dependencies: []
---

# 001 — No sender validation in background onMessage handler

## Problem Statement

Any co-installed Firefox extension that knows this extension's ID can call `browser.runtime.sendMessage("<id>", { type: "CLEAR_HISTORY" })` or `{ type: "SAVE_SETTINGS", settings: { workDuration: 0 } }` and the handler executes without question. The `sender` argument is received but never read.

## Findings

**File:** `background/background.js`, line 372

```js
browser.runtime.onMessage.addListener((msg, sender, reply) => {
  // `sender` is never inspected
  switch (msg.type) {
    case "SAVE_SETTINGS":
      settings = { ...DEFAULT_SETTINGS, ...msg.settings };
```

In MV2, `browser.runtime.onMessage` receives messages from the extension's own popup, its own content scripts, **and any other installed extension**. Malicious extensions can:
- Erase session history via `CLEAR_HISTORY`
- Corrupt settings (e.g. `workDuration: 0`) triggering infinite session loop
- Force `START`/`STOP` without user knowledge

## Proposed Solutions

**Option A — Reject foreign senders (Recommended)**
Add a single guard at the top of the handler:
```js
browser.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id && sender.id !== browser.runtime.id) return false;
  // ...
});
```
Pros: One line, closes the attack surface completely. Cons: None — the extension has no legitimate reason to accept messages from other extensions.

**Option B — Split content-script vs popup handlers**
Use `sender.tab` presence to distinguish: content scripts have `sender.tab`, popup messages do not. Apply command restrictions per origin. Pros: Fine-grained. Cons: More complexity for no additional benefit given Option A handles it.

## Technical Details

- **Affected file:** `background/background.js:372`
- **Impacted commands:** `SAVE_SETTINGS`, `CLEAR_HISTORY`, `START`, `STOP`, `BIND_TAB`, `UNBIND_TAB`

## Acceptance Criteria

- [ ] `sender.id !== browser.runtime.id` causes the handler to return without executing
- [ ] Content scripts (which have `sender.id === browser.runtime.id`) continue to work
- [ ] Popup continues to work

## Work Log

- 2026-03-01: Identified by security-sentinel agent
