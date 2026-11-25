import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../Text";
import { haptic } from "../../haptics";
import { colors, radius } from "../../theme";
import { quantSet } from "../../brain/gen";
import { Button, Card } from "../ui";

/** Quant puzzles: five multiple choice questions with an explanation after each. Score = number correct. */
export default function QuantPuzzles({ seed, onFinish }: { seed: number; onFinish: (score: number) => void }) {
  const questions = useMemo(() => quantSet(seed, 5), [seed]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const doneRef = useRef(false);
  const cb = useRef(onFinish);
  cb.current = onFinish;

  const q = questions[idx];
  const answered = picked !== null;
  const last = idx === questions.length - 1;
  const right = picked === q.answerIndex;

  const choose = (i: number) => {
    if (answered) return;
    if (i === q.answerIndex) { setScore(s => s + 1); haptic.success(); } else haptic.warning();
    setPicked(i);
  };

  const next = () => {
    if (last) {
      if (!doneRef.current) { doneRef.current = true; cb.current(score); }
      return;
    }
    setIdx(idx + 1);
    setPicked(null);
  };

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 }}>
      <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, marginBottom: 20 }}>
        {questions.map((_, i) => {
          const filled = i < idx || (i === idx && answered);
          return <View key={i} style={{ width: i === idx ? 22 : 10, height: 10, borderRadius: 5, backgroundColor: filled ? colors.primary : i === idx ? colors.primarySoft : colors.border }} />;
        })}
      </View>

      <Card style={{ padding: 20 }}>
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, marginBottom: 8 }}>{`Question ${idx + 1} of ${questions.length}`}</Text>
        <Text style={{ fontSize: 19, fontWeight: "700", lineHeight: 28 }}>{q.text}</Text>
      </Card>

      <View style={{ gap: 10, marginTop: 16 }}>
        {q.options.map((o, i) => {
          const showRight = answered && i === q.answerIndex;
          const showWrong = answered && picked === i && i !== q.answerIndex;
          const bg = showRight ? colors.successSoft : showWrong ? colors.dangerSoft : "#fff";
          const border = showRight ? colors.success : showWrong ? colors.danger : colors.border;
          return (
            <Pressable key={i} onPress={() => choose(i)} disabled={answered} accessibilityRole="button" accessibilityLabel={`Option ${o}`}
              style={({ pressed }) => [{ minHeight: 56, borderRadius: radius.md, paddingHorizontal: 18, paddingVertical: 14, backgroundColor: bg, borderWidth: 1.5, borderColor: border, flexDirection: "row", alignItems: "center", gap: 10 }, pressed && !answered && { opacity: 0.7 }]}>
              <Text style={{ flex: 1, fontSize: 16, fontWeight: "700" }}>{o}</Text>
              {showRight && <Ionicons name="checkmark-circle" size={22} color={colors.success} />}
              {showWrong && <Ionicons name="close-circle" size={22} color={colors.danger} />}
            </Pressable>
          );
        })}
      </View>

      {answered && (
        <Card style={{ marginTop: 16, backgroundColor: colors.primaryTint }}>
          <Text style={{ fontWeight: "800", marginBottom: 6, color: right ? "#0E7D4B" : "#B3263F" }}>{right ? "Correct" : "Not quite"}</Text>
          <Text style={{ lineHeight: 22 }}>{q.explain}</Text>
        </Card>
      )}
      {answered && <Button title="Next" onPress={next} style={{ marginTop: 16 }} />}
    </ScrollView>
  );
}
