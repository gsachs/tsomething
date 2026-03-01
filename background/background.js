// Pomo background script — timer state machine, persistence, messaging.

const DEFAULT_SETTINGS = {
  workDuration: 25,
  breakDuration: 5,
  longBreakDuration: 15,
  longBreakInterval: 4,
  completionThreshold: 80,
};

// Change 2 (todo 002): sanitize and clamp all settings fields at boundaries.
function sanitizeSettings(raw) {
  return {
    workDuration:        Math.max(1, Math.min(120, parseInt(raw.workDuration)        || 25)),
    breakDuration:       Math.max(1, Math.min(60,  parseInt(raw.breakDuration)       || 5)),
    longBreakDuration:   Math.max(1, Math.min(120, parseInt(raw.longBreakDuration)   || 15)),
    longBreakInterval:   Math.max(1, Math.min(10,  parseInt(raw.longBreakInterval)   || 4)),
    completionThreshold: Math.max(1, Math.min(100, parseInt(raw.completionThreshold) || 80)),
  };
}

// Runtime state. startTimestamp is the wall-clock time the current running
// period began; elapsedMs accumulates time across auto-pauses.
const state = {
  mode: "idle", // 'idle' | 'work' | 'break' | 'longBreak'
  boundTabId: null,
  startTimestamp: null,
  elapsedMs: 0,
  sessionDuration: null,
  autoPaused: false,
  pomodoroCount: 0,
  sessionStart: null,
  sessionDomain: null,
};

let settings = { ...DEFAULT_SETTINGS };
let tickInterval = null;

// Change 6 (todo 006): timer handle for debouncing activity checks.
let _activityCheckTimer = null;

// Change 8 (todo 013): gate messages until init() completes.
let initialized = false;

// ─── Elapsed helpers ─────────────────────────────────────────────────────────

function currentElapsed() {
  if (state.mode === "idle") return 0;
  if (state.autoPaused) return state.elapsedMs;
  return Date.now() - state.startTimestamp;
}

function progress() {
  if (!state.sessionDuration) return 0;
  return Math.min(1, currentElapsed() / state.sessionDuration);
}

function remaining() {
  if (!state.sessionDuration) return 0;
  return Math.max(0, state.sessionDuration - currentElapsed());
}

// ─── Tick ────────────────────────────────────────────────────────────────────

function startTick() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(tick, 1000);
}

function stopTick() {
  clearInterval(tickInterval);
  tickInterval = null;
}

function tick() {
  if (state.autoPaused || state.mode === "idle") return;

  // Change 7 (todo 012): use currentElapsed() for consistency.
  state.elapsedMs = currentElapsed();

  if (state.elapsedMs >= state.sessionDuration) {
    state.elapsedMs = state.sessionDuration;
    onSessionComplete();
  } else {
    // Change 5 (todo 005): persistState removed from hot tick path.
    broadcastState();
    updateBadge();
  }
}

// ─── Session lifecycle ────────────────────────────────────────────────────────

function durationFor(mode) {
  switch (mode) {
    case "work": return settings.workDuration * 60000;
    case "break": return settings.breakDuration * 60000;
    case "longBreak": return settings.longBreakDuration * 60000;
    default: return 0;
  }
}

function startSession(mode) {
  state.mode = mode;
  state.sessionDuration = durationFor(mode);
  state.elapsedMs = 0;
  state.startTimestamp = Date.now();
  state.autoPaused = false;
  state.sessionStart = Date.now();

  if (state.boundTabId !== null) {
    browser.tabs.get(state.boundTabId).then((tab) => {
      try { state.sessionDomain = new URL(tab.url).hostname; }
      catch { state.sessionDomain = null; }
    }).catch(() => { state.sessionDomain = null; });
  } else {
    state.sessionDomain = null;
  }

  startTick();
  // Change 7 (todo 012): set badge color once at session start, not on every tick.
  browser.browserAction.setBadgeBackgroundColor({
    color: mode === "work" ? "#E05A4A" : "#52C78E",
  });
  broadcastState();
  persistState();
  updateBadge();
}

function stopSession() {
  if (state.mode === "idle") return;
  // Change 4 (todo 010): consolidated into recordWorkSession.
  recordWorkSession(false);
  resetToIdle();
}

function onSessionComplete() {
  stopTick();

  if (state.mode === "work") {
    // Change 4 (todo 010): replace inline logSession + pomodoroCount++ with recordWorkSession.
    recordWorkSession(true);
  }

  const wasWork = state.mode === "work";
  const pomosBeforeReset = state.pomodoroCount;

  // Change 4 (todo 010): dead block removed — mode is always "work" here,
  // so the longBreak branch could never execute.

  notify(wasWork, pomosBeforeReset);

  if (wasWork) {
    const nextBreak =
      pomosBeforeReset >= settings.longBreakInterval ? "longBreak" : "break";
    if (nextBreak === "longBreak") state.pomodoroCount = 0;
    startSession(nextBreak);
  } else {
    // Break finished — go idle, user manually starts next pomo
    resetToIdle();
  }
}

