// Pomo background script — timer state machine, persistence, messaging.

const DEFAULT_SETTINGS = {
  workDuration: 25,
  breakDuration: 5,
  longBreakDuration: 15,
  longBreakInterval: 4,
  completionThreshold: 80,
};

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

  state.elapsedMs = Date.now() - state.startTimestamp;

  if (state.elapsedMs >= state.sessionDuration) {
    state.elapsedMs = state.sessionDuration;
    onSessionComplete();
  } else {
    broadcastState();
    persistState();
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
  broadcastState();
  persistState();
  updateBadge();
}

function stopSession() {
  if (state.mode === "idle") return;
  maybeLogWork(false);
  resetToIdle();
}

function onSessionComplete() {
  stopTick();

  if (state.mode === "work") {
    logSession(true, 100);
    state.pomodoroCount++;
  }

  const wasWork = state.mode === "work";
  const pomosBeforeReset = state.pomodoroCount;

  // After long break, reset cycle counter
  if (state.mode === "longBreak") {
    state.pomodoroCount = 0;
  }

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

// Auto-pause: fires when tab activation or window focus changes.
function checkBoundTabActivity() {
  if (state.boundTabId === null || state.mode === "idle") return;

  browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    browser.windows.getCurrent().then((win) => {
      const activeTabId = tabs.length ? tabs[0].id : null;
      const isActive = win.focused && activeTabId === state.boundTabId;

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
  });
}

browser.tabs.onActivated.addListener(checkBoundTabActivity);
browser.windows.onFocusChanged.addListener(checkBoundTabActivity);

browser.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== state.boundTabId) return;

  // Bound tab closed — count as abandoned work session if ≥ threshold
  maybeLogWork(false);

  state.boundTabId = null;
  resetToIdle();
});

// ─── History ──────────────────────────────────────────────────────────────────

function maybeLogWork(completed) {
  if (state.mode !== "work") return;
  const pct = progress() * 100;
  const counted = pct >= settings.completionThreshold;
  logSession(counted, pct);
  if (counted) state.pomodoroCount++;
}

async function logSession(completed, pctComplete) {
  if (state.mode === "idle") return;

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    type: state.mode,
    domain: state.sessionDomain,
    startTime: state.sessionStart,
    endTime: Date.now(),
    duration: state.sessionDuration,
    elapsed: Math.round(currentElapsed()),
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

  browser.browserAction.setBadgeText({ text: label });
  browser.browserAction.setBadgeBackgroundColor({
    color: state.mode === "work" ? "#E05A4A" : "#52C78E",
  });
}

// ─── Broadcasting ─────────────────────────────────────────────────────────────

function publicState() {
  return {
    mode: state.mode,
    progress: progress(),
    remaining: remaining(),
    sessionDuration: state.sessionDuration,
    autoPaused: state.autoPaused,
    pomodoroCount: state.pomodoroCount,
    boundTabId: state.boundTabId,
    settings: { ...settings },
  };
}

function broadcastState() {
  const ps = publicState();

  // Push to all content scripts
  browser.tabs.query({}).then((tabs) => {
    tabs.forEach((tab) => {
      browser.tabs.sendMessage(tab.id, {
        type: "UPDATE_BAR",
        ...ps,
        isBoundTab: tab.id === state.boundTabId,
      }).catch(() => {});
    });
  });

  // Push to popup if open
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
    settings = { ...DEFAULT_SETTINGS, ...stored.settings };
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
}

// ─── Message handler ──────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((msg, sender, reply) => {
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

    case "SAVE_SETTINGS":
      settings = { ...DEFAULT_SETTINGS, ...msg.settings };
      browser.storage.local.set({ settings });
      reply({ ok: true });
      return false;

    case "CLEAR_HISTORY":
      browser.storage.local.set({ history: [] });
      reply({ ok: true });
      return false;
  }
});

init();
