import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, post } from "../api";
import { showAlert, showError } from "../alert";
import { haptic } from "../haptics";
import { useAuth } from "../auth";
import { quantSet, randomSeed, type QuantQuestion } from "../brain/gen";
import { Text } from "../components/Text";
import { ErrorView, Header, IconButton, Loading, Pill, Screen, type IconName } from "../components/ui";
import { colors, gradients, radius } from "../theme";
import type { BuddyMessage, BuddyMood, BuddyReply, BuddyState } from "../types";

const MOODS: { id: BuddyMood; label: string; icon: IconName; color: string }[] = [
  { id: "energetic", label: "Energetic", icon: "flash", color: "#F2A100" },
  { id: "chill", label: "Chill", icon: "leaf", color: "#18B26B" },
  { id: "stressed", label: "Stressed", icon: "thunderstorm", color: "#EF4565" },
  { id: "sleepy", label: "Sleepy", icon: "moon", color: "#6C63FF" },
];
const QUICK = ["Plan my day", "What's due?", "Motivate me", "Explain a topic"];

type Teaser = { key: string; at: number; q: QuantQuestion; picked: number | null };
type Item = { kind: "msg"; at: number; m: BuddyMessage } | { kind: "teaser"; at: number; t: Teaser };

/** The buddy's face: a glowing orb whose colour and icon follow the mood. */
function Orb({ mood, busy }: { mood: BuddyMood | null; busy: boolean }) {
  const m = MOODS.find(x => x.id === mood);
  const color = m?.color ?? colors.accent;
  return (
    <View style={{ alignItems: "center", marginBottom: 8 }}>
      <View style={{ width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center", shadowColor: color, shadowOpacity: 0.55, shadowRadius: 18, shadowOffset: { width: 0, height: 4 }, elevation: 8 }}>
        <LinearGradient colors={["#1A2430", "#05080C"]} style={{ position: "absolute", width: 76, height: 76, borderRadius: 38 }} />
        <View style={{ width: 62, height: 62, borderRadius: 31, borderWidth: 3, borderColor: color, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={busy ? "ellipsis-horizontal" : m ? m.icon : "happy"} size={30} color={color} />
        </View>
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8, fontWeight: "600" }}>{busy ? "Thinking..." : m ? `Feeling ${m.label.toLowerCase()}` : "How are you feeling?"}</Text>
    </View>
  );
}

function Bubble({ m }: { m: BuddyMessage }) {
  const mine = m.role === "user";
  const safety = m.source === "safety";
  return (
    <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "86%", marginBottom: 10 }}>
      <View style={{ borderRadius: radius.md, borderBottomRightRadius: mine ? 4 : radius.md, borderBottomLeftRadius: mine ? radius.md : 4, overflow: "hidden", backgroundColor: mine ? colors.ink : safety ? colors.dangerSoft : "#fff", borderWidth: mine ? 0 : 1, borderColor: safety ? colors.danger : colors.border, paddingHorizontal: 14, paddingVertical: 10 }}>
        <Text selectable style={{ color: mine ? "#fff" : colors.text, lineHeight: 21 }}>{m.text}</Text>
      </View>
    </View>
  );
}

function TeaserCard({ t, onPick }: { t: Teaser; onPick: (i: number) => void }) {
  const done = t.picked !== null;
  return (
    <View style={{ alignSelf: "flex-start", width: "92%", marginBottom: 12, backgroundColor: "#fff", borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name="bulb" size={16} color={colors.warn} /><Text style={{ fontWeight: "800", fontSize: 12, color: colors.muted }}>BRAIN TEASER</Text>
      </View>
      <Text style={{ fontWeight: "700", lineHeight: 21 }}>{t.q.text}</Text>
      {t.q.options.map((o, i) => {
        const right = done && i === t.q.answerIndex, wrong = done && t.picked === i && i !== t.q.answerIndex;
        return (
          <Pressable key={i} disabled={done} onPress={() => onPick(i)} accessibilityRole="button" accessibilityLabel={`Option ${o}`}
            style={{ borderRadius: radius.sm, borderWidth: 1.5, borderColor: right ? colors.success : wrong ? colors.danger : colors.border, backgroundColor: right ? colors.successSoft : wrong ? colors.dangerSoft : "#fff", paddingHorizontal: 12, paddingVertical: 10 }}>
            <Text style={{ fontWeight: "600" }}>{o}</Text>
          </Pressable>
        );
      })}
      {done && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: t.picked === t.q.answerIndex ? colors.success : colors.danger, fontWeight: "800" }}>{t.picked === t.q.answerIndex ? "Correct" : "Not quite"}</Text>
          <Text style={{ color: colors.muted, lineHeight: 20 }}>{t.q.explain}</Text>
          <Pressable onPress={() => router.push("/brain")} accessibilityRole="button"><Text style={{ color: colors.primary, fontWeight: "700" }}>Play the full Brain Gym</Text></Pressable>
        </View>
      )}
    </View>
  );
}

