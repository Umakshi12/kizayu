import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";
import { get } from "../api";
import { useAuth } from "../auth";
import { haptic } from "../haptics";
import { fmtDuration, fmtKm, fmtPace, kindInfo } from "../fitness";
import { Text } from "../components/Text";
import { ChallengesSection } from "../components/Challenges";
import { Avatar, Button, Card, Empty, ErrorView, Header, IconTile, Loading, Pill, Screen, SectionHeader, timeAgo } from "../components/ui";
import { colors, glow, gradients, radius } from "../theme";
import type { Circle, FeedWorkout, FitnessSummary, LeaderRow } from "../types";

const DAY = ["S", "M", "T", "W", "T", "F", "S"];
const MEDAL = ["#FFC845", "#B8C4CE", "#D9965B"];

function Hero({ s }: { s: FitnessSummary }) {
  const max = Math.max(1000, ...s.days.map(d => d.distanceM));
  return (
    <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.xl, padding: 18, ...glow }}>
      <Text style={{ color: "rgba(255,255,255,0.75)", fontWeight: "700", letterSpacing: 1, fontSize: 12 }}>LAST 7 DAYS</Text>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, marginTop: 4 }}>
        <Text style={{ color: "#fff", fontSize: 46, fontWeight: "800", letterSpacing: -1 }}>{(s.week.distanceM / 1000).toFixed(1)}</Text>
        <Text style={{ color: "rgba(255,255,255,0.8)", fontWeight: "700", marginBottom: 10 }}>km</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, height: 64, marginTop: 8 }}>
        {s.days.map((d, i) => {
          const isToday = i === 6;
          return (
            <View key={d.date} style={{ flex: 1, alignItems: "center", gap: 6 }}>
              <View style={{ flex: 1, justifyContent: "flex-end", width: "100%" }}>
                <View style={{ width: "100%", height: Math.max(4, (d.distanceM / max) * 44), borderRadius: 4, backgroundColor: isToday ? "#fff" : "rgba(255,255,255,0.35)" }} />
              </View>
              <Text style={{ color: isToday ? "#fff" : "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700" }}>{DAY[new Date(`${d.date}T12:00:00`).getDay()]}</Text>
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.18)" }}>
        {[["Workouts", String(s.week.count)], ["Active", fmtDuration(s.week.durationSec)], ["Calories", String(s.week.calories)], ["Est. steps", s.week.steps.toLocaleString()]].map(([k, v]) => (
          <View key={k} style={{ flex: 1 }}>
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{v}</Text>
            <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "600", marginTop: 1 }}>{k}</Text>
          </View>
        ))}
      </View>
    </LinearGradient>
  );
}

function FeedCard({ w, mine }: { w: FeedWorkout; mine: boolean }) {
  const k = kindInfo(w.kind);
  return (
    <Card onPress={() => router.push(`/activity/${w.id}`)} style={{ marginBottom: 10, padding: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Avatar uri={w.user.avatarUrl} name={w.user.name} size={34} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "700" }}>{mine ? "You" : w.user.name}</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{timeAgo(w.startedAt)}{!w.shared ? " · private" : ""}</Text>
        </View>
        <IconTile icon={k.icon} gradient={gradients.ocean} size={36} />
      </View>
      <Text style={{ fontWeight: "800", fontSize: 16, marginBottom: 10 }}>{w.title || `${k.label}`}</Text>
      <View style={{ flexDirection: "row" }}>
        {[[fmtKm(w.distanceM), "Distance"], [fmtDuration(w.durationSec), "Time"], [fmtPace(w.kind, w.distanceM, w.durationSec), w.kind === "cycle" ? "Speed" : "Pace"]].map(([v, l]) => (
          <View key={l} style={{ flex: 1 }}>
            <Text style={{ fontWeight: "800", fontSize: 16 }}>{v}</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>{l}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

export default function Fitness() {
  const { user } = useAuth();
  const tz = new Date().getTimezoneOffset();
  const summary = useQuery({ queryKey: ["fitness", "summary"], queryFn: () => get<FitnessSummary>(`/activities/summary?tz=${tz}`) });
  const feed = useQuery({ queryKey: ["fitness", "feed"], queryFn: () => get<FeedWorkout[]>("/activities/feed") });
  const circles = useQuery({ queryKey: ["circles"], queryFn: () => get<Circle[]>("/circles") });
  const [circleId, setCircleId] = useState<string | null>(null);
  useEffect(() => { if (!circleId && circles.data?.length) setCircleId((circles.data.find(c => c.type === "Family") ?? circles.data[0]).id); }, [circles.data, circleId]);
  const board = useQuery({ queryKey: ["fitness", "board", circleId], enabled: !!circleId, queryFn: () => get<LeaderRow[]>(`/activities/leaderboard?circleId=${circleId}`) });
  const active = (board.data ?? []).some(r => r.distanceM > 0);

  return (
    <Screen>
      <Header title="Fitness" subtitle="Walks, runs and rides" back />
      {summary.isLoading ? <Loading /> : summary.error ? <ErrorView error={summary.error} onRetry={() => summary.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
          <Hero s={summary.data!} />
          <Button title="Start a workout" icon="play" onPress={() => { haptic.tap(); router.push("/workout"); }} style={{ marginTop: 14 }} />

          <SectionHeader title="Family leaderboard" />
          {(circles.data?.length ?? 0) > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 12 }}>
              {circles.data!.map(c => <Pill key={c.id} label={c.name} active={c.id === circleId} onPress={() => setCircleId(c.id)} />)}
            </ScrollView>
          )}
          <Card style={{ paddingVertical: 6 }}>
            {board.isLoading ? <Loading rows={1} /> : !active ? (
              <Empty compact icon="trophy-outline" title="No workouts yet this week" text="Start one and be first on the board. Only shared workouts count." />
            ) : board.data!.map((r, i) => (
              <View key={r.user.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border, opacity: r.distanceM > 0 ? 1 : 0.5 }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: i < 3 && r.distanceM > 0 ? MEDAL[i] : colors.primaryTint }}>
                  <Text style={{ fontWeight: "800", fontSize: 13, color: i < 3 && r.distanceM > 0 ? "#fff" : colors.muted }}>{i + 1}</Text>
                </View>
                <Avatar uri={r.user.avatarUrl} name={r.user.name} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700" }}>{r.user.id === user?.id ? "You" : r.user.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{r.count} workout{r.count === 1 ? "" : "s"}</Text>
                </View>
                <Text style={{ fontWeight: "800", fontSize: 16 }}>{(r.distanceM / 1000).toFixed(1)} km</Text>
              </View>
            ))}
          </Card>

          {circleId && <ChallengesSection circleId={circleId} />}

          <SectionHeader title="Recent activity" />
          {feed.isLoading ? <Loading rows={2} /> : (feed.data?.length ?? 0) === 0 ? (
            <Card><Empty compact icon="walk-outline" title="Nothing recorded yet" text="Your workouts and your family's show up here, with the route on a map." actionLabel="Start your first workout" onAction={() => router.push("/workout")} /></Card>
          ) : feed.data!.map(w => <FeedCard key={w.id} w={w} mine={w.userId === user?.id} />)}
        </ScrollView>
      )}
    </Screen>
  );
}
