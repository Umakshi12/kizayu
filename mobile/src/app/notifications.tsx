import { useEffect } from "react";
import { FlatList, Pressable, View } from "react-native";
import { Text } from "../components/Text";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { post } from "../api";
import { routeFor } from "../push";
import { useNotifications } from "../hooks";
import { Empty, ErrorView, Header, IconName, Loading, Screen, timeAgo } from "../components/ui";
import { colors, radius } from "../theme";
import type { AppNotification } from "../types";

const ICON: Record<string, { name: IconName; color: string; bg: string }> = {
  chat: { name: "chatbubbles", color: colors.primary, bg: colors.primarySoft },
  sos: { name: "alert-circle", color: colors.danger, bg: colors.dangerSoft },
  comment: { name: "chatbubble-ellipses", color: "#1E9BF0", bg: "#E1F2FD" },
  doctor: { name: "medical", color: colors.success, bg: colors.successSoft },
  home: { name: "home", color: colors.success, bg: colors.successSoft },
  system: { name: "sparkles", color: colors.warn, bg: colors.warnSoft },
};

export default function Notifications() {
  const qc = useQueryClient();
  const q = useNotifications();
  const markAll = useMutation({
    mutationFn: () => post("/notifications/read", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  // Opening the inbox marks everything as read (after it has been shown once).
  useEffect(() => { if (q.data?.unread) { const t = setTimeout(() => markAll.mutate(), 1500); return () => clearTimeout(t); } }, [q.data?.unread]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen>
      <Header title="Notifications" back />
      {q.isLoading ? <Loading /> : q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : (
        <FlatList
          data={q.data!.items} keyExtractor={n => n.id} contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshing={q.isRefetching} onRefresh={() => q.refetch()}
          ListEmptyComponent={<Empty icon="notifications-outline" text="You're all caught up." />}
          renderItem={({ item }) => {
            const ic = ICON[item.kind] ?? ICON.system;
            const to = routeFor(item.data);
            return (
              <Pressable onPress={() => to && to !== "/notifications" && router.push(to as never)}
                style={{ flexDirection: "row", gap: 12, alignItems: "center", padding: 14, borderRadius: radius.md, backgroundColor: item.readAt ? colors.card : colors.primarySoft }}>
                <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: ic.bg, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={ic.name} size={22} color={ic.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700", color: colors.text }}>{item.title}</Text>
                  <Text style={{ color: colors.text, marginTop: 2 }} numberOfLines={2}>{item.body}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{timeAgo(item.createdAt)}</Text>
                </View>
                {!item.readAt && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} accessibilityLabel="Unread" />}
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}
