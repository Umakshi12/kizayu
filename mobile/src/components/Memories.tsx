import { Image, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { get, mediaUrl } from "../api";
import { colors, radius } from "../theme";
import type { Memory } from "../types";
import { Text } from "./Text";

/** "On this day": photos and posts from earlier years. */
export function MemoriesStrip({ items }: { items: Memory[] }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Ionicons name="time" size={18} color="#E0559A" />
        <Text style={{ fontWeight: "800", fontSize: 16 }}>On this day</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {items.map(m => (
          <View key={m.kind + m.id} style={{ width: 150 }}>
            <Image source={{ uri: mediaUrl(m.url) }} style={{ width: 150, height: 150, borderRadius: radius.md, backgroundColor: colors.border }} />
            <Text style={{ fontWeight: "700", marginTop: 6, fontSize: 13 }}>{m.yearsAgo} year{m.yearsAgo === 1 ? "" : "s"} ago</Text>
            {!!(m.text || m.by) && <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{m.text || m.by}</Text>}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/** Home screen card: shows nothing at all unless there are real memories for today. */
export function HomeMemories() {
  const q = useQuery({ queryKey: ["memories"], queryFn: () => get<Memory[]>("/memories/today"), staleTime: 10 * 60_000 });
  if (!q.data?.length) return null;
  return <View style={{ paddingHorizontal: 16, marginTop: 6 }}><MemoriesStrip items={q.data} /></View>;
}
