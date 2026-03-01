// Pomo popup script — renders state, dispatches user actions.

// ─── Tab switching ────────────────────────────────────────────────────────────

document.querySelector(".tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  if (btn.dataset.tab === "history") loadHistory();
});

// ─── Timer tab ────────────────────────────────────────────────────────────────

const elLabel     = document.getElementById("session-label");
const elCountdown = document.getElementById("countdown");
const elFill      = document.getElementById("progress-fill");
const elPause     = document.getElementById("pause-label");
const elStart     = document.getElementById("btn-start");
const elStop      = document.getElementById("btn-stop");
const elSkip      = document.getElementById("btn-skip");
const elBind      = document.getElementById("btn-bind");
const elBindStatus = document.getElementById("bind-status");

function msToMinSecCeil(ms) {
  const s = Math.ceil(ms / 1000);
  return [Math.floor(s / 60), s % 60];
}

function msToMinSecRound(ms) {
  const s = Math.round(ms / 1000);
  return [Math.floor(s / 60), s % 60];
}

function formatTime(ms) {
  const [m, s] = msToMinSecCeil(ms);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const MODE_LABEL = {
  idle:      "IDLE",
  work:      "WORK",
  break:     "BREAK",
  longBreak: "LONG BREAK",
};

function updateButtonVisibility(mode) {
  if (mode === "idle") {
    elStart.classList.remove("hidden");
    elStop.classList.add("hidden");
    elSkip.classList.add("hidden");
    elStart.textContent = "Start";
    elStart.classList.remove("break-mode");
  } else if (mode === "work") {
    elStart.classList.add("hidden");
    elStop.classList.remove("hidden");
    elSkip.classList.add("hidden");
  } else {
    // break or longBreak
    elStart.classList.add("hidden");
    elStop.classList.add("hidden");
    elSkip.classList.remove("hidden");
  }
}

function renderTimerState(state) {
  const { mode, progress, remaining, autoPaused, pomodoroCount, boundTabId, settings } = state;

  // Session label
  elLabel.textContent = MODE_LABEL[mode] || "IDLE";
  elLabel.className = `session-label ${mode}`;

  // Countdown
  const displayMs = mode === "idle"
    ? (settings?.workDuration ?? 25) * 60000
    : remaining;
  elCountdown.textContent = formatTime(displayMs);
  elCountdown.className = `countdown ${mode}`;

  // Progress fill
  const pct = mode === "idle" ? 0 : progress * 100;
  elFill.style.width = `${pct}%`;
  elFill.className = `progress-fill ${mode}`;

  // Filled dots = completed pomos in the current cycle
  const interval = settings?.longBreakInterval ?? 4;
  const dotsContainer = document.querySelector(".dots");
  if (dotsContainer.children.length !== interval) {
    dotsContainer.replaceChildren(
      ...Array.from({ length: interval }, () => {
        const s = document.createElement("span");
        s.className = "dot";
        return s;
      })
    );
  }
  dotsContainer.querySelectorAll(".dot").forEach((dot, i) => {
    dot.classList.toggle("filled", i < pomodoroCount % interval);
  });

  // Pause notice
  elPause.classList.toggle("hidden", !autoPaused);

  // Buttons
  updateButtonVisibility(mode);

  // Bind button
  const bound = boundTabId !== null;
  const sessionActive = mode !== "idle";
  elBind.textContent = bound ? "Unbind tab" : "Bind to tab";
  elBind.classList.toggle("bound", bound);
  elBind.disabled = sessionActive;
  elBind.style.opacity = sessionActive ? "0.4" : "";
  elBind.style.cursor = sessionActive ? "default" : "";
  elBindStatus.textContent = bound ? "tab-bound timer" : "";
}

elStart.addEventListener("click", () => {
  browser.runtime.sendMessage({ type: "START" });
});

elStop.addEventListener("click", () => {
  browser.runtime.sendMessage({ type: "STOP" });
});

elSkip.addEventListener("click", () => {
  browser.runtime.sendMessage({ type: "SKIP_BREAK" });
});

elBind.addEventListener("click", () => {
  const type = elBind.classList.contains("bound") ? "UNBIND_TAB" : "BIND_TAB";
  browser.runtime.sendMessage({ type });
});

// ─── History tab ──────────────────────────────────────────────────────────────

const elHistoryList = document.getElementById("history-list");

function fmtDuration(ms) {
  const [m, s] = msToMinSecRound(ms);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayKey(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function groupByDay(sessions) {
  const map = {};
  sessions.forEach((entry) => {
    const key = dayKey(entry.startTime);
    if (!map[key]) map[key] = [];
    map[key].push(entry);
  });
  return Object.entries(map).map(([label, entries]) => ({ label, entries }));
}

function loadHistory() {
  browser.runtime.sendMessage({ type: "GET_HISTORY" }).then((history) => {
    elHistoryList.replaceChildren();

    // Only show work sessions
    const workSessions = history
      .filter((e) => e.type === "work")
      .sort((a, b) => b.startTime - a.startTime);

    if (!workSessions.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No sessions yet";
      elHistoryList.appendChild(empty);
      return;
    }

    groupByDay(workSessions).forEach(({ label, entries }) => {
      const groupEl = document.createElement("div");
      groupEl.className = "history-group-label";
      groupEl.textContent = label;
      elHistoryList.appendChild(groupEl);

      entries.forEach((e) => {
        const row = document.createElement("div");
        row.className = "history-entry";

        const dot = document.createElement("span");
        dot.className = `entry-dot ${e.completed ? "done" : "missed"}`;

        const domain = document.createElement("span");
        domain.className = "entry-domain";
        domain.textContent = e.domain || "unbound";
        domain.title = e.domain || "";

        const dur = document.createElement("span");
        dur.className = "entry-duration";
        dur.textContent = fmtDuration(e.elapsed);

        const time = document.createElement("span");
        time.className = "entry-time";
        time.textContent = fmtTime(e.startTime);

        row.append(dot, domain, dur, time);
        elHistoryList.appendChild(row);
      });
    });
  });
}

document.getElementById("btn-clear").addEventListener("click", () => {
  browser.runtime.sendMessage({ type: "CLEAR_HISTORY" }).then(loadHistory);
});

// ─── Settings tab ─────────────────────────────────────────────────────────────

const elSaveNotice = document.getElementById("save-notice");

function loadSettings(settings) {
  document.getElementById("s-work").value = settings.workDuration;
  document.getElementById("s-break").value = settings.breakDuration;
  document.getElementById("s-long").value = settings.longBreakDuration;
  document.getElementById("s-interval").value = settings.longBreakInterval;
  document.getElementById("s-threshold").value = settings.completionThreshold;
}

document.getElementById("settings-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const s = {
    workDuration:        parseInt(document.getElementById("s-work").value, 10),
    breakDuration:       parseInt(document.getElementById("s-break").value, 10),
    longBreakDuration:   parseInt(document.getElementById("s-long").value, 10),
    longBreakInterval:   parseInt(document.getElementById("s-interval").value, 10),
    completionThreshold: parseInt(document.getElementById("s-threshold").value, 10),
  };
  browser.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: s }).then(() => {
    elSaveNotice.classList.remove("hidden");
    setTimeout(() => elSaveNotice.classList.add("hidden"), 2000);
  });
});

// ─── State sync ───────────────────────────────────────────────────────────────

let popupReady = false;

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "STATE_UPDATE" && popupReady) {
    renderTimerState(msg.state);
    loadSettings(msg.state.settings);
  }
});

// Fetch initial state on popup open
browser.runtime.sendMessage({ type: "GET_STATE" }).then((state) => {
  popupReady = true;
  renderTimerState(state);
  loadSettings(state.settings);
});