export default function Buddy() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [text, setText] = useState("");
  const [mood, setMood] = useState<BuddyMood | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [teasers, setTeasers] = useState<Teaser[]>([]);
  const chat = useQuery({ queryKey: ["buddy"], queryFn: () => get<BuddyState>("/buddy") });
  const first = (user?.name ?? "").split(" ")[0] || "there";

  const send = useMutation({
    mutationFn: (v: { text: string; mood: BuddyMood | null }) => post<BuddyReply>("/buddy/chat", { text: v.text, ...(v.mood ? { mood: v.mood } : {}) }),
    onSuccess: r => {
      haptic.tap();
      qc.setQueryData<BuddyState>(["buddy"], old => old && { ...old, used: r.used, limit: r.limit, messages: [...old.messages, r.user, r.buddy] });
    },
    onError: e => showError("Buddy couldn't reply", e),
    onSettled: () => setPending(null),
  });
  const clear = useMutation({
    mutationFn: () => del("/buddy"),
    onSuccess: () => { setTeasers([]); qc.invalidateQueries({ queryKey: ["buddy"] }); }, onError: e => showError("Couldn't clear the chat", e),
  });

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [
      ...(chat.data?.messages ?? []).map(m => ({ kind: "msg" as const, at: new Date(m.createdAt).getTime(), m })),
      ...teasers.map(t => ({ kind: "teaser" as const, at: t.at, t })),
    ];
    return list.sort((a, b) => a.at - b.at);
  }, [chat.data?.messages, teasers]);
  useEffect(() => { const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 80); return () => clearTimeout(t); }, [items.length, pending]);

  const left = chat.data ? Math.max(0, chat.data.limit - chat.data.used) : 99;
  const out = !!chat.data && left === 0;
  const go = (t: string) => {
    const body = t.trim();
    if (!body || send.isPending) return;
    setText(""); setPending(body);
    send.mutate({ text: body, mood });
  };
  const teaser = () => { haptic.select(); setTeasers(l => [...l, { key: String(Date.now()), at: Date.now(), q: quantSet(randomSeed(), 1)[0], picked: null }]); };
  const pick = (key: string, i: number) => setTeasers(l => l.map(t => {
    if (t.key !== key || t.picked !== null) return t;
    if (i === t.q.answerIndex) haptic.success(); else haptic.warning();
    return { ...t, picked: i };
  }));
  const confirmClear = () => showAlert("Clear this chat?", "Your conversation with the buddy will be deleted.", [{ text: "Cancel", style: "cancel" }, { text: "Clear", style: "destructive", onPress: () => clear.mutate() }]);

  return (
    <Screen>
      <Header title="Kizayu Buddy" subtitle="Study help, quizzes and cheering" back right={<IconButton icon="trash-outline" label="Clear chat" onPress={confirmClear} />} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {chat.isLoading ? <Loading rows={2} /> : chat.error ? <ErrorView error={chat.error} onRetry={() => chat.refetch()} /> : (
          <>
            <ScrollView ref={scroller} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12, maxWidth: 560, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled">
              <Orb mood={mood} busy={send.isPending} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12, justifyContent: "center", flexGrow: 1 }}>
                {MOODS.map(m => <Pill key={m.id} label={m.label} icon={m.icon} active={mood === m.id} onPress={() => setMood(mood === m.id ? null : m.id)} />)}
              </ScrollView>
              {chat.data?.mode === "scripted" && (
                <View style={{ flexDirection: "row", gap: 8, backgroundColor: colors.warnSoft, borderRadius: radius.sm, padding: 10, marginBottom: 12 }}>
                  <Ionicons name="information-circle" size={18} color="#8A5A00" />
                  <Text style={{ flex: 1, color: "#8A5A00", fontSize: 12, lineHeight: 17 }}>Simple mode: the buddy answers from your plan, deadlines and streak. Full AI replies switch on when a model is connected.</Text>
                </View>
              )}
              {items.length === 0 && !pending && (
                <View style={{ alignSelf: "flex-start", maxWidth: "86%", backgroundColor: "#fff", borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 }}>
                  <Text style={{ lineHeight: 21 }}>Hi {first}! I'm your study buddy. Tell me how you're feeling, ask me to plan your day, quiz you, or explain a topic.</Text>
                </View>
              )}
              {items.map(it => it.kind === "msg" ? <Bubble key={it.m.id} m={it.m} /> : <TeaserCard key={it.t.key} t={it.t} onPick={i => pick(it.t.key, i)} />)}
              {pending && <Bubble m={{ id: "pending", role: "user", text: pending, mood: null, source: null, createdAt: "" }} />}
              {send.isPending && <View style={{ alignSelf: "flex-start", backgroundColor: "#fff", borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 10 }}><Ionicons name="ellipsis-horizontal" size={22} color={colors.muted} /></View>}
            </ScrollView>

            <View style={{ paddingHorizontal: 16, paddingBottom: 12, paddingTop: 6, maxWidth: 560, width: "100%", alignSelf: "center", gap: 8 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
                {QUICK.map(q => <Pill key={q} label={q} onPress={() => (q === "Explain a topic" ? setText("Explain ") : go(q))} />)}
                <Pill label="Brain teaser" icon="bulb" onPress={teaser} />
              </ScrollView>
              {out ? (
                <Pressable onPress={() => router.push("/premium")} accessibilityRole="button" style={{ backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: 14 }}>
                  <Text style={{ fontWeight: "800", color: colors.primaryDark }}>You've used today's free messages</Text>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Premium gives you many more. Brain teasers stay free.</Text>
                </Pressable>
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <TextInput value={text} onChangeText={setText} placeholder="Message your buddy" placeholderTextColor={colors.faint} maxLength={500} onSubmitEditing={() => go(text)} returnKeyType="send" accessibilityLabel="Message your buddy"
                    style={{ flex: 1, minHeight: 48, borderRadius: radius.pill, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border, paddingHorizontal: 18, color: colors.text, fontSize: 15 }} />
                  <Pressable onPress={() => go(text)} disabled={!text.trim() || send.isPending} accessibilityRole="button" accessibilityLabel="Send"
                    style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: colors.ink, opacity: !text.trim() || send.isPending ? 0.4 : 1 }}>
                    <Ionicons name="arrow-up" size={22} color="#fff" />
                  </Pressable>
                </View>
              )}
              {!out && left <= 3 && <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center" }}>{left} message{left === 1 ? "" : "s"} left today</Text>}
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}
