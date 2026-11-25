import { useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../api";
import { showError } from "../alert";
import { randomSeed } from "../brain/gen";
import { Text } from "../components/Text";
import MathSprint from "../components/brain/MathSprint";
import MemoryMatrix from "../components/brain/MemoryMatrix";
import StroopTest from "../components/brain/StroopTest";
import QuantPuzzles from "../components/brain/QuantPuzzles";
import { Button, Card, Chip, Empty, ErrorView, GradientCard, Header, IconButton, IconName, IconTile, Loading, Screen } from "../components/ui";
import { colors } from "../theme";
import type { BrainDaily, BrainGame, BrainResultReply } from "../types";

const INFO: Record<BrainGame, { title: string; how: string; icon: IconName }> = {
  math: { title: "Mental Math Sprint", how: "Solve as many sums as you can in 30 seconds. They get harder as you go.", icon: "calculator" },
  matrix: { title: "Memory Matrix", how: "Watch the tiles light up, then tap the same ones. Each round adds a tile. You have two lives.", icon: "grid" },
  stroop: { title: "Focus Test", how: "Tap the colour the word is printed in, not the word. You have 30 seconds.", icon: "color-palette" },
  quant: { title: "Quant Puzzles", how: "Five quick number and logic puzzles. Pick an answer, then read why it is right.", icon: "bulb" },
};
const isGame = (g: unknown): g is BrainGame => typeof g === "string" && g in INFO;

type Phase = "intro" | "playing" | "result";

/** Plays one Brain Gym game (practice or today's Daily Challenge), posts the score and shows what it earned. */
export default function BrainPlay() {
  const params = useLocalSearchParams<{ game?: string; daily?: string }>();
  const game = isGame(params.game) ? params.game : null;
  const isDaily = params.daily === "1";
  const qc = useQueryClient();
  const daily = useQuery({ queryKey: ["brain-daily"], queryFn: () => get<BrainDaily>("/brain/daily"), enabled: isDaily && !!game });
  const [practiceSeed] = useState(randomSeed);
  const [phase, setPhase] = useState<Phase>("intro");
  const [run, setRun] = useState(0);
  const [score, setScore] = useState(0);
  const seed = (isDaily ? daily.data?.seed : practiceSeed) ?? practiceSeed;
  const doneToday = !!daily.data?.games.find(g => g.game === game)?.done;

  const submit = useMutation({
    mutationFn: (s: number) => post<BrainResultReply>("/brain/result", { game: game!, score: s, daily: isDaily }),
    onSuccess: () => {
      for (const queryKey of [["brain-stats"], ["brain-daily"], ["brain-board"], ["badges"]]) qc.invalidateQueries({ queryKey });
    },
    onError: e => showError("Couldn't save your score", e),
  });

  const finish = (s: number) => { setScore(s); setPhase("result"); submit.mutate(s); };
  const playAgain = () => { submit.reset(); setRun(run + 1); setPhase("playing"); };

  if (!game) {
    return (
      <Screen>
        <Header title="Brain Gym" back />
        <Empty icon="bulb-outline" title="Pick a game" text="Choose a game from Brain Gym to start." actionLabel="Back" onAction={() => router.back()} />
      </Screen>
    );
  }
  const info = INFO[game];
  const head = <Header title={info.title} subtitle={isDaily ? "Daily challenge" : "Practice"} back={phase !== "playing"}
    right={phase === "playing" ? <IconButton icon="close" label="Quit" onPress={() => setPhase("intro")} /> : undefined} />;

  if (isDaily && daily.isLoading) return <Screen>{head}<Loading rows={1} /></Screen>;
  if (isDaily && daily.error) return <Screen>{head}<ErrorView error={daily.error} onRetry={() => daily.refetch()} /></Screen>;

  if (phase === "playing") {
    return (
      <Screen>
        {head}
        <View key={run} style={{ flex: 1 }}>
          {game === "math" && <MathSprint seed={seed} onFinish={finish} />}
          {game === "matrix" && <MemoryMatrix seed={seed} onFinish={finish} />}
          {game === "stroop" && <StroopTest seed={seed} onFinish={finish} />}
          {game === "quant" && <QuantPuzzles seed={seed} onFinish={finish} />}
        </View>
      </Screen>
    );
  }

  if (phase === "result") {
    const r = submit.data;
    const flags: { label: string; tone: "amber" | "success" | "primary" }[] = [];
    if (r?.newBest) flags.push({ label: "New best", tone: "amber" });
    if (r?.levelUp) flags.push({ label: "Level up", tone: "success" });
    if (r?.streakStarted) flags.push({ label: "Streak started", tone: "primary" });
    if (r?.capped) flags.push({ label: "Daily XP limit reached", tone: "amber" });
    return (
      <Screen>
        {head}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
          <GradientCard>
            <Text style={{ color: "rgba(255,255,255,0.85)", fontWeight: "700" }}>Your score</Text>
            <Text style={{ color: "#fff", fontSize: 52, fontWeight: "800", marginTop: 2 }}>{score}</Text>
            {submit.isPending && <ActivityIndicator color="#fff" style={{ alignSelf: "flex-start", marginTop: 10 }} />}
            {r && <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 10 }}>+{r.xp} XP</Text>}
            {r && r.bonus > 0 && <Text style={{ color: "#fff", fontWeight: "700", marginTop: 4 }}>Includes a +{r.bonus} XP daily bonus</Text>}
            {r && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
                {flags.map(f => <Chip key={f.label} label={f.label} tone={f.tone} />)}
              </View>
            )}
            {r && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16 }}>
                <Ionicons name="flame" size={18} color={colors.gold} />
                <Text style={{ color: "#fff", fontWeight: "700" }}>
                  {`Level ${r.stats.level} · ${r.stats.streak > 0 ? `${r.stats.streak} day streak` : "Start your streak today"}`}
                </Text>
              </View>
            )}
          </GradientCard>

          {submit.isError && (
            <Card style={{ marginTop: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
              <IconTile icon="cloud-offline-outline" size={42} color={colors.danger} bg={colors.dangerSoft} />
              <Text style={{ flex: 1, color: colors.muted }}>Your score didn't save.</Text>
              <Button title="Retry" size="sm" onPress={() => submit.mutate(score)} loading={submit.isPending} />
            </Card>
          )}

          <View style={{ gap: 10, marginTop: 20 }}>
            <Button title="Play again" icon="refresh" variant="soft" onPress={playAgain} disabled={submit.isPending} />
            <Button title="Done" onPress={() => router.back()} />
          </View>
        </ScrollView>
      </Screen>
    );
  }

  const bonus = daily.data?.bonus ?? 20;
  return (
    <Screen>
      {head}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
        <Card style={{ alignItems: "center", padding: 24, gap: 14, marginTop: 8 }}>
          <IconTile icon={info.icon} size={72} />
          <Text style={{ fontSize: 22, fontWeight: "800", textAlign: "center" }}>{info.title}</Text>
          <Text style={{ color: colors.muted, textAlign: "center", lineHeight: 22 }}>{info.how}</Text>
          {isDaily && (
            <Text style={{ fontWeight: "700", color: doneToday ? colors.muted : colors.primaryDark, textAlign: "center" }}>
              {doneToday ? "Today's bonus is already claimed. You can still practise." : `Your first run today earns a +${bonus} XP bonus.`}
            </Text>
          )}
        </Card>
        <Button title="Start" icon="play" onPress={() => setPhase("playing")} style={{ marginTop: 20 }} />
      </ScrollView>
    </Screen>
  );
}
