import { useState } from "react";
import { Linking, ScrollView, Switch, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, put } from "../api";
import { showAlert, showError } from "../alert";
import { haptic } from "../haptics";
import { Text } from "../components/Text";
import { Button, Card, Empty, GradientCard, Header, IconTile, Loading, Screen, SectionHeader } from "../components/ui";
import { ContactCard, ContactSheet } from "../components/Contacts";
import { colors, gradients } from "../theme";
import type { SafetySettings, SosContact } from "../types";

const MAX_CONTACTS = 5;

/** "SOS settings": who is alerted (the same contacts as the emergency card) and whether video and audio are recorded. */
export default function SosSettings() {
  const qc = useQueryClient();
  const contacts = useQuery({ queryKey: ["sos-contacts"], queryFn: () => get<SosContact[]>("/sos/contacts") });
  const settings = useQuery({ queryKey: ["safety"], queryFn: () => get<SafetySettings>("/safety") });
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<SosContact | null>(null);

  const update = useMutation({
    mutationFn: (b: Partial<SafetySettings>) => put<SafetySettings>("/safety", b),
    onSuccess: d => qc.setQueryData(["safety"], d),
    onError: e => showError("Couldn't save", e),
  });

  const toggleRecording = (on: boolean) => {
    if (!on) { update.mutate({ sosRecording: false }); return; }
    showAlert(
      "Record video and audio during an SOS?",
      "When you send an SOS, Kizayu will use your camera and microphone to record short clips and share them, with your location, with your emergency contacts and the people in your circles through a private link.\n\nIt only records during an SOS you start, while the app is open, and shows a clear \"recording\" indicator. Clips are deleted after 30 days.",
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Allow",
          onPress: () => {
            void (async () => {
              const c = camPerm?.granted ? camPerm : await requestCam();
              const m = micPerm?.granted ? micPerm : await requestMic();
              if (c.granted && m.granted) { haptic.success(); update.mutate({ sosRecording: true }); }
              else showAlert("Permission needed", "Allow camera and microphone for Kizayu in your phone's settings, then try again.", [
                { text: "Cancel", style: "cancel" }, { text: "Open settings", onPress: () => { void Linking.openSettings(); } },
              ]);
            })();
          },
        },
      ],
    );
  };

  const list = contacts.data ?? [];
  const open = (c: SosContact | null) => { setEditing(c); setSheetOpen(true); };

  return (
    <Screen>
      <Header title="SOS settings" subtitle="Who gets alerted, and what's recorded" back />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
        <GradientCard colors={gradients.danger}>
          <Text style={{ color: "#fff", fontSize: 19, fontWeight: "800" }}>If you send an SOS</Text>
          <Text style={{ color: "rgba(255,255,255,0.92)", marginTop: 6, lineHeight: 21 }}>
            Your circles get an urgent alert, and your emergency contacts get a text with a private link to your live location, video and audio. They don't need the app.
          </Text>
        </GradientCard>

        <SectionHeader title={`Emergency contacts (${list.length}/${MAX_CONTACTS})`} action={list.length < MAX_CONTACTS ? "Add" : undefined} onAction={() => open(null)} />
        {contacts.isLoading ? <Loading rows={1} /> : list.length === 0 ? (
          <Card><Empty compact icon="call-outline" title="No contacts yet" text="Add a parent, partner or friend. The same list appears on your emergency card." actionLabel="Add a contact" onAction={() => open(null)} /></Card>
        ) : list.map(c => <ContactCard key={c.id} c={c} onPress={() => open(c)} />)}

        <SectionHeader title="Recording" />
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <IconTile icon="videocam" gradient={gradients.danger} size={42} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "700", fontSize: 16 }}>Record video and audio</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, lineHeight: 17 }}>Short clips are shared live with your contacts during an SOS</Text>
            </View>
            <Switch value={!!settings.data?.sosRecording} onValueChange={toggleRecording} trackColor={{ true: colors.primary }} />
          </View>
        </Card>

        <Card style={{ marginTop: 14, backgroundColor: colors.primaryTint }}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
            <Ionicons name="information-circle" size={20} color={colors.primary} style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, color: colors.muted, lineHeight: 21, fontSize: 13 }}>
              You get a 5-second countdown to cancel an accidental SOS. Keep Kizayu open with the screen on: phones only record while the app is in front. Clips upload every 15 seconds and are deleted after 30 days.
            </Text>
          </View>
        </Card>
      </ScrollView>
      <ContactSheet visible={sheetOpen} contact={editing} onClose={() => setSheetOpen(false)} />
    </Screen>
  );
}
