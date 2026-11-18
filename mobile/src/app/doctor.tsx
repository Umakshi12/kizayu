import { useEffect, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, post, put } from "../api";
import { showAlert, showError } from "../alert";
import { useAuth } from "../auth";
import { haptic } from "../haptics";
import { Text } from "../components/Text";
import { Avatar, Button, Card, Empty, ErrorView, Field, Header, IconButton, IconName, IconTile, Loading, Pill, Screen, SectionHeader, fmtWhen } from "../components/ui";
import { colors, gradients, radius } from "../theme";
import type { Circle, Doctor, DoctorDetail } from "../types";

const RECORD_TILES: { type: string; label: string; icon: IconName }[] = [
  { type: "prescription", label: "Prescriptions", icon: "document-text" },
  { type: "lab", label: "Lab reports", icon: "flask" },
  { type: "history", label: "History", icon: "albums" },
  { type: "appointment", label: "Visits", icon: "calendar" },
];

function AddDoctorSheet({ visible, onClose, onAdded }: { visible: boolean; onClose: () => void; onAdded: (id: string) => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"email" | "manual">("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [phone, setPhone] = useState("");
  const add = useMutation({
    mutationFn: () => post<Doctor>("/doctors", mode === "email" ? { email: email.trim() } : { name: name.trim(), specialty: specialty.trim(), phone: phone.trim() || undefined }),
    onSuccess: d => { haptic.success(); qc.invalidateQueries({ queryKey: ["doctors"] }); setEmail(""); setName(""); setSpecialty(""); setPhone(""); onAdded(d.id); onClose(); },
    onError: e => showError("Couldn't add doctor", e),
  });
  const valid = mode === "email" ? /\S+@\S+\.\S+/.test(email) : name.trim().length >= 2 && specialty.trim().length >= 2;
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(10,13,18,0.55)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: colors.bg, padding: 20, borderTopLeftRadius: 30, borderTopRightRadius: 30 }}>
          <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: 14 }} />
          <Text style={{ fontSize: 22, fontWeight: "800" }}>Add your doctor</Text>
          <Text style={{ color: colors.muted, marginTop: 4, marginBottom: 16 }}>Only you and the relatives you choose will see your doctor.</Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
            <Pill label="Doctor on Kizayu" icon="link" active={mode === "email"} onPress={() => setMode("email")} />
            <Pill label="Add manually" icon="create" active={mode === "manual"} onPress={() => setMode("manual")} />
          </View>
          {mode === "email" ? (
            <Field label="Doctor's email" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="doctor@clinic.com"
              hint="If your doctor uses Kizayu, you'll be able to message them and share records." />
          ) : (
            <>
              <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="Dr. Full Name" />
              <Field label="Specialty" value={specialty} onChangeText={setSpecialty} autoCapitalize="words" placeholder="General Physician" />
              <Field label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+91 …" />
            </>
          )}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
            <Button title="Cancel" variant="soft" onPress={onClose} style={{ flex: 1 }} />
            <Button title="Add doctor" onPress={() => add.mutate()} loading={add.isPending} disabled={!valid} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function FamilyDoctor() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const doctors = useQuery({ queryKey: ["doctors"], queryFn: () => get<Doctor[]>("/doctors") });
  const circles = useQuery({ queryKey: ["circles"], queryFn: () => get<Circle[]>("/circles") });
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (doctors.data && (!doctorId || !doctors.data.some(d => d.id === doctorId))) setDoctorId(doctors.data[0]?.id ?? null);
  }, [doctors.data, doctorId]);

  const detail = useQuery({ queryKey: ["doctor", doctorId], enabled: !!doctorId, queryFn: () => get<DoctorDetail>(`/doctors/${doctorId}`) });
  const [sel, setSel] = useState<string[] | null>(null);
  useEffect(() => { if (detail.data) setSel(detail.data.sharedWith.map(u => u.id)); }, [detail.data]);

  const people = [...new Map((circles.data ?? []).flatMap(c => c.members).filter(m => m.id !== user?.id).map(m => [m.id, m])).values()];
  const dirty = detail.data && sel && [...sel].sort().join() !== detail.data.sharedWith.map(u => u.id).sort().join();

  const save = useMutation({
    mutationFn: () => put(`/doctors/${doctorId}/access`, { sharedWith: sel }),
    onSuccess: () => { haptic.success(); qc.invalidateQueries({ queryKey: ["doctor", doctorId] }); showAlert("Access updated"); },
    onError: e => showError("Couldn't update access", e),
  });
  const remove = useMutation({
    mutationFn: () => del(`/doctors/${doctorId}/access`),
    onSuccess: () => { setDoctorId(null); qc.invalidateQueries({ queryKey: ["doctors"] }); },
    onError: e => showError("Couldn't remove doctor", e),
  });

  const d = detail.data?.doctor;
  const counts = new Map((detail.data?.recordCounts ?? []).map(r => [r.type, r._count]));

  return (
    <Screen>
      <Header title="Family Doctor" back right={doctors.data?.length ? <IconButton icon="add" label="Add a doctor" tint={colors.primary} onPress={() => setAdding(true)} /> : undefined} />
      {doctors.isLoading ? <Loading /> : doctors.error ? <ErrorView error={doctors.error} onRetry={() => doctors.refetch()} /> :
        !doctors.data!.length ? (
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Card>
              <Empty icon="medical" title="Add your family doctor"
                text="Keep your doctor's details in one place. If they use Kizayu, you can message them and choose who in your family can see your records."
                actionLabel="Add a doctor" onAction={() => setAdding(true)} />
            </Card>
          </ScrollView>
        ) : detail.isLoading || !d ? <Loading /> : detail.error ? <ErrorView error={detail.error} onRetry={() => detail.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
          {doctors.data!.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
              {doctors.data!.map(x => <Pill key={x.id} label={x.name} active={x.id === doctorId} onPress={() => setDoctorId(x.id)} />)}
            </ScrollView>
          )}
          <Card style={{ padding: 18 }}>
            <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
              <Avatar uri={d.avatarUrl} name={d.name} size={72} ring />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 19, fontWeight: "800" }}>{d.name}</Text>
                <Text style={{ color: colors.muted, marginTop: 2 }}>{d.specialty}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: d.hasAccount ? colors.successSoft : colors.primaryTint }}>
                    <Ionicons name={d.hasAccount ? "checkmark-circle" : "person-circle-outline"} size={13} color={d.hasAccount ? colors.success : colors.muted} />
                    <Text style={{ fontSize: 11, fontWeight: "700", color: d.hasAccount ? colors.success : colors.muted }}>{d.hasAccount ? "On Kizayu" : "Contact card"}</Text>
                  </View>
                  {d.rating != null && <Text style={{ fontSize: 12, color: colors.muted }}>★ {d.rating} ({d.reviews})</Text>}
                </View>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <Button title="Message" icon="chatbubble-ellipses" disabled={!detail.data?.canMessage} onPress={() => router.push(`/doctor-chat/${d.id}`)} style={{ flex: 1 }} />
              <Button title="Call" icon="call" variant="soft" disabled={!d.phone} onPress={() => d.phone && Linking.openURL(`tel:${d.phone}`)} style={{ flex: 1 }} />
            </View>
            {!detail.data?.canMessage && <Text style={{ color: colors.faint, fontSize: 12, marginTop: 10, textAlign: "center" }}>Messaging works when your doctor joins Kizayu.</Text>}
          </Card>

          <SectionHeader title="Who can see your records" />
          <Card>
            <Text style={{ color: colors.muted, marginBottom: 12, lineHeight: 20 }}>Choose relatives who can view your records through this doctor.</Text>
            {people.length === 0 ? <Empty compact icon="people-outline" text="Invite family to your circle first." actionLabel="Invite family" onAction={() => router.push("/circles")} /> : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {people.map(p => {
                  const on = sel?.includes(p.id);
                  return (
                    <Pressable key={p.id} onPress={() => { haptic.select(); setSel(s => (s ?? []).includes(p.id) ? (s ?? []).filter(x => x !== p.id) : [...(s ?? []), p.id]); }}
                      style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, paddingLeft: 6, paddingRight: 12, borderRadius: radius.pill, backgroundColor: on ? colors.primarySoft : "#fff", borderWidth: 1.5, borderColor: on ? colors.primary : colors.border }}>
                      <Avatar uri={p.avatarUrl} name={p.name} size={28} />
                      <Text style={{ fontWeight: "600" }}>{p.name}</Text>
                      {on && <Ionicons name="checkmark-circle" size={18} color={colors.primary} />}
                    </Pressable>
                  );
                })}
              </View>
            )}
            {dirty && <Button title="Save access" onPress={() => save.mutate()} loading={save.isPending} style={{ marginTop: 14 }} />}
          </Card>

          <SectionHeader title="Your records" action="Open vault" onAction={() => router.push("/health/me")} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            {RECORD_TILES.map(t => (
              <Card key={t.type} onPress={() => router.push("/health/me")} style={{ flex: 1, alignItems: "center", paddingVertical: 14, paddingHorizontal: 6, gap: 8 }}>
                <IconTile icon={t.icon} gradient={gradients.primary} size={40} />
                <Text style={{ fontSize: 11, fontWeight: "700", textAlign: "center" }}>{t.label}</Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>{counts.get(t.type) ?? 0}</Text>
              </Card>
            ))}
          </View>

          {detail.data?.nextAppointment && (
            <>
              <SectionHeader title="Next appointment" />
              <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <IconTile icon="calendar" gradient={gradients.ocean} size={42} />
                <Text style={{ fontWeight: "700" }}>{fmtWhen(detail.data.nextAppointment.startsAt)}</Text>
              </Card>
            </>
          )}

          <Card style={{ flexDirection: "row", gap: 12, alignItems: "center", marginTop: 18, backgroundColor: colors.primaryTint }}>
            <Ionicons name="shield-checkmark" size={22} color={colors.primary} />
            <Text style={{ flex: 1, color: colors.text, lineHeight: 20 }}>Your doctor can only see information you choose to share.</Text>
          </Card>
          <Button title="Remove this doctor" variant="ghost" icon="trash-outline" style={{ marginTop: 16 }}
            onPress={() => showAlert("Remove doctor?", `${d.name} will be removed from your list and lose access to your records.`, [
              { text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => remove.mutate() },
            ])} />
        </ScrollView>
      )}
      <AddDoctorSheet visible={adding} onClose={() => setAdding(false)} onAdded={id => setDoctorId(id)} />
    </Screen>
  );
}
