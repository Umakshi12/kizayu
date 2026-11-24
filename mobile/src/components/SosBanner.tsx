import { Linking, Pressable, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { get } from "../api";
import { useAuth } from "../auth";
import { haptic } from "../haptics";
import { colors, radius } from "../theme";
import type { SosActive } from "../types";
import { Text } from "./Text";
import { timeAgo } from "./ui";

/** Red banner while someone in your circles has an SOS running (or you do). Tap to open the live page. */
export function SosBanner() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["sos-active"], enabled: !!user, refetchInterval: 15_000, queryFn: () => get<SosActive>("/sos/active") });
  const d = q.data;
  if (!d || (!d.mine && d.others.length === 0)) return null;
  return (
    <View style={{ paddingHorizontal: 16, gap: 10, marginBottom: 12 }}>
      {d.mine && (
        <Pressable onPress={() => { haptic.tap(); router.push("/sos"); }} accessibilityRole="button"
          style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: colors.danger }}>
          <Ionicons name="radio" size={24} color="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#fff", fontWeight: "800" }}>Your SOS is running</Text>
            <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 12 }}>Tap to open it, share the link or end it</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#fff" />
        </Pressable>
      )}
      {d.others.map(e => (
        <Pressable key={e.id} onPress={() => { haptic.tap(); void Linking.openURL(e.link); }} accessibilityRole="link"
          style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: colors.danger }}>
          <Ionicons name="alert-circle" size={26} color="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{e.user.name} needs help</Text>
            <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 12 }}>
              SOS started {timeAgo(e.startedAt)} · {e.clipCount} clip{e.clipCount === 1 ? "" : "s"} · tap for live location and video
            </Text>
          </View>
          <Ionicons name="open-outline" size={20} color="#fff" />
        </Pressable>
      ))}
    </View>
  );
}
