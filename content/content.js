// Pomo content script — injects progress bar and manages favicon overlay.

let myTabId = null;
let isBound = false;
let originalFaviconHref = null;
let faviconLinkEl = null;
let lastMode = null;
let _faviconGen = 0;
let pendingMsg = null;

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
  const gen = ++_faviconGen;
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
      if (gen !== _faviconGen) return;
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
      if (gen !== _faviconGen) return;
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
  ++_faviconGen;
  if (!faviconLinkEl || !originalFaviconHref) return;
  faviconLinkEl.href = originalFaviconHref;
  originalFaviconHref = null;
}

// ─── State updates ────────────────────────────────────────────────────────────

function applyState(state, tabId) {
  updateBar(state);

  const nowBound = state.boundTabId !== null && tabId === state.boundTabId;
  const shouldBind = nowBound && state.mode !== "idle";

  if (shouldBind && (!isBound || state.mode !== lastMode)) {
    applyFaviconOverlay(state.mode);
  } else if (!shouldBind && isBound) {
    removeFaviconOverlay();
  }
  isBound = shouldBind;
  lastMode = state.mode;
}

// ─── Visibility sync ──────────────────────────────────────────────────────────

document.addEventListener("visibilitychange", () => {
  if (document.hidden || myTabId === null) return;
  browser.runtime.sendMessage({ type: "GET_STATE" }).then((state) => {
    applyState(state, myTabId);
  }).catch(() => {});
});

// ─── Push messages from background ───────────────────────────────────────────

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "UPDATE_BAR") {
    if (myTabId === null) { pendingMsg = msg; return; }
    applyState(msg, myTabId);
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

browser.runtime.sendMessage({ type: "CONTENT_READY" }).then((response) => {
  myTabId = response.tabId;
  applyState(response.state, myTabId);
  if (pendingMsg) {
    applyState(pendingMsg, myTabId);
    pendingMsg = null;
  }
}).catch(() => {});
