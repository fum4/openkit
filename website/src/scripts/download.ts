interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface ReleaseData {
  tag_name: string;
  assets: ReleaseAsset[];
}

type Platform = "mac" | "linux" | "windows" | "other";
type Arch = "arm64" | "x64" | "universal" | "other";

interface DownloadOption {
  id: string;
  platform: Platform;
  arch: Arch;
  ext: string;
  extOrder: number;
  title: string;
  url: string;
}

interface DownloadInfo {
  version: string;
  options: DownloadOption[];
}

interface DownloadWidget {
  root: HTMLElement;
  main: HTMLAnchorElement;
  label: HTMLElement;
  version: HTMLElement | null;
  toggle: HTMLButtonElement;
  menu: HTMLElement;
}

interface FormatSpec {
  suffix: string;
  platformHint: Platform;
  order: number;
}

interface NavigatorWithUAData extends Navigator {
  userAgentData?: {
    architecture?: string;
    platform?: string;
  };
}

const CACHE_KEY = "OpenKit-release-info-v3";
const RELEASES_API = "https://api.github.com/repos/fum4/OpenKit/releases/latest";
const RELEASES_PAGE = "https://github.com/fum4/OpenKit/releases";
const LATEST_DOWNLOAD_BASE = "https://github.com/fum4/OpenKit/releases/latest/download";
const LATEST_MAC_MANIFEST = `${LATEST_DOWNLOAD_BASE}/latest-mac.yml`;
const LATEST_LINUX_MANIFEST = `${LATEST_DOWNLOAD_BASE}/latest-linux.yml`;

const FORMAT_SPECS: FormatSpec[] = [
  { suffix: ".appimage", platformHint: "linux", order: 0 },
  { suffix: ".deb", platformHint: "linux", order: 1 },
  { suffix: ".rpm", platformHint: "linux", order: 2 },
  { suffix: ".dmg", platformHint: "mac", order: 3 },
  { suffix: ".zip", platformHint: "mac", order: 4 },
  { suffix: ".tar.gz", platformHint: "linux", order: 5 },
  { suffix: ".tar.xz", platformHint: "linux", order: 6 },
  { suffix: ".msi", platformHint: "windows", order: 7 },
  { suffix: ".exe", platformHint: "windows", order: 8 },
];

const PLATFORM_ORDER: Record<Platform, number> = {
  mac: 0,
  linux: 1,
  windows: 2,
  other: 3,
};

const ARCH_ORDER: Record<Arch, number> = {
  arm64: 0,
  x64: 1,
  universal: 2,
  other: 3,
};

interface ManifestData {
  version: string;
  files: string[];
}

function getFallbackOptions(): DownloadOption[] {
  return [
    {
      id: "fallback-mac-arm64",
      platform: "mac",
      arch: "arm64",
      ext: ".dmg",
      extOrder: getFormatOrder(".dmg"),
      title: "macOS (Apple Silicon)",
      url: RELEASES_PAGE,
    },
    {
      id: "fallback-mac-x64",
      platform: "mac",
      arch: "x64",
      ext: ".dmg",
      extOrder: getFormatOrder(".dmg"),
      title: "macOS (Intel)",
      url: RELEASES_PAGE,
    },
    {
      id: "fallback-linux-x64",
      platform: "linux",
      arch: "x64",
      ext: ".AppImage",
      extOrder: getFormatOrder(".appimage"),
      title: "Linux",
      url: RELEASES_PAGE,
    },
  ];
}

function detectUserPlatform(): Platform {
  const nav = navigator as NavigatorWithUAData;
  const platform = (
    nav.userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent
  ).toLowerCase();

  if (platform.includes("mac") || platform.includes("darwin")) return "mac";
  if (platform.includes("linux")) return "linux";
  if (platform.includes("win")) return "windows";
  return "other";
}

function detectUserArch(): Arch {
  const nav = navigator as NavigatorWithUAData;
  const hints = [
    nav.userAgentData?.architecture || "",
    navigator.platform || "",
    navigator.userAgent || "",
  ]
    .join(" ")
    .toLowerCase();

  if (/(arm64|aarch64|armv8|\barm\b)/.test(hints)) return "arm64";
  if (/(x64|x86_64|amd64|intel|win64|x86)/.test(hints)) return "x64";
  return "other";
}

