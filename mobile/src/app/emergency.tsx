import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, put } from "../api";
import { showError } from "../alert";
import { useAuth } from "../auth";
import { haptic } from "../haptics";
import { Text } from "../components/Text";
import { Avatar, Button, Card, Chip, Empty, ErrorView, Field, Header, IconTile, Loading, Screen, SectionHeader } from "../components/ui";
import { Backdrop } from "../components/Sheets";
import { ContactCard, ContactSheet } from "../components/Contacts";
import { colors, glow, gradients, radius } from "../theme";
import type { EmergencyInfo, FamilyEmergency, SosContact } from "../types";

const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const ALLERGY_IDEAS = ["Penicillin", "Peanuts", "Dust", "Pollen", "Latex", "Shellfish"];
const CONDITION_IDEAS = ["Asthma", "Diabetes", "High BP", "Heart condition", "Epilepsy", "Thyroid"];
const MAX_CONTACTS = 5;
const EMPTY: EmergencyInfo = { bloodGroup: "", allergies: "", conditions: "", notes: "", contacts: [], updatedAt: null };

const tags = (t: string) => t.split(",").map(x => x.trim()).filter(Boolean);
const withTag = (cur: string, tag: string) => (tags(cur).some(t => t.toLowerCase() === tag.toLowerCase()) ? cur : [...tags(cur), tag].join(", "));

// ---------------------------------------------------------------- hero: a "medical ID" with a completeness meter
function Hero({ name, avatar, info }: { name?: string; avatar?: string | null; info: EmergencyInfo }) {
  const steps = [
    { label: "your blood group", done: !!info.bloodGroup },
    { label: "allergies or conditions", done: !!(info.allergies || info.conditions) },
    { label: "an emergency contact", done: info.contacts.length > 0 },
  ];
  const next = steps.find(s => !s.done);
  return (
    <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.xl, padding: 18, ...glow }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Avatar uri={avatar} name={name} size={58} ring />
        <View style={{ flex: 1 }}>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 20 }} numberOfLines={1}>{name}</Text>
          <Text style={{ color: "rgba(255,255,255,0.75)", marginTop: 2 }}>Medical ID</Text>
        </View>
        <View style={{ width: 68, height: 68, borderRadius: 20, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "700", letterSpacing: 1 }}>BLOOD</Text>
          <Text style={{ color: info.bloodGroup ? colors.danger : colors.faint, fontSize: 26, fontWeight: "800", lineHeight: 30 }}>{info.bloodGroup || "·"}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 6, marginTop: 18 }}>
        {steps.map(s => <View key={s.label} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: s.done ? "#fff" : "rgba(255,255,255,0.25)" }} />)}
      </View>
      <Text style={{ color: "rgba(255,255,255,0.88)", marginTop: 10, fontSize: 13 }}>
        {next ? `Next: add ${next.label}` : "All set. Your card is complete."}
      </Text>
    </LinearGradient>
  );
}

// ---------------------------------------------------------------- medical details
function InfoRow({ icon, gradient, label, values, tone, empty, onAdd, last }: {
  icon: React.ComponentProps<typeof Ionicons>["name"]; gradient: readonly [string, string, ...string[]]; label: string;
  values: string[]; tone: "amber" | "primary"; empty: string; onAdd: () => void; last?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 12, paddingVertical: 14, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      <IconTile icon={icon} gradient={gradient} size={40} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600", marginBottom: 6 }}>{label}</Text>
        {values.length > 0
          ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{values.map(v => <Chip key={v} label={v} tone={tone} />)}</View>
          : <Pressable onPress={onAdd} hitSlop={6}><Text style={{ color: colors.primary, fontWeight: "600" }}>+ {empty}</Text></Pressable>}
      </View>
    </View>
  );
}

