---
status: pending
priority: p1
issue_id: "002"
tags: [security, code-review, background, settings]
dependencies: ["001"]
---

# 002 — Settings not bounds-checked before use

## Problem Statement

Settings are merged from storage and from `SAVE_SETTINGS` messages without any validation. An attacker (or corrupt storage) can inject `workDuration: -1` or `workDuration: Infinity`, causing `durationFor()` to return negative/infinite ms, `remaining()` / `progress()` to produce `NaN`, and `onSessionComplete` to enter an infinite work↔break loop that cannot be stopped without clearing extension storage.

## Findings

**File:** `background/background.js`, lines 343 and 412

```js
// On init:
settings = { ...DEFAULT_SETTINGS, ...stored.settings };

// On SAVE_SETTINGS:
settings = { ...DEFAULT_SETTINGS, ...msg.settings };
```

The popup does `parseInt()` before sending, but the background accepts the raw object as-is. Any path that can write to storage (including finding 001 — cross-extension `SAVE_SETTINGS`) can inject malformed values.

**Cascade effect:** `durationFor("work")` with `workDuration: 0` → session duration = 0 ms → `tick()` immediately fires `onSessionComplete()` → `startSession("break")` → break duration 0 ms → fires again → infinite loop at 1-second intervals, making the extension permanently broken.

## Proposed Solutions

**Option A — `sanitizeSettings` clamping function (Recommended)**
```js
function sanitizeSettings(raw) {
  return {
    workDuration:        Math.max(1, Math.min(120, parseInt(raw.workDuration)  || 25)),
    breakDuration:       Math.max(1, Math.min(60,  parseInt(raw.breakDuration) || 5)),
    longBreakDuration:   Math.max(1, Math.min(120, parseInt(raw.longBreakDuration) || 15)),
    longBreakInterval:   Math.max(1, Math.min(10,  parseInt(raw.longBreakInterval) || 4)),
    completionThreshold: Math.max(1, Math.min(100, parseInt(raw.completionThreshold) || 80)),
  };
}
```
Apply at both `init()` and `SAVE_SETTINGS`. Pros: Simple, total protection. Cons: None.

**Option B — Destructure known keys only in `SAVE_SETTINGS` + sanitize**
Additionally prevents unknown field injection (see finding 018):
```js
const { workDuration, breakDuration, longBreakDuration,
        longBreakInterval, completionThreshold } = msg.settings;
settings = sanitizeSettings({ workDuration, breakDuration,
                               longBreakDuration, longBreakInterval, completionThreshold });
```

## Technical Details

- **Affected files:** `background/background.js:343`, `background/background.js:412`
- **Related:** Finding 018 (arbitrary field injection via SAVE_SETTINGS)

## Acceptance Criteria

- [ ] `sanitizeSettings` applied on both storage load and `SAVE_SETTINGS` handler
- [ ] Values outside valid ranges are clamped, not rejected (avoids breaking edge cases)
- [ ] `workDuration: 0` results in `workDuration: 1`
- [ ] `workDuration: "attack"` falls back to default 25

## Work Log

- 2026-03-01: Identified by security-sentinel agent
