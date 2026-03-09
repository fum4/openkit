let hasLoaded = false;
let loadPromise: Promise<unknown> | null = null;

function loadDownloadEnhancements() {
  if (hasLoaded) return loadPromise ?? Promise.resolve();
  if (!loadPromise) {
    loadPromise = import("./download").then(() => {
      hasLoaded = true;
    });
  }
  return loadPromise;
}

function bindIntentLoad() {
  const toggleButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-download-toggle]"),
  );
  if (toggleButtons.length === 0) return;

  toggleButtons.forEach((toggle) => {
    toggle.addEventListener("click", async (event) => {
      if (hasLoaded) return;

      event.preventDefault();
      event.stopPropagation();
      await loadDownloadEnhancements();
      toggle.click();
    });
  });
}

function initDownloadBootstrap() {
  bindIntentLoad();
}

if (document.readyState === "complete") {
  initDownloadBootstrap();
} else {
  window.addEventListener("load", initDownloadBootstrap, { once: true });
}
