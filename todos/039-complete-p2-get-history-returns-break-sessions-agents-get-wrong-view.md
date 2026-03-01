---
status: pending
priority: p2
issue_id: "039"
tags: [agent-native, background, history, code-review]
dependencies: []
---

# 039 — GET_HISTORY Returns Break Sessions, Giving Agents a Different View Than the User

## Problem Statement
`GET_HISTORY` returns the full raw history array including break and longBreak session entries. The popup filters to `type === "work"` before rendering, so the user sees only work sessions. An agent receiving `GET_HISTORY` sees a different (superset) view from what the user considers their "history." Agent-generated summaries will include break sessions, diverging from the user-visible history.

## Findings
`background/background.js`:
```js
case "GET_HISTORY":
  browser.storage.local.get("history").then((s) => reply(s.history || []));
```
Returns everything. `popup/popup.js`: `history.filter((e) => e.type === "work")` — filter lives only in the UI.

## Proposed Solutions
Option A — Filter in the handler to match the user-visible view (Recommended):
```js
case "GET_HISTORY":
  browser.storage.local.get("history").then((s) => {
    const history = (s.history || []).filter((e) => e.type === "work");
    reply(history);
  });
  return true;
```

Option B — Add a `type` query parameter: `{ type: "GET_HISTORY", sessionType: "work" }`. Pros: flexible. Cons: more complex; the default should match the user's view.

## Technical Details
- **Affected file:** `background/background.js`

## Acceptance Criteria
- [ ] `GET_HISTORY` response contains only `type === "work"` entries
- [ ] Popup history display is unchanged (it was already filtering, now redundantly)
- [ ] `CLEAR_HISTORY` still clears all entries (the filter is only on reads)

## Work Log
- 2026-03-01: Identified by agent-native-reviewer
