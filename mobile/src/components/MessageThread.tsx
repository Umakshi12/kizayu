import { useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, View } from "react-native";
import { Text, TextInput } from "./Text";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius } from "../theme";
import type { DoctorMessage } from "../types";
import { Avatar, Empty } from "./ui";

const time = (iso: string) => new Date(iso).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" });

/** Chat UI shared by the patient → doctor chat and the doctor's inbox. */
export function MessageThread({ messages, meId, onSend, sending, header, emptyText, disabled }: {
  messages: DoctorMessage[]; meId: string; onSend: (text: string) => Promise<void> | void; sending?: boolean;
  header?: React.ReactNode; emptyText: string; disabled?: string;
}) {
  const [text, setText] = useState("");
  const list = useRef<FlatList<DoctorMessage>>(null);
  const submit = async () => { const t = text.trim(); if (!t) return; setText(""); await onSend(t); };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <FlatList
        ref={list} data={messages} keyExtractor={m => m.id} contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
        ListHeaderComponent={header ? <View style={{ marginBottom: 6 }}>{header}</View> : undefined}
        ListEmptyComponent={<Empty icon="chatbubbles-outline" text={emptyText} />}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => {
          const mine = item.sender.id === meId;
          return (
            <View style={{ flexDirection: "row", gap: 8, alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%" }}>
              {!mine && <Avatar uri={item.sender.avatarUrl} name={item.sender.name} size={30} />}
              <View style={{ backgroundColor: mine ? colors.primarySoft : colors.card, borderRadius: radius.md, padding: 10, flexShrink: 1 }}>
                <Text style={{ color: colors.text, fontSize: 16 }}>{item.text}</Text>
                <Text style={{ fontSize: 11, color: colors.muted, alignSelf: "flex-end", marginTop: 2 }}>{time(item.createdAt)}</Text>
              </View>
            </View>
          );
        }}
      />
      {disabled ? (
        <Text style={{ textAlign: "center", color: colors.muted, padding: 16, backgroundColor: colors.card }}>{disabled}</Text>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border }}>
          <TextInput value={text} onChangeText={setText} placeholder="Type a message…" placeholderTextColor={colors.muted} onSubmitEditing={submit} returnKeyType="send" maxLength={2000}
            style={{ flex: 1, backgroundColor: colors.bg, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 10, fontSize: 16 }} />
          <Pressable onPress={submit} disabled={!text.trim() || sending} accessibilityLabel="Send message" hitSlop={8}>
            <Ionicons name="send" size={26} color={text.trim() ? colors.primary : colors.muted} />
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