function MedicalCard({ info, onEdit }: { info: EmergencyInfo; onEdit: () => void }) {
  return (
    <Card style={{ paddingVertical: 0 }}>
      <InfoRow icon="alert-circle" gradient={gradients.sunrise} label="Allergies" values={tags(info.allergies)} tone="amber" empty="Add allergies" onAdd={onEdit} />
      <InfoRow icon="pulse" gradient={gradients.ocean} label="Medical conditions" values={tags(info.conditions)} tone="primary" empty="Add conditions" onAdd={onEdit} last={!info.notes} />
      {info.notes ? (
        <View style={{ flexDirection: "row", gap: 12, paddingVertical: 14 }}>
          <IconTile icon="document-text" gradient={gradients.success} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600", marginBottom: 4 }}>Notes for a helper</Text>
            <Text style={{ lineHeight: 21 }}>{info.notes}</Text>
          </View>
        </View>
      ) : null}
    </Card>
  );
}

function TagField({ label, value, onChange, ideas, placeholder }: { label: string; value: string; onChange: (v: string) => void; ideas: string[]; placeholder: string }) {
  const have = tags(value).map(t => t.toLowerCase());
  const left = ideas.filter(i => !have.includes(i.toLowerCase()));
  return (
    <View>
      <Field label={label} value={value} onChangeText={onChange} autoCapitalize="sentences" placeholder={placeholder} maxLength={300} />
      {left.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: -6, marginBottom: 16 }}>
          {left.map(i => <Chip key={i} label={`+ ${i}`} tone="ghost" onPress={() => onChange(withTag(value, i))} />)}
        </View>
      )}
    </View>
  );
}

function MedicalSheet({ info, visible, onClose }: { info: EmergencyInfo; visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [blood, setBlood] = useState("");
  const [allergies, setAllergies] = useState("");
  const [conditions, setConditions] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => { if (visible) { setBlood(info.bloodGroup); setAllergies(info.allergies); setConditions(info.conditions); setNotes(info.notes); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => put("/emergency/me", { bloodGroup: blood, allergies, conditions, notes }),
    onSuccess: () => { haptic.success(); qc.invalidateQueries({ queryKey: ["emergency"] }); onClose(); },
    onError: e => showError("Couldn't save", e),
  });
  return (
    <Backdrop visible={visible} onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: 580 }}>
        <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: 16 }}>Medical info</Text>
        <Text style={{ fontWeight: "600", fontSize: 13, marginBottom: 8 }}>Blood group</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
          {BLOOD.map(b => <View key={b} style={{ width: "23.2%" }}><Chip block label={b} tone={blood === b ? "danger" : "ghost"} onPress={() => setBlood(blood === b ? "" : b)} /></View>)}
        </View>
        <TagField label="Allergies" value={allergies} onChange={setAllergies} ideas={ALLERGY_IDEAS} placeholder="Separate with commas" />
        <TagField label="Medical conditions" value={conditions} onChange={setConditions} ideas={CONDITION_IDEAS} placeholder="Separate with commas" />
        <Field label="Notes for a helper" value={notes} onChangeText={setNotes} autoCapitalize="sentences" placeholder="Medicines you take, where your inhaler is…" multiline maxLength={500} style={{ minHeight: 84, textAlignVertical: "top" }} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button title="Cancel" variant="soft" onPress={onClose} style={{ flex: 1 }} />
          <Button title="Save" onPress={() => save.mutate()} loading={save.isPending} style={{ flex: 1.3 }} />
        </View>
      </ScrollView>
    </Backdrop>
  );
}

