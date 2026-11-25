import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "../Text";
import { haptic } from "../../haptics";
import { colors, radius, shadow } from "../../theme";
import { mathLevel, mathQuestion, rng, type MathQuestion } from "../../brain/gen";

const TOTAL = 30000;

/** Mental Math Sprint: as many sums as possible in 30 seconds. Difficulty rises with every correct answer. */
export default function MathSprint({ seed, onFinish }: { seed: number; onFinish: (score: number) => void }) {
  const [r] = useState(() => rng(seed));
  const [q, setQ] = useState<MathQuestion>(() => mathQuestion(r, 1));
  const [score, setScore] = useState(0);
  const [ms, setMs] = useState(TOTAL);
  const scoreRef = useRef(0);
  const doneRef = useRef(false);
  const cb = useRef(onFinish);
  cb.current = onFinish;
  const startRef = useRef(Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      const left = Math.max(0, TOTAL - (Date.now() - startRef.current));
      setMs(left);
      if (left === 0 && !doneRef.current) {
        doneRef.current = true;
        clearInterval(id);
        cb.current(scoreRef.current);
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  const answer = (v: number) => {
    if (doneRef.current || ms === 0) return;
    if (v === q.answer) { scoreRef.current += 1; haptic.success(); } else haptic.warning();
    setScore(scoreRef.current);
    setQ(mathQuestion(r, mathLevel(scoreRef.current)));
  };

  const left = Math.ceil(ms / 1000);
  const low = left <= 5;
  return (
    <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>{score} correct</Text>
        <Text style={{ fontWeight: "800", fontSize: 18, color: low ? colors.danger : colors.primaryDark }}>{left}s</Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden" }}>
        <View style={{ width: `${(ms / TOTAL) * 100}%`, height: "100%", borderRadius: 4, backgroundColor: low ? colors.danger : colors.primary }} />
      </View>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: 56, fontWeight: "800", letterSpacing: -1 }} numberOfLines={1} adjustsFontSizeToFit>{`${q.text} = ?`}</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 12 }}>
        {q.options.map(o => (
          <Pressable key={o} onPress={() => answer(o)} disabled={ms === 0} accessibilityRole="button" accessibilityLabel={`Answer ${o}`}
            style={({ pressed }) => [{ width: "48%", height: 84, borderRadius: radius.lg, backgroundColor: "#fff", borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center" }, shadow, pressed && { transform: [{ scale: 0.97 }] }]}>
            <Text style={{ fontSize: 30, fontWeight: "800" }}>{o}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
