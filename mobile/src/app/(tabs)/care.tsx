import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { get, mediaUrl, patch } from "../../api";
import { useAuth } from "../../auth";
import { haptic } from "../../haptics";
import { SosBanner } from "../../components/SosBanner";
import { Text } from "../../components/Text";
import { Avatar, Card, Empty, ErrorView, GradientCard, Header, IconName, IconTile, Loading, Pill, Screen, SectionHeader, timeAgo } from "../../components/ui";
import { colors, gradients, radius, statusColor } from "../../theme";
import type { Circle, Pulse, Status } from "../../types";

const EVENT_ICON: Record<string, { name: IconName; color: string; bg: string }> = {
  completed: { name: "checkmark-circle", color: colors.success, bg: colors.successSoft },
  appointment: { name: "calendar", color: colors.primary, bg: colors.primarySoft },
  photo: { name: "image", color: "#E0559A", bg: "#FDE7F1" },
  alert: { name: "warning", color: colors.warn, bg: colors.warnSoft },
};

const SHORTCUTS: { label: string; caption: string; icon: IconName; href: string; grad: readonly [string, string, ...string[]] }[] = [
  { label: "Health Vault", caption: "Vitals & medicines", icon: "pulse", href: "/health/me", grad: gradients.danger },
  { label: "Family Doctor", caption: "Records & chat", icon: "medical", href: "/doctor", grad: gradients.success },
  { label: "Safety", caption: "Location & SOS", icon: "shield-checkmark", href: "/safety", grad: gradients.ocean },
  { label: "Fitness", caption: "Walks, runs & rides", icon: "walk", href: "/fitness", grad: gradients.sunrise },
  { label: "Family lists", caption: "Groceries & to-dos", icon: "cart", href: "/lists", grad: gradients.success },
  { label: "Emergency card", caption: "Blood group & contacts", icon: "id-card", href: "/emergency", grad: gradients.danger },
  { label: "Games", caption: "Play together", icon: "game-controller", href: "/games", grad: gradients.sunrise },
];

