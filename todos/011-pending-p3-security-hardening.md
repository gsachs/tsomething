---
status: pending
priority: p3
issue_id: "011"
tags: [security, code-review, background, popup]
dependencies: ["001", "002"]
---

# 011 — Security hardening: CSP declaration, field injection, innerHTML pattern

## Problem Statement

Three related security polish items (all low severity individually, worth batching):

1. **No explicit CSP in manifest** — the default MV2 CSP (`script-src 'self'; object-src 'self'`) is applied implicitly. Not declaring it means reviewers cannot verify the security posture at a glance, and an accidental loosening (e.g. adding `unsafe-inline` for a quick fix) won't be obviously wrong.

2. **SAVE_SETTINGS spreads arbitrary fields** — `{ ...DEFAULT_SETTINGS, ...msg.settings }` copies any enumerable key from the message into `settings` and then into `publicState()`. Unknown keys propagate to every content script on every tick.

3. **`innerHTML` pattern in popup.js adjacent to untrusted data** — Two `innerHTML` usages sit directly above the history rendering loop which correctly uses `textContent`. The pattern inconsistency is a future XSS risk if a developer follows the `innerHTML` example when adding domain display.

## Findings

- `manifest.json`: no `content_security_policy` key
- `background/background.js:412`: `settings = { ...DEFAULT_SETTINGS, ...msg.settings }`
- `popup/popup.js:148, 156`: `elHistoryList.innerHTML = ""` and `innerHTML = '<div ...>'`

## Proposed Solutions

**All three in one pass:**

```json
// manifest.json — add:
"content_security_policy": "script-src 'self'; object-src 'self';"
```

```js
// background.js SAVE_SETTINGS — destructure known keys only:
const { workDuration, breakDuration, longBreakDuration,
        longBreakInterval, completionThreshold } = msg.settings;
settings = sanitizeSettings({ workDuration, breakDuration,
                               longBreakDuration, longBreakInterval, completionThreshold });
```

```js
// popup.js — replace innerHTML usages:
elHistoryList.replaceChildren();  // was innerHTML = ""

const empty = document.createElement("div");
empty.className = "empty-state";
empty.textContent = "No sessions yet";
elHistoryList.appendChild(empty);  // was innerHTML = '<div ...>'
```

## Technical Details

- **Affected files:** `manifest.json`, `background/background.js:412`, `popup/popup.js:148, 156`
- **Note:** Destructuring in SAVE_SETTINGS overlaps with finding 002 — apply both together

## Acceptance Criteria

- [ ] `manifest.json` has explicit `content_security_policy`
- [ ] `SAVE_SETTINGS` only applies the 5 known setting keys
- [ ] No `innerHTML` assignments remain in `popup.js`
- [ ] Empty-state display still works correctly in history tab

## Work Log

- 2026-03-01: Identified by security-sentinel agent
