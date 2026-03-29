/**
 * Expo app configuration for the OpenKit mobile app.
 * Uses a dynamic config (app.config.ts) for type safety and environment flexibility.
 */
import { ExpoConfig, ConfigContext } from "expo/config";

const BUNDLE_ID = "io.nomadware.openkit";
const BACKGROUND_COLOR = "#0c0e12";
const EAS_PROJECT_ID = "99fe7c99-89fe-40b2-b463-30ca2e1e1cb5";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "OpenKit",
  slug: "openkit",
  scheme: "openkit",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: BACKGROUND_COLOR,
  },
  plugins: [
    [
      "expo-camera",
      {
        cameraPermission: "Allow $(PRODUCT_NAME) to access your camera so you can scan QR codes.",
      },
    ],
    "expo-router",
    "expo-notifications",
  ],
  ios: {
    supportsTablet: true,
    bundleIdentifier: BUNDLE_ID,
    infoPlist: {
      NSCameraUsageDescription: "Allow this app to use your camera to scan QR codes.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: BUNDLE_ID,
    permissions: ["android.permission.CAMERA"],
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: BACKGROUND_COLOR,
    },
  },
  web: {
    bundler: "metro",
    favicon: "./assets/favicon.png",
  },
  extra: {
    eas: {
      projectId: EAS_PROJECT_ID,
    },
  },
  updates: {
    url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
  },
  runtimeVersion: {
    policy: "fingerprint",
  },
  owner: "openkit",
});
