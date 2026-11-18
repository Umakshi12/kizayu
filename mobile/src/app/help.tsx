import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Text } from "../components/Text";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../api";
import { showAlert } from "../alert";
import { APP_NAME } from "../config";
import { Button, Card, Empty, Field, Header, Screen, SectionHeader, timeAgo } from "../components/ui";
import { colors, radius } from "../theme";
import type { SupportTicket } from "../types";

const FAQ: { q: string; a: string }[] = [
  { q: "How do I add my family?", a: "Go to Profile → My Circles and tap “Invite someone”. Share the invite code; they enter it under “Join a circle”." },
  { q: "Who can see my posts?", a: "Only members of the circle you share with. Pick the circle under “Share with” before posting." },
  { q: "Who can see my health records?", a: "People in your circles can view your Health Vault. A doctor sees your records only after you link them on the Family Doctor screen, and you choose which relatives can see them there." },
  { q: "How does location sharing work?", a: "Location is shared only when you tap “Start sharing”, only with the circle you choose, and it stops automatically after the time you pick. Tap “Stop” any time." },
  { q: "What happens when I press SOS?", a: "Everyone in your circles gets an urgent notification and a chat message with your location. You can turn SOS off under Safety Features." },
  { q: "I'm not getting notifications", a: "Check that notifications are allowed for Kizayu in your phone's settings, and that you're signed in. Battery-saver modes can delay them." },
  { q: "I forgot my password", a: "On the sign-in screen tap “Forgot password?”. We'll email you a 6-digit code. You can also sign in with your phone number." },
  { q: "What does Premium include?", a: "More circles, longer location sharing and unlimited health records. See Profile → Kizayu Premium. You can cancel anytime and keep Premium until the period ends." },
];

export default function Help() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<number | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const tickets = useQuery({ queryKey: ["tickets"], queryFn: () => get<SupportTicket[]>("/support/tickets") });
  const send = useMutation({
    mutationFn: () => post<SupportTicket>("/support/tickets", { subject: subject.trim(), message: message.trim() }),
    onSuccess: () => { setSubject(""); setMessage(""); qc.invalidateQueries({ queryKey: ["tickets"] }); showAlert("Message sent", "Thanks! Our team will get back to you soon."); },
    onError: e => showAlert("Couldn't send", e instanceof Error ? e.message : "Try again"),
  });

  return (
    <Screen>
      <Header title="Help & Support" back />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, maxWidth: 640, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled">
        <SectionHeader title="Frequently asked" />
        <Card style={{ paddingVertical: 0 }}>
          {FAQ.map((f, i) => (
            <View key={f.q} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
              <Pressable onPress={() => setOpen(open === i ? null : i)} accessibilityRole="button" accessibilityState={{ expanded: open === i }}
                style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14, gap: 10 }}>
                <Text style={{ flex: 1, fontWeight: "600", fontSize: 15, color: colors.text }}>{f.q}</Text>
                <Ionicons name={open === i ? "chevron-up" : "chevron-down"} size={20} color={colors.muted} />
              </Pressable>
              {open === i && <Text style={{ color: colors.muted, paddingBottom: 14, lineHeight: 20 }}>{f.a}</Text>}
            </View>
          ))}
        </Card>

        <SectionHeader title="Contact support" />
        <Field label="Subject" value={subject} onChangeText={setSubject} autoCapitalize="sentences" placeholder="What do you need help with?" maxLength={120} />
        <Field label="Message" value={message} onChangeText={setMessage} autoCapitalize="sentences" multiline placeholder={`Tell us what happened in ${APP_NAME}…`}
          style={{ minHeight: 110, textAlignVertical: "top" }} maxLength={4000} />
        <Button title="Send message" icon="send" onPress={() => send.mutate()} loading={send.isPending} disabled={subject.trim().length < 3 || message.trim().length < 10} />
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>At least 3 characters for the subject and 10 for the message.</Text>

        <SectionHeader title="Your requests" />
        {(tickets.data?.length ?? 0) === 0 ? <Empty icon="mail-open-outline" text="No support requests yet." /> : tickets.data!.map(t => (
          <Card key={t.id} style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ flex: 1, fontWeight: "700", color: colors.text }}>{t.subject}</Text>
              <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: t.status === "open" ? colors.warnSoft : colors.successSoft }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text, textTransform: "capitalize" }}>{t.status}</Text>
              </View>
            </View>
            <Text style={{ color: colors.muted, marginTop: 4 }} numberOfLines={2}>{t.message}</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{timeAgo(t.createdAt)}</Text>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
