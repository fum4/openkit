import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(currentDir, "..");
const excludedApps = new Set(["mobile-app"]);
const isDryRun = process.argv.includes("--dry-run");

function run(command) {
  return execSync(command, {
    cwd: workspaceRoot,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  }).trim();
}

function getAffectedAppsFromNx(baseTag) {
  const nxOutput = run(
    `pnpm nx show projects --affected --base=${baseTag} --head=HEAD --type=app --json`,
  );
  if (!nxOutput) {
    return [];
  }

  const projects = JSON.parse(nxOutput);
  if (!Array.isArray(projects)) {
    return [];
  }

  return projects
    .filter((project) => typeof project === "string")
    .map((project) => project.trim())
    .filter(Boolean);
}

function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Expected semver x.y.z but got "${version}"`);
  }
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  return `${major}.${minor}.${patch + 1}`;
}

let changedFiles = [];
let lastReleaseTag = "";
let affectedAppsFromNx = [];

try {
  lastReleaseTag = run("git describe --tags --match 'v*' --abbrev=0");
  try {
    affectedAppsFromNx = getAffectedAppsFromNx(lastReleaseTag);
  } catch {
    affectedAppsFromNx = [];
  }

  if (affectedAppsFromNx.length === 0) {
    const diffOutput = run(`git diff --name-only ${lastReleaseTag}..HEAD -- apps`);
    changedFiles = diffOutput ? diffOutput.split("\n").filter(Boolean) : [];
  }
} catch {
  const allAppsOutput = run("find apps -mindepth 2 -maxdepth 2 -name package.json");
  changedFiles = allAppsOutput ? allAppsOutput.split("\n").filter(Boolean) : [];
}

const affectedApps = new Set();
for (const appName of affectedAppsFromNx) {
  if (excludedApps.has(appName)) {
    continue;
  }
  affectedApps.add(appName);
}

for (const filePath of changedFiles) {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments[0] !== "apps" || !segments[1]) {
    continue;
  }
  const appName = segments[1];
  if (excludedApps.has(appName)) {
    continue;
  }
  affectedApps.add(appName);
}

const updatedApps = [];
for (const appName of [...affectedApps].sort((a, b) => a.localeCompare(b))) {
  const appPackagePath = path.join(workspaceRoot, "apps", appName, "package.json");
  if (!existsSync(appPackagePath)) {
    continue;
  }

  const appPackage = JSON.parse(readFileSync(appPackagePath, "utf8"));
  const currentVersion =
    typeof appPackage.version === "string" && appPackage.version.length > 0
      ? appPackage.version
      : "0.0.0";
  const nextVersion = bumpPatch(currentVersion);
  appPackage.version = nextVersion;
  if (!isDryRun) {
    writeFileSync(appPackagePath, `${JSON.stringify(appPackage, null, 2)}\n`);
  }
  updatedApps.push(`${appName}:${currentVersion}->${nextVersion}`);
}

if (updatedApps.length === 0) {
  if (lastReleaseTag) {
    console.log(`[bump-affected-app-versions] no affected apps since ${lastReleaseTag}`);
  } else {
    console.log("[bump-affected-app-versions] no affected apps");
  }
} else {
  const mode = isDryRun ? "dry-run " : "";
  console.log(`[bump-affected-app-versions] ${mode}${updatedApps.join(", ")}`);
}