export default function Care() {
  const { user, refresh } = useAuth();
  const circles = useQuery({ queryKey: ["circles"], queryFn: () => get<Circle[]>("/circles") });
  const [circleId, setCircleId] = useState<string | null>(null);
  useEffect(() => {
    if (!circleId && circles.data?.length) setCircleId((circles.data.find(c => c.type === "Family") ?? circles.data[0]).id);
  }, [circles.data, circleId]);
  const circle = circles.data?.find(c => c.id === circleId);

  const pulse = useQuery({ queryKey: ["pulse", circleId], enabled: !!circleId, queryFn: () => get<Pulse>(`/pulse/${circleId}`), refetchInterval: 30_000 });

  const cycleStatus = async () => {
    const order: Status[] = ["Active", "All good", "Busy"];
    const next = order[(order.indexOf(user?.status ?? "Active") + 1) % order.length];
    haptic.select();
    await patch("/me", { status: next });
    await refresh();
    pulse.refetch();
  };

  const allGood = pulse.data?.summary !== "needs_attention";
  const others = (pulse.data?.members ?? []).filter(m => m.id !== user?.id);

  return (
    <Screen tab>
      <Header title="Family Pulse" subtitle={circle ? circle.name : undefined}
        right={circleId ? <Pressable onPress={() => router.push(`/chat/${circleId}`)} accessibilityLabel="Open family chat"
          style={{ width: 42, height: 42, borderRadius: 21, overflow: "hidden" }}><IconTile icon="chatbubbles" gradient={gradients.primary} size={42} /></Pressable> : undefined} />
      {circles.isLoading ? <Loading /> : circles.error ? <ErrorView error={circles.error} onRetry={() => circles.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
          {(circles.data?.length ?? 0) > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
              {circles.data!.map(c => <Pill key={c.id} label={c.name} active={c.id === circleId} onPress={() => setCircleId(c.id)} />)}
            </ScrollView>
          )}

          <SosBanner />

          <GradientCard colors={allGood ? gradients.hero : gradients.danger}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={allGood ? "heart" : "warning"} size={28} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 19 }}>{allGood ? "Everyone is doing great" : "Someone needs attention"}</Text>
                <Text style={{ color: "rgba(255,255,255,0.85)", marginTop: 2 }}>{allGood ? "Here's what's happening today" : "An SOS alert was sent in the last 24 hours"}</Text>
              </View>
            </View>
          </GradientCard>

          <Pressable onPress={() => { haptic.warning(); router.push("/sos"); }} accessibilityRole="button" accessibilityLabel="Emergency SOS"
            style={({ pressed }) => ({ marginTop: 14, flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: radius.lg, backgroundColor: colors.dangerSoft, borderWidth: 1.5, borderColor: colors.danger, opacity: pressed ? 0.85 : 1 })}>
            <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="alert" size={26} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "800", fontSize: 16, color: colors.danger }}>Emergency SOS</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>Alert family, share live location, video and audio</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.danger} />
          </Pressable>

          <SectionHeader title="Members" action={others.length ? undefined : "Invite"} onAction={() => router.push("/circles")} />
          <Card style={{ paddingVertical: 14 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 18, paddingHorizontal: 2 }}>
              {(pulse.data?.members ?? []).map(m => (
                <Pressable key={m.id} style={{ alignItems: "center", width: 68 }}
                  onPress={() => m.id === user?.id ? cycleStatus() : router.push(`/health/${m.id}`)} accessibilityLabel={`${m.name}, ${m.status}`}>
                  <Avatar uri={m.avatarUrl} name={m.name} size={58} ring />
                  <Text style={{ fontWeight: "700", marginTop: 6, fontSize: 13 }} numberOfLines={1}>{m.id === user?.id ? "You" : m.name.split(" ")[0]}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor(m.status) }} />
                    <Text style={{ fontSize: 11, color: colors.muted }}>{m.status}</Text>
                  </View>
                </Pressable>
              ))}
              {!others.length && (
                <Pressable onPress={() => router.push("/circles")} style={{ alignItems: "center", width: 68 }} accessibilityLabel="Invite family">
                  <View style={{ width: 58, height: 58, borderRadius: 29, borderWidth: 2, borderStyle: "dashed", borderColor: "#7FD9F0", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="person-add" size={22} color={colors.primary} />
                  </View>
                  <Text style={{ fontWeight: "700", marginTop: 6, fontSize: 13, color: colors.primary }}>Invite</Text>
                </Pressable>
              )}
            </ScrollView>
            <Text style={{ color: colors.faint, fontSize: 12, marginTop: 12 }}>Tap your photo to change your status. Tap someone to open their Health Vault.</Text>
          </Card>

          <SectionHeader title="Care tools" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {SHORTCUTS.map(sc => (
              <Card key={sc.label} onPress={() => router.push(sc.href as never)} style={{ width: "47.8%", padding: 14, gap: 10 }}>
                <IconTile icon={sc.icon} gradient={sc.grad} size={42} />
                <View>
                  <Text style={{ fontWeight: "700" }}>{sc.label}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{sc.caption}</Text>
                </View>
              </Card>
            ))}
          </View>

          <SectionHeader title="Recent activity" />
          {pulse.isLoading ? <Loading rows={2} /> : (pulse.data?.events.length ?? 0) === 0 ? (
            <Card><Empty compact icon="pulse-outline" title="No activity yet" text="When your family completes tasks, shares photos or checks in, you'll see it here." /></Card>
          ) : (
            <View style={{ gap: 10 }}>
              {pulse.data!.events.map(e => {
                const ic = EVENT_ICON[e.kind] ?? EVENT_ICON.completed;
                return (
                  <Card key={e.id} style={{ padding: 14, backgroundColor: e.kind === "alert" ? colors.warnSoft : colors.card }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <Avatar uri={e.user.avatarUrl} name={e.user.name} size={42} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: "600", lineHeight: 20 }}><Text style={{ fontWeight: "800" }}>{e.user.id === user?.id ? "You" : e.user.name}</Text> {e.text}</Text>
                        <Text style={{ color: colors.faint, marginTop: 2, fontSize: 12 }}>{timeAgo(e.createdAt)}</Text>
                      </View>
                      <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: ic.bg, alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name={ic.name} size={18} color={ic.color} />
                      </View>
                    </View>
                    {e.imageUrl && <Image source={{ uri: mediaUrl(e.imageUrl) }} style={{ width: "100%", height: 150, borderRadius: radius.md, marginTop: 12 }} />}
                  </Card>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}
