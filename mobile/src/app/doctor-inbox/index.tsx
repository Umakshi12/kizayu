import { FlatList, Pressable, View } from "react-native";
import { Text } from "../../components/Text";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { get } from "../../api";
import { Avatar, Empty, ErrorView, Header, Loading, Screen, timeAgo } from "../../components/ui";
import { colors, radius } from "../../theme";
import type { DoctorThreadSummary } from "../../types";

// Doctor side: every patient conversation, newest first, with unread counts.
export default function DoctorInbox() {
  const q = useQuery({ queryKey: ["doctor-threads"], queryFn: () => get<DoctorThreadSummary[]>("/doctor-portal/threads"), refetchInterval: 30_000 });
  return (
    <Screen>
      <Header title="Patient messages" back />
      {q.isLoading ? <Loading /> : q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : (
        <FlatList
          data={q.data} keyExtractor={t => t.id} contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshing={q.isRefetching} onRefresh={() => q.refetch()}
          ListEmptyComponent={<Empty icon="mail-outline" text="No patient messages yet." />}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/doctor-inbox/${item.id}`)}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: radius.md, backgroundColor: item.unread ? colors.primarySoft : colors.card }}>
              <Avatar uri={item.patient.avatarUrl} name={item.patient.name} size={46} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700", color: colors.text }}>{item.patient.name}</Text>
                <Text style={{ color: colors.muted }} numberOfLines={1}>{item.last?.text ?? "No messages"}</Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 6 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{timeAgo(item.updatedAt)}</Text>
                {item.unread > 0 && (
                  <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }}>
                    <Text style={{ color: "#fff", fontSize: 12, fontWeight: "800" }}>{item.unread}</Text>
                  </View>
                )}
              </View>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
