import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { Text } from "../../components/Text";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../../api";
import { Button, Card, Header, Screen, SectionHeader, Pill } from "../../components/ui";
import { colors, radius } from "../../theme";
import type { Game } from "../../types";
import * as L from "../../games/ludo";

const TINT = ["#FDE3E4", "#DDF3E7", "#FFF1CC", "#DDEFFD"];
const DICE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const PRESETS: Record<number, number[]> = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };

function Setup({ onStart }: { onStart: (players: number[], computer: number[]) => void }) {
  const [count, setCount] = useState(2);
  const [human, setHuman] = useState<Record<number, boolean>>({ 0: true });
  const players = PRESETS[count];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, maxWidth: 520, width: "100%", alignSelf: "center" }}>
      <Card>
        <Text style={{ fontSize: 20, fontWeight: "800", color: colors.text }}>Ludo</Text>
        <Text style={{ color: colors.muted, marginTop: 4, lineHeight: 20 }}>
          Roll a 6 to bring a token out. Land on a rival to send it home. Stars and start squares are safe. Get all four tokens home first to win.
        </Text>
      </Card>
      <SectionHeader title="Players" />
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
        {[2, 3, 4].map(n => (
          <Pill key={n} label={`${n} players`} active={count === n} onPress={() => setCount(n)} />
        ))}
      </View>
      {players.map(c => (
        <Card key={c} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: L.COLORS[c] }} />
          <Text style={{ flex: 1, fontWeight: "700", color: colors.text }}>{L.NAMES[c]}{c === 0 ? " (you)" : ""}</Text>
          {c !== 0 && (
            <View style={{ flexDirection: "row", gap: 6 }}>
              {[false, true].map(h => (
                <Pressable key={String(h)} onPress={() => setHuman(s => ({ ...s, [c]: h }))}
                  style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: !!human[c] === h ? colors.primarySoft : colors.bg, borderWidth: 1, borderColor: !!human[c] === h ? colors.primary : colors.border }}>
                  <Text style={{ fontWeight: "600", color: colors.text }}>{h ? "Family" : "Computer"}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </Card>
      ))}
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 14 }}>“Family” players take turns on this phone.</Text>
      <Button title="Start game" icon="play" onPress={() => onStart(players, players.filter(c => c !== 0 && !human[c]))} />
    </ScrollView>
  );
}

function Board({ s, size, onToken }: { s: L.LudoState; size: number; onToken: (i: number) => void }) {
  const cell = size / 15;
  const movable = new Set(s.computer.includes(s.turn) ? [] : L.movableTokens(s));
  const startCells = new Map(L.START.map((abs, c) => [L.TRACK[abs].join(","), c]));
  const stars = new Set([8, 21, 34, 47].map(a => L.TRACK[a].join(",")));
  const sq = (r: number, c: number, bg: string, child?: React.ReactNode, key?: string) => (
    <View key={key ?? `${r}-${c}`} style={{ position: "absolute", left: c * cell, top: r * cell, width: cell, height: cell, backgroundColor: bg, borderWidth: 0.5, borderColor: "#D9D3EA", alignItems: "center", justifyContent: "center" }}>{child}</View>
  );

  // Group tokens by cell so stacked tokens are offset and readable.
  const placed: { color: number; idx: number; cellPos: L.Cell; stack: number }[] = [];
  const counts = new Map<string, number>();
  for (const color of s.players) s.tokens[color].forEach((rel, idx) => {
    const cp = L.tokenCell(color, idx, rel);
    const k = cp.join(",");
    const n = counts.get(k) ?? 0;
    counts.set(k, n + 1);
    placed.push({ color, idx, cellPos: cp, stack: n });
  });

  return (
    <View style={{ width: size, height: size, alignSelf: "center", backgroundColor: "#fff", borderRadius: 8, overflow: "hidden", borderWidth: 2, borderColor: "#CFC6EA" }}>
      {/* yards */}
      {[[0, 0], [0, 9], [9, 9], [9, 0]].map(([r, c], color) => (
        <View key={`y${color}`} style={{ position: "absolute", left: c * cell, top: r * cell, width: 6 * cell, height: 6 * cell, backgroundColor: L.COLORS[color], padding: cell * 0.7 }}>
          <View style={{ flex: 1, backgroundColor: "#fff", borderRadius: cell * 0.6, opacity: s.players.includes(color) ? 1 : 0.5 }} />
        </View>
      ))}
      {/* track + home columns */}
      {L.TRACK.map(([r, c]) => {
        const k = `${r},${c}`;
        const startOf = startCells.get(k);
        return sq(r, c, startOf != null ? L.COLORS[startOf] : "#fff", stars.has(k) ? <Text style={{ fontSize: cell * 0.55, color: "#B9AEDB" }}>★</Text> : startOf != null ? <Text style={{ fontSize: cell * 0.5, color: "#fff" }}>★</Text> : null);
      })}
      {L.HOME_COLUMN.flatMap((col, color) => col.map(([r, c]) => sq(r, c, L.COLORS[color], null, `h${color}-${r}-${c}`)))}
      {/* center */}
      <View style={{ position: "absolute", left: 6 * cell, top: 6 * cell, width: 3 * cell, height: 3 * cell, backgroundColor: "#F5EFFF", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: cell * 1.2 }}>🏠</Text>
      </View>
      {/* tokens */}
      {placed.map(t => {
        const can = t.color === s.turn && movable.has(t.idx);
        const d = cell * 0.78, off = t.stack * cell * 0.18;
        return (
          <Pressable key={`t${t.color}-${t.idx}`} onPress={() => can && onToken(t.idx)} disabled={!can}
            accessibilityLabel={`${L.NAMES[t.color]} token ${t.idx + 1}${can ? ", can move" : ""}`}
            style={{
              position: "absolute", left: t.cellPos[1] * cell + (cell - d) / 2 + off, top: t.cellPos[0] * cell + (cell - d) / 2 - off,
              width: d, height: d, borderRadius: d / 2, backgroundColor: L.COLORS[t.color], borderWidth: can ? 3 : 2,
              borderColor: can ? "#1B1630" : "#fff", shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 3,
            }} />
        );
      })}
    </View>
  );
}

