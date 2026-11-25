import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../api";
import { showError } from "../alert";
import { haptic } from "../haptics";
import { Text } from "../components/Text";
import { Button, Card, ErrorView, Field, GradientCard, Header, Loading, Pill, Screen } from "../components/ui";
import { colors, gradients } from "../theme";
import type { CheckIn } from "../types";

const PRESETS = [{ label: "15 min", m: 15 }, { label: "30 min", m: 30 }, { label: "1 hour", m: 60 }, { label: "2 hours", m: 120 }];

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
};

async function whereAmI(): Promise<{ lat: number; lng: number } | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const p = await Location.getLastKnownPositionAsync() ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return p ? { lat: p.coords.latitude, lng: p.coords.longitude } : null;
  } catch { return null; }
}

export default function CheckInScreen() {
  const qc = useQueryClient();
  const active = useQuery({ queryKey: ["checkin"], queryFn: () => get<CheckIn | null>("/checkin/active"), refetchInterval: 30_000 });
  const [minutes, setMinutes] = useState(30);
  const [note, setNote] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const refresh = () => qc.invalidateQueries({ queryKey: ["checkin"] });

  const start = useMutation({
    mutationFn: async () => post<CheckIn>("/checkin", { minutes, note: note.trim() || undefined, ...(await whereAmI() ?? {}) }),
    onSuccess: () => { haptic.success(); setNote(""); refresh(); }, onError: e => showError("Couldn't start the timer", e),
  });
  const safe = useMutation({ mutationFn: (id: string) => post(`/checkin/${id}/safe`), onSuccess: () => { haptic.success(); refresh(); }, onError: e => showError("Couldn't update", e) });
  const extend = useMutation({ mutationFn: (id: string) => post(`/checkin/${id}/extend`, { minutes: 15 }), onSuccess: () => { haptic.tap(); refresh(); }, onError: e => showError("Couldn't add time", e) });

  const c = active.data;
  const left = c ? new Date(c.dueAt).getTime() - now : 0;
  const late = !!c && (c.status === "alerted" || left <= 0);

  return (
    <Screen>
      <Header title="Safe walk" subtitle="Get home, and your family knows" back />
      {active.isLoading ? <Loading /> : active.error ? <ErrorView error={active.error} onRetry={() => active.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
          {c ? (
            <>
              <GradientCard colors={late ? gradients.danger : gradients.hero}>
                <Text style={{ color: "rgba(255,255,255,0.85)", fontWeight: "700" }}>{c.status === "alerted" ? "Your family has been alerted" : late ? "Time is up" : "Timer running"}</Text>
                <Text style={{ color: "#fff", fontSize: 54, fontWeight: "800", marginTop: 6, fontVariant: ["tabular-nums"] }} accessibilityLabel={late ? "Time is up" : `${clock(left)} left`}>
                  {late ? "0:00" : clock(left)}
                </Text>
                {!!c.note && <Text style={{ color: "rgba(255,255,255,0.9)", marginTop: 4 }}>{c.note}</Text>}
              </GradientCard>
              <Button title="I'm safe" icon="checkmark-circle" onPress={() => safe.mutate(c.id)} loading={safe.isPending} style={{ marginTop: 14 }} />
              {c.status === "active" && <Button title="Need more time (+15 min)" variant="soft" onPress={() => extend.mutate(c.id)} loading={extend.isPending} style={{ marginTop: 10 }} />}
              <Text style={{ color: colors.muted, fontSize: 13, marginTop: 14, lineHeight: 19 }}>
                {c.status === "alerted" ? "Tap I'm safe to let everyone know you're okay." : "If the timer runs out and you haven't tapped I'm safe, your family gets an alert. This works even if your phone switches off, because the alert comes from our server."}
              </Text>
            </>
          ) : (
            <>
              <Card>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <Ionicons name="shield-checkmark" size={30} color={colors.primary} />
                  <Text style={{ flex: 1, color: colors.muted, lineHeight: 20 }}>Walking alone, taking a cab, travelling late? Set a timer. Tap I'm safe when you arrive. If you don't, your family is alerted.</Text>
                </View>
                <Text style={{ fontWeight: "700", marginBottom: 8 }}>How long will it take?</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                  {PRESETS.map(p => <Pill key={p.m} label={p.label} active={minutes === p.m} onPress={() => setMinutes(p.m)} />)}
                </View>
                <Field label="Where are you going? (optional)" value={note} onChangeText={setNote} placeholder="Walking home from work" maxLength={120} autoCapitalize="sentences" />
                <Button title={`Start ${PRESETS.find(p => p.m === minutes)?.label} timer`} icon="timer" onPress={() => start.mutate()} loading={start.isPending} />
              </Card>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 14, lineHeight: 18 }}>
                Your last known location (if you allowed it) is included in the alert. Emergency contacts also get a text message when SMS is switched on.
              </Text>
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}
