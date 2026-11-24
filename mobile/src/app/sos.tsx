import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, AppState, BackHandler, Linking, Platform, Pressable, ScrollView, Share, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions, useMicrophonePermissions, type CameraType } from "expo-camera";
import * as Location from "expo-location";
import { deleteAsync, FileSystemUploadType, uploadAsync } from "expo-file-system/legacy";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API_URL } from "../config";
import { get, getToken, post } from "../api";
import { showAlert } from "../alert";
import { useAuth } from "../auth";
import { haptic } from "../haptics";
import { Text } from "../components/Text";
import { Button } from "../components/ui";
import { colors, radius } from "../theme";
import type { SafetySettings, SosActive, SosContact, SosStartResult } from "../types";

const CLIP_SECONDS = 15;   // each recording is uploaded as soon as it's finished
const COUNTDOWN = 5;       // seconds to cancel an accidental SOS
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

type Stage = "countdown" | "starting" | "active" | "ending" | "ended" | "error";

function Pulse({ children }: { children: React.ReactNode }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 0.35, duration: 650, useNativeDriver: true }), Animated.timing(v, { toValue: 1, duration: 650, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={{ opacity: v }}>{children}</Animated.View>;
}

function Line({ ok, text, warn }: { ok?: boolean; warn?: boolean; text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 5 }}>
      <Ionicons name={warn ? "alert-circle" : ok ? "checkmark-circle" : "ellipse-outline"} size={20} color={warn ? colors.warn : ok ? colors.success : "#7C8A97"} />
      <Text style={{ color: "#E6EEF4", flex: 1, fontSize: 14, lineHeight: 19 }}>{text}</Text>
    </View>
  );
}

