import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, post } from "../api";
import { showAlert, showError } from "../alert";
import { haptic } from "../haptics";
import { useAuth } from "../auth";
import { CirclePills, useCircle } from "../components/CirclePicker";
import { Backdrop } from "../components/Sheets";
import { Text } from "../components/Text";
import { Avatar, Button, Card, Chip, Empty, ErrorView, Field, GradientCard, Header, IconButton, IconTile, Loading, Pill, Screen, SectionHeader } from "../components/ui";
import { colors, gradients } from "../theme";
import type { Chore, ChoreBoard, Circle } from "../types";

const POINTS = [5, 10, 20, 50];
const REPEAT: { id: Chore["repeat"]; label: string }[] = [{ id: "daily", label: "Every day" }, { id: "weekly", label: "Weekly" }, { id: "once", label: "One time" }];
const COSTS = [20, 50, 100, 200];

function ChoreSheet({ circle, visible, onClose }: { circle: Circle; visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [points, setPoints] = useState(10);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [repeat, setRepeat] = useState<Chore["repeat"]>("daily");
  const save = useMutation({
    mutationFn: () => post("/chores", { circleId: circle.id, title: title.trim(), points, assigneeId: assignee, repeat }),
    onSuccess: () => { haptic.success(); setTitle(""); setAssignee(null); qc.invalidateQueries({ queryKey: ["chores", circle.id] }); onClose(); }, onError: e => showError("Couldn't add chore", e),
  });
  return (
    <Backdrop visible={visible} onClose={onClose}>
      <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: 12 }}>New chore</Text>
      <Field label="What needs doing?" value={title} onChangeText={setTitle} placeholder="Wash the dishes" maxLength={60} autoCapitalize="sentences" />
      <Text style={{ fontWeight: "700", marginBottom: 8 }}>Points</Text>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>{POINTS.map(p => <Pill key={p} label={`${p}`} active={points === p} onPress={() => setPoints(p)} />)}</View>
      <Text style={{ fontWeight: "700", marginBottom: 8 }}>Who is it for?</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
        <Pill label="Anyone" active={!assignee} onPress={() => setAssignee(null)} />
        {circle.members.map(m => <Pill key={m.id} label={m.name.split(" ")[0]} active={assignee === m.id} onPress={() => setAssignee(m.id)} />)}
      </ScrollView>
      <Text style={{ fontWeight: "700", marginBottom: 8 }}>How often?</Text>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>{REPEAT.map(r => <Pill key={r.id} label={r.label} active={repeat === r.id} onPress={() => setRepeat(r.id)} />)}</View>
      <Button title="Add chore" onPress={() => save.mutate()} loading={save.isPending} disabled={!title.trim()} />
    </Backdrop>
  );
}

function RewardSheet({ circleId, visible, onClose }: { circleId: string; visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [cost, setCost] = useState(50);
  const save = useMutation({
    mutationFn: () => post("/rewards", { circleId, title: title.trim(), cost }),
    onSuccess: () => { haptic.success(); setTitle(""); qc.invalidateQueries({ queryKey: ["chores", circleId] }); onClose(); }, onError: e => showError("Couldn't add reward", e),
  });
  return (
    <Backdrop visible={visible} onClose={onClose}>
      <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: 12 }}>New reward</Text>
      <Field label="What can points buy?" value={title} onChangeText={setTitle} placeholder="Ice cream trip" maxLength={60} autoCapitalize="sentences" />
      <Text style={{ fontWeight: "700", marginBottom: 8 }}>Cost in points</Text>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>{COSTS.map(c => <Pill key={c} label={`${c}`} active={cost === c} onPress={() => setCost(c)} />)}</View>
      <Button title="Add reward" onPress={() => save.mutate()} loading={save.isPending} disabled={!title.trim()} />
    </Backdrop>
  );
}

