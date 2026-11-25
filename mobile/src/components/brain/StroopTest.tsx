import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "../Text";
import { haptic } from "../../haptics";
import { colors, radius, shadow } from "../../theme";
import { rng, STROOP_COLORS, stroopTrial, type StroopTrial } from "../../brain/gen";

const TOTAL = 30000;

/** Focus (Stroop) test: name the INK colour of each word, not the word itself. Score = max(0, correct - wrong). */
export default function StroopTest({ seed, onFinish }: { seed: number; onFinish: (score: number) => void }) {
  const [r] = useState(() => rng(seed));
  const [trial, setTrial] = useState<StroopTrial>(() => stroopTrial(r));
  const [tally, setTally] = useState({ right: 0, wrong: 0 });
  const [ms, setMs] = useState(TOTAL);
  const tallyRef = useRef({ right: 0, wrong: 0 });
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
        const t = tallyRef.current;
        cb.current(Math.max(0, t.right - t.wrong));
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  const answer = (name: string) => {
    if (doneRef.current || ms === 0) return;
    const t = { ...tallyRef.current };
    if (name === trial.inkName) { t.right += 1; haptic.tap(); } else { t.wrong += 1; haptic.warning(); }
    tallyRef.current = t;
    setTally(t);
    setTrial(stroopTrial(r));
  };

  const left = Math.ceil(ms / 1000);
  const low = left <= 5;
  return (
    <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <Text style={{ fontWeight: "800", fontSize: 18 }}>Score {Math.max(0, tally.right - tally.wrong)}</Text>
        <Text style={{ fontWeight: "800", fontSize: 18, color: low ? colors.danger : colors.primaryDark }}>{left}s</Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden" }}>
        <View style={{ width: `${(ms / TOTAL) * 100}%`, height: "100%", borderRadius: 4, backgroundColor: low ? colors.danger : colors.primary }} />
      </View>
      <Text style={{ textAlign: "center", color: colors.muted, fontWeight: "600", marginTop: 14 }}>Tap the colour the word is printed in, not the word.</Text>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: 64, fontWeight: "800", color: trial.ink }}>{trial.word}</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10 }}>
        {STROOP_COLORS.map(c => (
          <Pressable key={c.name} onPress={() => answer(c.name)} disabled={ms === 0} accessibilityRole="button" accessibilityLabel={c.name}
            style={({ pressed }) => [{ width: "30%", height: 56, borderRadius: radius.md, backgroundColor: "#fff", borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center" }, shadow, pressed && { opacity: 0.7 }]}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>{c.name}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
