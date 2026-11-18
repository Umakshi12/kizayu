import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// Keychain / Keystore on devices. On web (for previewing), localStorage. Never throws.
export const secure = {
  async get(key: string): Promise<string | null> {
    try { return Platform.OS === "web" ? globalThis.localStorage?.getItem(key) ?? null : await SecureStore.getItemAsync(key); }
    catch { return null; }
  },
  async set(key: string, value: string) {
    try { if (Platform.OS === "web") globalThis.localStorage?.setItem(key, value); else await SecureStore.setItemAsync(key, value); }
    catch { /* ignore */ }
  },
  async del(key: string) {
    try { if (Platform.OS === "web") globalThis.localStorage?.removeItem(key); else await SecureStore.deleteItemAsync(key); }
    catch { /* ignore */ }
  },
};
