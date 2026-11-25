import { Switch, ScrollView, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, put } from "../api";
import { showError } from "../alert";
import { haptic } from "../haptics";
import { Text } from "../components/Text";
import { Card, ErrorView, Header, IconName, IconTile, Loading, Screen } from "../components/ui";
import { colors } from "../theme";
import type { NotifyPrefs } from "../types";

const ROWS: { key: keyof NotifyPrefs; title: string; sub: string; icon: IconName }[] = [
  { key: "chat", title: "Chat messages", sub: "New messages from your circles", icon: "chatbubbles" },
  { key: "comments", title: "Comments, likes and photos", sub: "Activity on your posts and new album photos", icon: "chatbubble-ellipses" },
  { key: "events", title: "Calendar", sub: "New events, RSVPs and reminders", icon: "calendar" },
  { key: "care", title: "Family care", sub: "Missed medicines and arrivals", icon: "heart" },
  { key: "fitness", title: "Fitness", sub: "Challenges and who passed you", icon: "walk" },
  { key: "chores", title: "Chores and rewards", sub: "Approvals, points and rewards", icon: "checkbox" },
  { key: "study", title: "Study and brain streak", sub: "Assignments due and streak reminders", icon: "school" },
  { key: "nudges", title: "Gentle nudges", sub: "Evening reminder and On this day memories", icon: "sparkles" },
];

export default function NotificationSettings() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["notify-prefs"], queryFn: () => get<NotifyPrefs>("/prefs/notifications") });
  const save = useMutation({
    mutationFn: (v: Partial<NotifyPrefs>) => put<NotifyPrefs>("/prefs/notifications", v),
    onMutate: async v => { qc.setQueryData<NotifyPrefs>(["notify-prefs"], old => old && { ...old, ...v }); },
    onSuccess: p => qc.setQueryData(["notify-prefs"], p),
    onError: e => { showError("Couldn't save", e); qc.invalidateQueries({ queryKey: ["notify-prefs"] }); },
  });
  return (
    <Screen>
      <Header title="Notifications" subtitle="Choose what reaches you" back />
      {prefs.isLoading ? <Loading /> : prefs.error ? <ErrorView error={prefs.error} onRetry={() => prefs.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
          <Card style={{ paddingVertical: 4 }}>
            {ROWS.map((r, i) => (
              <View key={r.key} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                <IconTile icon={r.icon} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700", fontSize: 15 }}>{r.title}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>{r.sub}</Text>
                </View>
                <Switch value={prefs.data![r.key]} onValueChange={v => { haptic.select(); save.mutate({ [r.key]: v }); }}
                  trackColor={{ true: colors.primary, false: colors.border }} accessibilityLabel={r.title} />
              </View>
            ))}
          </Card>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 14, lineHeight: 18 }}>
            SOS alerts, safe-walk alerts and messages from your doctor always come through, because they are about safety.
          </Text>
        </ScrollView>
      )}
    </Screen>
  );
}
