import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { get } from "../../api";
import { Text } from "../Text";
import { Card, IconTile } from "../ui";
import { colors } from "../../theme";
import type { BrainStats } from "../../types";

/** Compact Brain Gym entry for other screens. Tap to open the hub. Renders nothing until stats load. */
export function BrainSummary() {
  const stats = useQuery({ queryKey: ["brain-stats"], queryFn: () => get<BrainStats>("/brain/stats") });
  const s = stats.data;
  if (!s) return null;
  return (
    <Card onPress={() => router.push("/brain")} style={{ marginBottom: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
      <IconTile icon="bulb" size={44} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "700", fontSize: 16 }}>Brain Gym · Level {s.level}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
          <Ionicons name="flame" size={14} color={s.streak ? colors.warn : colors.faint} />
          <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600" }}>
            {s.streak ? `${s.streak} day streak · ` : ""}{s.playedToday ? "Done for today" : "Play today's challenge"}
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.faint} />
    </Card>
  );
}