// ---------------------------------------------------------------- family cards (tap to expand)
function FamilyCard({ f }: { f: FamilyEmergency }) {
  const [open, setOpen] = useState(false);
  const { info } = f;
  const al = tags(info.allergies), co = tags(info.conditions);
  const bits = [info.contacts.length ? `${info.contacts.length} contact${info.contacts.length === 1 ? "" : "s"}` : "", al.length ? "allergies" : "", co.length ? "conditions" : ""].filter(Boolean);
  return (
    <Card style={{ marginBottom: 10, padding: 0, overflow: "hidden" }}>
      <Pressable onPress={() => { haptic.select(); setOpen(o => !o); }} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, opacity: pressed ? 0.85 : 1 })}>
        <Avatar uri={f.user.avatarUrl} name={f.user.name} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "700", fontSize: 16 }}>{f.user.name}</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>{bits.join(" · ") || "Card started"}</Text>
        </View>
        {info.bloodGroup ? <Chip label={info.bloodGroup} tone="danger" /> : null}
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={20} color={colors.faint} />
      </Pressable>
      {open && (
        <View style={{ paddingHorizontal: 14, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
          {al.length > 0 && <TagLine label="Allergies" values={al} tone="amber" />}
          {co.length > 0 && <TagLine label="Conditions" values={co} tone="primary" />}
          {info.notes ? <View style={{ paddingVertical: 10 }}><Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600", marginBottom: 3 }}>Notes</Text><Text style={{ lineHeight: 20 }}>{info.notes}</Text></View> : null}
          {info.contacts.length > 0 && (
            <View style={{ paddingTop: 12 }}>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600", marginBottom: 10 }}>Emergency contacts</Text>
              {info.contacts.map(c => <ContactCard key={c.id} c={c} compact />)}
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

function TagLine({ label, values, tone }: { label: string; values: string[]; tone: "amber" | "primary" }) {
  return (
    <View style={{ paddingVertical: 10 }}>
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600", marginBottom: 6 }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{values.map(v => <Chip key={v} label={v} tone={tone} />)}</View>
    </View>
  );
}

// ---------------------------------------------------------------- screen
export default function Emergency() {
  const { user } = useAuth();
  const me = useQuery({ queryKey: ["emergency", "me"], queryFn: () => get<EmergencyInfo>("/emergency/me") });
  const family = useQuery({ queryKey: ["emergency", "family"], queryFn: () => get<FamilyEmergency[]>("/emergency/family") });
  const [editingMedical, setEditingMedical] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [contact, setContact] = useState<SosContact | null>(null);
  const mine = me.data ?? EMPTY;
  const openContact = (c: SosContact | null) => { setContact(c); setContactOpen(true); };

  return (
    <Screen>
      <Header title="Emergency card" subtitle="Medical info your family can reach fast" back />
      {me.isLoading ? <Loading /> : me.error ? <ErrorView error={me.error} onRetry={() => me.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
          <Hero name={user?.name} avatar={user?.avatarUrl} info={mine} />

          <SectionHeader title="Medical info" action="Edit" onAction={() => setEditingMedical(true)} />
          <MedicalCard info={mine} onEdit={() => setEditingMedical(true)} />

          <SectionHeader title="Emergency contacts" action={mine.contacts.length < MAX_CONTACTS ? "Add" : undefined} onAction={() => openContact(null)} />
          {mine.contacts.length === 0 ? (
            <Card>
              <Empty compact icon="call-outline" title="Who should be called first?" text="Add family or friends. They're also texted a live link if you send an SOS."
                actionLabel="Add a contact" onAction={() => openContact(null)} />
            </Card>
          ) : (
            <>
              {mine.contacts.map(c => <ContactCard key={c.id} c={c} onPress={() => openContact(c)} />)}
              <Text style={{ color: colors.faint, fontSize: 12, marginLeft: 4 }}>Tap a contact to edit. They're texted automatically during an SOS.</Text>
            </>
          )}

          <Card onPress={() => router.push("/sos-contacts")} style={{ marginTop: 18, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <IconTile icon="alert-circle" gradient={gradients.danger} size={42} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "700" }}>SOS settings</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>Video and audio recording during an SOS</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.faint} />
          </Card>

          <SectionHeader title="Family cards" />
          {family.isLoading ? <Loading rows={1} /> : (family.data?.length ?? 0) === 0 ? (
            <Card><Empty compact icon="people-outline" title="No family cards yet" text="When people in your circles fill in their card, it appears here so you can reach it quickly." /></Card>
          ) : family.data!.map(f => <FamilyCard key={f.user.id} f={f} />)}

          <View style={{ flexDirection: "row", gap: 10, alignItems: "center", marginTop: 14, paddingHorizontal: 4 }}>
            <Ionicons name="lock-closed" size={16} color={colors.faint} />
            <Text style={{ flex: 1, color: colors.faint, fontSize: 12, lineHeight: 17 }}>Only people in your circles can see your card.</Text>
          </View>
        </ScrollView>
      )}
      <MedicalSheet info={mine} visible={editingMedical} onClose={() => setEditingMedical(false)} />
      <ContactSheet visible={contactOpen} contact={contact} onClose={() => setContactOpen(false)} />
    </Screen>
  );
}
