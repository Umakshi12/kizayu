import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import { Text, TextInput } from "../../components/Text";
import { showAlert } from "../../alert";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../../api";
import { pickAndUpload } from "../../media";
import { Avatar, Button, Header, Screen, Pill } from "../../components/ui";
import { colors, radius } from "../../theme";
import type { Circle } from "../../types";

const MODES = [
  { key: "snap", label: "Snap", hint: "Share a photo" },
  { key: "story", label: "Story", hint: "Disappears in 24 hours" },
  { key: "checkin", label: "Check-in", hint: "Let everyone know you're okay" },
  { key: "activity", label: "Activity", hint: "Share what you're up to" },
] as const;
type Mode = (typeof MODES)[number]["key"];

export default function Share() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("snap");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [circleId, setCircleId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const circles = useQuery({ queryKey: ["circles"], queryFn: () => get<Circle[]>("/circles") });
  useEffect(() => {
    if (!circleId && circles.data?.length) setCircleId(circles.data[0].id);
  }, [circles.data, circleId]);
  const circle = circles.data?.find(c => c.id === circleId);

  const capture = async (source: "camera" | "library") => {
    setUploading(true);
    try { const url = await pickAndUpload(source); if (url) setImageUrl(url); }
    catch (e) { showAlert("Upload failed", e instanceof Error ? e.message : "Try again"); }
    finally { setUploading(false); }
  };

  const send = useMutation({
    mutationFn: async () => {
      if (mode === "story") return post("/stories", { imageUrl });
      return post("/posts", {
        circleId: circleId ?? undefined, kind: mode,
        caption: caption.trim() || (mode === "checkin" ? "I'm okay! ✅" : undefined), imageUrl: imageUrl ?? undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed"] });
      qc.invalidateQueries({ queryKey: ["stories"] });
      qc.invalidateQueries({ queryKey: ["pulse"] });
      setImageUrl(null); setCaption("");
      router.navigate("/");
    },
    onError: e => showAlert("Couldn't share", e instanceof Error ? e.message : "Try again"),
  });

  const needsImage = mode === "story" || mode === "snap";
  const canSend = needsImage ? !!imageUrl : !!(imageUrl || caption.trim() || mode === "checkin");

  return (
    <Screen tab>
      <Header title="Share a moment" />
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}>
          {MODES.map(m => (
            <Pill key={m.key} label={m.label} active={mode === m.key} onPress={() => setMode(m.key)} />
          ))}
        </View>
        <Text style={{ color: colors.muted, textAlign: "center", marginBottom: 14 }}>{MODES.find(m => m.key === mode)!.hint}</Text>

        <View style={{ aspectRatio: 1, borderRadius: radius.lg, backgroundColor: colors.card, overflow: "hidden", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
          {imageUrl ? <Image source={{ uri: imageUrl }} style={{ width: "100%", height: "100%" }} /> : (
            <View style={{ alignItems: "center", gap: 12 }}>
              <Ionicons name="image-outline" size={56} color={colors.muted} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Button title="Camera" icon="camera" onPress={() => capture("camera")} loading={uploading} />
                <Button title="Gallery" icon="images" variant="soft" onPress={() => capture("library")} disabled={uploading} />
              </View>
            </View>
          )}
          {imageUrl && (
            <Pressable onPress={() => setImageUrl(null)} accessibilityLabel="Remove photo"
              style={{ position: "absolute", top: 10, right: 10, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 18, padding: 6 }}>
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          )}
        </View>

        {mode !== "story" && (
          <TextInput value={caption} onChangeText={setCaption} placeholder="Write a caption…" placeholderTextColor={colors.muted} maxLength={500} multiline
            style={{ backgroundColor: "#fff", borderRadius: radius.md, padding: 14, fontSize: 16, minHeight: 56, borderWidth: 1, borderColor: colors.border, marginBottom: 14 }} />
        )}

        {mode !== "story" && (
          <>
            <Text style={{ fontWeight: "700", marginBottom: 8, color: colors.text }}>Share with</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, marginBottom: 18 }}>
              {(circles.data ?? []).map(c => {
                const on = c.id === circleId;
                return (
                  <Pressable key={c.id} onPress={() => setCircleId(c.id)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: on ? colors.primarySoft : colors.card, borderWidth: 1.5, borderColor: on ? colors.primary : colors.border }}>
                    <View style={{ flexDirection: "row" }}>
                      {c.members.slice(0, 3).map((m, i) => (
                        <View key={m.id} style={{ marginLeft: i ? -10 : 0 }}><Avatar uri={m.avatarUrl} name={m.name} size={26} /></View>
                      ))}
                    </View>
                    <Text style={{ fontWeight: "600", color: colors.text }}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}
        {mode === "story" && <Text style={{ color: colors.muted, marginBottom: 18, textAlign: "center" }}>Visible to everyone in your circles.</Text>}

        <Button title={mode === "story" ? "Add to story" : `Share${circle ? ` with ${circle.name}` : ""}`} onPress={() => send.mutate()} loading={send.isPending} disabled={!canSend || uploading} />
      </ScrollView>
    </Screen>
  );
}
