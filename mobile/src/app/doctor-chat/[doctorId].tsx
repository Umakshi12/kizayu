import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { Text } from "../../components/Text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../../api";
import { showAlert } from "../../alert";
import { useAuth } from "../../auth";
import { Avatar, ErrorView, Header, Loading, Screen } from "../../components/ui";
import { MessageThread } from "../../components/MessageThread";
import { colors, radius } from "../../theme";
import type { DoctorDetail, DoctorMessage } from "../../types";

// Patient side: secure chat with a doctor. New replies arrive live (NotificationsBridge refreshes "doctor-messages").
export default function DoctorChat() {
  const { doctorId } = useLocalSearchParams<{ doctorId: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["doctor", doctorId], queryFn: () => get<DoctorDetail>(`/doctors/${doctorId}`) });
  const msgs = useQuery({ queryKey: ["doctor-messages", doctorId], queryFn: () => get<DoctorMessage[]>(`/doctors/${doctorId}/messages`) });
  const send = useMutation({
    mutationFn: (text: string) => post<DoctorMessage>(`/doctors/${doctorId}/messages`, { text }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["doctor-messages", doctorId] }),
    onError: e => showAlert("Couldn't send", e instanceof Error ? e.message : "Try again"),
  });

  const d = detail.data?.doctor;
  return (
    <Screen>
      <Header title={d?.name ?? "Doctor"} back />
      {detail.isLoading || msgs.isLoading ? <Loading /> : detail.error || msgs.error ? <ErrorView error={detail.error ?? msgs.error} onRetry={() => { detail.refetch(); msgs.refetch(); }} /> : (
        <MessageThread
          meId={user!.id} messages={msgs.data ?? []} sending={send.isPending}
          onSend={async t => { await send.mutateAsync(t).catch(() => undefined); }}
          emptyText="Ask your doctor a question. They'll reply here."
          disabled={detail.data?.canMessage ? undefined : "This doctor hasn't joined Kizayu messaging yet. Use Call instead."}
          header={d && (
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: colors.card, borderRadius: radius.md, padding: 12 }}>
              <Avatar uri={d.avatarUrl} name={d.name} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700", color: colors.text }}>{d.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{d.specialty} • {detail.data?.linked ? "Can see your shared records" : "Can't see your records"}</Text>
              </View>
            </View>
          )}
        />
      )}
    </Screen>
  );
}
