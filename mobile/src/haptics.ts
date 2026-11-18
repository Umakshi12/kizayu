import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

// Subtle tactile feedback on phones; silently does nothing on web.
const on = Platform.OS === "ios" || Platform.OS === "android";
export const haptic = {
  tap: () => { if (on) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); },
  select: () => { if (on) void Haptics.selectionAsync().catch(() => undefined); },
  success: () => { if (on) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined); },
  warning: () => { if (on) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined); },
};
