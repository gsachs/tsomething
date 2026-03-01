// Pomo content script — injects progress bar and manages favicon overlay.

let myTabId = null;
let isBound = false;
let lastMode = null;
// UPDATE_BAR can arrive before CONTENT_READY resolves — buffer it so the first
// push is not lost. Replayed immediately after myTabId is established.
let bufferedUpdate = null;

// ─── Bar ─────────────────────────────────────────────────────────────────────

const bar = document.createElement("div");
bar.id = "pomo-bar-root";
bar.setAttribute("data-mode", "idle");

const barFill = document.createElement("div");
barFill.id = "pomo-bar-fill";
bar.appendChild(barFill);
document.body.prepend(bar);

function updateBar(state) {
  const mode = state.autoPaused ? "paused" : state.mode;
  bar.setAttribute("data-mode", mode);
  barFill.style.width = state.mode === "idle" ? "0%" : `${state.progress * 100}%`;
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

const faviconOverlay = (() => {
  let originalHref = null;
  let linkEl = null;
  let gen = 0;

  const FAVICON_SIZE = 32;
  const DOT_RADIUS = 6;
  const DOT_MARGIN = 1;  // px gap between dot edge and canvas edge
  const DOT_CENTER = FAVICON_SIZE - DOT_RADIUS - DOT_MARGIN;  // = 25
  const DOT_STROKE_WIDTH = 1.5;

  const _canvas = document.createElement("canvas");
  _canvas.width = FAVICON_SIZE;
  _canvas.height = FAVICON_SIZE;
  const _ctx = _canvas.getContext("2d");

  function getFaviconLink() {
    return (
      document.querySelector('link[rel~="icon"]') ||
      document.querySelector('link[rel="shortcut icon"]')
    );
  }

  function setFaviconDataUrl(dataUrl) {
    if (!linkEl) {
      linkEl = document.createElement("link");
      linkEl.rel = "icon";
      document.head.appendChild(linkEl);
    }
    linkEl.href = dataUrl;
  }

  function applyFaviconOverlay(mode) {
    const myGen = ++gen;
    linkEl = linkEl || getFaviconLink();

    // Preserve original href once
    if (!originalHref) {
      originalHref = linkEl ? linkEl.href : null;
    }

    const color = mode === "work" ? "#E05A4A" : "#52C78E";

    const drawOverlay = () => {
      _ctx.clearRect(0, 0, FAVICON_SIZE, FAVICON_SIZE);
      // Small dot in bottom-right corner
      _ctx.beginPath();
      _ctx.arc(DOT_CENTER, DOT_CENTER, DOT_RADIUS, 0, Math.PI * 2);
      _ctx.fillStyle = color;
      _ctx.fill();
      _ctx.strokeStyle = "#ffffff";
      _ctx.lineWidth = DOT_STROKE_WIDTH;
      _ctx.stroke();

      setFaviconDataUrl(_canvas.toDataURL("image/png"));
    };

    const ALLOWED_SCHEMES = ["http:", "https:", "data:"];
    const src = originalHref || null;
    if (src) {
      if (!ALLOWED_SCHEMES.some((s) => src.startsWith(s))) {
        drawOverlay();
        return;
      }
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (myGen !== gen) return; // stale: a newer applyFaviconOverlay call has taken over
        try {
          _ctx.drawImage(img, 0, 0, FAVICON_SIZE, FAVICON_SIZE);
          drawOverlay();
        } catch {
          // Canvas tainted by cross-origin image — just show dot
          _ctx.clearRect(0, 0, FAVICON_SIZE, FAVICON_SIZE);
          drawOverlay();
        }
      };
      img.onerror = () => {
        if (myGen !== gen) return;
        drawOverlay();
      };
      img.src = src;
    } else {
      drawOverlay();
    }
  }

  function removeFaviconOverlay() {
    ++gen;
    if (!linkEl || !originalHref) return;
    linkEl.href = originalHref;
  }

  return {
    apply(mode) { applyFaviconOverlay(mode); },
    remove() { removeFaviconOverlay(); },
  };
})();

// ─── State updates ────────────────────────────────────────────────────────────

// Each content script only receives UPDATE_BAR for its own tab, so no binding
// check is needed — active mode means this tab's timer is running.
function applyState(state) {
  updateBar(state);

  const shouldBind = state.mode !== "idle";

  if (shouldBind && (!isBound || state.mode !== lastMode)) {
    faviconOverlay.apply(state.mode);
  } else if (!shouldBind && isBound) {
    faviconOverlay.remove();
  }
  isBound = shouldBind;
  lastMode = state.mode;
}

// ─── Visibility sync ──────────────────────────────────────────────────────────

// Re-sync when the tab becomes visible: content scripts in background tabs may
// miss UPDATE_BAR pushes while suspended. The background also sends a fresh
// broadcastState via checkBoundTabActivity, but this covers the edge case where
// that push races ahead of the tab fully becoming active.
document.addEventListener("visibilitychange", () => {
  if (document.hidden || myTabId === null) return;
  browser.runtime.sendMessage({ type: "GET_STATE", tabId: myTabId }).then((state) => {
    applyState(state);
  // extension context unavailable (update in flight) — nothing to apply
  }).catch(() => {});
});

// ─── Push messages from background ───────────────────────────────────────────

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "UPDATE_BAR") {
    if (myTabId === null) { bufferedUpdate = msg; return; }
    applyState(msg.state);
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

browser.runtime.sendMessage({ type: "CONTENT_READY" }).then((response) => {
  myTabId = response.tabId;
  applyState(response.state);
  if (bufferedUpdate) {
    applyState(bufferedUpdate.state);
    bufferedUpdate = null;
  }
// background not yet ready; content script will re-init on next CONTENT_READY
}).catch(() => {});