function skipBreak() {
  if (state.mode !== "break" && state.mode !== "longBreak") return;
  stopTick();
  resetToIdle();
}

function resetToIdle() {
  state.mode = "idle";
  state.startTimestamp = null;
  state.elapsedMs = 0;
  state.sessionDuration = null;
  state.autoPaused = false;
  stopTick();
  broadcastState();
  persistState();
  updateBadge();
}

// ─── Tab binding ──────────────────────────────────────────────────────────────

function bindToCurrentTab() {
  browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    if (!tabs.length) return;
    state.boundTabId = tabs[0].id;
    persistState();
    broadcastState();
  });
}

function unbindTab() {
  state.boundTabId = null;
  persistState();
  broadcastState();
}

// Change 6 (todo 006): single atomic query replaces the nested
// tabs.query + windows.getCurrent pair; lastFocusedWindow covers all windows.
function checkBoundTabActivity() {
  if (state.boundTabId === null || state.mode === "idle") return;

  browser.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => {
    const isActive = tabs.length > 0 && tabs[0].id === state.boundTabId;

    if (isActive && state.autoPaused) {
      // Resume: restart startTimestamp so elapsedMs is continuous
      state.startTimestamp = Date.now() - state.elapsedMs;
      state.autoPaused = false;
      broadcastState();
      persistState();
    } else if (!isActive && !state.autoPaused) {
      // Auto-pause: snapshot elapsed
      state.elapsedMs = Date.now() - state.startTimestamp;
      state.autoPaused = true;
      broadcastState();
      persistState();
    }
  });
}

// Change 6 (todo 006): debounce rapid activation/focus events into one check.
function scheduleActivityCheck() {
  clearTimeout(_activityCheckTimer);
  _activityCheckTimer = setTimeout(checkBoundTabActivity, 50);
}

browser.tabs.onActivated.addListener(scheduleActivityCheck);
browser.windows.onFocusChanged.addListener(scheduleActivityCheck);

browser.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== state.boundTabId) return;

  // Change 4 (todo 010): bound tab closed — use recordWorkSession instead of
  // inline logic; counts as abandoned if work session met threshold.
  recordWorkSession(false);

  state.boundTabId = null;
  resetToIdle();
});

// ─── History ──────────────────────────────────────────────────────────────────

// Change 4 (todo 010): maybeLogWork replaced by recordWorkSession, which also
// handles the pomodoroCount increment, eliminating duplicate increment paths.
function recordWorkSession(fullyCompleted) {
  if (state.mode !== "work") return;
  const pct = fullyCompleted ? 100 : progress() * 100;
  const counted = fullyCompleted || pct >= settings.completionThreshold;
  if (counted) state.pomodoroCount++;
  logSession(counted, pct);
}

// Change 3 (todo 003): snapshot mutable state synchronously before the first
// await so async storage reads see a consistent picture of the session.
async function logSession(completed, pctComplete) {
  const snapshot = {
    mode: state.mode,
    domain: state.sessionDomain,
    startTime: state.sessionStart,
    duration: state.sessionDuration,
    elapsed: Math.round(currentElapsed()),
  };
  if (snapshot.mode === "idle") return;

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    type: snapshot.mode,
    domain: snapshot.domain,
    startTime: snapshot.startTime,
    endTime: Date.now(),
    duration: snapshot.duration,
    elapsed: snapshot.elapsed,
    completed,
    pctComplete: Math.round(pctComplete),
  };

  const stored = await browser.storage.local.get("history");
  let history = stored.history || [];
  history.push(entry);

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  history = history.filter((e) => e.startTime > cutoff);

  await browser.storage.local.set({ history });
}

// ─── Notifications ────────────────────────────────────────────────────────────