export default function Chores() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { circles, circle, circleId, setCircleId, isOwner } = useCircle();
  const [addingChore, setAddingChore] = useState(false);
  const [addingReward, setAddingReward] = useState(false);
  const board = useQuery({ queryKey: ["chores", circleId], enabled: !!circleId, queryFn: () => get<ChoreBoard>(`/chores?circleId=${circleId}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["chores", circleId] });
  const fail = (t: string) => (e: unknown) => showError(t, e);

  const done = useMutation({ mutationFn: (id: string) => post(`/chores/${id}/done`), onSuccess: () => { haptic.success(); refresh(); }, onError: fail("Couldn't mark done") });
  const review = useMutation({ mutationFn: (v: { id: string; approve: boolean }) => post(`/chores/done/${v.id}/review`, { approve: v.approve }), onSuccess: () => { haptic.success(); refresh(); }, onError: fail("Couldn't review") });
  const claim = useMutation({ mutationFn: (id: string) => post(`/rewards/${id}/claim`), onSuccess: () => { haptic.success(); refresh(); showAlert("Requested", "A parent will be told. Enjoy your reward!"); }, onError: fail("Couldn't claim") });
  const given = useMutation({ mutationFn: (id: string) => post(`/rewards/claims/${id}/given`), onSuccess: refresh, onError: fail("Couldn't update") });
  const dropChore = useMutation({ mutationFn: (id: string) => del(`/chores/${id}`), onSuccess: refresh, onError: fail("Couldn't remove") });
  const dropReward = useMutation({ mutationFn: (id: string) => del(`/rewards/${id}`), onSuccess: refresh, onError: fail("Couldn't remove") });
  const confirmDrop = (what: string, run: () => void) => showAlert(`Remove "${what}"?`, "Points already earned are kept.", [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: run }]);

  const b = board.data;
  return (
    <Screen>
      <Header title="Chores & rewards" subtitle={circle?.name} back
        right={isOwner && circleId ? <IconButton icon="add" label="Add chore" tint={colors.primary} onPress={() => setAddingChore(true)} /> : undefined} />
      {circles.isLoading ? <Loading /> : circles.error ? <ErrorView error={circles.error} onRetry={() => circles.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
          <CirclePills circles={circles.data} circleId={circleId} onChange={setCircleId} />
          {board.isLoading ? <Loading /> : board.error ? <ErrorView error={board.error} onRetry={() => board.refetch()} /> : b && (
            <>
              <GradientCard colors={gradients.sunrise}>
                <Text style={{ color: "rgba(255,255,255,0.9)", fontWeight: "700" }}>Your points</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 }}>
                  <Ionicons name="star" size={34} color="#fff" />
                  <Text style={{ color: "#fff", fontSize: 44, fontWeight: "800" }}>{b.myPoints}</Text>
                </View>
              </GradientCard>

              {b.pending.length > 0 && (
                <>
                  <SectionHeader title="Waiting for your OK" action={`${b.pending.length}`} />
                  {b.pending.map(p => (
                    <Card key={p.id} style={{ marginBottom: 8, padding: 12 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <Avatar uri={p.user?.avatarUrl} name={p.user?.name} size={38} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontWeight: "700" }} numberOfLines={1}>{p.title}</Text>
                          <Text style={{ color: colors.muted, fontSize: 12 }}>{p.user?.name ?? "Someone"} · {p.points} pts</Text>
                        </View>
                        <Button title="Not yet" size="sm" variant="ghost" onPress={() => review.mutate({ id: p.id, approve: false })} />
                        <Button title="Approve" size="sm" onPress={() => review.mutate({ id: p.id, approve: true })} />
                      </View>
                    </Card>
                  ))}
                </>
              )}

              {b.claims.length > 0 && (
                <>
                  <SectionHeader title="Rewards to hand over" />
                  {b.claims.map(c => (
                    <Card key={c.id} style={{ marginBottom: 8, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <IconTile icon="gift" size={38} color="#E0559A" bg="#FDE7F1" />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: "700" }} numberOfLines={1}>{c.title}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>{c.user?.name} · {c.cost} pts</Text>
                      </View>
                      <Button title="Given" size="sm" variant="soft" onPress={() => given.mutate(c.id)} />
                    </Card>
                  ))}
                </>
              )}

              <SectionHeader title="Chores" action={isOwner ? "Add" : undefined} onAction={() => setAddingChore(true)} />
              {b.chores.length === 0 ? (
                <Card><Empty compact icon="checkbox-outline" title="No chores yet" text={isOwner ? "Add chores with points. Kids tick them off, you approve, and points turn into rewards." : "A parent can add chores for you to earn points."}
                  actionLabel={isOwner ? "Add a chore" : undefined} onAction={() => setAddingChore(true)} /></Card>
              ) : b.chores.map(c => (
                <Card key={c.id} style={{ marginBottom: 8, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <IconTile icon={c.myStatus === "approved" ? "checkmark-circle" : "sparkles"} size={42} color={c.myStatus === "approved" ? "#fff" : colors.primary} bg={c.myStatus === "approved" ? colors.success : colors.primarySoft} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", fontSize: 16 }} numberOfLines={1}>{c.title}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
                      <Chip label={`${c.points} pts`} tone="amber" small />
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{c.assignee ? (c.assignee.id === user?.id ? "You" : c.assignee.name.split(" ")[0]) : "Anyone"} · {REPEAT.find(r => r.id === c.repeat)?.label.toLowerCase()}</Text>
                    </View>
                  </View>
                  {c.myStatus === "pending" ? <Chip label="Waiting" tone="amber" small />
                    : c.myStatus === "approved" ? <Chip label="Done" tone="success" small />
                    : c.canDo ? <Button title="Done" size="sm" onPress={() => done.mutate(c.id)} loading={done.isPending && done.variables === c.id} />
                    : null}
                  {isOwner && <Pressable onPress={() => confirmDrop(c.title, () => dropChore.mutate(c.id))} hitSlop={10} accessibilityLabel={`Remove ${c.title}`}><Ionicons name="trash-outline" size={19} color={colors.faint} /></Pressable>}
                </Card>
              ))}

              <SectionHeader title="Rewards" action={isOwner ? "Add" : undefined} onAction={() => setAddingReward(true)} />
              {b.rewards.length === 0 ? (
                <Card><Empty compact icon="gift-outline" title="No rewards yet" text={isOwner ? "Add things points can buy: screen time, a treat, a day out." : "A parent can add rewards you can spend points on."} /></Card>
              ) : b.rewards.map(r => (
                <Card key={r.id} style={{ marginBottom: 8, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <IconTile icon="gift" size={42} color="#E0559A" bg="#FDE7F1" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", fontSize: 16 }} numberOfLines={1}>{r.title}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{r.cost} points</Text>
                  </View>
                  <Button title="Claim" size="sm" variant={b.myPoints >= r.cost ? "primary" : "soft"} disabled={b.myPoints < r.cost} onPress={() => claim.mutate(r.id)} loading={claim.isPending && claim.variables === r.id} />
                  {isOwner && <Pressable onPress={() => confirmDrop(r.title, () => dropReward.mutate(r.id))} hitSlop={10} accessibilityLabel={`Remove ${r.title}`}><Ionicons name="trash-outline" size={19} color={colors.faint} /></Pressable>}
                </Card>
              ))}

              <SectionHeader title="Points board" />
              <Card style={{ paddingVertical: 4 }}>
                {b.balances.map((x, i) => (
                  <View key={x.user.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                    <Avatar uri={x.user.avatarUrl} name={x.user.name} size={36} />
                    <Text style={{ flex: 1, fontWeight: "700" }}>{x.user.id === user?.id ? "You" : x.user.name}</Text>
                    <Ionicons name="star" size={16} color={colors.gold} />
                    <Text style={{ fontWeight: "800", fontSize: 16 }}>{x.points}</Text>
                  </View>
                ))}
              </Card>
            </>
          )}
        </ScrollView>
      )}
      {circle && <ChoreSheet circle={circle} visible={addingChore} onClose={() => setAddingChore(false)} />}
      {circleId && <RewardSheet circleId={circleId} visible={addingReward} onClose={() => setAddingReward(false)} />}
    </Screen>
  );
}
