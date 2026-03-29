/**
 * Local EAS build script that wraps `eas build --local` with environment-aware
 * profile selection, output paths, and optional iOS simulator installation.
 */
const _yargs = require("yargs/yargs");
const easJson = require("../eas.json");
const { spawnSync } = require("child_process");
const path = require("path");

/** Read the iOS bundle identifier from app.config.ts via expo/config */
function getIosBundleId(): string {
  const { getConfig } = require("@expo/config");
  const { exp } = getConfig(path.resolve(__dirname, ".."), { skipSDKVersionRequirement: true });
  return exp.ios?.bundleIdentifier ?? "io.nomadware.openkit";
}

const ENVIRONMENTS = [
  "P", //  - Production
  "S", //  - Staging
  "I", //  - Internal/Preview
  "D", //  - Development
  "DS", // - Development Simulator (iOS)
  "IS", // - Internal/Preview Simulator (iOS)
] as const;
type TEnv = (typeof ENVIRONMENTS)[number];
const ENV_DESCRIPTION =
  "'D' for development, 'I' for internal preview, 'S' for Staging or 'P' for Production";

const PLATFORMS = ["android", "ios"] as const;
type TPlatforms = (typeof PLATFORMS)[number];

const SIMULATOR_ENVS: readonly string[] = ["DS", "IS"];

function installOnSimulator(tarGzPath: string) {
  const fs = require("fs");
  const os = require("os");

  const absolutePath = path.resolve(tarGzPath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`Build artifact not found: ${absolutePath}`);
    return;
  }

  // Extract the tar.gz to a temp directory
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "eas-sim-build-"));
  console.log(`\nExtracting ${absolutePath} to ${extractDir}...`);

  const extractResult = spawnSync("tar", ["-xzf", absolutePath, "-C", extractDir], {
    stdio: "inherit",
  });

  if (extractResult.status !== 0) {
    console.error("Failed to extract build artifact");
    return;
  }

  // Find the .app bundle inside the extracted directory
  const findResult = spawnSync(
    "find",
    [extractDir, "-name", "*.app", "-type", "d", "-maxdepth", "2"],
    {
      encoding: "utf-8",
    },
  );

  const appPath = findResult.stdout?.trim().split("\n")[0];
  if (!appPath) {
    console.error("No .app bundle found in extracted archive");
    console.error("Contents:", spawnSync("ls", ["-la", extractDir], { encoding: "utf-8" }).stdout);
    return;
  }

  console.log(`Found app bundle: ${appPath}`);

  // Boot the simulator if not already running
  spawnSync("xcrun", ["simctl", "boot", "booted"], {
    encoding: "utf-8",
  });
  // Ignore boot errors — it fails if already booted, which is fine

  // Open Simulator.app to make it visible
  spawnSync("open", ["-a", "Simulator"], { stdio: "inherit" });

  // Install the app on the simulator
  console.log("Installing app on simulator...");
  const installResult = spawnSync("xcrun", ["simctl", "install", "booted", appPath], {
    stdio: "inherit",
  });

  if (installResult.status !== 0) {
    console.error("Failed to install app on simulator. Make sure a simulator is running.");
    return;
  }

  // Launch the app
  console.log("Launching app...");
  spawnSync("xcrun", ["simctl", "launch", "booted", getIosBundleId()], {
    stdio: "inherit",
  });

  // Cleanup
  spawnSync("rm", ["-rf", extractDir]);

  console.log("\nApp installed and launched on simulator successfully!");
}

function local_eas_build(platform: TPlatforms, ENV?: TEnv, otherEasBuildsArgs?: string) {
  const BUILD_PROFILE: keyof typeof easJson.build = (() => {
    if (ENV === "P") {
      return "production";
    }

    if (ENV === "S") {
      return "staging";
    }

    if (ENV === "I") {
      return "preview";
    }

    if (ENV === "DS") {
      return "dev-simulator";
    }

    if (ENV === "IS") {
      return "preview-simulator";
    }

    return "development";
  })();

  const isSimulatorBuild = platform === "ios" && ENV && SIMULATOR_ENVS.includes(ENV);

  const FILE_EXTENSION = (() => {
    if (platform === "ios") {
      if (isSimulatorBuild) {
        return "tar.gz";
      }

      return "ipa";
    }

    if (ENV === "P") {
      return "aab";
    }

    return "apk";
  })();

  const outputPath = `eas-builds/${platform}/${BUILD_PROFILE}.${FILE_EXTENSION}`;

  const args = [
    "run",
    "eas-build",
    "--",
    "-e",
    BUILD_PROFILE,
    "--local",
    `--output=${outputPath}`,
    "--platform",
    platform,
  ];
  if (otherEasBuildsArgs?.trim()) {
    args.push(...otherEasBuildsArgs.trim().split(/\s+/));
  }

  const result = spawnSync("pnpm", args, {
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== null && result.status !== 0) {
    throw new Error(`local-eas-build script failed with exit code ${result.status}`);
  }

  // For simulator builds, extract and install the app
  if (isSimulatorBuild) {
    installOnSimulator(outputPath);
  }
}

const options = {
  env: {
    demandOption: false,
    choices: ENVIRONMENTS,
    describe: `Environment: ${ENV_DESCRIPTION}`,
  },
  platform: {
    demandOption: true,
    choices: PLATFORMS,
  },
} as const;

const yargs = _yargs(process.argv.slice(2)).options(options).strict(false);

try {
  const { env, platform } = yargs.parseSync();

  const scriptArg = process.argv
    .filter((item) => {
      const normalizedItem = item.replace(/\\/g, "/"); // Windows OS: Normalize only the item being checked
      return (
        !normalizedItem.includes("node_modules/.bin/ts-node") &&
        !normalizedItem.includes("node_modules/ts-node/dist/bin.js") &&
        !normalizedItem.includes("scripts/local-eas-build.ts") &&
        !item.includes("--env=") && // No need to normalize for these
        !item.includes("--platform=") // No need to normalize for these
      );
    })
    .reduce((prev, curr) => prev + " " + curr, "");

  local_eas_build(platform, env, scriptArg);
} catch (e) {
  yargs.showHelp();

  console.error(e);

  /**
   * This line of code terminates the current process
   * and returns '1' as the exit code to the calling process or shell.
   * This is typically done to indicate that an error has occurred.
   */
  process.exit(1);
}
