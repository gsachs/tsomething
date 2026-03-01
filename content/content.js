// Pomo content script — injects progress bar and manages favicon overlay.

let myTabId = null;
let isBound = false;
let originalFaviconHref = null;
let faviconLinkEl = null;
let lastMode = null;
let lastIsBound = false;

// ─── Bar ─────────────────────────────────────────────────────────────────────

function createBar() {
  const root = document.createElement("div");
  root.id = "pomo-bar-root";
  root.setAttribute("data-mode", "idle");

  const fill = document.createElement("div");
  fill.id = "pomo-bar-fill";
  root.appendChild(fill);

  document.body.prepend(root);
  return root;
}

const bar = createBar();

function updateBar(state) {
  const mode = state.autoPaused ? "paused" : state.mode;
  bar.setAttribute("data-mode", mode);
  bar.querySelector("#pomo-bar-fill").style.width =
    state.mode === "idle" ? "0%" : `${state.progress * 100}%`;
}

// ─── Fullscreen ───────────────────────────────────────────────────────────────

document.addEventListener("fullscreenchange", () => {
  const fs = document.fullscreenElement;
  if (fs) {
    fs.appendChild(bar);
    bar.classList.add("pomo-fullscreen");
  } else {
    document.body.prepend(bar);
    bar.classList.remove("pomo-fullscreen");
  }
});

// ─── Favicon overlay ─────────────────────────────────────────────────────────

function getFaviconLink() {
  return (
    document.querySelector('link[rel~="icon"]') ||
    document.querySelector('link[rel="shortcut icon"]')
  );
}

function applyFaviconOverlay(mode) {
  faviconLinkEl = faviconLinkEl || getFaviconLink();

  // Preserve original href once
  if (!originalFaviconHref) {
    originalFaviconHref = faviconLinkEl ? faviconLinkEl.href : null;
  }

  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const color = mode === "work" ? "#E05A4A" : "#52C78E";

  const drawOverlay = () => {
    // Small dot in bottom-right corner
    ctx.beginPath();
    ctx.arc(size - 7, size - 7, 6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    setFaviconDataUrl(canvas.toDataURL("image/png"));
  };

  const src = originalFaviconHref || null;
  if (src) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, size, size);
        drawOverlay();
      } catch (_) {
        // Canvas tainted by cross-origin image — just show dot
        ctx.clearRect(0, 0, size, size);
        drawOverlay();
      }
    };
    img.onerror = () => {
      drawOverlay();
    };
    img.src = src;
  } else {
    drawOverlay();
  }
}

function setFaviconDataUrl(dataUrl) {
  if (!faviconLinkEl) {
    faviconLinkEl = document.createElement("link");
    faviconLinkEl.rel = "icon";
    document.head.appendChild(faviconLinkEl);
  }
  faviconLinkEl.href = dataUrl;
}

function removeFaviconOverlay() {
  if (!faviconLinkEl || !originalFaviconHref) return;
  faviconLinkEl.href = originalFaviconHref;
  originalFaviconHref = null;
}

// ─── State updates ────────────────────────────────────────────────────────────

function applyState(state, tabId) {
  updateBar(state);

  const nowBound = state.boundTabId !== null && tabId === state.boundTabId;
  const modeChanged = state.mode !== lastMode;
  const bindChanged = nowBound !== lastIsBound;

  if (nowBound && state.mode !== "idle" && (bindChanged || modeChanged)) {
    applyFaviconOverlay(state.mode);
    isBound = true;
  } else if (isBound && (!nowBound || state.mode === "idle")) {
    removeFaviconOverlay();
    isBound = false;
  }

  lastMode = state.mode;
  lastIsBound = nowBound;
}

// ─── Polling ──────────────────────────────────────────────────────────────────

function poll() {
  if (document.hidden || myTabId === null) return;
  browser.runtime.sendMessage({ type: "GET_STATE" }).then((state) => {
    applyState(state, myTabId);
  }).catch(() => {});
}

setInterval(poll, 1000);

// ─── Push messages from background ───────────────────────────────────────────

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "UPDATE_BAR" && myTabId !== null) {
    applyState(msg, myTabId);
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

browser.runtime.sendMessage({ type: "CONTENT_READY" }).then((response) => {
  myTabId = response.tabId;
  applyState(response.state, myTabId);
}).catch(() => {});
