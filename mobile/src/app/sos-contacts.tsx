import { useState } from "react";
import { Linking, ScrollView, Switch, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, post, put } from "../api";
import { showAlert, showError } from "../alert";
import { haptic } from "../haptics";
import { Text } from "../components/Text";
import { Button, Card, Empty, Field, GradientCard, Header, IconTile, Loading, Screen, SectionHeader } from "../components/ui";
import { colors, gradients } from "../theme";
import type { SafetySettings, SosContact } from "../types";

export default function SosContacts() {
  const qc = useQueryClient();
  const contacts = useQuery({ queryKey: ["sos-contacts"], queryFn: () => get<SosContact[]>("/sos/contacts") });
  const settings = useQuery({ queryKey: ["safety"], queryFn: () => get<SafetySettings>("/safety") });
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+91 ");

  const add = useMutation({
    mutationFn: () => post<SosContact>("/sos/contacts", { name: name.trim(), phone: phone.trim() }),
    onSuccess: () => { haptic.success(); setName(""); setPhone("+91 "); qc.invalidateQueries({ queryKey: ["sos-contacts"] }); },
    onError: e => showError("Couldn't add contact", e),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/sos/contacts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sos-contacts"] }),
    onError: e => showError("Couldn't remove contact", e),
  });
  const update = useMutation({
    mutationFn: (b: Partial<SafetySettings>) => put<SafetySettings>("/safety", b),
    onSuccess: d => qc.setQueryData(["safety"], d),
    onError: e => showError("Couldn't save", e),
  });

  const toggleRecording = (on: boolean) => {
    if (!on) { update.mutate({ sosRecording: false }); return; }
    showAlert(
      "Record video and audio during an SOS?",
      "When you send an SOS, Kizayu will use your camera and microphone to record short clips and share them, with your location, with your SOS contacts and the people in your circles through a private link.\n\nIt only records during an SOS you start, while the app is open, and shows a clear \"recording\" indicator. Clips are deleted after 30 days.",
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

  const valid = name.trim().length > 0 && /^\+[1-9]\d{7,14}$/.test(phone.replace(/[\s().-]/g, ""));
  const full = (contacts.data?.length ?? 0) >= 5;

  return (
    <Screen>
      <Header title="SOS contacts" subtitle="Who to alert in an emergency" back />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled">
        <GradientCard colors={gradients.danger}>
          <Text style={{ color: "#fff", fontSize: 19, fontWeight: "800" }}>Add people who should know</Text>
          <Text style={{ color: "rgba(255,255,255,0.9)", marginTop: 6, lineHeight: 21 }}>
            In an SOS, these numbers get a message with a private link to your live location, video and audio. They don't need the app. People in your circles are alerted in the app too.
          </Text>
        </GradientCard>

        <SectionHeader title={`Your SOS contacts (${contacts.data?.length ?? 0}/5)`} />
        <Card style={{ paddingVertical: 6 }}>
          {contacts.isLoading ? <Loading rows={1} /> : (contacts.data?.length ?? 0) === 0 ? (
            <Empty compact icon="call-outline" title="No contacts yet" text="Add a parent, partner or friend below." />
          ) : contacts.data!.map((c, i) => (
            <View key={c.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
              <IconTile icon="person" gradient={gradients.danger} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700" }}>{c.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>{c.phone}</Text>
              </View>
              <Button title="Remove" size="sm" variant="soft" onPress={() => remove.mutate(c.id)} loading={remove.isPending && remove.variables === c.id} />
            </View>
          ))}
        </Card>

        {!full && (
          <>
            <SectionHeader title="Add a contact" />
            <Card>
              <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="Mom" maxLength={60} />
              <Field label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+91 98765 43210" maxLength={24} hint="Include the country code, like +91" />
              <Button title="Add contact" icon="person-add" onPress={() => add.mutate()} loading={add.isPending} disabled={!valid} />
            </Card>
          </>
        )}

        <SectionHeader title="Recording" />
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Ionicons name="videocam" size={26} color={colors.danger} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "700", fontSize: 16 }}>Record video and audio</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, lineHeight: 17 }}>During an SOS, record short clips and share them live with your contacts</Text>
            </View>
            <Switch value={!!settings.data?.sosRecording} onValueChange={toggleRecording} trackColor={{ true: colors.primary }} />
          </View>
        </Card>

        <Card style={{ marginTop: 14, backgroundColor: colors.primaryTint }}>
          <Text style={{ fontWeight: "700", marginBottom: 6 }}>Good to know</Text>
          <Text style={{ color: colors.muted, lineHeight: 21, fontSize: 13 }}>
            • You get a 5-second countdown to cancel an accidental SOS.{"\n"}
            • Keep Kizayu open with the screen on: phones only record while the app is in front.{"\n"}
            • Clips upload every 15 seconds, so contacts see them shortly after they happen.{"\n"}
            • Recordings are deleted after 30 days.
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}
