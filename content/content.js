// Pomo content script — injects progress bar and manages favicon overlay.

let myTabId = null;
let isBound = false;
let lastMode = null;
let pendingMsg = null;

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

    const src = originalHref || null;
    if (src) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (myGen !== gen) return;
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
    originalHref = null;
  }

  return {
    apply(mode) { applyFaviconOverlay(mode); },
    remove() { removeFaviconOverlay(); },
  };
})();

// ─── State updates ────────────────────────────────────────────────────────────

function applyState(state, tabId) {
  updateBar(state);

  const nowBound = state.boundTabId !== null && tabId === state.boundTabId;
  const shouldBind = nowBound && state.mode !== "idle";

  if (shouldBind && (!isBound || state.mode !== lastMode)) {
    faviconOverlay.apply(state.mode);
  } else if (!shouldBind && isBound) {
    faviconOverlay.remove();
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
    applyState(msg.state, myTabId);
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

browser.runtime.sendMessage({ type: "CONTENT_READY" }).then((response) => {
  myTabId = response.tabId;
  applyState(response.state, myTabId);
  if (pendingMsg) {
    applyState(pendingMsg.state, myTabId);
    pendingMsg = null;
  }
}).catch(() => {});
