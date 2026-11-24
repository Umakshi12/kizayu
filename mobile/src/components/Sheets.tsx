import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { post } from "../api";
import { showAlert, showError } from "../alert";
import { haptic } from "../haptics";
import { colors, radius } from "../theme";
import { Text, TextInput } from "./Text";
import { Button, IconName } from "./ui";

export type SheetAction = { label: string; icon: IconName; destructive?: boolean; onPress: () => void };

/** Bottom sheet: dims the screen, lifts above the keyboard, closes when you tap outside. */
export function Backdrop({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "web" ? undefined : "padding"} style={{ flex: 1 }}>
        <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(10,13,18,0.55)", justifyContent: "flex-end" }}>
          <Pressable onPress={() => undefined} style={{ backgroundColor: colors.bg, padding: 18, paddingBottom: 28, borderTopLeftRadius: 30, borderTopRightRadius: 30 }}>
            <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: 14 }} />
            {children}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Bottom menu of actions (the "⋯" menu on posts, comments and messages). */
export function ActionSheet({ visible, title, actions, onClose }: { visible: boolean; title?: string; actions: SheetAction[]; onClose: () => void }) {
  return (
    <Backdrop visible={visible} onClose={onClose}>
      {title && <Text style={{ fontWeight: "800", fontSize: 17, marginBottom: 10, marginLeft: 4 }}>{title}</Text>}
      <View style={{ backgroundColor: "#fff", borderRadius: radius.lg, overflow: "hidden" }}>
        {actions.map((a, i) => (
          <Pressable key={a.label} onPress={() => { haptic.tap(); onClose(); setTimeout(a.onPress, 250); }}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 16, paddingHorizontal: 18, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border, backgroundColor: pressed ? colors.primaryTint : "#fff" })}>
            <Ionicons name={a.icon} size={21} color={a.destructive ? colors.danger : colors.text} />
            <Text style={{ fontWeight: "600", fontSize: 16, color: a.destructive ? colors.danger : colors.text }}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
      <Button title="Cancel" variant="soft" onPress={onClose} style={{ marginTop: 12 }} />
    </Backdrop>
  );
}

const REASONS: { id: string; label: string }[] = [
  { id: "harassment", label: "Harassment or bullying" },
  { id: "inappropriate", label: "Inappropriate or harmful" },
  { id: "spam", label: "Spam or scam" },
  { id: "other", label: "Something else" },
];

export type ReportTarget = { type: "post" | "comment" | "message" | "user"; id: string; label: string };

/** Report content to the Kizayu team. A reported post is hidden from you right away. */
export function ReportSheet({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => { setReason(null); setDetails(""); onClose(); };
  const send = async () => {
    if (!target || !reason) return;
    setBusy(true);
    try {
      await post("/reports", { targetType: target.type, targetId: target.id, reason, details: details.trim() || undefined });
      haptic.success();
      qc.invalidateQueries({ queryKey: ["feed"] });
      close();
      showAlert("Thanks for reporting", "Our team will review it. You won't see this post again.");
    } catch (e) { showError("Couldn't send report", e); }
    finally { setBusy(false); }
  };
  return (
    <Backdrop visible={!!target} onClose={close}>
      <Text style={{ fontWeight: "800", fontSize: 20 }}>Report {target?.label}</Text>
      <Text style={{ color: colors.muted, marginTop: 4, marginBottom: 14 }}>Reports are private. The person won't know who reported them.</Text>
      <View style={{ backgroundColor: "#fff", borderRadius: radius.lg, overflow: "hidden" }}>
        {REASONS.map((r, i) => (
          <Pressable key={r.id} onPress={() => { haptic.select(); setReason(r.id); }} accessibilityRole="radio" accessibilityState={{ selected: reason === r.id }}
            style={{ flexDirection: "row", alignItems: "center", paddingVertical: 15, paddingHorizontal: 16, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
            <Text style={{ flex: 1, fontWeight: "600" }}>{r.label}</Text>
            <Ionicons name={reason === r.id ? "radio-button-on" : "radio-button-off"} size={22} color={reason === r.id ? colors.primary : colors.faint} />
          </Pressable>
        ))}
      </View>
      <TextInput value={details} onChangeText={setDetails} placeholder="Add details (optional)" multiline maxLength={1000}
        style={{ backgroundColor: "#fff", borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, padding: 14, minHeight: 70, marginTop: 12, textAlignVertical: "top" }} />
      <Button title="Send report" variant="danger" onPress={send} loading={busy} disabled={!reason} style={{ marginTop: 14 }} />
    </Backdrop>
  );
}

/** Ask, then block someone. Their posts, comments, stories and messages are hidden from you. */
export function confirmBlock(name: string, userId: string, onDone: () => void) {
  showAlert(`Block ${name}?`, "You won't see their posts, comments, stories or messages, and they can't notify you. You can unblock them in Account & Security.", [
    { text: "Cancel", style: "cancel" },
    { text: "Block", style: "destructive", onPress: () => { post("/blocks", { userId }).then(() => { haptic.success(); onDone(); }).catch(e => showError("Couldn't block", e)); } },
  ]);
}
