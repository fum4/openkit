#!/usr/bin/env node

import { mkdirSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(projectRoot, "package.json");
const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "openkit-smoke-"));
const env = { ...process.env, npm_config_cache: path.join(tmpRoot, ".npm-cache") };

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const tarballDir = path.join(tmpRoot, "pack");
const unpackDir = path.join(tmpRoot, "unpack");

mkdirSync(tarballDir, { recursive: true });
mkdirSync(unpackDir, { recursive: true });

const tarballName = run("npm", ["pack", "--pack-destination", tarballDir], projectRoot)
  .split("\n")
  .pop();
const tarballPath = path.join(tarballDir, tarballName);
run("tar", ["-xzf", tarballPath, "-C", unpackDir], projectRoot);

const packedRoot = path.join(unpackDir, "package");
const packedPkg = JSON.parse(readFileSync(path.join(packedRoot, "package.json"), "utf8"));

const expectedBinPath = "dist/cli/index.js";
if (packedPkg.bin?.openkit !== expectedBinPath) {
  throw new Error(`packed bin.openkit mismatch: expected ${expectedBinPath}`);
}
if (packedPkg.bin?.ok !== expectedBinPath) {
  throw new Error(`packed bin.ok mismatch: expected ${expectedBinPath}`);
}

symlinkSync(path.join(projectRoot, "node_modules"), path.join(packedRoot, "node_modules"), "dir");

const cliEntrypoint = path.join(packedRoot, "dist", "cli", "index.js");
const versionOutput = run("node", [cliEntrypoint, "--version"], packedRoot);
const helpOutput = run("node", [cliEntrypoint, "--help"], packedRoot);

if (versionOutput !== pkg.version) {
  throw new Error(`CLI --version mismatch: expected ${pkg.version}, got ${versionOutput}`);
}

if (!helpOutput.includes("Usage:")) {
  throw new Error("CLI --help output missing expected Usage section");
}

console.log(`smoke:tarball passed for ${pkg.name}@${pkg.version}`);
