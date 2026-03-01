---
status: pending
priority: p3
issue_id: "019"
tags: [code-quality, popup, code-review, abstraction]
dependencies: []
---

# 019 — loadHistory conflates data grouping with DOM construction; extract groupByDay

## Problem Statement

`loadHistory` does four things: fetches history, filters/sorts, groups sessions by day into a plain-object map, then imperatively constructs all DOM nodes. The grouping logic is a pure data transformation buried inside an imperative rendering loop, making neither the transformation nor the rendering independently readable or testable.

## Findings

**File:** `popup/popup.js`, lines 143–198, `loadHistory`

```js
function loadHistory() {
  browser.runtime.sendMessage({ type: "GET_HISTORY" }).then((history) => {
    // ... filter, sort ...

    const groups = {};                          // ← pure data transformation
    workSessions.forEach((entry) => {
      const key = dayKey(entry.startTime);
      if (!groups[key]) groups[key] = [];
      groups[key].push(entry);
    });

    Object.entries(groups).forEach(([label, entries]) => {   // ← rendering
      // ... 25 lines of DOM construction ...
    });
  });
}
```

`groupByDay` produces a `{ [label]: entries[] }` plain object. The rendering pass then iterates it with `Object.entries`. These are two distinct operations with different concerns: one is a pure function of data, the other is an imperative DOM construction pass.

## Proposed Solutions

**Option A — Extract groupByDay returning ordered array (Recommended)**

```js
function groupByDay(sessions) {
  const map = {};
  sessions.forEach((entry) => {
    const key = dayKey(entry.startTime);
    if (!map[key]) map[key] = [];
    map[key].push(entry);
  });
  return Object.entries(map).map(([label, entries]) => ({ label, entries }));
}

function loadHistory() {
  browser.runtime.sendMessage({ type: "GET_HISTORY" }).then((history) => {
    elHistoryList.replaceChildren();
    const workSessions = history
      .filter((e) => e.type === "work")
      .sort((a, b) => b.startTime - a.startTime);

    if (!workSessions.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No sessions yet";
      elHistoryList.appendChild(empty);
      return;
    }

    groupByDay(workSessions).forEach(({ label, entries }) => {
      // ... render group header and entries ...
    });
  });
}
```

Pros: `groupByDay` is a pure function — readable, testable in isolation; `loadHistory` reads at a uniform "fetch → group → render" level.
Cons: none.

**Option B — Leave as-is**

Pros: no change. Cons: grouping logic remains entangled with DOM construction; cannot be reused or tested independently.

## Technical Details

- **Affected file:** `popup/popup.js`, lines 160–196
- **New function:** `groupByDay(sessions)` — pure, returns `Array<{ label: string, entries: object[] }>`

## Acceptance Criteria

- [ ] `groupByDay` exists as a named function separate from `loadHistory`
- [ ] `groupByDay` accepts a sorted array of work sessions and returns `Array<{ label, entries }>`
- [ ] History display is identical to before
- [ ] `dayKey` function remains as a pure helper (unchanged)

## Work Log

- 2026-03-01: Identified by design-reviewer agent (Violation 9, P6 recommendation)
