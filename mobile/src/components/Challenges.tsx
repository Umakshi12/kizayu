import { useState } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, post } from "../api";
import { showAlert, showError } from "../alert";
import { haptic } from "../haptics";
import { useAuth } from "../auth";
import { colors } from "../theme";
import type { Challenge } from "../types";
import { Backdrop } from "./Sheets";
import { Text } from "./Text";
import { Avatar, Button, Card, Chip, Empty, Field, IconTile, Loading, Pill, SectionHeader } from "./ui";

const fmt = (c: Pick<Challenge, "metric">, v: number) => c.metric === "distance" ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} km` : `${v} workout${v === 1 ? "" : "s"}`;
const left = (iso: string) => { const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400e3); return d <= 0 ? "ends today" : d === 1 ? "1 day left" : `${d} days left`; };

function NewChallengeSheet({ circleId, visible, onClose }: { circleId: string; visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [metric, setMetric] = useState<"distance" | "workouts">("distance");
  const [target, setTarget] = useState(10);
  const [days, setDays] = useState(7);
  const targets = metric === "distance" ? [5, 10, 25, 50] : [3, 5, 10, 20];
  const create = useMutation({
    mutationFn: () => post("/challenges", { circleId, title: title.trim() || (metric === "distance" ? `Walk ${target} km` : `${target} workouts`), metric, target: metric === "distance" ? target * 1000 : target, days }),
    onSuccess: () => { haptic.success(); setTitle(""); qc.invalidateQueries({ queryKey: ["challenges", circleId] }); onClose(); }, onError: e => showError("Couldn't start the challenge", e),
  });
  return (
    <Backdrop visible={visible} onClose={onClose}>
      <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: 12 }}>Start a challenge</Text>
      <Text style={{ fontWeight: "700", marginBottom: 8 }}>What counts?</Text>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
        <Pill label="Distance" icon="trail-sign" active={metric === "distance"} onPress={() => { setMetric("distance"); setTarget(10); }} />
        <Pill label="Workouts" icon="walk" active={metric === "workouts"} onPress={() => { setMetric("workouts"); setTarget(5); }} />
      </View>
      <Text style={{ fontWeight: "700", marginBottom: 8 }}>Goal for each person</Text>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>{targets.map(t => <Pill key={t} label={metric === "distance" ? `${t} km` : `${t}`} active={target === t} onPress={() => setTarget(t)} />)}</View>
      <Text style={{ fontWeight: "700", marginBottom: 8 }}>For how long?</Text>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>{[3, 7, 14, 30].map(d => <Pill key={d} label={`${d} days`} active={days === d} onPress={() => setDays(d)} />)}</View>
      <Field label="Name (optional)" value={title} onChangeText={setTitle} placeholder="Family step-off" maxLength={60} autoCapitalize="sentences" />
      <Button title="Start and tell the family" onPress={() => create.mutate()} loading={create.isPending} />
    </Backdrop>
  );
}

/** Family challenges on the Fitness screen. Only shared workouts counted inside the challenge dates count. */
export function ChallengesSection({ circleId }: { circleId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["challenges", circleId], queryFn: () => get<Challenge[]>(`/challenges?circleId=${circleId}`) });
  const drop = useMutation({ mutationFn: (id: string) => del(`/challenges/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["challenges", circleId] }), onError: e => showError("Couldn't remove", e) });
  const list = q.data ?? [];
  return (
    <>
      <SectionHeader title="Family challenges" action="Start one" onAction={() => setOpen(true)} />
      {q.isLoading ? <Loading rows={1} /> : list.length === 0 ? (
        <Card><Empty compact icon="trophy-outline" title="No challenges running" text="Pick a goal like 25 km this week. Everyone races to finish first." actionLabel="Start a challenge" onAction={() => setOpen(true)} /></Card>
      ) : list.map(c => {
        const pct = Math.min(1, c.mine / c.target), done = c.mine >= c.target;
        const mine = c.createdById === user?.id;
        return (
          <Card key={c.id} style={{ marginBottom: 10, padding: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <IconTile icon={done ? "trophy" : "flag"} size={42} color={done ? "#fff" : colors.primary} bg={done ? colors.gold : colors.primarySoft} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 16 }} numberOfLines={1}>{c.title}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>Goal {fmt(c, c.target)} · {c.active ? left(c.endsAt) : "finished"}</Text>
              </View>
              {mine && <Pressable onPress={() => showAlert(`Remove "${c.title}"?`, "It disappears for everyone.", [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => drop.mutate(c.id) }])} hitSlop={10} accessibilityLabel={`Remove ${c.title}`}><Ionicons name="trash-outline" size={19} color={colors.faint} /></Pressable>}
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, marginTop: 12, overflow: "hidden" }}>
              <View style={{ width: `${pct * 100}%`, height: 8, backgroundColor: done ? colors.success : colors.primary }} />
            </View>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 5 }}>You: {fmt(c, c.mine)}{done ? " · goal reached!" : ""}</Text>
            <View style={{ marginTop: 8 }}>
              {c.standings.slice(0, 4).map((s, i) => (
                <View key={s.user.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 5 }}>
                  <Text style={{ width: 18, color: colors.muted, fontWeight: "700" }}>{i + 1}</Text>
                  <Avatar uri={s.user.avatarUrl} name={s.user.name} size={28} />
                  <Text style={{ flex: 1, fontWeight: "600" }} numberOfLines={1}>{s.user.id === user?.id ? "You" : s.user.name}</Text>
                  {s.done && <Chip label="Done" tone="success" small />}
                  <Text style={{ fontWeight: "800" }}>{fmt(c, s.value)}</Text>
                </View>
              ))}
            </View>
          </Card>
        );
      })}
      <Button title="See my badges" icon="ribbon" variant="soft" size="sm" onPress={() => router.push("/badges")} style={{ alignSelf: "flex-start", marginTop: 2 }} />
      <NewChallengeSheet circleId={circleId} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
