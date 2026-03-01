---
status: pending
priority: p3
issue_id: "041"
tags: [security, manifest, code-review]
dependencies: []
---

# 041 — Redundant host permissions in manifest

## Problem Statement
`"http://*/*"` and `"https://*/*"` appear in both `content_scripts.matches` and `permissions[]`. The content_scripts block governs injection scope. The redundant entries in `permissions[]` additionally grant `tabs.executeScript`, `tabs.insertCSS`, and `tabs.captureVisibleTab` on any page — a broader capability than used, causing a wider install-time permissions prompt.

## Findings
[manifest.json:32-34] — `"http://*/*"` and `"https://*/*"` in `permissions` array.

## Proposed Solutions
**Option A — Remove host patterns from permissions[] (Recommended)**
Remove `"http://*/*"` and `"https://*/*"` from `permissions[]`. The content script injection is governed by `content_scripts.matches` alone in Firefox MV2.

**Option B — Leave as-is (no active exploitation). Cons: wider permissions prompt.**

## Technical Details
- **Affected file:** `manifest.json` lines 32-34

## Acceptance Criteria
- [ ] `permissions[]` does not contain `http://*/*` or `https://*/*`
- [ ] content script still injects correctly

## Work Log
- 2026-03-01: Identified by code-review agent
