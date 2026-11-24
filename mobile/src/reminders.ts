import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

// Daily reminders for medicines and timed tasks. They're scheduled on the phone itself, so they fire even when
// the app is closed and need no server. (Local notifications don't work in the browser preview.)

export type Reminder = { id: string; title: string; body: string; hour: number; minute: number };

const PREFIX = "kz-reminder-";

/** "8:30 PM", "8 pm", "20:15" or "08:30" → { hour, minute } (24h), or null if it isn't a clock time. */
export function parseClock(text: string | null | undefined): { hour: number; minute: number } | null {
  const m = (text ?? "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const mer = m[3]?.[0]?.toLowerCase();
  if (minute > 59) return null;
  if (mer) { if (hour < 1 || hour > 12) return null; hour = (hour % 12) + (mer === "p" ? 12 : 0); }
  else if (hour > 23) return null;
  return { hour, minute };
}

/** { hour, minute } → "08:30" (what the server stores). */
export const toHHMM = (t: { hour: number; minute: number }) => `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;

/** Makes the phone's scheduled reminders match `list` exactly (adds new ones, removes old ones). */
export async function syncReminders(list: Reminder[]): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted" && list.length) status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("reminders", { name: "Reminders", importance: Notifications.AndroidImportance.HIGH });
    }
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(existing.filter(n => n.identifier.startsWith(PREFIX)).map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
    for (const r of list) {
      await Notifications.scheduleNotificationAsync({
        identifier: PREFIX + r.id,
        content: { title: r.title, body: r.body, sound: "default", data: { screen: r.id.startsWith("med-") ? "health" : "my-day" } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: r.hour, minute: r.minute, channelId: "reminders" },
      });
    }
  } catch (e) {
    console.log("[reminders]", e instanceof Error ? e.message : e);
  }
}
