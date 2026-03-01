---
status: pending
priority: p3
issue_id: "051"
tags: [simplicity, popup, code-review]
dependencies: []
---

# 051 — popupReady flag guards an impossible race

## Problem Statement
The `popupReady` flag suppresses `STATE_UPDATE` messages until `GET_STATE` resolves. The concern is a STATE_UPDATE arriving after the listener is registered but before GET_STATE resolves — dropping it. In practice: the GET_STATE response also calls `renderTimerState` with the same or newer state, so any dropped STATE_UPDATE is immediately superseded. The flag adds a tracking variable and conditional for no observable safety benefit.

## Findings
[popup/popup.js] — `let popupReady = false` (line ~254), guard in STATE_UPDATE listener, set to true in GET_STATE .then().

## Proposed Solutions
**Option A — Remove the popupReady flag and guard (Recommended)**
Remove the `popupReady` flag and guard. Process all STATE_UPDATE messages immediately. The GET_STATE response will render the definitive initial state.

**Option B — Keep as an intentional guard against the theoretical race. Pros: documents the race exists. Cons: adds state management for no practical benefit.**

## Technical Details
- **Affected file:** `popup/popup.js`

## Acceptance Criteria
- [ ] `popupReady` variable removed
- [ ] STATE_UPDATE handler processes messages without guard
- [ ] popup renders correctly on open

## Work Log
- 2026-03-01: Identified by code-review agent
