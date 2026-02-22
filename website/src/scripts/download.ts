interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface ReleaseData {
  tag_name: string;
  assets: ReleaseAsset[];
}

interface DownloadInfo {
  arm64Url: string | null;
  x64Url: string | null;
  version: string;
}

const CACHE_KEY = "OpenKit-release-info";
const RELEASES_API = "https://api.github.com/repos/fum4/OpenKit/releases/latest";
const RELEASES_PAGE = "https://github.com/fum4/OpenKit/releases";

function detectArch(): "arm64" | "x64" {
  const uad = (navigator as any).userAgentData;
  if (uad?.architecture === "arm") return "arm64";
  if (/ARM/.test(navigator.userAgent)) return "arm64";
  // Default to ARM — most modern Macs are Apple Silicon
  return "arm64";
}

function getCached(): DownloadInfo | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCache(info: DownloadInfo) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(info));
  } catch {}
}

async function fetchRelease(): Promise<DownloadInfo> {
  const cached = getCached();
  if (cached) return cached;

  try {
    const res = await fetch(RELEASES_API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: ReleaseData = await res.json();

    const arm64Asset = data.assets.find((a) => a.name.endsWith(".dmg") && a.name.includes("arm64"));
    const x64Asset = data.assets.find((a) => a.name.endsWith(".dmg") && !a.name.includes("arm64"));

    const info: DownloadInfo = {
      arm64Url: arm64Asset?.browser_download_url ?? null,
      x64Url: x64Asset?.browser_download_url ?? null,
      version: data.tag_name,
    };

    setCache(info);
    return info;
  } catch {
    return { arm64Url: null, x64Url: null, version: "" };
  }
}

function updateUI(info: DownloadInfo, arch: "arm64" | "x64") {
  const downloadBtn = document.getElementById("download-btn") as HTMLAnchorElement | null;
  const downloadLabel = document.getElementById("download-label");
  const downloadVersion = document.getElementById("download-version");
  const heroAltArch = document.getElementById("hero-alt-arch");
  const footerVersion = document.getElementById("footer-version");

  const url = arch === "arm64" ? info.arm64Url : info.x64Url;
  const archLabel = arch === "arm64" ? "Apple Silicon" : "Intel";
  const altLabel = arch === "arm64" ? "Intel Macs" : "Apple Silicon";

  if (downloadBtn) {
    downloadBtn.href = url || RELEASES_PAGE;
    if (!url) downloadBtn.href = RELEASES_PAGE;
  }

  if (downloadLabel) {
    downloadLabel.textContent = `Download for ${archLabel}`;
  }

  if (downloadVersion && info.version) {
    downloadVersion.textContent = info.version;
  }

  if (heroAltArch) {
    heroAltArch.textContent = altLabel;
  }

  if (footerVersion && info.version) {
    footerVersion.textContent = info.version;
  }
}

// Init
async function init() {
  const detectedArch = detectArch();
  let currentArch = detectedArch;

  const info = await fetchRelease();
  updateUI(info, currentArch);

  // Architecture tab switching
  document.querySelectorAll<HTMLButtonElement>(".arch-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".arch-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentArch = tab.dataset.arch as "arm64" | "x64";
      updateUI(info, currentArch);
    });
  });

  // Set initial active tab based on detection
  document.querySelectorAll<HTMLButtonElement>(".arch-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.arch === detectedArch);
  });

  // Copy buttons
  document.querySelectorAll<HTMLButtonElement>(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.dataset.copy || "";
      try {
        await navigator.clipboard.writeText(text);
        btn.classList.add("copied");
        setTimeout(() => btn.classList.remove("copied"), 1500);
      } catch {}
    });
  });
}

init();
