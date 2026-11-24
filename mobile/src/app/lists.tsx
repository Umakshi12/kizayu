import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, patch, post } from "../api";
import { showAlert, showError } from "../alert";
import { haptic } from "../haptics";
import { getSocket } from "../realtime";
import { useAuth } from "../auth";
import { Text, TextInput } from "../components/Text";
import { Button, Card, Empty, ErrorView, Field, Header, IconButton, IconName, IconTile, Loading, Pill, Screen } from "../components/ui";
import { colors, gradients, radius } from "../theme";
import type { Circle, SharedList } from "../types";

const ICONS: Record<string, IconName> = { cart: "cart", list: "list", airplane: "airplane", gift: "gift", home: "home", medkit: "medkit" };
const GRADS = [gradients.ocean, gradients.success, gradients.sunrise, gradients.danger] as const;
const TEMPLATES: { title: string; icon: string }[] = [
  { title: "Groceries", icon: "cart" }, { title: "To-do", icon: "list" }, { title: "Packing list", icon: "airplane" },
  { title: "Gift ideas", icon: "gift" }, { title: "Home chores", icon: "home" }, { title: "Medicines to buy", icon: "medkit" },
];

function NewListSheet({ circleId, visible, onClose }: { circleId: string; visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("list");
  const create = useMutation({
    mutationFn: () => post(`/circles/${circleId}/lists`, { title: title.trim(), icon }),
    onSuccess: () => { haptic.success(); setTitle(""); qc.invalidateQueries({ queryKey: ["lists", circleId] }); onClose(); },
    onError: e => showError("Couldn't create list", e),
  });
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: colors.bg, padding: 20, borderTopLeftRadius: 30, borderTopRightRadius: 30 }}>
          <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: 14 }} />
          <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: 12 }}>New list</Text>
          <Text style={{ fontWeight: "600", fontSize: 13, marginBottom: 8 }}>Quick start</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {TEMPLATES.map(t => <Pill key={t.title} label={t.title} icon={ICONS[t.icon]} active={title === t.title} onPress={() => { setTitle(t.title); setIcon(t.icon); }} />)}
          </View>
          <Field label="List name" value={title} onChangeText={setTitle} autoCapitalize="sentences" placeholder="Weekend picnic" maxLength={60} />
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
            {Object.entries(ICONS).map(([k, name]) => (
              <Pressable key={k} onPress={() => { haptic.select(); setIcon(k); }} accessibilityLabel={`Icon ${k}`}
                style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: icon === k ? colors.primarySoft : "#fff", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: icon === k ? colors.primary : colors.border }}>
                <Ionicons name={name} size={21} color={icon === k ? colors.primary : colors.muted} />
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button title="Cancel" variant="soft" onPress={onClose} style={{ flex: 1 }} />
            <Button title="Create" onPress={() => create.mutate()} loading={create.isPending} disabled={!title.trim()} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ListCard({ list, index, circleId }: { list: SharedList; index: number; circleId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["lists", circleId] });
  const add = useMutation({ mutationFn: (t: string) => post(`/lists/${list.id}/items`, { text: t }), onSuccess: () => { haptic.tap(); refresh(); }, onError: e => showError("Couldn't add", e) });
  const toggle = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => patch(`/lists/${list.id}/items/${v.id}`, { done: v.done }),
    onMutate: async v => { // tick instantly, then confirm with the server
      await qc.cancelQueries({ queryKey: ["lists", circleId] });
      const prev = qc.getQueryData<SharedList[]>(["lists", circleId]);
      qc.setQueryData<SharedList[]>(["lists", circleId], old => old?.map(l => l.id === list.id ? { ...l, items: l.items.map(i => i.id === v.id ? { ...i, done: v.done } : i) } : l));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["lists", circleId], ctx.prev); showError("Couldn't update", e); },
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/lists/${list.id}/items/${id}`), onSuccess: refresh, onError: e => showError("Couldn't remove", e) });
  const clear = useMutation({ mutationFn: () => post(`/lists/${list.id}/clear-done`), onSuccess: () => { haptic.success(); refresh(); }, onError: e => showError("Couldn't clear", e) });
  const drop = useMutation({ mutationFn: () => del(`/lists/${list.id}`), onSuccess: refresh, onError: e => showError("Couldn't delete list", e) });

  const done = list.items.filter(i => i.done).length;
  const submit = () => { const t = text.trim(); if (!t) return; setText(""); add.mutate(t); };
  const confirmDelete = () => showAlert(`Delete "${list.title}"?`, "It will be removed for everyone in the circle.", [
    { text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => drop.mutate() },
  ]);

  return (
    <Card style={{ marginBottom: 16, padding: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <IconTile icon={ICONS[list.icon] ?? "list"} gradient={GRADS[index % GRADS.length]} size={42} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "800", fontSize: 17 }} numberOfLines={1}>{list.title}</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{list.items.length ? `${done} of ${list.items.length} done` : "Nothing here yet"}</Text>
        </View>
        {done > 0 && <Button title="Clear done" size="sm" variant="soft" onPress={() => clear.mutate()} loading={clear.isPending} />}
        <Pressable onPress={confirmDelete} hitSlop={10} accessibilityLabel={`Delete ${list.title}`} style={{ padding: 4 }}>
          <Ionicons name="trash-outline" size={20} color={colors.faint} />
        </Pressable>
      </View>

      {list.items.length > 0 && (
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
          {list.items.map((it, i) => (
            <View key={it.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
              <Pressable onPress={() => { haptic.select(); toggle.mutate({ id: it.id, done: !it.done }); }} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: it.done }}
                accessibilityLabel={it.text} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Ionicons name={it.done ? "checkmark-circle" : "ellipse-outline"} size={26} color={it.done ? colors.success : colors.faint} />
                <Text style={{ flex: 1, fontSize: 16, color: it.done ? colors.faint : colors.text, textDecorationLine: it.done ? "line-through" : "none" }}>{it.text}</Text>
              </Pressable>
              {(it.addedById === user?.id || it.done) && (
                <Pressable onPress={() => remove.mutate(it.id)} hitSlop={10} accessibilityLabel={`Remove ${it.text}`}>
                  <Ionicons name="close" size={20} color={colors.faint} />
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 }}>
        <TextInput value={text} onChangeText={setText} placeholder="Add an item…" maxLength={120} onSubmitEditing={submit} returnKeyType="done" blurOnSubmit={false}
          style={{ flex: 1, backgroundColor: colors.primaryTint, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 11 }} />
        <Pressable onPress={submit} disabled={!text.trim() || add.isPending} accessibilityLabel={`Add to ${list.title}`}
          style={{ width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: text.trim() ? colors.ink : colors.border }}>
          <Ionicons name="add" size={24} color="#fff" />
        </Pressable>
      </View>
    </Card>
  );
}

export default function Lists() {
  const circles = useQuery({ queryKey: ["circles"], queryFn: () => get<Circle[]>("/circles") });
  const qc = useQueryClient();
  const [circleId, setCircleId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (!circleId && circles.data?.length) setCircleId((circles.data.find(c => c.type === "Family") ?? circles.data[0]).id);
  }, [circles.data, circleId]);

  const lists = useQuery({ queryKey: ["lists", circleId], enabled: !!circleId, queryFn: () => get<SharedList[]>(`/circles/${circleId}/lists`) });

  // Live: when anyone in the circle changes a list, refresh it right away.
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !circleId) return;
    const onChanged = (e: { circleId: string }) => { if (e.circleId === circleId) qc.invalidateQueries({ queryKey: ["lists", circleId] }); };
    socket.on("listChanged", onChanged);
    return () => { socket.off("listChanged", onChanged); };
  }, [circleId, qc]);

  const circle = circles.data?.find(c => c.id === circleId);
  return (
    <Screen>
      <Header title="Family lists" subtitle={circle ? `Shared with ${circle.name}` : undefined} back
        right={circleId ? <IconButton icon="add" label="New list" tint={colors.primary} onPress={() => setCreating(true)} /> : undefined} />
      {circles.isLoading ? <Loading /> : circles.error ? <ErrorView error={circles.error} onRetry={() => circles.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {(circles.data?.length ?? 0) > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
              {circles.data!.map(c => <Pill key={c.id} label={c.name} active={c.id === circleId} onPress={() => setCircleId(c.id)} />)}
            </ScrollView>
          )}
          {lists.isLoading ? <Loading rows={2} /> : lists.error ? <ErrorView error={lists.error} onRetry={() => lists.refetch()} /> :
            (lists.data?.length ?? 0) === 0 ? (
              <Card><Empty icon="cart-outline" title="No lists yet" text="Make a grocery list, a packing list or a to-do list. Everyone in your circle can add and tick items, and changes show up live."
                actionLabel="Create a list" onAction={() => setCreating(true)} /></Card>
            ) : lists.data!.map((l, i) => <ListCard key={l.id} list={l} index={i} circleId={circleId!} />)}
        </ScrollView>
      )}
      {circleId && <NewListSheet circleId={circleId} visible={creating} onClose={() => setCreating(false)} />}
    </Screen>
  );
}