function detectPlatformFromAssetName(name: string, hint: Platform): Platform {
  if (/(darwin|mac|osx)/.test(name)) return "mac";
  if (/linux/.test(name)) return "linux";
  if (/(win|windows)/.test(name)) return "windows";
  return hint;
}

function detectArchFromAssetName(name: string, platform: Platform, ext: string): Arch {
  if (/(arm64|aarch64|armv8|\barm\b)/.test(name)) return "arm64";
  if (/(x64|x86_64|amd64)/.test(name)) return "x64";
  if (/universal/.test(name)) return "universal";

  if (platform === "mac" && ext === ".dmg") {
    // Current macOS Intel DMGs do not include an architecture marker.
    return "x64";
  }

  return "other";
}

function getPlatformTitle(platform: Platform): string {
  if (platform === "mac") return "macOS";
  if (platform === "linux") return "Linux";
  if (platform === "windows") return "Windows";
  return "Release";
}

function getArchTitle(platform: Platform, arch: Arch): string {
  if (arch === "arm64") return platform === "mac" ? "Apple Silicon" : "ARM64";
  if (arch === "x64") return platform === "mac" ? "Intel" : "x64";
  if (arch === "universal") return "Universal";
  return "";
}

function getOptionTitle(platform: Platform, arch: Arch): string {
  const platformTitle = getPlatformTitle(platform);
  const archTitle = getArchTitle(platform, arch);
  return archTitle ? `${platformTitle} (${archTitle})` : platformTitle;
}

function normalizeVersion(tag: string): string {
  if (!tag) return "";
  return tag.startsWith("v") ? tag : `v${tag}`;
}

function normalizeManifestValue(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, "");
}

function parseManifest(content: string): ManifestData {
  const files: string[] = [];
  const versionMatch = content.match(/^\s*version:\s*([^\r\n]+)\s*$/m);
  const version = versionMatch ? normalizeVersion(normalizeManifestValue(versionMatch[1])) : "";

  const urlPattern = /^\s*-\s+url:\s*([^\r\n]+)\s*$/gm;
  let urlMatch: RegExpExecArray | null = urlPattern.exec(content);
  while (urlMatch) {
    files.push(normalizeManifestValue(urlMatch[1]));
    urlMatch = urlPattern.exec(content);
  }

  const pathMatch = content.match(/^\s*path:\s*([^\r\n]+)\s*$/m);
  if (pathMatch) {
    const pathValue = normalizeManifestValue(pathMatch[1]);
    if (pathValue && !files.includes(pathValue)) files.push(pathValue);
  }

  return { version, files };
}

function getFileExt(file: string): string {
  const normalized = file.toLowerCase();
  if (normalized.endsWith(".appimage")) return ".AppImage";
  if (normalized.endsWith(".dmg")) return ".dmg";
  if (normalized.endsWith(".zip")) return ".zip";
  if (normalized.endsWith(".deb")) return ".deb";
  if (normalized.endsWith(".rpm")) return ".rpm";
  return "";
}

