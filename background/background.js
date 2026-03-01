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

// Each tab gets its own TimerInstance. tickInterval is the live setInterval handle.
function createTimerInstance(tabId) {
  return {
    tabId,
    mode: "idle",            // 'idle' | 'work' | 'break' | 'longBreak'
    startTimestamp: null,    // wall-clock anchor for current running period
    elapsedMs: 0,            // accumulated across auto-pauses
    sessionDuration: null,   // ms, computed from settings at session start
    autoPaused: false,
    sessionStart: null,      // immutable wall-clock of session start; used for history
    sessionDomain: null,     // hostname of this tab at session start
    tickInterval: null,      // handle from setInterval; excluded from persistence
  };
}

// Pool of all active timer instances, keyed by tab ID.
const timers = new Map();

// ─── Shared module-level state ────────────────────────────────────────────────

let settings = { ...DEFAULT_SETTINGS };

// Shared across all instances — completing any work session advances this counter.
let pomodoroCount = 0;

// Debounces rapid activation/focus events to avoid redundant tab queries.
let _activityCheckTimer = null;

// Gates message handling until init() completes.
let initialized = false;

// Serializes all appendToHistory calls across all instances to prevent concurrent
// read-modify-write races on the history array.
let _historyChain = Promise.resolve();

// Tracks last-emitted badge text to skip redundant setBadgeText calls.
let _lastBadgeText = null;

// Generation counter: invalidates stale tabs.query callbacks in checkBoundTabActivity.
let _activityCheckGen = 0;

// ─── Elapsed helpers ─────────────────────────────────────────────────────────

function currentElapsed(inst) {
  if (inst.mode === "idle") return 0;
  if (inst.autoPaused) return inst.elapsedMs;
  return Date.now() - inst.startTimestamp;
}

function progress(inst) {
  if (!inst.sessionDuration) return 0;
  return Math.min(1, currentElapsed(inst) / inst.sessionDuration);
}

function remaining(inst) {
  if (!inst.sessionDuration) return 0;
  return Math.max(0, inst.sessionDuration - currentElapsed(inst));
}

// ─── Tick ────────────────────────────────────────────────────────────────────

function startTick(inst) {
  if (inst.tickInterval) clearInterval(inst.tickInterval);
  inst.tickInterval = setInterval(() => tick(inst), 1000);
}

function stopTick(inst) {
  clearInterval(inst.tickInterval);
  inst.tickInterval = null;
}

function tick(inst) {
  if (inst.autoPaused || inst.mode === "idle") return;

  inst.elapsedMs = currentElapsed(inst);

  if (inst.elapsedMs >= inst.sessionDuration) {
    inst.elapsedMs = inst.sessionDuration;
    onSessionComplete(inst);
  } else {
    // Persist only on state transitions, not on every tick.
    broadcastState(inst);
    updateBadge(inst);
  }
}

// ─── Session lifecycle ────────────────────────────────────────────────────────

function durationFor(mode) {
  switch (mode) {
    case "work":      return settings.workDuration * 60000;
    case "break":     return settings.breakDuration * 60000;
    case "longBreak": return settings.longBreakDuration * 60000;
    default:          return 0;
  }
}

async function startSession(inst, mode) {
  inst.mode = mode;
  inst.sessionDuration = durationFor(mode);
  inst.elapsedMs = 0;
  const now = Date.now();
  inst.startTimestamp = now;
  inst.autoPaused = false;
  inst.sessionStart = now;

  try {
    const tab = await browser.tabs.get(inst.tabId);
    inst.sessionDomain = new URL(tab.url).hostname;
  } catch { inst.sessionDomain = null; }

  startTick(inst);
  // Badge color is set once per session start; only text changes on tick.
  browser.browserAction.setBadgeBackgroundColor({
    color: mode === "work" ? "#E05A4A" : "#52C78E",
  });
  broadcastState(inst);
  safePersist();
  updateBadge(inst);
}

function stopSession(inst) {
  if (inst.mode === "idle") return;
  finalizeWorkSession(inst, false);
  stopTick(inst);
}

