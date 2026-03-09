let hasLoaded = false;

function loadDownloadEnhancements() {
  if (hasLoaded) return;
  hasLoaded = true;
  void import("./download");
}

function scheduleBackgroundLoad() {
  const requestIdleCallback = (
    window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;

  if (requestIdleCallback) {
    requestIdleCallback(loadDownloadEnhancements, { timeout: 5000 });
  }

  setTimeout(loadDownloadEnhancements, 5000);
}

function bindIntentLoad() {
  const loadOnIntent = () => {
    loadDownloadEnhancements();
  };

  document.addEventListener("pointerdown", loadOnIntent, { once: true });
  document.addEventListener("keydown", loadOnIntent, { once: true });
  document.addEventListener("touchstart", loadOnIntent, { once: true });
}

function initDownloadBootstrap() {
  bindIntentLoad();
  scheduleBackgroundLoad();
}

if (document.readyState === "complete") {
  initDownloadBootstrap();
} else {
  window.addEventListener("load", initDownloadBootstrap, { once: true });
}