export default function Ludo() {
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const size = Math.min(width - 24, 460);
  const [s, setS] = useState<L.LudoState | null>(null);
  const [rolls, setRolls] = useState(0);
  const [lastRoll, setLastRoll] = useState<number | null>(null);
  const saved = useRef(false);
  const games = useQuery({ queryKey: ["games"], queryFn: () => get<Game[]>("/games") });
  const gameId = useMemo(() => games.data?.find(g => g.title === "Ludo")?.id, [games.data]);

  const doRoll = () => setS(cur => {
    if (!cur) return cur;
    const v = 1 + Math.floor(Math.random() * 6);
    setLastRoll(v); setRolls(r => r + 1);
    return L.roll(cur, v);
  });

  // Computer turns: roll, then move.
  useEffect(() => {
    if (!s || s.winner != null || !s.computer.includes(s.turn)) return;
    const t = setTimeout(() => {
      if (s.dice == null) doRoll();
      else { const m = L.chooseMove(s); if (m != null) setS(L.move(s, m)); }
    }, s.dice == null ? 700 : 600);
    return () => clearTimeout(t);
  }, [s]);

  // Save a score when you (Red) win.
  useEffect(() => {
    if (s?.winner === 0 && gameId && !saved.current) {
      saved.current = true;
      void post(`/games/${gameId}/scores`, { score: 300 + Math.max(0, 200 - rolls) }).then(() => qc.invalidateQueries({ queryKey: ["leaderboard"] })).catch(() => undefined);
    }
  }, [s?.winner, gameId, rolls, qc]);

  if (!s) return <Screen><Header title="Ludo" back /><Setup onStart={(p, c) => { saved.current = false; setRolls(0); setLastRoll(null); setS(L.newGame(p, c)); }} /></Screen>;

  const myTurn = !s.computer.includes(s.turn);
  return (
    <Screen>
      <Header title="Ludo" back right={<Pressable onPress={() => setS(null)} hitSlop={10} accessibilityLabel="New game"><Ionicons name="refresh" size={24} color={colors.text} /></Pressable>} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 32 }}>
        <Board s={s} size={size} onToken={i => setS(L.move(s, i))} />
        <Card style={{ marginTop: 14, flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: L.COLORS[s.winner ?? s.turn] }} />
          <Text style={{ flex: 1, fontWeight: "600", color: colors.text }}>{s.log}</Text>
          <Text style={{ fontSize: 40, color: colors.text }} accessibilityLabel={lastRoll ? `Last roll ${lastRoll}` : "No roll yet"}>{lastRoll ? DICE[lastRoll] : "🎲"}</Text>
        </Card>
        {s.winner != null ? (
          <View style={{ alignItems: "center", marginTop: 16, gap: 10 }}>
            <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>{s.winner === 0 ? "You win! 🏆" : `${L.NAMES[s.winner]} wins!`}</Text>
            {s.winner === 0 && <Text style={{ color: colors.muted }}>Score saved: {300 + Math.max(0, 200 - rolls)}</Text>}
            <Button title="Play again" icon="refresh" onPress={() => setS(null)} />
          </View>
        ) : myTurn && s.dice == null ? (
          <Button title={`Roll dice (${L.NAMES[s.turn]})`} icon="cube" onPress={doRoll} style={{ marginTop: 14, backgroundColor: L.COLORS[s.turn] }} />
        ) : myTurn ? (
          <Text style={{ textAlign: "center", color: colors.muted, marginTop: 14 }}>Tap a highlighted {L.NAMES[s.turn].toLowerCase()} token to move {s.dice}.</Text>
        ) : (
          <Text style={{ textAlign: "center", color: colors.muted, marginTop: 14 }}>{L.NAMES[s.turn]} (computer) is playing…</Text>
        )}
      </ScrollView>
    </Screen>
  );
}