export default function Sos() {
  // The screen must stay on: Android only records while the app is open. (Wrapped so a wake-lock hiccup can never break an SOS.)
  useEffect(() => {
    void activateKeepAwakeAsync("sos").catch(() => undefined);
    return () => { try { void deactivateKeepAwake("sos").catch(() => undefined); } catch { /* not active */ } };
  }, []);
  const qc = useQueryClient();
  const { user } = useAuth();
  const settings = useQuery({ queryKey: ["safety"], queryFn: () => get<SafetySettings>("/safety") });
  const contacts = useQuery({ queryKey: ["sos-contacts"], queryFn: () => get<SosContact[]>("/sos/contacts") });
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();

  const [ready, setReady] = useState(false);
  const [stage, setStage] = useState<Stage>("countdown");
  const [count, setCount] = useState(COUNTDOWN);
  const [event, setEvent] = useState<SosStartResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<CameraType>("back");
  const [camOn, setCamOn] = useState(false);
  const [camKey, setCamKey] = useState(0);
  const [recording, setRecording] = useState(false);
  const [permDenied, setPermDenied] = useState(false);
  const [recordIssue, setRecordIssue] = useState(false);
  const [away, setAway] = useState(false);
  const [stats, setStats] = useState({ recorded: 0, uploaded: 0, failed: 0 });
  const [now, setNow] = useState(Date.now());

  const cam = useRef<CameraView>(null);
  const stageRef = useRef<Stage>("countdown");
  const eventRef = useRef<SosStartResult | null>(null);
  const wantRecording = useRef(false);
  const cameraReady = useRef(false);
  const appActive = useRef(AppState.currentState === "active");
  const loopRunning = useRef(false);
  const loopDone = useRef<Promise<void>>(Promise.resolve());
  const uploads = useRef<Promise<void>>(Promise.resolve());
  const watcher = useRef<Location.LocationSubscription | null>(null);
  const recordErrors = useRef(0);
  stageRef.current = stage;

  const recordingEnabled = settings.data?.sosRecording === true;
  const contactCount = contacts.data?.length ?? 0;

  // ---- on open: resume an SOS that is already running (e.g. the app was closed), else start the countdown
  useEffect(() => {
    if (!settings.isSuccess && !settings.isError) return;
    let cancelled = false;
    get<SosActive>("/sos/active")
      .then(a => { if (cancelled) return; if (a.mine) adopt({ ...a.mine, reused: true, contacts: contactCount, smsSent: 0, notifiedPeople: 0 }); setReady(true); })
      .catch(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [settings.isSuccess, settings.isError]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- countdown
  useEffect(() => {
    if (!ready || stage !== "countdown") return;
    if (count <= 0) { void begin(); return; }
    haptic.warning();
    const t = setTimeout(() => setCount(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [ready, stage, count]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- clock for the elapsed timer
  useEffect(() => {
    if (stage !== "active") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stage]);

  // ---- app going to the background pauses recording (Android stops the camera)
  useEffect(() => {
    const sub = AppState.addEventListener("change", s => {
      appActive.current = s === "active";
      setAway(s !== "active");
      if (s === "active") { cameraReady.current = false; setCamKey(k => k + 1); }
    });
    return () => sub.remove();
  }, []);

  // ---- hardware back must not silently abandon a running SOS
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stageRef.current === "countdown" || stageRef.current === "error" || stageRef.current === "ended") return false;
      if (stageRef.current === "active") confirmEnd();
      return true;
    });
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- leaving the screen stops the camera and location (the SOS itself stays active until ended)
  useEffect(() => () => {
    wantRecording.current = false;
    try { cam.current?.stopRecording(); } catch { /* not recording */ }
    watcher.current?.remove();
  }, []);

  async function begin() {
    setStage("starting");
    try {
      let pos: { lat: number; lng: number } | undefined;
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.granted) {
          const last = await Location.getLastKnownPositionAsync();
          const p = last ?? await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), sleep(6000).then(() => null)]);
          if (p) pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        }
      } catch { /* alert goes out without a location rather than not at all */ }
      adopt(await post<SosStartResult>("/sos/start", pos));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the SOS");
      setStage("error");
    }
  }

  function adopt(r: SosStartResult) {
    eventRef.current = r;
    setEvent(r);
    setStage("active");
    haptic.warning();
    void startLocationWatch(r.id);
    void startRecording();
    qc.invalidateQueries({ queryKey: ["sos-active"] });
  }

  async function startLocationWatch(id: string) {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return;
      watcher.current?.remove();
      watcher.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 10_000, distanceInterval: 15 },
        p => { post(`/sos/${id}/location`, { lat: p.coords.latitude, lng: p.coords.longitude }).catch(() => undefined); },
      );
    } catch { /* location is a bonus once the alert has gone out */ }
  }

  async function startRecording() {
    if (!settings.data?.sosRecording) return;
    const cp = camPerm?.granted ? camPerm : await requestCam();
    const mp = micPerm?.granted ? micPerm : await requestMic();
    if (!cp?.granted || !mp?.granted) { setPermDenied(true); return; }
    wantRecording.current = true;
    setCamOn(true);
  }

  function kick() {
    if (loopRunning.current) return;
    loopRunning.current = true;
    loopDone.current = recordLoop().finally(() => { loopRunning.current = false; });
  }

  async function recordLoop() {
    while (wantRecording.current) {
      if (!cameraReady.current || !appActive.current) { await sleep(500); continue; }
      try {
        setRecording(true);
        const res = await cam.current?.recordAsync({ maxDuration: CLIP_SECONDS });
        setRecording(false);
        if (res?.uri) { recordErrors.current = 0; setRecordIssue(false); setStats(s => ({ ...s, recorded: s.recorded + 1 })); queueUpload(res.uri); }
        await sleep(250);
      } catch {
        setRecording(false);
        if (++recordErrors.current >= 3) setRecordIssue(true);
        await sleep(1500);
      }
    }
  }

  function queueUpload(uri: string) {
    uploads.current = uploads.current.then(async () => {
      const ev = eventRef.current;
      if (!ev) return;
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const r = await uploadAsync(`${API_URL}/sos/${ev.id}/clips?kind=video&seconds=${CLIP_SECONDS}`, uri, {
            httpMethod: "POST", uploadType: FileSystemUploadType.BINARY_CONTENT,
            headers: { authorization: `Bearer ${getToken()}`, "content-type": "video/mp4" },
          });
          if (r.status === 201) { setStats(s => ({ ...s, uploaded: s.uploaded + 1 })); await deleteAsync(uri, { idempotent: true }).catch(() => undefined); return; }
          if (r.status === 404 || r.status === 409 || r.status === 413) break; // retrying can't help
        } catch { /* network hiccup: try again */ }
        await sleep(1500 * (attempt + 1));
      }
      setStats(s => ({ ...s, failed: s.failed + 1 }));
      await deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    });
  }

  async function endSos() {
    setStage("ending");
    wantRecording.current = false;
    try { cam.current?.stopRecording(); } catch { /* not recording */ }
    watcher.current?.remove(); watcher.current = null;
    // let the final clip finish and upload before telling everyone it's over
    await Promise.race([(async () => { await loopDone.current; await uploads.current; })(), sleep(25_000)]);
    try { if (eventRef.current) await post(`/sos/${eventRef.current.id}/end`); } catch { /* the server also expires old SOS alerts */ }
    setCamOn(false);
    setStage("ended");
    haptic.success();
    qc.invalidateQueries({ queryKey: ["sos-active"] });
  }

  function confirmEnd() {
    showAlert("End the SOS?", "Everyone will be told you're safe, and recording will stop.", [
      { text: "Keep SOS running", style: "cancel" },
      { text: "I'm safe, end SOS", onPress: () => { void endSos(); } },
    ]);
  }

  const elapsed = useMemo(() => {
    if (!event) return "00:00";
    const s = Math.max(0, Math.floor((now - new Date(event.startedAt).getTime()) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, [event, now]);

  const textContacts = () => {
    if (!event || !contacts.data?.length) return;
    const body = `🚨 ${user?.name ?? "I"} here. I've sent an SOS and may need help. Live location, video and audio: ${event.link}`;
    const nums = contacts.data.map(c => c.phone).join(",");
    void Linking.openURL(`sms:${nums}${Platform.OS === "ios" ? "&" : "?"}body=${encodeURIComponent(body)}`);
  };

  const shell = (children: React.ReactNode) => (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <SafeAreaView style={{ flex: 1 }}>{children}</SafeAreaView>
    </View>
  );

  // ================================================================ countdown
  if (stage === "countdown" || stage === "starting") {
    const starting = stage === "starting" || !ready;
    return shell(
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: "center", alignItems: "center", maxWidth: 520, width: "100%", alignSelf: "center" }}>
        <View style={{ width: 170, height: 170, borderRadius: 85, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center", shadowColor: colors.danger, shadowOpacity: 0.6, shadowRadius: 30, elevation: 14 }}>
          {starting ? <Ionicons name="radio" size={72} color="#fff" /> : <Text style={{ color: "#fff", fontSize: 84, fontWeight: "800" }}>{count}</Text>}
        </View>
        <Text style={{ color: "#fff", fontSize: 26, fontWeight: "800", marginTop: 28, textAlign: "center" }}>{starting ? "Sending your SOS…" : "Sending SOS…"}</Text>
        <Text style={{ color: "#9FB2C0", textAlign: "center", marginTop: 8, lineHeight: 21 }}>
          {starting ? "Alerting your family and contacts." : "Your family and SOS contacts will be alerted. Tap Cancel if this was a mistake."}
        </Text>
        <View style={{ marginTop: 22, width: "100%", padding: 14, borderRadius: radius.lg, backgroundColor: "rgba(255,255,255,0.06)" }}>
          <Line ok text="Everyone in your circles gets an urgent alert with your location" />
          <Line ok={contactCount > 0} warn={contactCount === 0} text={contactCount > 0 ? `${contactCount} SOS contact${contactCount === 1 ? "" : "s"} will get a message with a private link` : "No SOS contacts yet. Add family numbers in SOS contacts"} />
          <Line ok={recordingEnabled} text={recordingEnabled ? "Video and audio will be recorded and shared" : "Video and audio recording is off"} />
        </View>
        {!starting && (
          <View style={{ width: "100%", gap: 12, marginTop: 24 }}>
            <Button title="Send now" variant="danger" icon="alert-circle" onPress={() => setCount(0)} />
            <Button title="Cancel, I'm OK" variant="light" onPress={() => router.back()} />
          </View>
        )}
      </ScrollView>,
    );
  }

  // ================================================================ error
  if (stage === "error") {
    return shell(
      <View style={{ flex: 1, padding: 24, justifyContent: "center", alignItems: "center", maxWidth: 520, width: "100%", alignSelf: "center" }}>
        <Ionicons name="warning" size={64} color={colors.warn} />
        <Text style={{ color: "#fff", fontSize: 24, fontWeight: "800", marginTop: 16, textAlign: "center" }}>The SOS didn't go out</Text>
        <Text style={{ color: "#9FB2C0", textAlign: "center", marginTop: 8, lineHeight: 21 }}>{error}</Text>
        <View style={{ width: "100%", gap: 12, marginTop: 24 }}>
          <Button title="Call 112 now" variant="danger" icon="call" onPress={() => Linking.openURL("tel:112")} />
          <Button title="Try again" variant="light" onPress={() => { setError(null); setCount(COUNTDOWN); setStage("countdown"); }} />
          <Button title="Close" variant="ghost" onPress={() => router.back()} />
        </View>
      </View>,
    );
  }

  // ================================================================ ended
  if (stage === "ended" || stage === "ending") {
    const ending = stage === "ending";
    return shell(
      <View style={{ flex: 1, padding: 24, justifyContent: "center", alignItems: "center", maxWidth: 520, width: "100%", alignSelf: "center" }}>
        <Ionicons name={ending ? "cloud-upload" : "shield-checkmark"} size={72} color={ending ? colors.accent : colors.success} />
        <Text style={{ color: "#fff", fontSize: 26, fontWeight: "800", marginTop: 16, textAlign: "center" }}>{ending ? "Finishing up…" : "SOS ended"}</Text>
        <Text style={{ color: "#9FB2C0", textAlign: "center", marginTop: 8, lineHeight: 21 }}>
          {ending ? "Uploading your last recording. Please keep the app open." : `Your family has been told you're safe.${stats.uploaded ? ` ${stats.uploaded} recording${stats.uploaded === 1 ? "" : "s"} saved for 30 days.` : ""}`}
        </Text>
        {!ending && <Button title="Done" variant="light" onPress={() => router.back()} style={{ marginTop: 28, alignSelf: "stretch" }} />}
      </View>,
    );
  }

  // ================================================================ active
  const smsNeeded = !!event && !event.reused && contactCount > 0 && event.smsSent === 0;
  const showCam = camOn && !permDenied;
  return shell(
    <ScrollView contentContainerStyle={{ paddingBottom: 28, maxWidth: 560, width: "100%", alignSelf: "center" }}>
      <View style={{ backgroundColor: colors.danger, paddingHorizontal: 18, paddingVertical: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Pulse><View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: "#fff" }} /></Pulse>
        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 17, flex: 1, letterSpacing: 0.4 }}>SOS ACTIVE</Text>
        <Text style={{ color: "#fff", fontWeight: "700", fontSize: 17 }}>{elapsed}</Text>
      </View>

      <View style={{ padding: 16 }}>
        {showCam ? (
          <View style={{ borderRadius: radius.lg, overflow: "hidden", backgroundColor: "#000" }}>
            <CameraView
              key={camKey} ref={cam} style={{ width: "100%", aspectRatio: 3 / 4 }} facing={facing} mode="video" videoQuality="480p"
              onCameraReady={() => { cameraReady.current = true; kick(); }}
            />
            <View style={{ position: "absolute", top: 12, left: 12, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: "rgba(0,0,0,0.6)" }}>
              {recording ? <Pulse><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger }} /></Pulse> : <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#7C8A97" }} />}
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>{recording ? "RECORDING & SHARING" : away ? "PAUSED" : "STARTING CAMERA"}</Text>
            </View>
            <Pressable onPress={() => { cameraReady.current = false; setFacing(f => (f === "back" ? "front" : "back")); }} accessibilityLabel="Switch camera"
              style={{ position: "absolute", top: 10, right: 10, width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="camera-reverse" size={22} color="#fff" />
            </Pressable>
          </View>
        ) : (
          <View style={{ padding: 16, borderRadius: radius.lg, backgroundColor: "rgba(255,255,255,0.06)", flexDirection: "row", gap: 12, alignItems: "center" }}>
            <Ionicons name="videocam-off" size={26} color="#9FB2C0" />
            <Text style={{ color: "#C7D5E0", flex: 1, lineHeight: 20 }}>
              {permDenied ? "Camera or microphone permission is off, so nothing is being recorded." : "Recording is off. You can turn it on in SOS contacts."}
            </Text>
            {permDenied && <Button title="Settings" size="sm" variant="light" onPress={() => Linking.openSettings()} />}
          </View>
        )}

        {away && <Text style={{ color: colors.warn, marginTop: 10, fontWeight: "600" }}>Kizayu was in the background: recording pauses until you come back.</Text>}
        {recordIssue && <Text style={{ color: colors.warn, marginTop: 10, fontWeight: "600" }}>This phone isn't letting Kizayu record. Your location and alerts are still working.</Text>}

        <View style={{ marginTop: 14, padding: 14, borderRadius: radius.lg, backgroundColor: "rgba(255,255,255,0.06)" }}>
          <Line ok text={event && !event.reused ? `Alerted ${event.notifiedPeople} ${event.notifiedPeople === 1 ? "person" : "people"} in your circles` : "Your circles have been alerted"} />
          <Line ok text="Sharing your live location" />
          {contactCount > 0
            ? <Line ok={!smsNeeded} warn={smsNeeded} text={smsNeeded ? `Automatic SMS isn't set up. Tap "Text my contacts" below to send the link yourself.` : `${contactCount} SOS contact${contactCount === 1 ? "" : "s"} messaged with your private link`} />
            : <Line warn text="No SOS contacts. Add family numbers in SOS contacts" />}
          {showCam && <Line ok={stats.uploaded > 0} text={stats.recorded === 0 ? "Recording starts in a moment…" : `${stats.uploaded} of ${stats.recorded} clips shared${stats.failed ? ` (${stats.failed} failed to upload)` : ""}`} />}
        </View>

        <View style={{ gap: 12, marginTop: 16 }}>
          {smsNeeded && <Button title="Text my contacts" icon="chatbubble-ellipses" variant="light" onPress={textContacts} />}
          {event && <Button title="Share live link" icon="share-social" variant="light" onPress={() => Share.share({ message: `🚨 ${user?.name ?? "I"} sent an SOS. Live location, video and audio: ${event.link}` })} />}
          <Button title="Call 112" icon="call" variant="danger" onPress={() => Linking.openURL("tel:112")} />
          <Button title="I'm safe: end SOS" icon="shield-checkmark" variant="ghost" onPress={confirmEnd} style={{ borderColor: colors.success }} />
        </View>
        <Text style={{ color: "#7C8A97", fontSize: 12, textAlign: "center", marginTop: 14 }}>Keep Kizayu open and the screen on. Android only records while the app is in front.</Text>
      </View>
    </ScrollView>,
  );
}