async function onSessionComplete(inst) {
  stopTick(inst);

  if (inst.mode === "work") {
    finalizeWorkSession(inst, true);
  }

  const wasWork = inst.mode === "work";
  const pomosSnap = pomodoroCount; // snapshot before possible reset

  notify(wasWork, pomosSnap);

  if (wasWork) {
    const nextBreak = pomosSnap >= settings.longBreakInterval ? "longBreak" : "break";
    if (nextBreak === "longBreak") pomodoroCount = 0;
    await startSession(inst, nextBreak); // same tab gets the break
  } else {
    // Break finished — remove instance; tab returns to idle
    timers.delete(inst.tabId);
    broadcastIdleForTab(inst.tabId);
    safePersist();
    updateBadge(undefined);
  }
}

function skipBreak(inst) {
  if (inst.mode !== "break" && inst.mode !== "longBreak") return;
  stopTick(inst);
  timers.delete(inst.tabId);
  broadcastIdleForTab(inst.tabId);
  safePersist();
  updateBadge(undefined);
}

// ─── Tab binding ──────────────────────────────────────────────────────────────

// Agent-only: move an existing instance to a different tab ID (or create one).
function bindTab(newTabId, fromTabId) {
  const inst = timers.get(fromTabId);
  if (inst) {
    timers.delete(fromTabId);
    inst.tabId = newTabId;
    timers.set(newTabId, inst);
  } else {
    timers.set(newTabId, createTimerInstance(newTabId));
  }
  safePersist();
}

// lastFocusedWindow covers all windows in a single query, avoiding a nested tabs+windows call.
function checkBoundTabActivity() {
  if (timers.size === 0) return;
  const myGen = ++_activityCheckGen;

  browser.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => {
    if (myGen !== _activityCheckGen) return;
    const activeTabId = tabs.length > 0 ? tabs[0].id : null;

    for (const [tabId, inst] of timers) {
      if (inst.mode === "idle") continue;
      const isActive = tabId === activeTabId;

      if (isActive && inst.autoPaused) {
        // Resume: restart startTimestamp so elapsedMs is continuous
        inst.startTimestamp = Date.now() - inst.elapsedMs;
        inst.autoPaused = false;
        broadcastState(inst);
        safePersist();
      } else if (!isActive && !inst.autoPaused) {
        // Auto-pause: snapshot elapsed
        inst.elapsedMs = Date.now() - inst.startTimestamp;
        inst.autoPaused = true;
        broadcastState(inst);
        safePersist();
      }
    }
  });
}

function scheduleActivityCheck() {
  clearTimeout(_activityCheckTimer);
  _activityCheckTimer = setTimeout(checkBoundTabActivity, 50);
}

browser.tabs.onActivated.addListener(({ tabId }) => {
  updateBadge(timers.get(tabId)); // undefined → clear badge if no timer on new tab
  scheduleActivityCheck();
});

browser.windows.onFocusChanged.addListener(scheduleActivityCheck);

browser.tabs.onRemoved.addListener((tabId) => {
  const inst = timers.get(tabId);
  if (!inst) return;

  // Bound tab closed; treat as an abandoned session.
  finalizeWorkSession(inst, false);
  timers.delete(tabId);
  safePersist();
});

// ─── History ──────────────────────────────────────────────────────────────────

