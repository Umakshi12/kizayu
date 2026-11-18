import { Alert, Platform } from "react-native";
import { router } from "expo-router";
import { ApiError } from "./api";

type Btn = { text: string; style?: "cancel" | "destructive" | "default"; onPress?: () => void };

/** Alert.alert on iOS/Android; window.alert/confirm on web (React Native Web's Alert is a no-op). */
export function showAlert(title: string, message?: string, buttons?: Btn[]) {
  if (Platform.OS !== "web") { Alert.alert(title, message, buttons); return; }
  const text = message ? `${title}\n\n${message}` : title;
  if (!buttons || buttons.length <= 1) { window.alert(text); buttons?.[0]?.onPress?.(); return; }
  const actions = buttons.filter(b => b.style !== "cancel");
  if (window.confirm(text)) actions[actions.length - 1]?.onPress?.();
  else buttons.find(b => b.style === "cancel")?.onPress?.();
}

/** Show an API error. Premium-limit errors (402) offer a shortcut to the Premium screen. */
export function showError(title: string, e: unknown) {
  const msg = e instanceof Error ? e.message : "Something went wrong";
  if (e instanceof ApiError && e.status === 402) {
    showAlert(title, msg, [{ text: "Not now", style: "cancel" }, { text: "See Premium", onPress: () => router.push("/premium") }]);
    return;
  }
  showAlert(title, msg);
}
