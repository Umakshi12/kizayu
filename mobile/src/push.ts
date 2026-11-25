import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { post } from "./api";

// Show notifications as banners even while the app is open.
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
  });
}

let registeredToken: string | null = null;

export type PushResult = { ok: true; token: string } | { ok: false; reason: string };

/**
 * Ask for permission, get this device's Expo push token and register it with the backend.
 * Needs a real device and an EAS project ID (app.json -> extra.eas.projectId, set by `eas init`).
 * Expo Go on Android can't receive remote pushes since SDK 53; use a development build.
 */
export async function registerForPush(): Promise<PushResult> {
  if (Platform.OS === "web") return { ok: false, reason: "Push notifications aren't available in the web preview." };
  if (!Device.isDevice) return { ok: false, reason: "Push notifications need a physical phone (not a simulator)." };

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "General", importance: Notifications.AndroidImportance.DEFAULT });
    await Notifications.setNotificationChannelAsync("urgent", {
      name: "SOS alerts", importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 400, 200, 400], sound: "default",
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return { ok: false, reason: "Notifications are turned off for Kizayu in your phone settings." };

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return { ok: false, reason: "This build has no EAS project ID yet. Run `npx eas-cli init` to enable push." };

  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await post("/push/register", { token, platform: Platform.OS });
    registeredToken = token;
    return { ok: true, token };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Couldn't register for push" };
  }
}

/** Called on sign-out so this phone stops getting the previous user's notifications. */
export async function unregisterPush() {
  if (!registeredToken) return;
  await post("/push/unregister", { token: registeredToken }).catch(() => undefined);
  registeredToken = null;
}

/** Where to go when a notification is tapped. */
export function routeFor(data: Record<string, unknown> | undefined): string | null {
  const d = (data ?? {}) as Record<string, string>;
  switch (d.screen) {
    case "chat": return d.circleId ? `/chat/${d.circleId}` : null;
    case "post": return d.postId ? `/post/${d.postId}` : null;
    case "safety": return "/safety";
    case "my-day": return "/my-day";
    case "/": return "/";
    case "/calendar": return "/calendar";
    case "/chores": return "/chores";
    case "/fitness": return "/fitness";
    case "/albums": return "/albums";
    case "/safety": return "/safety";
    case "/health": return "/health/me";
    case "sos": return "/"; // Home shows the SOS banner with the live link
    case "health": return "/health/me";
    case "doctor-chat": return d.doctorId ? `/doctor-chat/${d.doctorId}` : null;
    case "doctor-inbox": return d.threadId ? `/doctor-inbox/${d.threadId}` : "/doctor-inbox";
    default: return "/notifications";
  }
}
