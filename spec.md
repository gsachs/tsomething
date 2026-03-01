# Pomo — Firefox Extension Spec

A focused Pomodoro timer for Firefox. Minimal surface, no accounts, no cloud.

---

## Timer

**Durations (all configurable)**
- Work session: 25 min default
- Short break: 5 min default
- Long break: 15 min default
- Long break triggers after every 4 completed pomodoros (configurable)

**Session flow**
- Break starts automatically when a work session ends
- The next work session requires a manual click — no auto-start
- Break can be skipped at any time via a skip button; skipped breaks are not logged
- No pause: stopping a session mid-way abandons it
- A session counts as completed (toward the pomodoro counter) if ≥ 80% of its duration elapsed (configurable threshold)
- Abandoned sessions that meet the threshold still increment the counter and are logged as completed

**Session counter**
- 4-pomodoro cycle; long break resets the count
- The cycle counter persists across sessions within the same browser instance

**Persistence across browser restarts**
- If the browser closes mid-session, elapsed wall-clock time is calculated on restart and the session resumes from where it left off
- If the session would have completed while the browser was closed, completion is processed on startup

---

## Tab binding

**Default mode:** timer runs globally, not tied to any tab or window.

**Binding**
- User clicks "Bind to current tab" in the popup
- Only one tab can be bound at a time
- While bound, the timer ticks only when both conditions hold:
  1. The bound tab is the active (selected) tab
  2. The browser window has OS-level focus
- If either condition fails, the timer auto-pauses silently (no user action needed)

**Internal Firefox pages** (`about:newtab`, `about:blank`, browser settings)
- Content scripts cannot inject into these pages
- Treated as inactive: timer auto-pauses while on an internal page in bound mode

**Bound tab closed**
- Session is abandoned immediately
- Binding dissolves; timer returns to idle
- If ≥ 80% was elapsed, the session counts toward the cycle

**Bound tab indicator**
- A small colored dot is composited onto the tab's favicon via canvas
- Color matches session type (red = work, green = break)
- Restored to original favicon on unbind or session end

---

## Progress bar

- A thin bar (4 px) injected at the top of every `http://` and `https://` page via content script
- Position: `fixed`, `top: 0`, full width, `z-index: 2147483647`
- Not interactive — purely visual
- Color-coded by session type:
  - Work → red (`#E05A4A`)
  - Break / long break → green (`#52C78E`)
- Auto-paused sessions show the bar at a reduced opacity
- Idle: bar is hidden (0% width)

**Fullscreen**
- When a page element goes fullscreen (F11 or browser API), the bar is moved inside `document.fullscreenElement` so it remains visible
- Bar height increases to 6 px in fullscreen (slightly more prominent, since the toolbar icon is hidden)
- Restores to 4 px and returns to `<body>` when fullscreen exits

---

## Notifications

Three channels fire simultaneously when a session ends:
1. **Browser system notification** — title + message, appears even if browser is in the background
2. **Visual flash / color change** — the progress bar flashes at completion
3. **Badge on the toolbar icon** — shows remaining minutes during work (`"14"`), `"B"` during break, `"LB"` during long break; clears on idle

No audio.

---

## Activity log (History)

**What is recorded**
- Only work sessions are shown in history (breaks are not listed)
- Per entry: domain (e.g. `github.com`), start time, elapsed duration, completed/abandoned status
- No full URLs, no tab titles — domain only

**Retention**
- 7-day rolling window; entries older than 7 days are pruned automatically on each write

**Grouped display**
- Entries shown grouped by date: Today, Yesterday, then named weekday + date

**Storage**
- `browser.storage.local` — local to each Firefox profile, no Firefox Sync

---

## Popup

Three tabs: **Timer · History · Settings**

### Timer tab
- Session type label (WORK / BREAK / LONG BREAK / IDLE)
- Four dots showing progress through the current 4-pomo cycle (filled = completed)
- Large countdown display (MM:SS)
- Thin progress bar
- "Paused (tab inactive)" notice when auto-paused
- **Idle:** Start button
- **Work:** Stop button (abandons session)
- **Break / Long break:** Skip break button
- Bind to tab / Unbind tab toggle with bound status label

### History tab
- Scrollable list grouped by date
- Each entry: status dot (green = done, dim red = abandoned), domain, elapsed time, start time
- Clear all button

### Settings tab
- Work duration (min)
- Break duration (min)
- Long break duration (min)
- Long break after N pomodoros
- Completion threshold (%)
- Save button with a brief confirmation notice

---

## Technical

| Aspect | Decision |
|---|---|
| Platform | Firefox extension, Manifest V2 |
| Background | Persistent background page (`"persistent": true`) |
| Timer accuracy | `setInterval` (1 s tick) + timestamp-based elapsed to survive tab switches and restarts |
| Content script injection | `http://*/*`, `https://*/*`, top frame only, `document_end` |
| Bar updates | Content script polls background every 1 s when tab is visible (`document.hidden` check); background also pushes on state changes |
| Favicon overlay | Canvas compositing; CORS-safe (falls back to dot-only if origin blocks cross-origin image load) |
| Storage | `browser.storage.local` for settings, timer state, and history |
| Sync | None — local machine only |
