import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, post } from "../api";
import { showAlert, showError } from "../alert";
import { useAuth } from "../auth";
import { haptic } from "../haptics";
import { Text } from "../components/Text";
import { Avatar, Button, Card, Empty, Field, Header, Screen, SectionHeader } from "../components/ui";
import { colors, radius } from "../theme";
import type { PublicUser } from "../types";

function DeleteAccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user, signOut } = useAuth();
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await post("/me/delete", { confirm: "DELETE", password: password || undefined });
      haptic.warning();
      onClose();
      await signOut();
    } catch (e) { showError("Couldn't delete account", e); }
    finally { setBusy(false); }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(23,17,46,0.45)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: colors.bg, padding: 20, borderTopLeftRadius: 30, borderTopRightRadius: 30 }}>
          <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: 14 }} />
          <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: colors.dangerSoft, alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
            <Ionicons name="warning" size={28} color={colors.danger} />
          </View>
          <Text style={{ fontSize: 22, fontWeight: "800" }}>Delete your account?</Text>
          <Text style={{ color: colors.muted, marginTop: 6, marginBottom: 16, lineHeight: 21 }}>
            This permanently deletes your account, posts, photos, messages, health records and location. Circles you own pass to another member. This can't be undone.
          </Text>
          <Field label='Type "DELETE" to confirm' value={confirm} onChangeText={setConfirm} autoCapitalize="characters" placeholder="DELETE" />
          {user?.hasPassword && <Field label="Your password" value={password} onChangeText={setPassword} secureTextEntry placeholder="Your password" />}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
            <Button title="Keep account" variant="soft" onPress={onClose} style={{ flex: 1 }} />
            <Button title="Delete forever" variant="danger" onPress={run} loading={busy} disabled={confirm.trim() !== "DELETE" || (!!user?.hasPassword && !password)} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function Account() {
  const { user, refresh, signOut } = useAuth();
  const qc = useQueryClient();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const blocks = useQuery({ queryKey: ["blocks"], queryFn: () => get<{ user: PublicUser }[]>("/blocks") });
  const save = useMutation({
    mutationFn: () => post("/me/password", { current: current || undefined, password }),
    onSuccess: async () => { haptic.success(); setCurrent(""); setPassword(""); setConfirm(""); await refresh(); showAlert("Password saved"); },
    onError: e => showError("Couldn't save password", e),
  });
  const unblock = useMutation({
    mutationFn: (id: string) => del(`/blocks/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["blocks"] }); qc.invalidateQueries({ queryKey: ["feed"] }); qc.invalidateQueries({ queryKey: ["stories"] }); },
    onError: e => showError("Couldn't unblock", e),
  });
  if (!user) return null;

  const row = (label: string, value: string | null) => (
    <View style={{ flexDirection: "row", paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.border }}>
      <Text style={{ flex: 1, color: colors.muted }}>{label}</Text>
      <Text style={{ fontWeight: "600" }}>{value ?? "Not set"}</Text>
    </View>
  );

  return (
    <Screen>
      <Header title="Account & Security" back />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled">
        <Card style={{ paddingTop: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 }}>
            <Avatar uri={user.avatarUrl} name={user.name} size={48} />
            <Text style={{ fontWeight: "800", fontSize: 17 }}>{user.name}</Text>
          </View>
          {row("Username", "@" + user.username)}
          {row("Email", user.email)}
          {row("Phone", user.phone)}
        </Card>

        <SectionHeader title={user.hasPassword ? "Change password" : "Add a password"} />
        <Card>
          {!user.hasPassword && <Text style={{ color: colors.muted, marginBottom: 12 }}>You sign in with your phone or Google. Add a password to also sign in with your email.</Text>}
          {user.hasPassword && <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="password" />}
          <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" hint="At least 8 characters" />
          <Field label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" />
          {confirm.length > 0 && confirm !== password && <Text style={{ color: colors.danger, marginBottom: 10 }}>Passwords don't match</Text>}
          <Button title="Save password" onPress={() => save.mutate()} loading={save.isPending} disabled={password.length < 8 || password !== confirm || (user.hasPassword && !current)} />
        </Card>

        <SectionHeader title="Blocked people" />
        <Card style={{ paddingVertical: 6 }}>
          {(blocks.data?.length ?? 0) === 0 ? <Empty compact icon="ban-outline" text="You haven't blocked anyone." /> : blocks.data!.map((b, i) => (
            <View key={b.user.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
              <Avatar uri={b.user.avatarUrl} name={b.user.name} size={38} />
              <Text style={{ flex: 1, fontWeight: "600" }}>{b.user.name}</Text>
              <Button title="Unblock" size="sm" variant="soft" onPress={() => unblock.mutate(b.user.id)} loading={unblock.isPending && unblock.variables === b.user.id} />
            </View>
          ))}
        </Card>

        <Button title="Log out" variant="ghost" icon="log-out-outline" style={{ marginTop: 28 }}
          onPress={() => showAlert("Log out?", "You'll need to sign in again.", [{ text: "Cancel", style: "cancel" }, { text: "Log out", style: "destructive", onPress: () => { void signOut(); } }])} />

        <SectionHeader title="Danger zone" />
        <Pressable onPress={() => { haptic.tap(); setDeleting(true); }}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: radius.lg, backgroundColor: colors.dangerSoft, opacity: pressed ? 0.8 : 1 })}>
          <Ionicons name="trash" size={22} color={colors.danger} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", color: colors.danger }}>Delete account</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Permanently remove your account and all your data</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.danger} />
        </Pressable>
      </ScrollView>
      <DeleteAccountSheet visible={deleting} onClose={() => setDeleting(false)} />
    </Screen>
  );
}
