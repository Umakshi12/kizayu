import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { Text } from "../../components/Text";
import { router } from "expo-router";
import { showAlert } from "../../alert";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { get, post } from "../../api";
import { Avatar, Button, Card, Empty, ErrorView, Header, IconName, Loading, Screen, SectionHeader } from "../../components/ui";
import { colors, radius } from "../../theme";
import type { Game, LeaderboardRow } from "../../types";

const ICONS: Record<string, IconName> = { trophy: "trophy", dice: "dice", cards: "albums", abc: "text" };
const IN_APP = new Set(["Trivia", "Memory Match"]); // played in the modal below
const SCREENS: Record<string, string> = { Ludo: "/games/ludo", "Word Hunt": "/games/wordhunt" };

// ---------- Memory Match ----------
const EMOJI = ["🍎", "🐶", "🌻", "🚗", "⚽", "🎵", "🍕", "🌈"];
function MemoryMatch({ onFinish }: { onFinish: (score: number) => void }) {
  const [cards] = useState(() => [...EMOJI, ...EMOJI].map((e, i) => ({ id: i, e, r: Math.random() })).sort((a, b) => a.r - b.r));
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const done = matched.length === cards.length;

  useEffect(() => { if (done) onFinish(Math.max(10, 200 - moves * 8)); }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  const flip = (i: number) => {
    if (open.length >= 2 || open.includes(i) || matched.includes(i)) return;
    const next = [...open, i];
    setOpen(next);
    if (next.length === 2) {
      setMoves(m => m + 1);
      if (cards[next[0]].e === cards[next[1]].e) { setMatched(m => [...m, ...next]); setOpen([]); }
      else setTimeout(() => setOpen([]), 700);
    }
  };

  return (
    <View>
      <Text style={{ textAlign: "center", fontWeight: "700", marginBottom: 12, color: colors.text }}>Moves: {moves}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
        {cards.map((c, i) => {
          const show = open.includes(i) || matched.includes(i);
          return (
            <Pressable key={c.id} onPress={() => flip(i)} accessibilityLabel={show ? c.e : "Hidden card"}
              style={{ width: "22%", aspectRatio: 1, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: show ? colors.card : colors.primary }}>
              <Text style={{ fontSize: 30 }}>{show ? c.e : ""}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ---------- Trivia ----------
const QUESTIONS = [
  { q: "How many days are in a leap year?", a: ["365", "366", "364", "367"], c: 1 },
  { q: "Which planet is known as the Red Planet?", a: ["Venus", "Jupiter", "Mars", "Saturn"], c: 2 },
  { q: "What is the capital of India?", a: ["Mumbai", "New Delhi", "Kolkata", "Chennai"], c: 1 },
  { q: "How many colours are in a rainbow?", a: ["5", "6", "7", "8"], c: 2 },
  { q: "Which fruit keeps the doctor away, as the saying goes?", a: ["Banana", "Orange", "Apple", "Mango"], c: 2 },
  { q: "How many minutes are in two hours?", a: ["100", "120", "150", "90"], c: 1 },
];
function Trivia({ onFinish }: { onFinish: (score: number) => void }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const q = QUESTIONS[i];

  const choose = (k: number) => {
    if (picked !== null) return;
    setPicked(k);
    const gained = k === q.c ? 20 : 0;
    setScore(s => s + gained);
    setTimeout(() => {
      if (i + 1 < QUESTIONS.length) { setI(i + 1); setPicked(null); }
      else onFinish(score + gained);
    }, 800);
  };

  return (
    <View>
      <Text style={{ color: colors.muted, textAlign: "center" }}>Question {i + 1} of {QUESTIONS.length} • Score {score}</Text>
      <Text style={{ fontSize: 20, fontWeight: "800", textAlign: "center", marginVertical: 18, color: colors.text }}>{q.q}</Text>
      {q.a.map((opt, k) => {
        const bg = picked === null ? colors.card : k === q.c ? colors.successSoft : k === picked ? colors.dangerSoft : colors.card;
        return (
          <Pressable key={opt} onPress={() => choose(k)} style={{ padding: 14, borderRadius: radius.md, backgroundColor: bg, marginBottom: 10, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontWeight: "600", fontSize: 16, color: colors.text }}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- Screen ----------
export default function Games() {
  const qc = useQueryClient();
  const games = useQuery({ queryKey: ["games"], queryFn: () => get<Game[]>("/games") });
  const [playing, setPlaying] = useState<Game | null>(null);
  const [result, setResult] = useState<number | null>(null);
  const [boardFor, setBoardFor] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  const board = useQuery({ queryKey: ["leaderboard", boardFor], enabled: !!boardFor, queryFn: () => get<LeaderboardRow[]>(`/games/${boardFor}/leaderboard`) });

  const finish = async (score: number) => {
    setResult(score);
    try { await post(`/games/${playing!.id}/scores`, { score }); qc.invalidateQueries({ queryKey: ["leaderboard"] }); }
    catch (e) { showAlert("Score not saved", e instanceof Error ? e.message : "Try again"); }
  };
  const close = () => { setPlaying(null); setResult(null); };
  const open = (g: Game) => {
    if (SCREENS[g.title]) { router.push(SCREENS[g.title] as never); return; }
    if (!IN_APP.has(g.title)) return showAlert(g.title, "This game is coming soon.");
    setResult(null); setRound(r => r + 1); setPlaying(g); setBoardFor(g.id);
  };
  const featured = useMemo(() => games.data?.find(g => g.title === "Trivia"), [games.data]);

  return (
    <Screen>
      <Header title="Games" back />
      {games.isLoading ? <Loading /> : games.error ? <ErrorView error={games.error} onRetry={() => games.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
          <LinearGradient colors={["#7B4DF5", "#B28DFF"]} style={{ borderRadius: radius.lg, padding: 22, alignItems: "center" }}>
            <Ionicons name="game-controller" size={56} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 24, fontWeight: "800", marginTop: 6 }}>Play Together with Your Family</Text>
            <Text style={{ color: "#BFEFFB", marginBottom: 14 }}>Fun games for all ages</Text>
            <Button title="Start Playing" icon="arrow-forward" variant="soft" onPress={() => featured && open(featured)} style={{ backgroundColor: "#fff" }} />
          </LinearGradient>

          <SectionHeader title="Popular Games" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {games.data!.map(g => (
              <Pressable key={g.id} onPress={() => open(g)} style={{ width: "47.5%" }}>
                <Card style={{ alignItems: "center", gap: 6 }}>
                  <Ionicons name={ICONS[g.icon] ?? "game-controller"} size={34} color={colors.primary} />
                  <Text style={{ fontWeight: "800", color: colors.text }}>{g.title}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{g.tagline}</Text>
                </Card>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}

      <Modal visible={!!playing} animationType="slide" onRequestClose={close}>
        <Screen>
          <Header title={playing?.title ?? ""} right={<Pressable onPress={close} hitSlop={10} accessibilityLabel="Close game"><Ionicons name="close" size={28} color={colors.text} /></Pressable>} />
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {result === null ? (
              playing?.title === "Memory Match" ? <MemoryMatch key={round} onFinish={finish} /> : <Trivia key={round} onFinish={finish} />
            ) : (
              <View style={{ alignItems: "center", gap: 10 }}>
                <Ionicons name="trophy" size={64} color={colors.warn} />
                <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text }}>Score: {result}</Text>
                <Button title="Play again" onPress={() => { setResult(null); setRound(r => r + 1); }} />
              </View>
            )}
            <SectionHeader title="Family leaderboard" />
            {board.isLoading ? <Loading /> : (board.data?.length ?? 0) === 0 ? <Empty text="Be the first on the board!" /> : board.data!.map(r => (
              <Card key={r.user.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <Text style={{ width: 24, fontWeight: "800", color: colors.primary }}>{r.rank}</Text>
                <Avatar uri={r.user.avatarUrl} name={r.user.name} size={36} />
                <Text style={{ flex: 1, fontWeight: "700", color: colors.text }}>{r.user.name}</Text>
                <Text style={{ fontWeight: "800", color: colors.text }}>{r.score}</Text>
              </Card>
            ))}
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}
