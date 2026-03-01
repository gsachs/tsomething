// Pomo background script — timer state machine, persistence, messaging.
//
// ARCHITECTURE NOTE: This script requires "persistent": true in manifest.json.
// The timer uses a live setInterval handle (tickInterval). If the background page
// is suspended (persistent: false / MV3 service worker), the handle and all
// in-memory state are destroyed mid-session. Do not remove persistent: true
// without replacing setInterval with a browser.alarms-based approach.

const DEFAULT_SETTINGS = {
  workDuration: 25,
  breakDuration: 5,
  longBreakDuration: 15,
  longBreakInterval: 4,
  completionThreshold: 80,
};

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

// Debounces rapid activation/focus events to avoid redundant tab queries.
let _activityCheckTimer = null;

// Gates message handling until init() completes.
let initialized = false;

let _historyChain = Promise.resolve();

let _lastBadgeText = null;

let _activityCheckGen = 0;

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

  state.elapsedMs = currentElapsed();

  if (state.elapsedMs >= state.sessionDuration) {
    state.elapsedMs = state.sessionDuration;
    onSessionComplete();
  } else {
    // Persist only on state transitions, not on every tick.
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

async function startSession(mode) {
  state.mode = mode;
  state.sessionDuration = durationFor(mode);
  state.elapsedMs = 0;
  const now = Date.now();
  state.startTimestamp = now;
  state.autoPaused = false;
  state.sessionStart = now;

  if (state.boundTabId !== null) {
    try {
      const tab = await browser.tabs.get(state.boundTabId);
      state.sessionDomain = new URL(tab.url).hostname;
    } catch { state.sessionDomain = null; }
  } else {
    state.sessionDomain = null;
  }

  startTick();
  // Badge color is set once per session start; only text changes on tick.
  browser.browserAction.setBadgeBackgroundColor({
    color: mode === "work" ? "#E05A4A" : "#52C78E",
  });
  broadcastState();
  safePersist();
  updateBadge();
}

function stopSession() {
  if (state.mode === "idle") return;
  finalizeWorkSession(false);
  resetToIdle();
}

function onSessionComplete() {
  stopTick();

  if (state.mode === "work") {
    finalizeWorkSession(true);
  }

  const wasWork = state.mode === "work";
  const pomosBeforeReset = state.pomodoroCount;

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
  safePersist();
  updateBadge();
}

// ─── Tab binding ──────────────────────────────────────────────────────────────

function bindToCurrentTab() {
  browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    if (!tabs.length) return;
    state.boundTabId = tabs[0].id;
    safePersist();
    broadcastState();
  });
}

function unbindTab() {
  state.boundTabId = null;
  safePersist();
  broadcastState();
}

// lastFocusedWindow covers all windows in a single query, avoiding a nested tabs+windows call.
function checkBoundTabActivity() {
  if (state.boundTabId === null || state.mode === "idle") return;
  const myGen = ++_activityCheckGen;

  browser.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => {
    if (myGen !== _activityCheckGen) return;
    const isActive = tabs.length > 0 && tabs[0].id === state.boundTabId;

    if (isActive && state.autoPaused) {
      // Resume: restart startTimestamp so elapsedMs is continuous
      state.startTimestamp = Date.now() - state.elapsedMs;
      state.autoPaused = false;
      broadcastState();
      safePersist();
    } else if (!isActive && !state.autoPaused) {
      // Auto-pause: snapshot elapsed
      state.elapsedMs = Date.now() - state.startTimestamp;
      state.autoPaused = true;
      broadcastState();
      safePersist();
    }
  });
}

function scheduleActivityCheck() {
  clearTimeout(_activityCheckTimer);
  _activityCheckTimer = setTimeout(checkBoundTabActivity, 50);
}

browser.tabs.onActivated.addListener(scheduleActivityCheck);
browser.windows.onFocusChanged.addListener(scheduleActivityCheck);

browser.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== state.boundTabId) return;

  // Bound tab closed; treat as an abandoned session.
  finalizeWorkSession(false);

  state.boundTabId = null;
  resetToIdle();
});

// ─── History ──────────────────────────────────────────────────────────────────

function finalizeWorkSession(fullyCompleted) {
  if (state.mode !== "work") return;
  const pct = fullyCompleted ? 100 : progress() * 100;
  const counted = fullyCompleted || pct >= settings.completionThreshold;
  if (counted) state.pomodoroCount++;
  logSession(counted, pct).catch((err) => {
    console.error("[pomo] logSession failed:", err);
  });
}

function appendToHistory(entry) {
  _historyChain = _historyChain.then(async () => {
    const stored = await browser.storage.local.get("history");
    let history = stored.history || [];
    history.push(entry);
    await browser.storage.local.set({ history });
  });
  return _historyChain;
}

