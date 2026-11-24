import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { Text } from "../components/Text";
import { showAlert, showError } from "../alert";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Location from "expo-location";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, put } from "../api";
import { useAuth } from "../auth";
import { OsmMap, MapPin } from "../components/OsmMap";
import { Avatar, Button, Card, Chip, ErrorView, Header, IconName, Loading, Screen, SectionHeader, Pill, timeAgo } from "../components/ui";
import { colors, radius } from "../theme";
import type { Circle, SafetySettings, SharedLocation, SosContact } from "../types";

const SHARE_HOURS = [1, 4, 12];

export default function Safety() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const circles = useQuery({ queryKey: ["circles"], queryFn: () => get<Circle[]>("/circles") });
  const [circleId, setCircleId] = useState<string | null>(null);
  useEffect(() => { if (!circleId && circles.data?.length) setCircleId((circles.data.find(c => c.type === "Family") ?? circles.data[0]).id); }, [circles.data, circleId]);
  const circle = circles.data?.find(c => c.id === circleId);

  const settings = useQuery({ queryKey: ["safety"], queryFn: () => get<SafetySettings>("/safety") });
  const sosContacts = useQuery({ queryKey: ["sos-contacts"], queryFn: () => get<SosContact[]>("/sos/contacts") });
  const shared = useQuery({
    queryKey: ["locations", circleId], enabled: !!circleId, refetchInterval: 15_000,
    queryFn: () => get<SharedLocation[]>(`/location/circle/${circleId}`),
  });
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [hours, setHours] = useState(4);

  const locate = useCallback(async (): Promise<{ lat: number; lng: number } | null> => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) { showAlert("Location needed", "Allow location access in Settings to use this feature."); return null; }
    const p = await Location.getCurrentPositionAsync({});
    const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
    setMe(pos);
    await put("/location", pos);
    return pos;
  }, []);

  useEffect(() => { locate().catch(() => undefined); }, [locate]);

  // While I'm sharing, keep my position fresh.
  const iAmSharing = !!shared.data?.some(s => s.user.id === user?.id);
  useEffect(() => {
    if (!iAmSharing) return;
    const t = setInterval(() => { locate().then(() => shared.refetch()).catch(() => undefined); }, 30_000);
    return () => clearInterval(t);
  }, [iAmSharing, locate, shared]);

  const share = useMutation({
    mutationFn: async () => { await locate(); return post("/location/share", { circleId, hours }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["locations"] }),
    onError: e => showError("Couldn't share location", e),
  });
  const stop = useMutation({
    mutationFn: () => post("/location/stop"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["locations"] }),
  });
  const update = useMutation({
    mutationFn: (b: Partial<SafetySettings>) => put<SafetySettings>("/safety", b),
    onSuccess: d => qc.setQueryData(["safety"], d),
    onError: e => showAlert("Couldn't save", e instanceof Error ? e.message : "Try again"),
  });
  const setHome = async () => {
    const pos = me ?? await locate();
    if (pos) update.mutate({ homeLat: pos.lat, homeLng: pos.lng });
  };
  const pins = useMemo<MapPin[]>(() => {
    const out: MapPin[] = (shared.data ?? []).map(s => ({
      id: s.user.id, lat: s.lat, lng: s.lng, initial: s.user.name.slice(0, 1).toUpperCase(),
      label: `${s.user.id === user?.id ? "You" : s.user.name}${s.label ? ` • ${s.label}` : ""}`, me: s.user.id === user?.id,
    }));
    if (me && !out.some(p => p.id === user?.id)) out.push({ id: user!.id, lat: me.lat, lng: me.lng, initial: "Me", label: "You (not sharing)", me: true });
    return out;
  }, [shared.data, me, user]);

  const s = settings.data;
  const rows: { key: keyof SafetySettings; icon: IconName; label: string; sub: string }[] = [
    { key: "homeAlerts", icon: "home", label: "Arrived Home Alerts", sub: s?.homeLat != null ? "Notify circles when you get home" : "Set your home location first" },
    { key: "sosAlert", icon: "alert-circle", label: "SOS Emergency Alert", sub: "Allow sending SOS to your circles" },
    { key: "shareJourney", icon: "navigate", label: "Share Journey", sub: "Keep sharing while you travel" },
  ];

  return (
    <Screen>
      <Header title="Safety & Location" back />
      {circles.isLoading || settings.isLoading ? <Loading /> : circles.error ? <ErrorView error={circles.error} onRetry={() => circles.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
          <OsmMap pins={pins} />

          {(circles.data?.length ?? 0) > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 12 }}>
              {circles.data!.map(c => (
                <Pill key={c.id} label={c.name} active={c.id === circleId} onPress={() => setCircleId(c.id)} />
              ))}
            </ScrollView>
          )}

          <Card style={{ marginTop: 14, backgroundColor: iAmSharing ? colors.successSoft : colors.card }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Ionicons name={iAmSharing ? "checkmark-circle" : "location-outline"} size={28} color={iAmSharing ? colors.success : colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", color: colors.text }}>{iAmSharing ? `Sharing location with ${circle?.name}` : "Not sharing your location"}</Text>
                <Text style={{ color: colors.muted }}>
                  {iAmSharing ? `Until ${new Date(shared.data!.find(x => x.user.id === user?.id)!.sharingUntil).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : `Share with ${circle?.name ?? "your circle"} for a while`}
                </Text>
              </View>
              {iAmSharing && <Button title="Stop" variant="soft" onPress={() => stop.mutate()} loading={stop.isPending} style={{ paddingVertical: 6, minHeight: 34 }} />}
            </View>
            {!iAmSharing && (
              <View style={{ marginTop: 12 }}>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
                  {SHARE_HOURS.map(h => (
                    <Pill key={h} label={`${h} hr`} active={hours === h} onPress={() => setHours(h)} />
                  ))}
                </View>
                <Button title="Start sharing" icon="location" onPress={() => share.mutate()} loading={share.isPending} disabled={!circleId} />
              </View>
            )}
          </Card>

          {(shared.data ?? []).some(x => x.user.id !== user?.id) && (
            <>
              <SectionHeader title="Who's sharing" />
              <Card style={{ paddingVertical: 4 }}>
                {(shared.data ?? []).filter(x => x.user.id !== user?.id).map((x, i) => {
                  const mins = Math.max(0, (Date.now() - new Date(x.updatedAt).getTime()) / 60000);
                  const stale = mins > 30;
                  return (
                    <View key={x.user.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                      <Avatar uri={x.user.avatarUrl} name={x.user.name} size={42} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: "700" }}>{x.user.name}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>{x.label ? `${x.label} · ` : ""}{stale ? "Last seen" : "Updated"} {timeAgo(x.updatedAt)}</Text>
                      </View>
                      <Chip label={stale ? "May be offline" : "Live"} tone={stale ? "amber" : "success"} small />
                    </View>
                  );
                })}
              </Card>
              <Text style={{ color: colors.faint, fontSize: 12, marginTop: 8, marginLeft: 4, lineHeight: 17 }}>
                A phone that's switched off or has no signal can't report its position. You'll see the last place it was, and when.
              </Text>
            </>
          )}

          <SectionHeader title="Safety Features" />
          <Card style={{ paddingVertical: 4 }}>
            {rows.map((r, i) => (
              <View key={r.key} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                <Ionicons name={r.icon} size={24} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "600", fontSize: 16, color: colors.text }}>{r.label}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{r.sub}</Text>
                </View>
                <Switch value={!!s?.[r.key]} onValueChange={v => update.mutate({ [r.key]: v })} trackColor={{ true: colors.primary }} />
              </View>
            ))}
          </Card>
          <Button title={s?.homeLat != null ? "Update home to my current location" : "Set my current location as home"} variant="soft" icon="home" onPress={setHome} style={{ marginTop: 12 }} />
          <Card onPress={() => router.push("/sos-contacts")} style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Ionicons name="people-circle" size={30} color={colors.danger} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "700", fontSize: 16 }}>SOS settings</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                {(sosContacts.data?.length ?? 0) === 0 ? "Add emergency contacts and choose recording" : `${sosContacts.data!.length} emergency contact${sosContacts.data!.length === 1 ? "" : "s"} · video recording ${s?.sosRecording ? "on" : "off"}`}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.faint} />
          </Card>
          <Button title="Send SOS" variant="danger" icon="alert-circle" onPress={() => router.push("/sos")} disabled={s?.sosAlert === false} style={{ marginTop: 12 }} />
        </ScrollView>
      )}
    </Screen>
  );
}
