import { Image } from "react-native";

/** The Kizayu mark. `tile` = the app icon (cyan on black, rounded); otherwise the bare cyan mark for dark backgrounds. */
export function Logo({ size = 72, tile }: { size?: number; tile?: boolean }) {
  return tile ? (
    <Image source={require("../../assets/icon.png")} style={{ width: size, height: size, borderRadius: size * 0.26 }} accessibilityLabel="Kizayu" />
  ) : (
    <Image source={require("../../assets/splash-icon.png")} style={{ width: size, height: size }} resizeMode="contain" accessibilityLabel="Kizayu" />
  );
}
