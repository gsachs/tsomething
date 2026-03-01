# Pomo

A focused Pomodoro timer for Firefox. No accounts, no cloud, no distractions.

![Firefox](https://img.shields.io/badge/Firefox-Manifest%20V2-orange?logo=firefox-browser&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Features

- **Per-tab parallel timers** — run independent Pomodoro sessions on multiple tabs simultaneously; each tab gets its own timer, progress bar, and countdown; timers auto-pause when their tab is not focused
- **Injected progress bar** — a thin bar at the top of every page shows elapsed time; color-coded red for work, green for breaks; grows slightly in fullscreen
- **Favicon overlay** — a colored dot composited onto each active tab's favicon for at-a-glance status without opening anything
- **Classic Pomodoro cycle** — 25 min work → 5 min break → repeat × 4 → 15 min long break; all durations configurable
- **System notifications + toolbar badge** — alerts when a session ends even if the browser is in the background; badge shows remaining minutes
- **Activity history** — 7-day rolling log of work sessions grouped by date, domain, and completion status
- **Fully local** — everything lives in `browser.storage.local`; nothing leaves your machine

---

## Installation

### From source

1. Clone or download this repository
2. Open Firefox and go to `about:debugging`
3. Click **This Firefox** → **Load Temporary Add-on**
4. Select `manifest.json` from the project folder

The extension reloads automatically when you edit source files during development.

> **Note:** Temporary add-ons are removed when Firefox restarts. For a persistent install, the extension must be signed by Mozilla via [AMO](https://addons.mozilla.org/developers/).

---

## Usage

Click the toolbar icon to open the popup.

### Timer tab

| State | Available actions |
|---|---|
| Idle | Start |
| Work | Stop |
| Break / Long break | Skip break |

**Start** begins a 25-minute work session on the current tab. When it ends, a short break starts automatically on the same tab. After the break you click **Start** again for the next round. After 4 rounds a long break is offered.

**Stop** abandons the current session. If you were at least 80% through, it still counts toward your daily tally.

The popup always shows the timer for the tab you're currently on. To start a second parallel timer, switch to another tab and click **Start** there. Both timers run independently; switching tabs pauses the one you leave and resumes the one you return to.

Closing a tab ends its timer session.

### History tab

Shows completed and abandoned work sessions for the past 7 days, grouped by date. Each row shows the domain, elapsed time, and clock time. Green dot = completed, dim red dot = abandoned before the threshold.

### Settings tab

| Setting | Default | Range |
|---|---|---|
| Work duration | 25 min | 1–120 |
| Break duration | 5 min | 1–60 |
| Long break duration | 15 min | 1–120 |
| Long break after | 4 pomodoros | 1–10 |
| Count as done at | 80% | 1–100% |

---

## How it works

```
┌──────────────────────────────────────────────────────────────┐
│  background.js  (persistent background page)                 │
│  - Timer pool: Map<tabId, TimerInstance>                     │
│  - Each instance: own mode, elapsed, setInterval tick        │
│  - Shared: pomodoroCount, settings, history chain            │
│  - Tab focus tracking & per-instance auto-pause              │
│  - History logging (7-day rolling, domain-only)              │
│  - Pushes state to each tab's content script + popup         │
└──────┬────────────────────────────────────────┬──────────────┘
       │ UPDATE_BAR (to tab's content script)   │ STATE_UPDATE {tabId}
       ▼                                         ▼
┌──────────────────────┐  ┌────────────────────────────────────┐
│  content.js          │  │  popup.js                          │
│  - Injected bar      │  │  - Resolves active tabId on open   │
│  - Favicon overlay   │  │  - Renders only its tab's timer    │
│  - Fullscreen aware  │  │  - Filters STATE_UPDATE by tabId   │
│  - visibilitychange  │  │  - Timer / History / Settings tabs │
│    sync pull         │  └────────────────────────────────────┘
└──────────────────────┘
```

The background script maintains a pool of `TimerInstance` objects keyed by tab ID. Each instance runs its own 1 Hz `setInterval`. The popup resolves the currently-active tab's ID on open, sends it with every action message, and ignores `STATE_UPDATE` pushes for other tabs.

### Timer accuracy

State is anchored by a `startTimestamp` wall-clock value rather than a countdown. If the browser closes mid-session, elapsed time is recomputed on restart from `Date.now() - startTimestamp`. A session that completes while the browser is closed is processed on the next startup.

---

## Project structure

```
pomo/
├── manifest.json          Extension manifest (MV2)
├── icons/
│   └── icon.svg           Toolbar and notification icon
├── background/
│   └── background.js      Timer state machine, persistence, messaging
├── content/
│   ├── content.js         Progress bar, favicon overlay, visibility sync
│   └── content.css        Bar styles (fixed-position, z-index max)
└── popup/
    ├── popup.html          Three-tab popup layout
    ├── popup.js            State rendering, user action dispatch
    └── popup.css           Dark theme, 280 px
```

---

## Security

- Messages from other extensions are rejected (`sender.id` validation)
- All settings are sanitized and clamped on load and on save
- Only known setting keys are accepted from message payloads
- History stores domain names only — no full URLs, no tab titles
- No network requests; no external scripts; explicit Content Security Policy
- Canvas favicon compositing is CORS-safe with a dot-only fallback

---

## Browser compatibility

Firefox 60+ (Manifest V2, persistent background pages, `browser.*` APIs).

Not compatible with Chrome without modifications (Chrome requires MV3 and uses `chrome.*` APIs).

---

## License

MIT
