import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { Text } from "../../components/Text";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../../api";
import { showAlert } from "../../alert";
import { useAuth } from "../../auth";
import { Card, Empty, ErrorView, Header, Loading, Screen, SectionHeader, fmtWhen } from "../../components/ui";
import { MessageThread } from "../../components/MessageThread";
import { colors } from "../../theme";
import type { DoctorThreadDetail, PatientHealth } from "../../types";

const VITAL_LABEL: Record<string, string> = { heart_rate: "Heart rate", bp: "Blood pressure", spo2: "SpO₂" };

function PatientRecords({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["patient-health", patientId], queryFn: () => get<PatientHealth>(`/doctor-portal/patients/${patientId}/health`) });
  return (
    <Screen>
      <Header title={q.data ? `${q.data.user.name}'s records` : "Shared records"}
        right={<Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close"><Ionicons name="close" size={28} color={colors.text} /></Pressable>} />
      {q.isLoading ? <Loading /> : q.error ? <ErrorView error={q.error} /> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Text style={{ color: colors.muted }}>{[q.data!.user.age ? `Age ${q.data!.user.age}` : null, q.data!.user.gender].filter(Boolean).join(" • ")}</Text>
          <SectionHeader title="Recent vitals" />
          {q.data!.vitals.length === 0 ? <Empty text="No vitals recorded." /> : q.data!.vitals.slice(0, 10).map(v => (
            <Card key={v.id} style={{ flexDirection: "row", marginBottom: 6 }}>
              <Text style={{ flex: 1, fontWeight: "700", color: colors.text }}>{VITAL_LABEL[v.type] ?? v.type}: {v.value} {v.unit}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtWhen(v.recordedAt)}</Text>
            </Card>
          ))}
          <SectionHeader title="Medications" />
          {q.data!.medications.length === 0 ? <Empty text="None listed." /> : q.data!.medications.map(m => (
            <Card key={m.id} style={{ marginBottom: 6 }}><Text style={{ fontWeight: "700", color: colors.text }}>{m.name}</Text><Text style={{ color: colors.muted }}>{m.schedule}{m.taken ? " • taken today" : ""}</Text></Card>
          ))}
          <SectionHeader title="Records" />
          {q.data!.records.length === 0 ? <Empty text="No records on file." /> : q.data!.records.map(r => (
            <Card key={r.id} style={{ marginBottom: 6 }}>
              <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "700", textTransform: "capitalize" }}>{r.type}</Text>
              <Text style={{ fontWeight: "700", color: colors.text }}>{r.title}</Text>
              {r.notes ? <Text style={{ color: colors.muted }}>{r.notes}</Text> : null}
            </Card>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

export default function DoctorThread() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showRecords, setShowRecords] = useState(false);
  const q = useQuery({ queryKey: ["doctor-messages", "thread", threadId], queryFn: () => get<DoctorThreadDetail>(`/doctor-portal/threads/${threadId}`) });
  const send = useMutation({
    mutationFn: (text: string) => post(`/doctor-portal/threads/${threadId}/messages`, { text }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["doctor-messages", "thread", threadId] }); qc.invalidateQueries({ queryKey: ["doctor-threads"] }); },
    onError: e => showAlert("Couldn't send", e instanceof Error ? e.message : "Try again"),
  });

  return (
    <Screen>
      <Header title={q.data?.patient.name ?? "Patient"} back right={q.data?.linked ? (
        <Pressable onPress={() => setShowRecords(true)} accessibilityLabel="View shared records" hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="document-text" size={22} color={colors.primary} /><Text style={{ color: colors.primary, fontWeight: "700" }}>Records</Text>
        </Pressable>
      ) : undefined} />
      {q.isLoading ? <Loading /> : q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : (
        <MessageThread
          meId={user!.id} messages={q.data!.messages} sending={send.isPending}
          onSend={async t => { await send.mutateAsync(t).catch(() => undefined); }}
          emptyText="No messages yet."
          header={!q.data!.linked ? <Text style={{ color: colors.muted, textAlign: "center" }}>This patient hasn't shared their health records with you.</Text> : undefined}
        />
      )}
      <Modal visible={showRecords} animationType="slide" onRequestClose={() => setShowRecords(false)}>
        {q.data && <PatientRecords patientId={q.data.patient.id} onClose={() => setShowRecords(false)} />}
      </Modal>
    </Screen>
  );
}