function notify(wasWork, pomosCompleted) {
  const isLongBreak = pomosCompleted >= settings.longBreakInterval;
  const title = wasWork
    ? `Pomo ${pomosCompleted} done!`
    : "Break over";
  const message = wasWork
    ? isLongBreak
      ? "Time for a long break — you earned it."
      : "Short break starting."
    : "Click to start your next pomodoro.";

  browser.notifications.create({
    type: "basic",
    iconUrl: browser.runtime.getURL("icons/icon.svg"),
    title,
    message,
  });
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function updateBadge() {
  if (state.mode === "idle") {
    browser.browserAction.setBadgeText({ text: "" });
    return;
  }

  const mins = Math.ceil(remaining() / 60000);
  const label = state.mode === "work" ? String(mins) : state.mode === "longBreak" ? "LB" : "B";

  // Change 7 (todo 012): color is set once in startSession(); only text here.
  browser.browserAction.setBadgeText({ text: label });
}

// ─── Broadcasting ─────────────────────────────────────────────────────────────

function publicState() {
  return {
    mode: state.mode,
    progress: progress(),
    remaining: remaining(),
    // Change 5 (todo 005): sessionDuration removed from public surface.
    autoPaused: state.autoPaused,
    pomodoroCount: state.pomodoroCount,
    boundTabId: state.boundTabId,
    settings: { ...settings },
  };
}

// Change 5 (todo 005): send UPDATE_BAR only to bound tab; avoid broadcasting
// to every content script on every tick.
function broadcastState() {
  const ps = publicState();

  if (state.boundTabId !== null) {
    browser.tabs.sendMessage(state.boundTabId, {
      type: "UPDATE_BAR",
      ...ps,
      isBoundTab: true,
    }).catch(() => {});
  }

  browser.runtime.sendMessage({ type: "STATE_UPDATE", state: ps }).catch(() => {});
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function persistState() {
  await browser.storage.local.set({
    timerState: {
      mode: state.mode,
      boundTabId: state.boundTabId,
      startTimestamp: state.startTimestamp,
      elapsedMs: state.elapsedMs,
      sessionDuration: state.sessionDuration,
      autoPaused: state.autoPaused,
      pomodoroCount: state.pomodoroCount,
      sessionStart: state.sessionStart,
      sessionDomain: state.sessionDomain,
    },
  });
}

async function init() {
  const stored = await browser.storage.local.get(["settings", "timerState"]);

  if (stored.settings) {
    // Change 2 (todo 011): sanitizeSettings applied on load, not raw merge.
    settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored.settings });
  }

  if (stored.timerState && stored.timerState.mode !== "idle") {
    const s = stored.timerState;
    Object.assign(state, s);

    // If timer was running when browser closed, compute elapsed since then
    if (!s.autoPaused && s.startTimestamp) {
      const elapsed = Date.now() - s.startTimestamp;
      if (elapsed >= s.sessionDuration) {
        // Session completed while browser was closed — treat as complete
        state.elapsedMs = s.sessionDuration;
        onSessionComplete();
        return;
      }
      // Resume: update startTimestamp to now, accounting for accumulated elapsed
      state.elapsedMs = elapsed;
      state.startTimestamp = Date.now() - state.elapsedMs;
    }

    startTick();
    updateBadge();
  }

  // Change 8 (todo 013): signal that init is done; messages arriving before
  // this point (except CONTENT_READY / GET_STATE) are rejected.
  initialized = true;
}

// ─── Message handler ──────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((msg, sender, reply) => {
  // Change 1 (todo 001): reject messages from other extensions.
  if (sender.id && sender.id !== browser.runtime.id) return false;

  // Change 8 (todo 013): reject non-essential messages before init completes.
  if (!initialized && msg.type !== "CONTENT_READY" && msg.type !== "GET_STATE") {
    reply({ error: "not ready" });
    return false;
  }

  switch (msg.type) {
    case "GET_STATE":
      reply(publicState());
      return false;

    case "CONTENT_READY":
      reply({ tabId: sender.tab.id, state: publicState() });
      return false;

    case "START":
      startSession("work");
      reply({ ok: true });
      return false;

    case "STOP":
      stopSession();
      reply({ ok: true });
      return false;

    case "SKIP_BREAK":
      skipBreak();
      reply({ ok: true });
      return false;

    case "BIND_TAB":
      bindToCurrentTab();
      reply({ ok: true });
      return false;

    case "UNBIND_TAB":
      unbindTab();
      reply({ ok: true });
      return false;

    case "GET_HISTORY":
      browser.storage.local.get("history").then((s) => reply(s.history || []));
      return true; // async

    case "SAVE_SETTINGS": {
      // Change 2 (todo 011): destructure to accept only known fields, then sanitize.
      const { workDuration, breakDuration, longBreakDuration,
              longBreakInterval, completionThreshold } = msg.settings;
      settings = sanitizeSettings({ workDuration, breakDuration,
                                    longBreakDuration, longBreakInterval, completionThreshold });
      browser.storage.local.set({ settings });
      reply({ ok: true });
      return false;
    }

    case "CLEAR_HISTORY":
      browser.storage.local.set({ history: [] });
      reply({ ok: true });
      return false;

    default:
      // Change 8 (todo 013): surface unknown message types instead of silently ignoring.
      reply({ error: "unknown message type", type: msg.type });
      return false;
  }
});

init();
