import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { get } from "../../api";
import { haptic } from "../../haptics";
import { dueText, fmtMin } from "../../studyFormat";
import { BrainSummary } from "../../components/brain/BrainSummary";
import { Text } from "../../components/Text";
import { Card, Empty, ErrorView, Header, IconName, IconTile, Loading, Screen, SectionHeader } from "../../components/ui";
import { colors, gradients } from "../../theme";
import type { StudyToday } from "../../types";

const TOOLS: { label: string; caption: string; icon: IconName; href: string; grad: readonly [string, string, ...string[]] }[] = [
  { label: "Timetable", caption: "Your weekly plan", icon: "calendar", href: "/study-timetable", grad: gradients.ocean },
  { label: "Assignments", caption: "Homework and deadlines", icon: "document-text", href: "/study-assignments", grad: gradients.sunrise },
  { label: "Syllabus", caption: "Chapters and progress", icon: "list", href: "/study-syllabus", grad: gradients.success },
  { label: "Study materials", caption: "Notes, formulas, links", icon: "library", href: "/study-materials", grad: gradients.danger },
];

export default function Study() {
  const today = useQuery({ queryKey: ["study-today"], queryFn: () => get<StudyToday>("/study/today") });
  const d = today.data;
  const empty = !!d && !d.slots.length && !d.assignments.length;

  return (
    <Screen tab>
      <Header title="Study" subtitle="Brain Gym and Aaj Ka Plan" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
        <SectionHeader title="Brain Gym" action="Open" onAction={() => router.push("/brain")} />
        <BrainSummary />

        <SectionHeader title="Aaj Ka Plan" />
        {today.isLoading ? <Loading rows={2} /> : today.error ? <ErrorView error={today.error} onRetry={() => today.refetch()} /> : (
          <Card style={{ padding: 16, marginBottom: 14 }}>
            {empty ? (
              <Empty compact icon="calendar-outline" title="Nothing planned for today" text="Add your classes and study time to the timetable, or add an assignment with a deadline."
                actionLabel="Open timetable" onAction={() => router.push("/study-timetable")} />
            ) : (
              <View style={{ gap: 14 }}>
                {!!d!.slots.length && (
                  <View style={{ gap: 8 }}>
                    <Text style={{ fontWeight: "800", fontSize: 15 }}>Today's schedule</Text>
                    {d!.slots.map(s => (
                      <View key={s.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, opacity: s.past ? 0.5 : 1 }}>
                        <View style={{ width: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: s.color ?? colors.primary }} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontWeight: "700" }} numberOfLines={1}>{s.title}</Text>
                          <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtMin(s.startMin)} to {fmtMin(s.endMin)}{s.subject ? `, ${s.subject}` : ""}</Text>
                        </View>
                        {s.now && <View style={{ backgroundColor: colors.successSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}><Text style={{ color: colors.success, fontWeight: "800", fontSize: 11 }}>NOW</Text></View>}
                      </View>
                    ))}
                  </View>
                )}
                {!!d!.assignments.length && (
                  <View style={{ gap: 8 }}>
                    <Text style={{ fontWeight: "800", fontSize: 15 }}>Due soon</Text>
                    {d!.assignments.slice(0, 4).map(a => (
                      <View key={a.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <Ionicons name={a.overdue ? "alert-circle" : "ellipse-outline"} size={18} color={a.overdue ? colors.danger : colors.muted} />
                        <Text style={{ flex: 1, fontWeight: "600" }} numberOfLines={1}>{a.title}</Text>
                        <Text style={{ color: a.overdue ? colors.danger : colors.muted, fontSize: 12, fontWeight: "600" }}>{dueText(a.dueIn)}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}
            {!!d && d.chaptersLeft > 0 && (
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: empty ? 8 : 14 }}>{d.chaptersLeft} syllabus chapter{d.chaptersLeft === 1 ? "" : "s"} still to cover</Text>
            )}
          </Card>
        )}

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {TOOLS.map(t => (
            <Card key={t.label} onPress={() => { haptic.tap(); router.push(t.href as never); }} style={{ width: "47.8%", padding: 14, gap: 10 }}>
              <IconTile icon={t.icon} gradient={t.grad} size={42} />
              <View>
                <Text style={{ fontWeight: "700" }}>{t.label}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{t.caption}</Text>
              </View>
            </Card>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
