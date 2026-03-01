---
review_agents:
  - security-sentinel
  - performance-oracle
  - architecture-strategist
  - julik-frontend-races-reviewer
  - code-simplicity-reviewer
---

This is a Firefox WebExtension (Manifest V2) implementing a Pomodoro timer.
Key files: background/background.js, content/content.js, popup/popup.js, popup/popup.html, manifest.json.
No Rails, no database, no migrations. Skip any Rails/DB-specific checks.
Focus on browser extension security model, IPC correctness, async race conditions, and JS code quality.