// Snapshot mutable state synchronously before any await so storage reads see a consistent session picture.
async function logSession(completed, pctComplete) {
  const snapshot = {
    mode: state.mode,
    domain: state.sessionDomain,
    startTime: state.sessionStart,
    elapsed: Math.round(currentElapsed()),
  };
  if (snapshot.mode === "idle") return;

  const entry = {
    type: snapshot.mode,
    domain: snapshot.domain,
    startTime: snapshot.startTime,
    endTime: Date.now(),
    elapsed: snapshot.elapsed,
    completed,
    pctComplete: Math.round(pctComplete),
  };

  await appendToHistory(entry);
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
    if (_lastBadgeText !== "") {
      browser.browserAction.setBadgeText({ text: "" });
      _lastBadgeText = "";
    }
    return;
  }

  const mins = Math.ceil(remaining() / 60000);
  const label = state.mode === "work" ? String(mins) : state.mode === "longBreak" ? "LB" : "B";

  // Badge color is set once per session in startSession(); only text changes here.
  if (label !== _lastBadgeText) {
    browser.browserAction.setBadgeText({ text: label });
    _lastBadgeText = label;
  }
}

// ─── Broadcasting ─────────────────────────────────────────────────────────────

function publicState() {
  return {
    mode: state.mode,
    progress: progress(),
    remaining: remaining(),
    autoPaused: state.autoPaused,
    pomodoroCount: state.pomodoroCount,
    boundTabId: state.boundTabId,
    settings: { ...settings },
  };
}

// Send UPDATE_BAR only to the bound tab to avoid flooding unrelated content scripts.
function broadcastState() {
  const ps = publicState();

  if (state.boundTabId !== null) {
    browser.tabs.sendMessage(state.boundTabId, {
      type: "UPDATE_BAR",
      state: ps,
      isBoundTab: true,
    }).catch(() => {});
  }

  browser.runtime.sendMessage({ type: "STATE_UPDATE", state: ps }).catch(() => {});
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function persistState() {
  await browser.storage.local.set({ timerState: { ...state } });
}

function safePersist() {
  persistState().catch((err) => {
    console.error("[pomo] persistState failed:", err);
  });
}

function validateStoredState(s) {
  const VALID_MODES = ["idle", "work", "break", "longBreak"];
  if (!VALID_MODES.includes(s.mode)) s.mode = "idle";
  if (!Number.isFinite(s.elapsedMs) || s.elapsedMs < 0) s.elapsedMs = 0;
  if (s.boundTabId !== null && !Number.isInteger(s.boundTabId)) s.boundTabId = null;
  if (!Number.isFinite(s.sessionDuration) || s.sessionDuration <= 0) s.sessionDuration = null;
  if (!Number.isInteger(s.pomodoroCount) || s.pomodoroCount < 0) s.pomodoroCount = 0;
  return s;
}

function deserializeState(s) {
  s = validateStoredState(s);
  Object.assign(state, s);
  if (!s.autoPaused && s.startTimestamp) {
    const elapsed = Date.now() - s.startTimestamp;
    if (elapsed >= s.sessionDuration) {
      state.elapsedMs = s.sessionDuration;
      state.startTimestamp = Date.now() - s.sessionDuration;
      return true;
    }
    state.elapsedMs = elapsed;
    state.startTimestamp = Date.now() - state.elapsedMs;
  }
  return false;
}

async function init() {
  const stored = await browser.storage.local.get(["settings", "timerState", "history"]);

  if (stored.settings) {
    settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored.settings });
  }

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  history = (stored.history || []).filter((e) => e.startTime > cutoff);

  initialized = true;

  if (stored.timerState && stored.timerState.mode !== "idle") {
    const result = deserializeState(stored.timerState);
    if (result) { onSessionComplete(); return; }
    startTick();
    updateBadge();
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id && sender.id !== browser.runtime.id) return false;

  // Reject non-essential messages before init completes.
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

    case "START": {
      const mode = ["work", "break", "longBreak"].includes(msg.mode) ? msg.mode : "work";
      startSession(mode);
      reply({ ok: true });
      return false;
    }

    case "STOP":
      if (state.mode === "idle") { reply({ ok: false, reason: "not running" }); return false; }
      stopSession();
      reply({ ok: true });
      return false;

    case "SKIP_BREAK":
      if (state.mode !== "break" && state.mode !== "longBreak") {
        reply({ ok: false, reason: "not in break" });
        return false;
      }
      skipBreak();
      reply({ ok: true });
      return false;

    case "BIND_TAB":
      if (msg.tabId) {
        state.boundTabId = msg.tabId;
        safePersist();
        broadcastState();
        reply({ ok: true });
      } else {
        bindToCurrentTab();
        reply({ ok: true });
      }
      return false;

    case "UNBIND_TAB":
      unbindTab();
      reply({ ok: true });
      return false;

    case "GET_HISTORY":
      browser.storage.local.get("history").then((s) => {
        const history = (s.history || []).filter((e) => e.type === "work");
        reply(history);
      });
      return true;

    case "SAVE_SETTINGS": {
      // Accept only known fields before sanitizing to prevent prototype pollution.
      const { workDuration, breakDuration, longBreakDuration,
              longBreakInterval, completionThreshold } = msg.settings;
      settings = sanitizeSettings({ workDuration, breakDuration,
                                    longBreakDuration, longBreakInterval, completionThreshold });
      browser.storage.local.set({ settings });
      reply({ ok: true, settings: { ...settings } });
      return false;
    }

    case "CLEAR_HISTORY":
      browser.storage.local.set({ history: [] });
      reply({ ok: true });
      return false;

    default:
      // Surface unknown message types rather than silently ignoring them.
      reply({ error: "unknown message type", type: msg.type });
      return false;
  }
});

init();
