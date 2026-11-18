import Constants from "expo-constants";

// Single place for the product name. Also update app.json (name/slug/scheme/package ids) when renaming.
export const APP_NAME = "Kizayu";

// Backend URL. In dev, the Expo dev server host is also the machine running the API, so a physical
// phone on the same Wi-Fi reaches it automatically. Override with EXPO_PUBLIC_API_URL for staging/prod.
const devHost = Constants.expoConfig?.hostUri?.split(":")[0];
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? `http://${devHost ?? "localhost"}:4000`;
