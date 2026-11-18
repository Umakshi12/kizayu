import { useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Text, TextInput } from "../../components/Text";
import { showAlert, showError } from "../../alert";
import { del, get, post } from "../../api";
import { useAuth } from "../../auth";
import { haptic } from "../../haptics";
import { ActionSheet, ReportSheet, ReportTarget, SheetAction, confirmBlock } from "../../components/Sheets";
import { Avatar, Empty, ErrorView, Header, Loading, Screen, timeAgo } from "../../components/ui";
import { colors, radius, shadow } from "../../theme";
import type { Comment } from "../../types";

export default function PostComments() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [menuFor, setMenuFor] = useState<Comment | null>(null);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const q = useQuery({ queryKey: ["comments", id], queryFn: () => get<Comment[]>(`/posts/${id}/comments`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["comments", id] }); qc.invalidateQueries({ queryKey: ["feed"] }); };
  const send = useMutation({
    mutationFn: () => post(`/posts/${id}/comments`, { text: text.trim() }),
    onSuccess: () => { haptic.tap(); setText(""); refresh(); },
    onError: e => showError("Couldn't comment", e),
  });

  const actionsFor = (c: Comment): SheetAction[] => c.user.id === user?.id
    ? [{ label: "Delete comment", icon: "trash-outline", destructive: true, onPress: () => showAlert("Delete comment?", undefined, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => { del(`/comments/${c.id}`).then(refresh).catch(e => showError("Couldn't delete", e)); } },
      ]) }]
    : [
      { label: "Report comment", icon: "flag-outline", destructive: true, onPress: () => setReport({ type: "comment", id: c.id, label: "comment" }) },
      { label: `Block ${c.user.name.split(" ")[0]}`, icon: "ban-outline", destructive: true, onPress: () => confirmBlock(c.user.name, c.user.id, refresh) },
    ];

  return (
    <Screen>
      <Header title="Comments" back />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        {q.isLoading ? <Loading /> : q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : (
          <FlatList
            data={q.data} keyExtractor={c => c.id} contentContainerStyle={{ padding: 16, gap: 14 }}
            ListEmptyComponent={<Empty icon="chatbubble-outline" title="No comments yet" text="Say something nice!" />}
            renderItem={({ item }) => (
              <Pressable onLongPress={() => { haptic.tap(); setMenuFor(item); }} style={{ flexDirection: "row", gap: 10 }}>
                <Avatar uri={item.user.avatarUrl} name={item.user.name} size={38} />
                <View style={{ flex: 1, backgroundColor: "#fff", borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.hairline, ...shadow }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={{ fontWeight: "700", flex: 1 }}>{item.user.name} <Text style={{ color: colors.faint, fontSize: 12 }}>{timeAgo(item.createdAt)}</Text></Text>
                    <Pressable onPress={() => setMenuFor(item)} hitSlop={10} accessibilityLabel="Comment options">
                      <Ionicons name="ellipsis-horizontal" size={18} color={colors.faint} />
                    </Pressable>
                  </View>
                  <Text style={{ marginTop: 4, lineHeight: 21 }}>{item.text}</Text>
                </View>
              </Pressable>
            )}
          />
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: "#fff" }}>
          <TextInput value={text} onChangeText={setText} placeholder="Add a comment…" maxLength={500}
            style={{ flex: 1, backgroundColor: colors.primaryTint, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 11 }} />
          <Pressable onPress={() => send.mutate()} disabled={!text.trim() || send.isPending} accessibilityLabel="Send comment" hitSlop={8}>
            <Ionicons name="send" size={26} color={text.trim() ? colors.primary : colors.faint} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      <ActionSheet visible={!!menuFor} actions={menuFor ? actionsFor(menuFor) : []} onClose={() => setMenuFor(null)} />
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </Screen>
  );
}