function resolveDownloadUrl(file: string): string {
  if (/^https?:\/\//i.test(file)) return file;
  return `${LATEST_DOWNLOAD_BASE}/${encodeURIComponent(file)}`;
}

function pickMacFile(files: string[], arch: "arm64" | "x64"): string | null {
  const candidates = files.filter((file) => {
    const normalized = file.toLowerCase();
    const hasArm = normalized.includes("arm64");
    const formatSupported = normalized.endsWith(".dmg") || normalized.endsWith(".zip");
    if (!formatSupported) return false;
    return arch === "arm64" ? hasArm : !hasArm;
  });

  if (candidates.length === 0) return null;
  return (
    candidates.find((file) => file.toLowerCase().endsWith(".dmg")) ||
    candidates.find((file) => file.toLowerCase().endsWith(".zip")) ||
    candidates[0]
  );
}

function pickLinuxFile(files: string[]): string | null {
  const candidates = files.filter((file) => {
    const normalized = file.toLowerCase();
    return (
      normalized.endsWith(".appimage") || normalized.endsWith(".deb") || normalized.endsWith(".rpm")
    );
  });

  if (candidates.length === 0) return null;
  return (
    candidates.find((file) => file.toLowerCase().endsWith(".appimage")) ||
    candidates.find((file) => file.toLowerCase().endsWith(".deb")) ||
    candidates.find((file) => file.toLowerCase().endsWith(".rpm")) ||
    candidates[0]
  );
}

function getFormatOrder(ext: string): number {
  const format = FORMAT_SPECS.find((entry) => entry.suffix === ext.toLowerCase());
  return format?.order ?? 99;
}

function optionsFromWorkflowManifests(
  macManifest: ManifestData | null,
  linuxManifest: ManifestData | null,
): DownloadOption[] {
  const options: DownloadOption[] = [];

  const macArmFile = macManifest ? pickMacFile(macManifest.files, "arm64") : null;
  const macIntelFile = macManifest ? pickMacFile(macManifest.files, "x64") : null;
  const linuxFile = linuxManifest ? pickLinuxFile(linuxManifest.files) : null;

  if (macArmFile) {
    const ext = getFileExt(macArmFile);
    options.push({
      id: "workflow-mac-arm64",
      platform: "mac",
      arch: "arm64",
      ext,
      extOrder: getFormatOrder(ext),
      title: "macOS (Apple Silicon)",
      url: resolveDownloadUrl(macArmFile),
    });
  }

  if (macIntelFile) {
    const ext = getFileExt(macIntelFile);
    options.push({
      id: "workflow-mac-x64",
      platform: "mac",
      arch: "x64",
      ext,
      extOrder: getFormatOrder(ext),
      title: "macOS (Intel)",
      url: resolveDownloadUrl(macIntelFile),
    });
  }

  if (linuxFile) {
    const ext = getFileExt(linuxFile);
    options.push({
      id: "workflow-linux-x64",
      platform: "linux",
      arch: "x64",
      ext,
      extOrder: getFormatOrder(ext),
      title: "Linux",
      url: resolveDownloadUrl(linuxFile),
    });
  }

  return options;
}

function parseReleaseOptions(assets: ReleaseAsset[]): DownloadOption[] {
  const options: DownloadOption[] = [];

  assets.forEach((asset) => {
    const assetName = asset.name.toLowerCase();

    if (
      !asset.browser_download_url ||
      assetName.includes("blockmap") ||
      assetName.includes("checksum") ||
      assetName.includes("checksums") ||
      assetName.endsWith(".yml")
    ) {
      return;
    }

    const format = FORMAT_SPECS.find((entry) => assetName.endsWith(entry.suffix));
    if (!format) return;

    const platform = detectPlatformFromAssetName(assetName, format.platformHint);
    const arch = detectArchFromAssetName(assetName, platform, format.suffix);
    const title = getOptionTitle(platform, arch);

    options.push({
      id: `${assetName}-${format.suffix}`,
      platform,
      arch,
      ext: format.suffix,
      extOrder: format.order,
      title,
      url: asset.browser_download_url,
    });
  });

  options.sort((a, b) => {
    if (PLATFORM_ORDER[a.platform] !== PLATFORM_ORDER[b.platform]) {
      return PLATFORM_ORDER[a.platform] - PLATFORM_ORDER[b.platform];
    }
    if (ARCH_ORDER[a.arch] !== ARCH_ORDER[b.arch]) {
      return ARCH_ORDER[a.arch] - ARCH_ORDER[b.arch];
    }
    if (a.extOrder !== b.extOrder) return a.extOrder - b.extOrder;
    return a.title.localeCompare(b.title);
  });

  return options;
}

function getCached(): DownloadInfo | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DownloadInfo;
    if (!Array.isArray(parsed.options)) return null;
    return parsed;
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
    const [macManifestRes, linuxManifestRes] = await Promise.allSettled([
      fetch(LATEST_MAC_MANIFEST),
      fetch(LATEST_LINUX_MANIFEST),
    ]);

    const macManifestText =
      macManifestRes.status === "fulfilled" && macManifestRes.value.ok
        ? await macManifestRes.value.text()
        : "";
    const linuxManifestText =
      linuxManifestRes.status === "fulfilled" && linuxManifestRes.value.ok
        ? await linuxManifestRes.value.text()
        : "";

    const macManifest = macManifestText ? parseManifest(macManifestText) : null;
    const linuxManifest = linuxManifestText ? parseManifest(linuxManifestText) : null;
    const manifestOptions = optionsFromWorkflowManifests(macManifest, linuxManifest);
    const manifestVersion = macManifest?.version || linuxManifest?.version || "";

    if (manifestOptions.length > 0) {
      const info: DownloadInfo = {
        version: manifestVersion,
        options: manifestOptions,
      };
      setCache(info);
      return info;
    }

    const res = await fetch(RELEASES_API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: ReleaseData = await res.json();
    const parsedOptions = parseReleaseOptions(data.assets || []);
    const info: DownloadInfo = {
      version: normalizeVersion(data.tag_name),
      options: parsedOptions.length > 0 ? parsedOptions : getFallbackOptions(),
    };

    setCache(info);
    return info;
  } catch {
    return { version: "", options: getFallbackOptions() };
  }
}

