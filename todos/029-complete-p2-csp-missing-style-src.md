---
status: pending
priority: p2
issue_id: "029"
tags: [security, manifest, code-review]
dependencies: []
---

# 029 — CSP Missing style-src Directive

## Problem Statement
The CSP in manifest.json specifies `script-src 'self'; object-src 'self';` but omits `style-src`. Without an explicit `style-src`, a compromised popup HTML could load an external stylesheet enabling CSS-based data exfiltration attacks (CSS attribute selectors reading form field values via `:has`, `content:` property leaks). Security-sentinel identified this.

## Findings
`manifest.json` line 35: `"content_security_policy": "script-src 'self'; object-src 'self';"`

## Proposed Solutions
Option A — Add `style-src 'self';` to the CSP string: `"script-src 'self'; object-src 'self'; style-src 'self';"` (Recommended). Pros: closes CSS exfiltration vector; explicit over implicit.

Option B — Accept the default (implicit 'self' in Firefox MV2). Pros: no change. Cons: policy intent is ambiguous and browser-dependent.

## Technical Details
- **Affected file:** `manifest.json`

## Acceptance Criteria
- [ ] manifest.json CSP includes explicit `style-src 'self'`
- [ ] Extension loads and popup renders correctly

## Work Log
- 2026-03-01: Identified by security-sentinel
