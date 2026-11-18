import { View } from "react-native";
import { Text } from "./Text";
import { colors, radius } from "../theme";

/** Shown only when the backend is in dev mode with no SMS/email provider: displays the one-time code. */
export function DevCode({ code }: { code?: string }) {
  if (!code) return null;
  return (
    <View style={{ backgroundColor: colors.warnSoft, borderRadius: radius.md, padding: 12, marginBottom: 14 }}>
      <Text style={{ color: colors.text }}>
        <Text style={{ fontWeight: "800" }}>Dev mode:</Text> no SMS/email service is connected yet, so your code is{" "}
        <Text style={{ fontWeight: "800", letterSpacing: 2 }}>{code}</Text>
      </Text>
    </View>
  );
}
