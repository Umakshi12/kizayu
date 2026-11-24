import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, BackHandler, Linking, Pressable, ScrollView, Switch, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { post } from "../api";
import { showAlert, showError } from "../alert";
import { haptic } from "../haptics";
import { distanceM, fmtDuration, fmtKm, fmtPace, KIND_INFO, simplifyRoute, type Kind } from "../fitness";
import { Text, TextInput } from "../components/Text";
import { MapPin, OsmMap } from "../components/OsmMap";
import { Button } from "../components/ui";
import { colors, radius } from "../theme";
import type { Workout } from "../types";

type Stage = "setup" | "tracking" | "summary";
const KINDS: Kind[] = ["walk", "run", "cycle"];

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={{ color: "#fff", fontSize: 24, fontWeight: "800" }}>{value}</Text>
      <Text style={{ color: "#8FA3B3", fontSize: 12, fontWeight: "600", marginTop: 2 }}>{label}</Text>
    </View>
  );
}

export default function WorkoutScreen() {
  const qc = useQueryClient();
  const [stage, setStage] = useState<Stage>("setup");
  const [kind, setKind] = useState<Kind>("walk");
  const [paused, setPaused] = useState(false);
  const [away, setAway] = useState(false);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [gotFix, setGotFix] = useState(false);
  const [distance, setDistance] = useState(0);
  const [route, setRoute] = useState<[number, number][]>([]);
  const [now, setNow] = useState(Date.now());
  const [title, setTitle] = useState("");
  const [shared, setShared] = useState(true);
  const [saving, setSaving] = useState(false);

  const stageRef = useRef<Stage>("setup");
  const kindRef = useRef<Kind>("walk");
  const pausedRef = useRef(false);
  const pts = useRef<[number, number][]>([]);
  const dist = useRef(0);
  const lastTs = useRef(0);
  const startMs = useRef(0);
  const pausedTotal = useRef(0);
  const pauseStart = useRef(0);
  const watcher = useRef<Location.LocationSubscription | null>(null);
  const finalElapsed = useRef(0);
  stageRef.current = stage; kindRef.current = kind; pausedRef.current = paused;

  const elapsed = () => {
    if (stage === "summary") return finalElapsed.current;
    if (!startMs.current) return 0;
    return Math.max(0, (now - startMs.current - pausedTotal.current - (paused ? now - pauseStart.current : 0)) / 1000);
  };

  // keep the screen on while a workout is open (phones only track while the app is in front)
  useEffect(() => {
    void activateKeepAwakeAsync("workout").catch(() => undefined);
    return () => { try { void deactivateKeepAwake("workout").catch(() => undefined); } catch { /* not active */ } };
  }, []);

  useEffect(() => {
    if (stage !== "tracking") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stage]);

  // tracking pauses by itself when the app is left; resume listening when it's back
  useEffect(() => {
    const sub = AppState.addEventListener("change", s => {
      setAway(s !== "active");
      if (s === "active" && stageRef.current === "tracking") void listen();
    });
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stageRef.current === "tracking") { confirmQuit(); return true; }
      if (stageRef.current === "summary") { confirmDiscard(); return true; }
      return false;
    });
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { watcher.current?.remove(); }, []);

  async function listen() {
    watcher.current?.remove();
    watcher.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 3 },
      loc => {
        if (pausedRef.current) return;
        const { latitude, longitude, accuracy } = loc.coords;
        if (accuracy != null && accuracy > 35) return;       // too fuzzy to trust
        setGotFix(true);
        const p: [number, number] = [latitude, longitude];
        const last = pts.current[pts.current.length - 1];
        if (last) {
          const d = distanceM(last, p);
          const dt = Math.max(0.5, (loc.timestamp - lastTs.current) / 1000);
          if (d < 3) return;                                   // jitter while standing still
          if ((d / dt) * 3.6 > KIND_INFO[kindRef.current].maxKmh * 1.6) return; // GPS jump
          dist.current += d; setDistance(dist.current);
        }
        pts.current.push(p); lastTs.current = loc.timestamp;
        setRoute(r => (r.length > 1500 ? r : [...r, p]));
      },
    );
  }

  async function start() {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) { setGpsDenied(true); return; }
    setGpsDenied(false);
    pts.current = []; dist.current = 0; pausedTotal.current = 0; lastTs.current = 0;
    setDistance(0); setRoute([]); setGotFix(false); setPaused(false);
    startMs.current = Date.now(); setNow(Date.now());
    setStage("tracking");
    haptic.success();
    try { await listen(); } catch (e) { showError("Couldn't start GPS", e); setStage("setup"); }
  }

  function togglePause() {
    haptic.tap();
    if (!paused) { pauseStart.current = Date.now(); setPaused(true); }
    else { pausedTotal.current += Date.now() - pauseStart.current; lastTs.current = Date.now(); setPaused(false); }
  }

  function finish() {
    const secs = elapsed();
    if (distance < 50 || secs < 30) {
      showAlert("Too short to save", "Walk a little further first, or discard this workout.", [
        { text: "Keep going", style: "cancel" }, { text: "Discard", style: "destructive", onPress: () => { watcher.current?.remove(); router.back(); } },
      ]);
      return;
    }
    watcher.current?.remove(); watcher.current = null;
    finalElapsed.current = secs;
    const h = new Date().getHours();
    setTitle(`${h < 12 ? "Morning" : h < 17 ? "Afternoon" : h < 21 ? "Evening" : "Night"} ${KIND_INFO[kind].verb}`);
    setStage("summary");
    haptic.success();
  }

  function confirmQuit() {
    showAlert("Stop this workout?", "You can finish and save it, or discard it.", [
      { text: "Keep going", style: "cancel" }, { text: "Finish & save", onPress: finish },
      { text: "Discard", style: "destructive", onPress: () => { watcher.current?.remove(); router.back(); } },
    ]);
  }
  function confirmDiscard() {
    showAlert("Discard this workout?", "It won't be saved.", [{ text: "Keep it", style: "cancel" }, { text: "Discard", style: "destructive", onPress: () => router.back() }]);
  }

  async function save() {
    setSaving(true);
    try {
      const w = await post<Workout>("/activities", {
        kind, title: title.trim() || undefined, shared,
        startedAt: new Date(startMs.current).toISOString(),
        durationSec: Math.round(finalElapsed.current), distanceM: Math.round(dist.current),
        route: simplifyRoute(pts.current, 500),
      });
      haptic.success();
      qc.invalidateQueries({ queryKey: ["fitness"] });
      qc.invalidateQueries({ queryKey: ["pulse"] });
      router.replace(`/activity/${w.id}`);
    } catch (e) { showError("Couldn't save workout", e); }
    finally { setSaving(false); }
  }

  const secs = elapsed();
  const pins = useMemo<MapPin[]>(() => {
    if (route.length === 0) return [];
    const a = route[0], b = route[route.length - 1];
    return stage === "summary"
      ? [{ id: "s", lat: a[0], lng: a[1], label: "Start", initial: "S" }, { id: "f", lat: b[0], lng: b[1], label: "Finish", initial: "F" }]
      : [{ id: "me", lat: b[0], lng: b[1], label: "You", initial: "Me", me: true }];
  }, [route, stage]);

  const shell = (children: React.ReactNode) => (
    <View style={{ flex: 1, backgroundColor: colors.ink }}><SafeAreaView style={{ flex: 1 }}>{children}</SafeAreaView></View>
  );
  const info = KIND_INFO[kind];

  // ================================================================ setup
  if (stage === "setup") {
    return shell(
      <ScrollView contentContainerStyle={{ padding: 20, maxWidth: 520, width: "100%", alignSelf: "center", flexGrow: 1 }}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Go back" hitSlop={10} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <Text style={{ color: "#fff", fontSize: 30, fontWeight: "800", marginTop: 22 }}>New workout</Text>
        <Text style={{ color: "#8FA3B3", marginTop: 6, lineHeight: 21 }}>Pick an activity. Kizayu records your route, distance and pace.</Text>
        <View style={{ flexDirection: "row", gap: 12, marginTop: 28 }}>
          {KINDS.map(k => {
            const on = k === kind;
            return (
              <Pressable key={k} onPress={() => { haptic.select(); setKind(k); }} accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={{ flex: 1, alignItems: "center", paddingVertical: 22, borderRadius: radius.lg, backgroundColor: on ? "rgba(0,184,230,0.16)" : "rgba(255,255,255,0.06)", borderWidth: 2, borderColor: on ? colors.accent : "transparent" }}>
                <Ionicons name={KIND_INFO[k].icon} size={34} color={on ? colors.accent : "#8FA3B3"} />
                <Text style={{ color: on ? "#fff" : "#8FA3B3", fontWeight: "700", marginTop: 8 }}>{KIND_INFO[k].label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ marginTop: 28, padding: 16, borderRadius: radius.lg, backgroundColor: "rgba(255,255,255,0.06)", gap: 10 }}>
          {[["location", "Uses your phone's GPS. Allow location when asked."], ["phone-portrait", "Keep Kizayu open with the screen on while you move."], ["people", "Share it with your circles and climb the family leaderboard."]].map(([icon, text]) => (
            <View key={text} style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              <Ionicons name={icon as "location"} size={20} color={colors.accent} />
              <Text style={{ color: "#C7D5E0", flex: 1, lineHeight: 20 }}>{text}</Text>
            </View>
          ))}
        </View>
        {gpsDenied && (
          <View style={{ marginTop: 16, padding: 14, borderRadius: radius.md, backgroundColor: "rgba(242,161,0,0.14)" }}>
            <Text style={{ color: "#FFD27A", lineHeight: 20 }}>Location is off for Kizayu, so workouts can't be tracked.</Text>
            <Button title="Open settings" size="sm" variant="light" onPress={() => Linking.openSettings()} style={{ marginTop: 10, alignSelf: "flex-start" }} />
          </View>
        )}
        <View style={{ flex: 1, minHeight: 24 }} />
        <Button title={`Start ${info.verb}`} icon="play" onPress={start} variant="light" />
      </ScrollView>,
    );
  }

  // ================================================================ summary
  if (stage === "summary") {
    const sec = finalElapsed.current;
    return shell(
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32, maxWidth: 520, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: "#8FA3B3", fontWeight: "700", letterSpacing: 1 }}>NICE WORK</Text>
        <Text style={{ color: "#fff", fontSize: 44, fontWeight: "800", marginTop: 4 }}>{fmtKm(distance)}</Text>
        <View style={{ flexDirection: "row", marginTop: 14, paddingVertical: 14, borderRadius: radius.lg, backgroundColor: "rgba(255,255,255,0.06)" }}>
          <Stat label="Time" value={fmtDuration(sec)} />
          <Stat label={kind === "cycle" ? "Speed" : "Pace"} value={fmtPace(kind, distance, sec)} />
        </View>
        <View style={{ marginTop: 14 }}><OsmMap pins={pins} route={route} height={220} /></View>
        <Text style={{ color: "#fff", fontWeight: "700", marginTop: 20, marginBottom: 8 }}>Name your workout</Text>
        <TextInput value={title} onChangeText={setTitle} maxLength={80} placeholder="Morning walk"
          style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#fff", borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16 }} placeholderTextColor="#6C8091" />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16, padding: 14, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.06)" }}>
          <Ionicons name="people" size={22} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>Share with my circles</Text>
            <Text style={{ color: "#8FA3B3", fontSize: 12, marginTop: 1 }}>Shows on the leaderboard and in the feed</Text>
          </View>
          <Switch value={shared} onValueChange={setShared} trackColor={{ true: colors.accent }} />
        </View>
        <View style={{ gap: 12, marginTop: 22 }}>
          <Button title="Save workout" icon="checkmark" variant="light" onPress={save} loading={saving} />
          <Button title="Discard" variant="ghost" onPress={confirmDiscard} style={{ borderColor: "rgba(255,255,255,0.2)" }} />
        </View>
      </ScrollView>,
    );
  }

  // ================================================================ tracking
  return shell(
    <View style={{ flex: 1, maxWidth: 520, width: "100%", alignSelf: "center", padding: 20 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Ionicons name={info.icon} size={22} color={colors.accent} />
        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 18, flex: 1 }}>{info.label}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.08)" }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: paused ? colors.warn : gotFix ? colors.success : "#6C8091" }} />
          <Text style={{ color: "#C7D5E0", fontSize: 12, fontWeight: "700" }}>{paused ? "PAUSED" : gotFix ? "GPS" : "FINDING GPS"}</Text>
        </View>
      </View>

      <View style={{ alignItems: "center", marginTop: 26 }}>
        <Text style={{ color: "#fff", fontSize: 76, fontWeight: "800", letterSpacing: -2 }}>{(distance / 1000).toFixed(2)}</Text>
        <Text style={{ color: "#8FA3B3", fontWeight: "700", letterSpacing: 1 }}>KILOMETRES</Text>
      </View>
      <View style={{ flexDirection: "row", marginTop: 22, paddingVertical: 14, borderRadius: radius.lg, backgroundColor: "rgba(255,255,255,0.06)" }}>
        <Stat label="Time" value={fmtDuration(secs)} />
        <Stat label={kind === "cycle" ? "Speed" : "Pace"} value={fmtPace(kind, distance, secs)} />
      </View>

      <View style={{ flex: 1, marginTop: 16, minHeight: 150 }}>
        {route.length > 1 ? <OsmMap pins={pins} route={route} height={220} /> : (
          <View style={{ height: 150, borderRadius: radius.lg, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Ionicons name="locate" size={30} color="#6C8091" />
            <Text style={{ color: "#8FA3B3" }}>{gotFix ? "Start moving to draw your route" : "Waiting for a GPS signal… go outside if you can"}</Text>
          </View>
        )}
      </View>
      {away && <Text style={{ color: "#FFD27A", fontWeight: "600", marginTop: 10 }}>Kizayu was in the background, so tracking paused. Stay in the app to record everything.</Text>}

      <View style={{ flexDirection: "row", gap: 12, marginTop: 14 }}>
        <Button title={paused ? "Resume" : "Pause"} icon={paused ? "play" : "pause"} variant="light" onPress={togglePause} style={{ flex: 1 }} />
        <Button title="Finish" icon="stop" variant="danger" onPress={finish} style={{ flex: 1 }} />
      </View>
    </View>,
  );
}
