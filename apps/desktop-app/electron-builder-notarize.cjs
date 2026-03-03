const { notarize } = require("@electron/notarize");

/**
 * Electron Builder afterSign hook for macOS notarization.
 *
 * Required environment variables:
 * - APPLE_ID
 * - APPLE_APP_SPECIFIC_PASSWORD
 * - APPLE_TEAM_ID
 */
exports.default = async function notarizeApp(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.warn(
      "[notarize] Skipping notarization: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID is missing.",
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appBundleId = context.packager.appInfo.id;
  const appPath = `${context.appOutDir}/${appName}.app`;

  console.log(`[notarize] Notarizing ${appName}.app (${appBundleId})`);

  await notarize({
    appBundleId,
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });
};