function selectDefaultOption(options: DownloadOption[]): DownloadOption | null {
  if (options.length === 0) return null;

  const userPlatform = detectUserPlatform();
  const userArch = detectUserArch();

  if (userPlatform === "mac") {
    return (
      options.find((o) => o.platform === "mac" && o.arch === "arm64") ||
      options.find((o) => o.platform === "mac" && o.arch === "universal") ||
      options.find((o) => o.platform === "mac") ||
      options[0]
    );
  }

  return (
    options.find((o) => o.platform === userPlatform && o.arch === userArch) ||
    options.find((o) => o.platform === userPlatform && o.arch === "universal") ||
    options.find((o) => o.platform === userPlatform) ||
    options.find((o) => o.arch === userArch) ||
    options[0]
  );
}

function getWidgets(): DownloadWidget[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-download-widget]"))
    .map((root): DownloadWidget | null => {
      const main = root.querySelector<HTMLAnchorElement>("[data-download-main]");
      const label = root.querySelector<HTMLElement>("[data-download-label]");
      const version = root.querySelector<HTMLElement>("[data-download-version]");
      const toggle = root.querySelector<HTMLButtonElement>("[data-download-toggle]");
      const menu = root.querySelector<HTMLElement>("[data-download-menu]");

      if (!main || !label || !toggle || !menu) return null;
      return { root, main, label, version, toggle, menu };
    })
    .filter((widget): widget is DownloadWidget => Boolean(widget));
}

function closeMenus(widgets: DownloadWidget[]) {
  widgets.forEach((widget) => {
    widget.root.classList.remove("open");
    widget.toggle.setAttribute("aria-expanded", "false");
  });
}

function getSelectedOption(info: DownloadInfo): DownloadOption | null {
  if (info.options.length === 0) return null;
  return selectDefaultOption(info.options);
}

function updateWidgets(widgets: DownloadWidget[], info: DownloadInfo) {
  const selected = getSelectedOption(info);

  widgets.forEach((widget) => {
    if (!selected) {
      widget.main.href = RELEASES_PAGE;
      widget.label.textContent = "Download from GitHub";
      if (widget.version) widget.version.textContent = "";
      return;
    }

    widget.main.href = selected.url || RELEASES_PAGE;
    widget.label.textContent = `Download ${selected.title}`;
    if (widget.version) widget.version.textContent = info.version;
  });

  const footerVersion = document.getElementById("footer-version");
  if (footerVersion) footerVersion.textContent = info.version;
}

function renderMenus(widgets: DownloadWidget[], info: DownloadInfo) {
  widgets.forEach((widget) => {
    widget.menu.innerHTML = "";

    if (info.options.length === 0) {
      const empty = document.createElement("div");
      empty.className = "download-option";
      empty.textContent = "No direct assets detected";
      widget.menu.appendChild(empty);
      return;
    }

    info.options.forEach((option) => {
      const item = document.createElement("a");
      item.className = "download-option";
      item.href = option.url || RELEASES_PAGE;

      const title = document.createElement("span");
      title.className = "download-option-title";
      title.textContent = option.title;

      item.appendChild(title);

      item.addEventListener("click", () => {
        closeMenus(widgets);
      });

      widget.menu.appendChild(item);
    });
  });
}

function bindDropdowns(widgets: DownloadWidget[]) {
  widgets.forEach((widget) => {
    widget.toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const isOpen = widget.root.classList.contains("open");
      closeMenus(widgets);

      if (!isOpen) {
        widget.root.classList.add("open");
        widget.toggle.setAttribute("aria-expanded", "true");
      }
    });
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (widgets.some((widget) => widget.root.contains(target))) return;
    closeMenus(widgets);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenus(widgets);
  });
}

function bindCopyButtons() {
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

async function init() {
  const widgets = getWidgets();
  bindCopyButtons();
  if (widgets.length === 0) return;

  bindDropdowns(widgets);

  const info = await fetchRelease();
  renderMenus(widgets, info);
  updateWidgets(widgets, info);
}

init();
