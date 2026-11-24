import { useMemo } from "react";
import { ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get } from "../../api";
import { showAlert, showError } from "../../alert";
import { useAuth } from "../../auth";
import { fmtDuration, fmtKm, fmtPace, kindInfo } from "../../fitness";
import { Text } from "../../components/Text";
import { MapPin, OsmMap } from "../../components/OsmMap";
import { Avatar, Button, Card, ErrorView, Header, IconTile, Loading, Screen } from "../../components/ui";
import { colors, gradients } from "../../theme";
import type { WorkoutDetail } from "../../types";

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card style={{ width: "48.2%", padding: 14 }}>
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600" }}>{label}</Text>
      <Text style={{ fontWeight: "800", fontSize: 22, marginTop: 4 }}>{value}</Text>
      {sub ? <Text style={{ color: colors.faint, fontSize: 11, marginTop: 2 }}>{sub}</Text> : null}
    </Card>
  );
}

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["fitness", "workout", id], queryFn: () => get<WorkoutDetail>(`/activities/${id}`) });
  const remove = useMutation({
    mutationFn: () => del(`/activities/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fitness"] }); router.back(); },
    onError: e => showError("Couldn't delete", e),
  });
  const w = q.data;
  const pins = useMemo<MapPin[]>(() => {
    if (!w || w.route.length < 2) return [];
    const a = w.route[0], b = w.route[w.route.length - 1];
    return [{ id: "s", lat: a[0], lng: a[1], label: "Start", initial: "S" }, { id: "f", lat: b[0], lng: b[1], label: "Finish", initial: "F" }];
  }, [w]);
  const k = kindInfo(w?.kind ?? "walk");

  return (
    <Screen>
      <Header title={w?.title || k.label} back />
      {q.isLoading ? <Loading /> : q.error || !w ? <ErrorView error={q.error ?? new Error("Workout not found")} onRetry={() => q.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
          <OsmMap pins={pins} route={w.route} height={280} />

          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16 }}>
            <Avatar uri={w.user.avatarUrl} name={w.user.name} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "800", fontSize: 16 }}>{w.userId === user?.id ? "You" : w.user.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>{new Date(w.startedAt).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}{!w.shared ? " · private" : ""}</Text>
            </View>
            <IconTile icon={k.icon} gradient={gradients.ocean} size={42} />
          </View>

          <Text style={{ fontSize: 44, fontWeight: "800", letterSpacing: -1, marginTop: 18 }}>{fmtKm(w.distanceM)}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 10 }}>
            <Tile label="Time" value={fmtDuration(w.durationSec)} />
            <Tile label={w.kind === "cycle" ? "Speed" : "Pace"} value={fmtPace(w.kind, w.distanceM, w.durationSec)} />
            <Tile label="Calories" value={String(w.calories)} sub="estimate" />
            {w.steps != null && <Tile label="Steps" value={w.steps.toLocaleString()} sub="estimate from distance" />}
          </View>
          {w.note ? <Card style={{ marginTop: 14 }}><Text style={{ lineHeight: 21 }}>{w.note}</Text></Card> : null}

          {w.userId === user?.id && (
            <Button title="Delete workout" icon="trash-outline" variant="ghost" style={{ marginTop: 24 }}
              onPress={() => showAlert("Delete this workout?", "It will be removed for everyone.", [
                { text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => remove.mutate() },
              ])} />
          )}
        </ScrollView>
      )}
    </Screen>
  );
}
