#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(projectRoot, "package.json");

function fail(message) {
  console.error(`verify:package failed: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));

assert(pkg.name === "openkit", `package name must be "openkit" (received "${pkg.name}")`);

const expectedBinPath = "dist/cli/index.js";
assert(pkg.bin?.openkit === expectedBinPath, `bin.openkit must be "${expectedBinPath}"`);
assert(pkg.bin?.ok === expectedBinPath, `bin.ok must be "${expectedBinPath}"`);

const files = Array.isArray(pkg.files) ? pkg.files : [];
assert(files.includes("dist/**/*"), `package.json files must include "dist/**/*"`);
assert(files.includes("README.md"), `package.json files must include "README.md"`);
assert(files.includes("LICENSE"), `package.json files must include "LICENSE"`);

const requiredFiles = [
  "dist/cli/index.js",
  "dist/ui/index.html",
  "dist/runtime/port-hook.cjs",
  "README.md",
  "LICENSE",
];

for (const relPath of requiredFiles) {
  const fullPath = path.join(projectRoot, relPath);
  assert(existsSync(fullPath), `required file missing: ${relPath}`);
}

const cliStat = statSync(path.join(projectRoot, "dist/cli/index.js"));
assert((cliStat.mode & 0o111) !== 0, "dist/cli/index.js must be executable");

const cliSource = readFileSync(path.join(projectRoot, "src/cli/index.ts"), "utf8");
assert(cliSource.includes("APP_VERSION"), "src/cli/index.ts must source version from APP_VERSION");

console.log("verify:package passed");
