---
status: pending
priority: p3
issue_id: "058"
tags: [code-quality, naming, comments, code-review]
dependencies: []
---

# 058 — Micro naming and clarity notes: `catch (_)`, `pendingMsg`, `msToMinSec` call-site comments

## Problem Statement

Three small naming/clarity issues identified by code-reviewer that don't warrant individual todos but should be addressed together in a single cleanup pass.

## Findings

### A. `catch (_)` — single-letter catch binding

**File:** `content/content.js`, inside `faviconOverlay.apply()`:

```js
} catch (_) {
  // Canvas tainted by cross-origin image — just show dot
  ctx.clearRect(0, 0, size, size);
  drawOverlay();
}
```

`_` is a single-letter variable name. The project standard flags single-letter names outside tiny loop scopes. The comment explains the intent, but the binding name should match: either use `catch { }` (no binding — available in modern JS / Firefox 69+) or name it `_crossOriginError` to signal intentional discard.

**Fix:** Replace `catch (_)` with `catch { }` (no binding). This is cleaner and explicitly signals the error is discarded.

---

### B. `pendingMsg` — name does not convey the race it solves

**File:** `content/content.js`, line 6:

```js
let pendingMsg = null;
```

Used to buffer a single `UPDATE_BAR` message that arrives before `myTabId` is set. The name `pendingMsg` could mean any pending message. A more precise name: `_pendingUpdateBeforeTabIdKnown` or, more concisely, `bufferedUpdate`.

**Fix:** Rename to `bufferedUpdate` and update the two read sites (line ~160, ~170).

---

### C. `msToMinSecCeil` / `msToMinSecRound` — call sites don't explain the rounding choice

**File:** `popup/popup.js`:

```js
function formatTime(ms) {
  const [m, s] = msToMinSecCeil(ms);   // ← why Ceil here?
  ...
}

function fmtDuration(ms) {
  const [m, s] = msToMinSecRound(ms);  // ← why Round here?
  ...
}
```

The rounding strategy differs for a non-obvious reason: `formatTime` uses Ceil so the countdown never shows `00:00` one second before the session actually ends; `fmtDuration` uses Round for historical accuracy. These reasons are invisible at the call site. A reader must infer why the two functions exist and which is correct to use in a new context.

**Fix:** Add a one-line comment at each call site:

```js
function formatTime(ms) {
  const [m, s] = msToMinSecCeil(ms);   // ceil: countdown never shows 00:00 prematurely
  ...
}

function fmtDuration(ms) {
  const [m, s] = msToMinSecRound(ms);  // round: accurate elapsed display in history
  ...
}
```

## Proposed Solutions

**Option A — Fix all three in one pass (Recommended)**

Address A, B, and C together. Small mechanical changes, no logic impact.

**Option B — Fix A and C only; leave B for a broader rename pass**

`pendingMsg` rename is slightly larger (two read sites). Defer if a bigger naming sweep is planned.

## Technical Details

- **A:** `content/content.js` — one `catch (_)` → `catch { }` inside `faviconOverlay.apply`
- **B:** `content/content.js` — `pendingMsg` → `bufferedUpdate` (declaration + 2 usage sites)
- **C:** `popup/popup.js` — 2 comment additions (one per formatting function call)

## Acceptance Criteria

- [ ] `catch (_)` replaced with `catch { }` in favicon overlay
- [ ] `pendingMsg` renamed to `bufferedUpdate` at declaration and both usage sites
- [ ] `msToMinSecCeil` and `msToMinSecRound` call sites each have a one-line comment explaining the rounding choice

## Work Log

- 2026-03-01: Identified by code-reviewer agent (Advisory Notes #6, #7, #8)
