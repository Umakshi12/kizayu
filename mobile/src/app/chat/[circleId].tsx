import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Image, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Text, TextInput } from "../../components/Text";
import { showAlert, showError } from "../../alert";
import { haptic } from "../../haptics";
import { ActionSheet, ReportSheet, ReportTarget, SheetAction, confirmBlock } from "../../components/Sheets";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, post, mediaUrl } from "../../api";
import { getSocket } from "../../realtime";
import { useAuth } from "../../auth";
import { pickAndUpload } from "../../media";
import { Avatar, ErrorView, Header, Loading, Screen } from "../../components/ui";
import { colors, gradients, radius } from "../../theme";
import type { Circle, Message } from "../../types";

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const URL_RE = /(https?:\/\/\S+)/;

function Bubble({ m, mine, showName, onMenu }: { m: Message; mine: boolean; showName: boolean; onMenu: () => void }) {
  const parts = (m.text ?? "").split(URL_RE);
  return (
    <Pressable onLongPress={() => { haptic.tap(); onMenu(); }} delayLongPress={350} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%", marginBottom: 8, flexDirection: "row", gap: 8 }}>
      {!mine && <Avatar uri={m.user.avatarUrl} name={m.user.name} size={30} />}
      <View style={{ flexShrink: 1 }}>
        {!mine && showName && <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 2 }}>{m.user.name}</Text>}
        <View style={{ backgroundColor: mine ? "transparent" : "#fff", borderRadius: 20, borderBottomRightRadius: mine ? 6 : 20, borderBottomLeftRadius: mine ? 20 : 6, padding: 11, overflow: "hidden", borderWidth: mine ? 0 : 1, borderColor: colors.hairline }}>
          {mine && <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
          {m.imageUrl && <Image source={{ uri: mediaUrl(m.imageUrl) }} style={{ width: 220, height: 160, borderRadius: radius.sm, marginBottom: m.text ? 6 : 0 }} />}
          {m.text ? (
            <Text style={{ color: mine ? "#fff" : colors.text, fontSize: 16 }}>
              {parts.map((p, i) => URL_RE.test(p)
                ? <Text key={i} style={{ color: mine ? "#fff" : colors.primary, textDecorationLine: "underline" }} onPress={() => Linking.openURL(p)}>{p}</Text>
                : p)}
            </Text>
          ) : null}
          <Text style={{ fontSize: 11, color: mine ? "rgba(255,255,255,0.75)" : colors.faint, alignSelf: "flex-end", marginTop: 2 }}>{time(m.createdAt)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function Chat() {
  const { circleId } = useLocalSearchParams<{ circleId: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);
  const [menuFor, setMenuFor] = useState<Message | null>(null);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const blocks = useQuery({ queryKey: ["blocks"], queryFn: () => get<{ user: { id: string } }[]>("/blocks") });
  const blockedRef = useRef(new Set<string>());
  blockedRef.current = new Set((blocks.data ?? []).map(b => b.user.id));

  const circles = useQuery({ queryKey: ["circles"], queryFn: () => get<Circle[]>("/circles") });
  const circle = circles.data?.find(c => c.id === circleId);
  const history = useQuery({ queryKey: ["messages", circleId], queryFn: () => get<Message[]>(`/circles/${circleId}/messages`), gcTime: 0 });

  useEffect(() => { if (history.data) setMessages(history.data); }, [history.data]);

  // Realtime: new messages arrive over the socket; dedupe by id (we also receive our own).
  useEffect(() => {
    const socket = getSocket(); // shared app-wide connection
    if (!socket) return;
    const onMessage = (m: Message) => {
      if (m.circleId !== circleId || blockedRef.current.has(m.user.id)) return;
      setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m]);
      qc.invalidateQueries({ queryKey: ["pulse"] });
    };
    const onDeleted = (e: { id: string }) => setMessages(prev => prev.filter(x => x.id !== e.id));
    socket.on("message", onMessage);
    socket.on("messageDeleted", onDeleted);
    return () => { socket.off("message", onMessage); socket.off("messageDeleted", onDeleted); };
  }, [circleId, qc]);

  const send = useCallback(async (body: { text?: string; imageUrl?: string }) => {
    setSending(true);
    try {
      const m = await post<Message>(`/circles/${circleId}/messages`, body);
      setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m]);
    } catch (e) { showAlert("Couldn't send", e instanceof Error ? e.message : "Try again"); }
    finally { setSending(false); }
  }, [circleId]);

  const actionsFor = (m: Message): SheetAction[] => m.user.id === user?.id
    ? [{ label: "Delete message", icon: "trash-outline", destructive: true, onPress: () => {
        del(`/messages/${m.id}`).then(() => setMessages(prev => prev.filter(x => x.id !== m.id))).catch(e => showError("Couldn't delete", e));
      } }]
    : [
      { label: "Report message", icon: "flag-outline", destructive: true, onPress: () => setReport({ type: "message", id: m.id, label: "message" }) },
      { label: `Block ${m.user.name.split(" ")[0]}`, icon: "ban-outline", destructive: true, onPress: () => confirmBlock(m.user.name, m.user.id, () => {
        qc.invalidateQueries({ queryKey: ["blocks"] }); history.refetch();
      }) },
    ];

  const submit = () => { const t = text.trim(); if (!t) return; setText(""); void send({ text: t }); };
  const attach = async () => {
    try { const url = await pickAndUpload("camera"); if (url) await send({ imageUrl: url }); }
    catch (e) { showAlert("Upload failed", e instanceof Error ? e.message : "Try again"); }
  };

  return (
    <Screen>
      <Header title={circle?.name ?? "Chat"} back right={circle ? <Text style={{ color: colors.muted }}>{circle.members.length} members</Text> : undefined} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        {history.isLoading ? <Loading /> : history.error ? <ErrorView error={history.error} onRetry={() => history.refetch()} /> : (
          <FlatList
            ref={listRef} data={messages} keyExtractor={m => m.id} contentContainerStyle={{ padding: 16 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item, index }) => (
              <Bubble m={item} mine={item.user.id === user?.id} showName={index === 0 || messages[index - 1].user.id !== item.user.id} onMenu={() => setMenuFor(item)} />
            )}
          />
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Pressable onPress={attach} accessibilityLabel="Send a photo" hitSlop={8}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="camera" size={20} color="#fff" />
          </Pressable>
          <TextInput value={text} onChangeText={setText} placeholder="Type a message…" placeholderTextColor={colors.muted} onSubmitEditing={submit} returnKeyType="send" maxLength={2000}
            style={{ flex: 1, backgroundColor: colors.bg, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 10, fontSize: 16 }} />
          <Pressable onPress={submit} disabled={!text.trim() || sending} accessibilityLabel="Send message" hitSlop={8}>
            <Ionicons name="send" size={26} color={text.trim() ? colors.primary : colors.muted} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      <ActionSheet visible={!!menuFor} actions={menuFor ? actionsFor(menuFor) : []} onClose={() => setMenuFor(null)} />
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </Screen>
  );
}
