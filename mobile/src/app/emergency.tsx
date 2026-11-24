import { useEffect, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, put } from "../api";
import { showError } from "../alert";
import { useAuth } from "../auth";
import { haptic } from "../haptics";
import { Text } from "../components/Text";
import { Avatar, Button, Card, Empty, ErrorView, Field, GradientCard, Header, IconTile, Loading, Pill, Screen, SectionHeader } from "../components/ui";
import { colors, gradients, radius } from "../theme";
import type { EmergencyInfo, FamilyEmergency } from "../types";

const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const EMPTY: EmergencyInfo = { bloodGroup: "", allergies: "", conditions: "", contactName: "", contactPhone: "", notes: "", updatedAt: null };
const isEmpty = (i: EmergencyInfo) => !(i.bloodGroup || i.allergies || i.conditions || i.contactName || i.contactPhone || i.notes);
const call = (phone: string) => Linking.openURL(`tel:${phone.replace(/[^+\d]/g, "")}`);

function Fact({ icon, label, value, tint }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; value: string; tint?: string }) {
  if (!value) return null;
  return (
    <View style={{ flexDirection: "row", gap: 12, paddingVertical: 8 }}>
      <Ionicons name={icon} size={20} color={tint ?? colors.primary} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600" }}>{label}</Text>
        <Text style={{ fontWeight: "600", marginTop: 1, lineHeight: 21 }}>{value}</Text>
      </View>
    </View>
  );
}

function CardBody({ info }: { info: EmergencyInfo }) {
  return (
    <>
      <Fact icon="water" label="Blood group" value={info.bloodGroup} tint={colors.danger} />
      <Fact icon="alert-circle" label="Allergies" value={info.allergies} tint={colors.warn} />
      <Fact icon="medkit" label="Medical conditions" value={info.conditions} />
      <Fact icon="document-text" label="Notes" value={info.notes} />
      {(info.contactName || info.contactPhone) && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.primaryTint }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600" }}>Emergency contact</Text>
            <Text style={{ fontWeight: "700", marginTop: 1 }}>{info.contactName || info.contactPhone}</Text>
            {info.contactName && info.contactPhone ? <Text style={{ color: colors.muted, fontSize: 13 }}>{info.contactPhone}</Text> : null}
          </View>
          {info.contactPhone ? <Button title="Call" icon="call" size="sm" onPress={() => call(info.contactPhone)} /> : null}
        </View>
      )}
    </>
  );
}

function EditSheet({ initial, visible, onClose }: { initial: EmergencyInfo; visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<EmergencyInfo>(initial);
  useEffect(() => { if (visible) setF(initial); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof EmergencyInfo) => (v: string) => setF(p => ({ ...p, [k]: v }));
  const save = useMutation({
    mutationFn: () => put<EmergencyInfo>("/emergency/me", { bloodGroup: f.bloodGroup, allergies: f.allergies, conditions: f.conditions, contactName: f.contactName, contactPhone: f.contactPhone, notes: f.notes }),
    onSuccess: () => { haptic.success(); qc.invalidateQueries({ queryKey: ["emergency"] }); onClose(); },
    onError: e => showError("Couldn't save", e),
  });
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: colors.bg, maxHeight: "92%", borderTopLeftRadius: 30, borderTopRightRadius: 30 }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
            <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: 14 }} />
            <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: 14 }}>Your emergency card</Text>
            <Text style={{ fontWeight: "600", fontSize: 13, marginBottom: 8 }}>Blood group</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              {BLOOD.map(b => <Pill key={b} label={b} active={f.bloodGroup === b} onPress={() => setF(p => ({ ...p, bloodGroup: p.bloodGroup === b ? "" : b }))} />)}
            </View>
            <Field label="Allergies" value={f.allergies} onChangeText={set("allergies")} autoCapitalize="sentences" placeholder="Penicillin, peanuts" maxLength={300} />
            <Field label="Medical conditions" value={f.conditions} onChangeText={set("conditions")} autoCapitalize="sentences" placeholder="Asthma, diabetes" maxLength={300} />
            <Field label="Emergency contact name" value={f.contactName} onChangeText={set("contactName")} autoCapitalize="words" placeholder="Who should be called?" maxLength={80} />
            <Field label="Emergency contact phone" value={f.contactPhone} onChangeText={set("contactPhone")} keyboardType="phone-pad" placeholder="+91 98765 43210" maxLength={20} />
            <Field label="Notes" value={f.notes} onChangeText={set("notes")} autoCapitalize="sentences" placeholder="Anything a helper should know" multiline maxLength={500} style={{ minHeight: 80, textAlignVertical: "top" }} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button title="Cancel" variant="soft" onPress={onClose} style={{ flex: 1 }} />
              <Button title="Save" onPress={() => save.mutate()} loading={save.isPending} style={{ flex: 1 }} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function Emergency() {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const me = useQuery({ queryKey: ["emergency", "me"], queryFn: () => get<EmergencyInfo>("/emergency/me") });
  const family = useQuery({ queryKey: ["emergency", "family"], queryFn: () => get<FamilyEmergency[]>("/emergency/family") });
  const mine = me.data ?? EMPTY;

  return (
    <Screen>
      <Header title="Emergency card" subtitle="Medical info your family can reach fast" back />
      {me.isLoading ? <Loading /> : me.error ? <ErrorView error={me.error} onRetry={() => me.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
          <GradientCard colors={gradients.danger}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <Avatar uri={user?.avatarUrl} name={user?.name} size={54} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 19 }}>{user?.name}</Text>
                <Text style={{ color: "rgba(255,255,255,0.85)", marginTop: 2 }}>{isEmpty(mine) ? "Not filled in yet" : mine.bloodGroup ? `Blood group ${mine.bloodGroup}` : "Medical ID"}</Text>
              </View>
              <Button title={isEmpty(mine) ? "Fill in" : "Edit"} icon="create" size="sm" variant="light" onPress={() => setEditing(true)} />
            </View>
          </GradientCard>

          {!isEmpty(mine) && <Card style={{ marginTop: 14 }}><CardBody info={mine} /></Card>}
          <Card style={{ flexDirection: "row", gap: 12, alignItems: "center", marginTop: 14, backgroundColor: colors.primaryTint }}>
            <Ionicons name="lock-closed" size={20} color={colors.primary} />
            <Text style={{ flex: 1, color: colors.muted, lineHeight: 20, fontSize: 13 }}>Only people in your circles can see your card. Keep it up to date; it could help in a real emergency.</Text>
          </Card>

          <SectionHeader title="Family cards" />
          {family.isLoading ? <Loading rows={1} /> : (family.data?.length ?? 0) === 0 ? (
            <Card><Empty compact icon="people-outline" title="No family cards yet" text="When people in your circles fill in their emergency card, it shows up here so you can reach it quickly." /></Card>
          ) : family.data!.map(f => (
            <Card key={f.user.id} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 6 }}>
                <Avatar uri={f.user.avatarUrl} name={f.user.name} size={44} />
                <Text style={{ flex: 1, fontWeight: "800", fontSize: 16 }}>{f.user.name}</Text>
                {f.info.bloodGroup ? (
                  <View style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.dangerSoft }}>
                    <Text style={{ color: colors.danger, fontWeight: "800" }}>{f.info.bloodGroup}</Text>
                  </View>
                ) : null}
              </View>
              <CardBody info={{ ...f.info, bloodGroup: "" }} />
            </Card>
          ))}
        </ScrollView>
      )}
      <EditSheet initial={mine} visible={editing} onClose={() => setEditing(false)} />
    </Screen>
  );
}
