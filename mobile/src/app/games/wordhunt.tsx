import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { Text } from "../../components/Text";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../../api";
import { Button, Card, Header, Screen, SectionHeader } from "../../components/ui";
import { colors, radius } from "../../theme";
import type { Game } from "../../types";
import * as W from "../../games/wordhunt";

const SIZE = 9;
const FOUND_COLORS = ["#C9B8FF", "#B5E8CB", "#FFE19A", "#BFE0FB", "#FFC4C6", "#D7F0A8", "#F9C9EC", "#C3F1EE", "#FFD6B0", "#D9D3EA"];

export default function WordHunt() {
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const board = Math.min(width - 32, 440);
  const cell = board / SIZE;
  const [topic, setTopic] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const puzzle = useMemo(() => (topic ? W.generate(W.WORD_SETS[topic], SIZE) : null), [topic, round]);
  const [found, setFound] = useState<W.Placed[]>([]);
  const [start, setStart] = useState<W.Pos | null>(null);
  const [miss, setMiss] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [done, setDone] = useState<number | null>(null);
  const saved = useRef(false);
  const games = useQuery({ queryKey: ["games"], queryFn: () => get<Game[]>("/games") });
  const gameId = games.data?.find(g => g.title === "Word Hunt")?.id;

  useEffect(() => {
    if (!puzzle || done != null) return;
    const t = setInterval(() => setSeconds(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [puzzle, done]);

  const finish = (f: W.Placed[]) => {
    if (!puzzle) return;
    const sc = W.score(f, puzzle.placed.length, seconds);
    setDone(sc);
    if (gameId && !saved.current && sc > 0) {
      saved.current = true;
      void post(`/games/${gameId}/scores`, { score: sc }).then(() => qc.invalidateQueries({ queryKey: ["leaderboard"] })).catch(() => undefined);
    }
  };

  const tap = (p: W.Pos) => {
    if (!puzzle || done != null) return;
    if (!start) { setStart(p); return; }
    const w = W.findWord(puzzle, start, p, found.map(x => x.word));
    setStart(null);
    if (w) {
      const next = [...found, w];
      setFound(next);
      if (next.length === puzzle.placed.length) finish(next);
    } else { setMiss(true); setTimeout(() => setMiss(false), 400); }
  };

  const newGame = (t: string) => { setTopic(t); setRound(r => r + 1); setFound([]); setStart(null); setSeconds(0); setDone(null); saved.current = false; };

  if (!puzzle) return (
    <Screen>
      <Header title="Word Hunt" back />
      <ScrollView contentContainerStyle={{ padding: 16, maxWidth: 520, width: "100%", alignSelf: "center" }}>
        <Card><Text style={{ color: colors.text, lineHeight: 20 }}>Find all the hidden words. Tap the <Text style={{ fontWeight: "800" }}>first letter</Text>, then the <Text style={{ fontWeight: "800" }}>last letter</Text>. Words go across, down, diagonally and even backwards.</Text></Card>
        <SectionHeader title="Pick a theme" />
        {Object.keys(W.WORD_SETS).map(t => (
          <Button key={t} title={t} variant="soft" onPress={() => newGame(t)} style={{ marginBottom: 10 }} />
        ))}
      </ScrollView>
    </Screen>
  );

  const colorAt = new Map<string, string>();
  found.forEach((w, i) => w.cells.forEach(([r, c]) => colorAt.set(`${r},${c}`, FOUND_COLORS[i % FOUND_COLORS.length])));

  return (
    <Screen>
      <Header title={`Word Hunt • ${topic}`} back />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, alignItems: "center" }}>
        <View style={{ flexDirection: "row", width: board, justifyContent: "space-between", marginBottom: 10 }}>
          <Text style={{ fontWeight: "700", color: colors.text }}>Found {found.length}/{puzzle.placed.length}</Text>
          <Text style={{ fontWeight: "700", color: colors.text }}>⏱ {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</Text>
        </View>
        <View style={{ width: board, height: board, backgroundColor: miss ? colors.dangerSoft : colors.card, borderRadius: radius.md, overflow: "hidden" }}>
          {puzzle.grid.map((row, r) => (
            <View key={r} style={{ flexDirection: "row" }}>
              {row.map((ch, c) => {
                const isStart = start?.[0] === r && start?.[1] === c;
                return (
                  <Pressable key={c} onPress={() => tap([r, c])} accessibilityLabel={`${ch}, row ${r + 1} column ${c + 1}`}
                    style={{ width: cell, height: cell, alignItems: "center", justifyContent: "center", backgroundColor: isStart ? colors.primary : colorAt.get(`${r},${c}`) ?? "transparent", borderRadius: cell / 2 }}>
                    <Text style={{ fontSize: cell * 0.48, fontWeight: "700", color: isStart ? "#fff" : colors.text }}>{ch}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, width: board, marginTop: 14 }}>
          {puzzle.placed.map(w => {
            const got = found.some(f => f.word === w.word);
            return (
              <View key={w.word} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: got ? colors.successSoft : colors.card }}>
                <Text style={{ fontWeight: "700", color: got ? colors.muted : colors.text, textDecorationLine: got ? "line-through" : "none" }}>{w.word}</Text>
              </View>
            );
          })}
        </View>
        {done != null ? (
          <View style={{ alignItems: "center", gap: 10, marginTop: 18 }}>
            <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>{found.length === puzzle.placed.length ? "All found! 🎉" : "Game over"}</Text>
            <Text style={{ color: colors.muted }}>Score: {done}</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button title="Play again" icon="refresh" onPress={() => newGame(topic!)} />
              <Button title="Change theme" variant="soft" onPress={() => setTopic(null)} />
            </View>
          </View>
        ) : (
          <Button title="Finish" variant="soft" onPress={() => finish(found)} style={{ marginTop: 18, width: board }} />
        )}
      </ScrollView>
    </Screen>
  );
}
