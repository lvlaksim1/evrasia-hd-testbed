import type { ExpoConfig } from "expo/config";

const releaseVersionCode = Number(process.env.RELEASE_VERSION_CODE || "1");
if (!Number.isInteger(releaseVersionCode) || releaseVersionCode < 1) {
  throw new Error("RELEASE_VERSION_CODE must be a positive integer");
}
const releaseVersion = `v${releaseVersionCode}`;
const config: ExpoConfig = {
  name: "Евразия hd",
  slug: "evrasia-hd",
  version: releaseVersion,
  orientation: "portrait",
  scheme: "evrasiahd",
  userInterfaceStyle: "dark",
  newArchEnabled: true,
  icon: "./assets/icon.png",
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.evrasia.hd",
    icon: "./assets/icon.png",
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    edgeToEdgeEnabled: true,
    softwareKeyboardLayoutMode: "resize",
    predictiveBackGestureEnabled: false,
    package: "com.evrasia.hd",
    versionCode: releaseVersionCode,
    icon: "./assets/icon.png",
    adaptiveIcon: {
      foregroundImage: "./assets/icon.png",
      backgroundColor: "#081310",
    },
    permissions: [],
  },
  plugins: [
    "expo-secure-store",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#081310",
        image: "./assets/icon.png",
        imageWidth: 180,
        resizeMode: "contain",
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["arm64-v8a"],
          minSdkVersion: 24,
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          enableBundleCompression: true,
          useLegacyPackaging: true,
        },
      },
    ],
    "./plugins/with-sms-code",
  ],
  experiments: { reactCompiler: true },
};

export default config;
