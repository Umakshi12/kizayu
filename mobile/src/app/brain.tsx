import { Pressable, ScrollView, Switch, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, put } from "../api";
import { showError } from "../alert";
import { haptic } from "../haptics";
import { CirclePills, useCircle } from "../components/CirclePicker";
import { Text } from "../components/Text";
import { Avatar, Card, Empty, ErrorView, GradientCard, Header, IconName, IconTile, Loading, Screen, SectionHeader } from "../components/ui";
import { colors } from "../theme";
import type { BrainBoardRow, BrainDaily, BrainGame, BrainStats } from "../types";

const GAMES: { id: BrainGame; title: string; desc: string; icon: IconName; color: string; bg: string }[] = [
  { id: "math", title: "Mental Math Sprint", desc: "Quick sums that get harder as you go", icon: "calculator", color: colors.primary, bg: colors.primarySoft },
  { id: "matrix", title: "Memory Matrix", desc: "Remember where the tiles lit up", icon: "grid", color: "#6A4DFF", bg: "#EEE9FF" },
  { id: "stroop", title: "Focus Test", desc: "Name the ink colour, ignore the word", icon: "color-palette", color: "#E0559A", bg: "#FDE7F1" },
  { id: "quant", title: "Quant Puzzles", desc: "Number and logic puzzles with explanations", icon: "bulb", color: "#8A5A00", bg: colors.warnSoft },
];

const play = (game: BrainGame, daily: boolean) =>
  router.push({ pathname: "/brain-play", params: daily ? { game, daily: "1" } : { game } });

/** Brain Gym hub: your level and streak, today's Daily Challenge, practice games and the family board. */
export default function Brain() {
  const qc = useQueryClient();
  const { circles, circleId, setCircleId } = useCircle();
  const stats = useQuery({ queryKey: ["brain-stats"], queryFn: () => get<BrainStats>("/brain/stats") });
  const daily = useQuery({ queryKey: ["brain-daily"], queryFn: () => get<BrainDaily>("/brain/daily") });
  const board = useQuery({ queryKey: ["brain-board", circleId], enabled: !!circleId, queryFn: () => get<BrainBoardRow[]>(`/brain/board?circleId=${circleId}`) });
  const share = useMutation({
    mutationFn: (v: boolean) => put("/brain/settings", { share: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["brain-stats"] }); qc.invalidateQueries({ queryKey: ["brain-board"] }); },
    onError: e => showError("Couldn't change sharing", e),
  });

  const s = stats.data;
  const d = daily.data;
  const doneCount = d?.games.filter(g => g.done).length ?? 0;
  const pct = s && s.xpForNext ? Math.min(1, s.xpIntoLevel / s.xpForNext) : 0;
  const rows = board.data ?? [];
  const others = rows.filter(r => !r.me).length;

  return (
    <Screen>
      <Header title="Brain Gym" subtitle="A few minutes a day" back />
      {stats.isLoading ? <Loading /> : stats.error ? <ErrorView error={stats.error} onRetry={() => stats.refetch()} /> : s && (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
          <GradientCard>
            <Text style={{ color: "rgba(255,255,255,0.85)", fontWeight: "700" }}>Level</Text>
            <Text style={{ color: "#fff", fontSize: 44, fontWeight: "800" }}>{s.level}</Text>
            <View style={{ height: 10, borderRadius: 5, backgroundColor: "rgba(255,255,255,0.18)", overflow: "hidden", marginTop: 14 }}>
              <View style={{ width: `${pct * 100}%`, height: "100%", borderRadius: 5, backgroundColor: colors.accent }} />
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
              <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "600" }}>{`${s.xpIntoLevel} of ${s.xpForNext} XP`}</Text>
              <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "600" }}>{`Level ${s.level + 1} next`}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="flame" size={20} color={s.streak ? colors.gold : "rgba(255,255,255,0.6)"} />
                <Text style={{ color: "#fff", fontWeight: "700" }}>{s.streak ? `${s.streak} day streak` : "Start your streak today"}</Text>
              </View>
              <Text style={{ color: "#fff", fontWeight: "700" }}>{`${s.weekXp} XP this week`}</Text>
            </View>
          </GradientCard>

          <SectionHeader title="Daily challenge" action={d ? `${doneCount}/${d.games.length} done` : undefined} />
          <Card style={{ padding: 6 }}>
            {GAMES.map((g, i) => {
              const done = !!d?.games.find(x => x.game === g.id)?.done;
              return (
                <Pressable key={g.id} onPress={() => { haptic.tap(); play(g.id, true); }} accessibilityRole="button" accessibilityLabel={`${g.title}${done ? ", done today" : ""}`}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                  <IconTile icon={g.icon} size={42} color={g.color} bg={g.bg} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700" }}>{g.title}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{done ? "Done today" : "Bonus waiting"}</Text>
                  </View>
                  {done
                    ? <Ionicons name="checkmark-circle" size={26} color={colors.success} />
                    : <Ionicons name="chevron-forward" size={20} color={colors.faint} />}
                </Pressable>
              );
            })}
          </Card>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>{`Each game earns a +${d?.bonus ?? 20} XP bonus the first time you play it each day.`}</Text>

          <SectionHeader title="Practice" />
          {GAMES.map(g => (
            <Card key={g.id} onPress={() => play(g.id, false)} style={{ marginBottom: 10, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
              <IconTile icon={g.icon} size={46} color={g.color} bg={g.bg} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700", fontSize: 16 }}>{g.title}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }} numberOfLines={2}>{g.desc}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "600" }}>Best</Text>
                <Text style={{ fontWeight: "800", fontSize: 18 }}>{s.bestScores[g.id] ? s.bestScores[g.id] : "-"}</Text>
              </View>
            </Card>
          ))}

          <Card style={{ marginTop: 14, flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "700" }}>Show my streak to my circles</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Family can see your level, streak and weekly XP</Text>
            </View>
            <Switch value={s.share} onValueChange={v => share.mutate(v)} disabled={share.isPending}
              trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#fff" accessibilityLabel="Show my streak to my circles" />
          </Card>

          <SectionHeader title="Family board" />
          <CirclePills circles={circles.data} circleId={circleId} onChange={setCircleId} />
          {!circleId || board.isLoading ? <Loading rows={2} /> : board.error ? <ErrorView error={board.error} onRetry={() => board.refetch()} /> : (
            <>
              {rows.length > 0 && (
                <Card style={{ paddingVertical: 4 }}>
                  {rows.map((x, i) => (
                    <View key={x.user.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                      <Text style={{ width: 22, textAlign: "center", fontWeight: "800", color: colors.muted }}>{i + 1}</Text>
                      <Avatar uri={x.user.avatarUrl} name={x.user.name} size={38} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: "700" }} numberOfLines={1}>{x.me ? "You" : x.user.name}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>{`Level ${x.level} · ${x.streak > 0 ? `${x.streak} day streak` : "No streak yet"}`}</Text>
                      </View>
                      <Text style={{ fontWeight: "800", fontSize: 16 }}>{`${x.weekXp} XP`}</Text>
                    </View>
                  ))}
                </Card>
              )}
              {others === 0 && (
                <Card style={{ marginTop: 10 }}>
                  <Empty compact icon="people-outline" title="Just you for now" text={'Family members appear here once they turn on "Show my streak to my circles".'} />
                </Card>
              )}
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}
