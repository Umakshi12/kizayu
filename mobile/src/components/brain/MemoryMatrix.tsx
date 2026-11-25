import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../Text";
import { haptic } from "../../haptics";
import { colors, radius } from "../../theme";
import { matrixRound, rng } from "../../brain/gen";

type Phase = "show" | "tap" | "miss" | "over";
const LIVES = 2;
const GAP = 8;

/** Memory Matrix: watch the tiles light up, then tap the same ones. Each cleared round adds a tile. Score = rounds cleared. */
export default function MemoryMatrix({ seed, onFinish }: { seed: number; onFinish: (score: number) => void }) {
  const { width } = useWindowDimensions();
  const board = Math.min(width, 420) - 40;
  const [level, setLevel] = useState(1);
  const [phase, setPhase] = useState<Phase>("show");
  const [lives, setLives] = useState(LIVES);
  const [picked, setPicked] = useState<number[]>([]);
  const [miss, setMiss] = useState<number | null>(null);
  const round = useMemo(() => matrixRound(rng(seed + level), level), [seed, level]);
  const n = round.size;
  const cell = Math.floor((board - GAP * (n - 1)) / n);
  const cb = useRef(onFinish);
  cb.current = onFinish;

  // Light the tiles up, then hand over to the player.
  useEffect(() => {
    if (phase !== "show") return;
    const t = setTimeout(() => setPhase("tap"), 1200 + 300 * (round.tiles.length - 1));
    return () => clearTimeout(t);
  }, [phase, round]);

  // A wrong tile costs a life, then the same round is shown again.
  useEffect(() => {
    if (phase !== "miss") return;
    const t = setTimeout(() => { setMiss(null); setPicked([]); setPhase("show"); }, 900);
    return () => clearTimeout(t);
  }, [phase]);

  // Out of lives: show the board for a moment, then report the score.
  useEffect(() => {
    if (phase !== "over") return;
    const t = setTimeout(() => cb.current(level - 1), 1200);
    return () => clearTimeout(t);
  }, [phase, level]);

  const tap = (i: number) => {
    if (phase !== "tap" || picked.includes(i)) return;
    if (!round.tiles.includes(i)) {
      haptic.warning();
      const left = lives - 1;
      setLives(left);
      setMiss(i);
      setPhase(left > 0 ? "miss" : "over");
      return;
    }
    const next = [...picked, i];
    if (next.length === round.tiles.length) {
      haptic.success();
      setLevel(level + 1);
      setPicked([]);
      setPhase("show");
    } else {
      haptic.tap();
      setPicked(next);
    }
  };

  const status = phase === "show" ? "Remember these tiles" : phase === "tap" ? "Tap the tiles you saw" : phase === "miss" ? "Not quite. Watch again" : "Out of lives";
  return (
    <View style={{ flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20 }}>
      <View style={{ width: board, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Round {level}</Text>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {Array.from({ length: LIVES }, (_, i) => <Ionicons key={i} name={i < lives ? "heart" : "heart-outline"} size={22} color={colors.danger} />)}
        </View>
      </View>
      <Text style={{ width: board, color: colors.muted, fontWeight: "600", marginBottom: 18 }}>{status}</Text>
      <View style={{ width: board, flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
        {Array.from({ length: n * n }, (_, i) => {
          const lit = phase === "show" || phase === "over" ? round.tiles.includes(i) : picked.includes(i) || miss === i;
          const bad = miss === i;
          const bg = bad ? colors.danger : lit ? colors.primary : "#fff";
          return (
            <Pressable key={i} onPress={() => tap(i)} disabled={phase !== "tap"} accessibilityRole="button" accessibilityLabel={`Tile ${i + 1}`}
              style={{ width: cell, height: cell, borderRadius: radius.md, backgroundColor: bg, borderWidth: 1.5, borderColor: bg === "#fff" ? colors.border : bg }} />
          );
        })}
      </View>
    </View>
  );
}
