import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { Text } from "../../components/Text";
import { showAlert } from "../../alert";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../../api";
import { useAuth } from "../../auth";
import { Avatar, Button, Card, Empty, ErrorView, Field, Header, IconName, Loading, Screen, SectionHeader, fmtWhen, Pill } from "../../components/ui";
import { colors, radius } from "../../theme";
import type { HealthOverview, HealthRecord, Vital } from "../../types";

type Tab = "Overview" | "History" | "Reports";
const VITALS: Record<Vital["type"], { label: string; unit: string; icon: IconName; color: string; placeholder: string }> = {
  heart_rate: { label: "Heart Rate", unit: "bpm", icon: "heart", color: colors.danger, placeholder: "72" },
  bp: { label: "BP", unit: "mmHg", icon: "water", color: "#1E9BF0", placeholder: "120/80" },
  spo2: { label: "SpO₂", unit: "%", icon: "fitness", color: "#4F7DF3", placeholder: "98" },
};

function AddVital({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<Vital["type"]>("heart_rate");
  const [value, setValue] = useState("");
  const add = useMutation({
    mutationFn: () => post("/health/vitals", { type, value: value.trim(), unit: VITALS[type].unit }),
    onSuccess: () => { setValue(""); qc.invalidateQueries({ queryKey: ["health"] }); onClose(); },
    onError: e => showAlert("Couldn't save", e instanceof Error ? e.message : "Try again"),
  });
  const valid = type === "bp" ? /^\d{2,3}\/\d{2,3}$/.test(value.trim()) : /^\d{2,3}$/.test(value.trim());
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: colors.bg, padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
          <Text style={{ fontSize: 20, fontWeight: "800", marginBottom: 14 }}>Record a vital</Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
            {(Object.keys(VITALS) as Vital["type"][]).map(k => (
              <Pill key={k} label={VITALS[k].label} active={type === k} onPress={() => { setType(k); setValue(""); }} />
            ))}
          </View>
          <Field label={`Value (${VITALS[type].unit})`} value={value} onChangeText={setValue} placeholder={VITALS[type].placeholder} keyboardType={type === "bp" ? "numbers-and-punctuation" : "number-pad"} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button title="Cancel" variant="soft" onPress={onClose} style={{ flex: 1 }} />
            <Button title="Save" onPress={() => add.mutate()} loading={add.isPending} disabled={!valid} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function AddMedication({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("Daily • 8 AM");
  const add = useMutation({
    mutationFn: () => post("/health/medications", { name: name.trim(), schedule: schedule.trim() }),
    onSuccess: () => { setName(""); qc.invalidateQueries({ queryKey: ["health"] }); onClose(); },
    onError: e => showAlert("Couldn't save", e instanceof Error ? e.message : "Try again"),
  });
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: colors.bg, padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
          <Text style={{ fontSize: 20, fontWeight: "800", marginBottom: 14 }}>Add medication</Text>
          <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="Vitamin D" />
          <Field label="Schedule" value={schedule} onChangeText={setSchedule} autoCapitalize="sentences" />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button title="Cancel" variant="soft" onPress={onClose} style={{ flex: 1 }} />
            <Button title="Save" onPress={() => add.mutate()} loading={add.isPending} disabled={!name.trim() || !schedule.trim()} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function HealthVault() {
  const { user } = useAuth();
  const params = useLocalSearchParams<{ userId: string }>();
  const userId = params.userId === "me" ? user!.id : params.userId;
  const mine = userId === user?.id;
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("Overview");
  const [addingVital, setAddingVital] = useState(false);
  const [addingMed, setAddingMed] = useState(false);

  const overview = useQuery({ queryKey: ["health", userId], queryFn: () => get<HealthOverview>(`/health/${userId}`) });
  const history = useQuery({ queryKey: ["health", userId, "vitals"], enabled: tab === "History", queryFn: () => get<Vital[]>(`/health/${userId}/vitals`) });
  const records = useQuery({ queryKey: ["health", userId, "records"], enabled: tab === "Reports", queryFn: () => get<HealthRecord[]>(`/health/${userId}/records`) });
  const take = useMutation({
    mutationFn: (id: string) => post(`/health/medications/${id}/take`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["health"] }); qc.invalidateQueries({ queryKey: ["pulse"] }); },
    onError: e => showAlert("Couldn't update", e instanceof Error ? e.message : "Try again"),
  });

  const d = overview.data;
  return (
    <Screen>
      <Header title="Health Vault" back right={mine ? (
        <Pressable onPress={() => setAddingVital(true)} accessibilityLabel="Record a vital" hitSlop={10}><Ionicons name="add" size={28} color={colors.text} /></Pressable>
      ) : undefined} />
      {overview.isLoading ? <Loading /> : overview.error ? <ErrorView error={overview.error} onRetry={() => overview.refetch()} /> : d && (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 }}>
            <Avatar uri={d.user.avatarUrl} name={d.user.name} size={72} ring />
            <View>
              <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>{mine ? "You" : d.user.name}</Text>
              <Text style={{ color: colors.muted }}>{[d.user.age ? `Age ${d.user.age}` : null, d.user.gender].filter(Boolean).join(" • ")}</Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", backgroundColor: colors.card, borderRadius: radius.pill, padding: 4 }}>
            {(["Overview", "History", "Reports"] as Tab[]).map(t => (
              <Pressable key={t} onPress={() => setTab(t)} style={{ flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: radius.pill, backgroundColor: tab === t ? colors.primarySoft : "transparent" }}>
                <Text style={{ fontWeight: "700", color: tab === t ? colors.primary : colors.muted }}>{t}</Text>
              </Pressable>
            ))}
          </View>

          {tab === "Overview" && (
            <>
              <SectionHeader title="Vitals" />
              {d.vitals.length === 0 ? <Empty icon="pulse-outline" text={mine ? "No vitals yet. Tap + to record one." : "No vitals recorded."} /> : (
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {d.vitals.map(v => {
                    const m = VITALS[v.type];
                    return (
                      <Card key={v.id} style={{ flex: 1, alignItems: "center", paddingVertical: 14 }}>
                        <Ionicons name={m.icon} size={22} color={m.color} />
                        <Text style={{ fontSize: 22, fontWeight: "800", marginTop: 6, color: colors.text }}>{v.value}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>{v.unit}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>{m.label}</Text>
                      </Card>
                    );
                  })}
                </View>
              )}

              <SectionHeader title="Medications" action={mine ? "Add" : undefined} onAction={() => setAddingMed(true)} />
              {d.medications.length === 0 ? <Empty icon="medkit-outline" text="No medications." /> : d.medications.map(m => (
                <Card key={m.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 }}>
                  <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: "#E5ECFF", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="medkit" size={22} color="#4F7DF3" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", color: colors.text }}>{m.name}</Text>
                    <Text style={{ color: colors.muted }}>{m.schedule}</Text>
                  </View>
                  {m.taken ? <Ionicons name="checkmark-circle" size={30} color={colors.success} accessibilityLabel="Taken" /> :
                    mine ? <Button title="Take" onPress={() => take.mutate(m.id)} loading={take.isPending && take.variables === m.id} style={{ paddingVertical: 6, paddingHorizontal: 16, minHeight: 34 }} /> :
                    <Ionicons name="ellipse-outline" size={30} color={colors.muted} accessibilityLabel="Not taken yet" />}
                </Card>
              ))}

              {d.nextAppointment && (
                <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.primarySoft }}>
                  <Ionicons name="calendar" size={28} color={colors.primary} />
                  <View>
                    <Text style={{ fontWeight: "700", color: colors.text }}>Next Appointment</Text>
                    <Text style={{ color: colors.muted }}>{fmtWhen(d.nextAppointment.startsAt)}</Text>
                  </View>
                </Card>
              )}
              {mine && <Button title="Family Doctor" variant="soft" icon="medical" onPress={() => router.push("/doctor")} style={{ marginTop: 14 }} />}
            </>
          )}

          {tab === "History" && (
            <>
              <SectionHeader title="Vitals history" />
              {history.isLoading ? <Loading /> : (history.data?.length ?? 0) === 0 ? <Empty text="Nothing recorded yet." /> : history.data!.map(v => (
                <Card key={v.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <Ionicons name={VITALS[v.type].icon} size={22} color={VITALS[v.type].color} />
                  <Text style={{ flex: 1, fontWeight: "700", color: colors.text }}>{VITALS[v.type].label}: {v.value} {v.unit}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtWhen(v.recordedAt)}</Text>
                </Card>
              ))}
            </>
          )}

          {tab === "Reports" && (
            <>
              <SectionHeader title="Medical records" />
              {records.isLoading ? <Loading /> : (records.data?.length ?? 0) === 0 ? <Empty text="No records on file." /> : records.data!.map(r => (
                <Card key={r.id} style={{ marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "700", textTransform: "capitalize" }}>{r.type}</Text>
                  <Text style={{ fontWeight: "700", color: colors.text, marginTop: 2 }}>{r.title}</Text>
                  {r.notes ? <Text style={{ color: colors.muted, marginTop: 2 }}>{r.notes}</Text> : null}
                </Card>
              ))}
            </>
          )}
        </ScrollView>
      )}
      <AddVital visible={addingVital} onClose={() => setAddingVital(false)} />
      <AddMedication visible={addingMed} onClose={() => setAddingMed(false)} />
    </Screen>
  );
}