function finalizeWorkSession(inst, fullyCompleted) {
  if (inst.mode !== "work") return;
  const pct = fullyCompleted ? 100 : progress(inst) * 100;
  const counted = fullyCompleted || pct >= settings.completionThreshold;
  if (counted) pomodoroCount++;
  logSession(inst, counted, pct).catch((err) => {
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
async function logSession(inst, completed, pctComplete) {
  const snapshot = {
    mode:      inst.mode,
    domain:    inst.sessionDomain,
    startTime: inst.sessionStart,
    elapsed:   Math.round(currentElapsed(inst)),
  };
  if (snapshot.mode === "idle") return;

  const entry = {
    type:        snapshot.mode,
    domain:      snapshot.domain,
    startTime:   snapshot.startTime,
    endTime:     Date.now(),
    elapsed:     snapshot.elapsed,
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
    type:     "basic",
    iconUrl:  browser.runtime.getURL("icons/icon.svg"),
    title,
    message,
  });
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function updateBadge(inst) {
  if (!inst || inst.mode === "idle") {
    if (_lastBadgeText !== "") {
      browser.browserAction.setBadgeText({ text: "" });
      _lastBadgeText = "";
    }
    return;
  }

  const mins = Math.ceil(remaining(inst) / 60000);
  const label = inst.mode === "work" ? String(mins) : inst.mode === "longBreak" ? "LB" : "B";

  if (label !== _lastBadgeText) {
    browser.browserAction.setBadgeText({ text: label });
    _lastBadgeText = label;
  }
  // Color may differ across instances; update on every badge refresh.
  browser.browserAction.setBadgeBackgroundColor({
    color: inst.mode === "work" ? "#E05A4A" : "#52C78E",
  });
}

// ─── Broadcasting ─────────────────────────────────────────────────────────────

function publicState(inst) {
  return {
    mode:          inst.mode,
    progress:      progress(inst),
    remaining:     remaining(inst),
    autoPaused:    inst.autoPaused,
    pomodoroCount,
    settings:      { ...settings },
  };
}

// Idle state for tabs with no active instance.
function idlePublicState() {
  return {
    mode:          "idle",
    progress:      0,
    remaining:     settings.workDuration * 60000,
    autoPaused:    false,
    pomodoroCount,
    settings:      { ...settings },
  };
}

// Push UPDATE_BAR to the tab and STATE_UPDATE (tagged with tabId) to the popup.
// The popup only applies STATE_UPDATEs matching its own tabId.
function broadcastState(inst) {
  const ps = publicState(inst);

  browser.tabs.sendMessage(inst.tabId, {
    type:  "UPDATE_BAR",
    state: ps,
  }).catch(() => {});

  browser.runtime.sendMessage({
    type:  "STATE_UPDATE",
    tabId: inst.tabId,
    state: ps,
  }).catch(() => {});
}

// Broadcast an idle state to a tab whose instance was just removed.
function broadcastIdleForTab(tabId) {
  const ps = idlePublicState();

  browser.tabs.sendMessage(tabId, {
    type:  "UPDATE_BAR",
    state: ps,
  }).catch(() => {});

  browser.runtime.sendMessage({
    type:  "STATE_UPDATE",
    tabId,
    state: ps,
  }).catch(() => {});
}

// ─── Persistence ──────────────────────────────────────────────────────────────

// Serializes all active instances into storage. tickInterval is a live handle — excluded.
async function persistState() {
  const timerStates = {};
  for (const [tabId, inst] of timers) {
    const { tickInterval, ...snapshot } = inst; // eslint-disable-line no-unused-vars
    timerStates[String(tabId)] = snapshot;
  }
  await browser.storage.local.set({ timerStates, pomodoroCount });
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
  if (!Number.isFinite(s.sessionDuration) || s.sessionDuration <= 0) s.sessionDuration = null;
  if (!Number.isInteger(s.pomodoroCount) || s.pomodoroCount < 0) s.pomodoroCount = 0;
  return s;
}

// Populates `inst` from a stored snapshot. Returns true if session completed offline.
function deserializeInstance(snap, inst) {
  snap = validateStoredState(snap);
  Object.assign(inst, snap);
  inst.tickInterval = null; // never persisted

  if (!snap.autoPaused && snap.startTimestamp) {
    const elapsed = Date.now() - snap.startTimestamp;
    if (elapsed >= snap.sessionDuration) {
      inst.elapsedMs = snap.sessionDuration;
      inst.startTimestamp = Date.now() - snap.sessionDuration;
      return true; // completed offline → caller should call onSessionComplete
    }
    inst.elapsedMs = elapsed;
    inst.startTimestamp = Date.now() - inst.elapsedMs;
  }
  return false;
}

async function init() {
  const stored = await browser.storage.local.get(
    ["settings", "timerState", "timerStates", "pomodoroCount", "history"]
  );

  if (stored.settings) {
    settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored.settings });
  }

  // Prune history on startup — no need to filter on every write.
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const rawHistory = stored.history || [];
  const pruned = rawHistory.filter((e) => e.startTime > cutoff);
  if (pruned.length !== rawHistory.length) {
    browser.storage.local.set({ history: pruned });
  }

  // Schema migration: old single-timer key → extract pomodoroCount, discard timer.
  // Tab IDs do not survive browser restarts, so the old session cannot be safely restored.
  if (stored.timerState && !stored.timerStates) {
    pomodoroCount = Number.isInteger(stored.timerState.pomodoroCount)
      ? stored.timerState.pomodoroCount
      : 0;
    await browser.storage.local.remove("timerState");
    await browser.storage.local.set({ pomodoroCount });
  } else {
    pomodoroCount = Number.isInteger(stored.pomodoroCount) ? stored.pomodoroCount : 0;
  }

  initialized = true;

  // Restore multi-instance state.
  if (stored.timerStates) {
    const restorePromises = Object.entries(stored.timerStates).map(async ([tabIdStr, snap]) => {
      const tabId = parseInt(tabIdStr, 10);

      // Verify the tab still exists; discard silently if not.
      try { await browser.tabs.get(tabId); } catch { return; }

      const inst = createTimerInstance(tabId);
      const completed = deserializeInstance(snap, inst);
      timers.set(tabId, inst);

      if (completed) {
        await onSessionComplete(inst);
      } else if (inst.mode !== "idle") {
        startTick(inst);
        updateBadge(inst);
      }
    });

    await Promise.all(restorePromises);
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

// Returns the instance for a tab, creating one if it doesn't exist.
// Use only for mutating actions (START, BIND_TAB) — not for read-only GET_STATE.
function resolveInstance(tabId) {
  if (!timers.has(tabId)) {
    timers.set(tabId, createTimerInstance(tabId));
  }
  return timers.get(tabId);
}

browser.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id && sender.id !== browser.runtime.id) return false;

  // Reject non-essential messages before init completes.
  if (!initialized && msg.type !== "CONTENT_READY" && msg.type !== "GET_STATE") {
    reply({ error: "not ready" });
    return false;
  }

  switch (msg.type) {
    case "GET_STATE": {
      // Read-only: do NOT call resolveInstance here (avoids creating ghost instances).
      const inst = timers.get(msg.tabId);
      reply(inst ? publicState(inst) : idlePublicState());
      return false;
    }

    case "CONTENT_READY": {
      const inst = timers.get(sender.tab.id);
      reply({ tabId: sender.tab.id, state: inst ? publicState(inst) : idlePublicState() });
      return false;
    }

    case "START": {
      const tabId = msg.tabId ?? sender.tab?.id;
      if (!tabId) { reply({ error: "tabId required" }); return false; }
      const inst = resolveInstance(tabId);
      const mode = ["work", "break", "longBreak"].includes(msg.mode) ? msg.mode : "work";
      startSession(inst, mode); // async — reply is fire-and-forget; popup doesn't use reply body
      reply({ ok: true });
      return false;
    }

    case "STOP": {
      const tabId = msg.tabId ?? sender.tab?.id;
      const inst = tabId ? timers.get(tabId) : null;
      if (!inst || inst.mode === "idle") {
        reply({ ok: false, reason: "not running" }); return false;
      }
      stopSession(inst);
      timers.delete(tabId);
      broadcastIdleForTab(tabId);
      safePersist();
      reply({ ok: true });
      return false;
    }

    case "SKIP_BREAK": {
      const tabId = msg.tabId ?? sender.tab?.id;
      const inst = tabId ? timers.get(tabId) : null;
      if (!inst || (inst.mode !== "break" && inst.mode !== "longBreak")) {
        reply({ ok: false, reason: "not in break" }); return false;
      }
      skipBreak(inst);
      reply({ ok: true });
      return false;
    }

    // Agent-only: bind an instance to a specific tab, or move one between tabs.
    case "BIND_TAB": {
      const targetTabId = msg.tabId;
      if (!targetTabId) { reply({ error: "tabId required for BIND_TAB" }); return false; }
      bindTab(targetTabId, msg.fromTabId);
      reply({ ok: true });
      return false;
    }

    // Agent-only: gracefully stop the instance on a specific tab.
    case "UNBIND_TAB": {
      const tabId = msg.tabId ?? sender.tab?.id;
      const inst = tabId ? timers.get(tabId) : null;
      if (inst) {
        finalizeWorkSession(inst, false);
        stopTick(inst);
        timers.delete(tabId);
        broadcastIdleForTab(tabId);
        safePersist();
      }
      reply({ ok: true });
      return false;
    }

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
