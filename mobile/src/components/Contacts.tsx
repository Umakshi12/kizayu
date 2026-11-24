import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { del, post, put } from "../api";
import { showAlert, showError } from "../alert";
import { haptic } from "../haptics";
import { colors, gradients } from "../theme";
import type { SosContact } from "../types";
import { Backdrop } from "./Sheets";
import { Text } from "./Text";
import { Button, Card, Chip, Field } from "./ui";

const RELATIONS = ["Mom", "Dad", "Spouse", "Sibling", "Child", "Friend", "Doctor", "Other"];
const call = (phone: string) => { haptic.tap(); void Linking.openURL(`tel:${phone}`); };

/** A person to call: initial, name, relationship, number and a big green Call button. */
export function ContactCard({ c, onPress, compact }: { c: SosContact; onPress?: () => void; compact?: boolean }) {
  const size = compact ? 40 : 48;
  const body = (
    <>
      <LinearGradient colors={gradients.ocean} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#fff", fontWeight: "800", fontSize: compact ? 16 : 19 }}>{c.name.trim().slice(0, 1).toUpperCase() || "?"}</Text>
      </LinearGradient>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Text style={{ fontWeight: "700", fontSize: compact ? 15 : 16 }} numberOfLines={1}>{c.name}</Text>
          {c.relation && c.relation.trim().toLowerCase() !== c.name.trim().toLowerCase() ? <Chip label={c.relation} tone="ghost" small /> : null}
        </View>
        <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>{c.phone}</Text>
      </View>
      <Pressable onPress={() => call(c.phone)} accessibilityRole="button" accessibilityLabel={`Call ${c.name}`} hitSlop={6}
        style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.success, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.8 : 1 })}>
        <Ionicons name="call" size={compact ? 18 : 21} color="#fff" />
      </Pressable>
    </>
  );
  const style = { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, padding: compact ? 0 : 14, marginBottom: compact ? 12 : 10 };
  return compact ? <View style={style}>{body}</View> : <Card onPress={onPress} style={style}>{body}</Card>;
}

/** Add a contact, or edit / remove one. The list is shared by the emergency card and the SOS message. */
export function ContactSheet({ visible, contact, onClose }: { visible: boolean; contact?: SosContact | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [phone, setPhone] = useState("+91 ");
  useEffect(() => {
    if (!visible) return;
    setName(contact?.name ?? ""); setRelation(contact?.relation ?? ""); setPhone(contact?.phone ?? "+91 ");
  }, [visible, contact?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = () => { qc.invalidateQueries({ queryKey: ["sos-contacts"] }); qc.invalidateQueries({ queryKey: ["emergency"] }); onClose(); };
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), relation: relation.trim(), phone: phone.trim() };
      return contact ? put(`/sos/contacts/${contact.id}`, body) : post("/sos/contacts", body);
    },
    onSuccess: () => { haptic.success(); done(); },
    onError: e => showError("Couldn't save contact", e),
  });
  const remove = useMutation({ mutationFn: () => del(`/sos/contacts/${contact!.id}`), onSuccess: done, onError: e => showError("Couldn't remove contact", e) });

  const pick = (r: string) => {
    haptic.select();
    setRelation(relation === r ? "" : r);
    if (!name.trim() && r !== "Other" && relation !== r) setName(r); // "Mom" → name "Mom", editable
  };
  const valid = name.trim().length > 0 && /^\+[1-9]\d{7,14}$/.test(phone.replace(/[\s().-]/g, ""));

  return (
    <Backdrop visible={visible} onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: 560 }}>
        <Text style={{ fontSize: 22, fontWeight: "800" }}>{contact ? "Edit contact" : "New emergency contact"}</Text>
        <Text style={{ color: colors.muted, marginTop: 4, marginBottom: 16, lineHeight: 20 }}>They'll get a text with your live location and video if you send an SOS.</Text>

        <Text style={{ fontWeight: "600", fontSize: 13, marginBottom: 8 }}>Who are they?</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {RELATIONS.map(r => <Chip key={r} label={r} tone={relation === r ? "primary" : "ghost"} onPress={() => pick(r)} />)}
        </View>

        <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="Full name" maxLength={60} />
        <Field label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+91 98765 43210" maxLength={24} hint="Include the country code, like +91" />

        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button title="Cancel" variant="soft" onPress={onClose} style={{ flex: 1 }} />
          <Button title={contact ? "Save" : "Add contact"} onPress={() => save.mutate()} loading={save.isPending} disabled={!valid} style={{ flex: 1.3 }} />
        </View>
        {contact && (
          <Button title="Remove this contact" variant="ghost" icon="trash-outline" style={{ marginTop: 12 }}
            onPress={() => showAlert(`Remove ${contact.name}?`, "They'll no longer be texted during an SOS.", [
              { text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => remove.mutate() },
            ])} />
        )}
      </ScrollView>
    </Backdrop>
  );
}
