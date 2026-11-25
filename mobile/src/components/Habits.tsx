import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, patch, post } from "../api";
import { showAlert, showError } from "../alert";
import { haptic } from "../haptics";
import { parseClock, toHHMM } from "../reminders";
import { colors, radius } from "../theme";
import type { Habit } from "../types";
import { Backdrop } from "./Sheets";
import { Text } from "./Text";
import { Button, Card, Empty, Field, IconName, IconTile, Loading, SectionHeader } from "./ui";

export const HABIT_ICONS: IconName[] = ["star", "water", "walk", "book", "bed", "fitness", "heart", "leaf", "nutrition", "medkit", "sunny", "musical-notes"];
const SUGGESTIONS: { title: string; icon: IconName; target?: number }[] = [
  { title: "Drink water", icon: "water", target: 6 }, { title: "Walk", icon: "walk" }, { title: "Read", icon: "book" },
  { title: "Sleep early", icon: "bed" }, { title: "Stretch", icon: "fitness" }, { title: "Call family", icon: "heart" },
];

function HabitSheet({ habit, visible, onClose }: { habit: Habit | null; visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState<IconName>("star");
  const [target, setTarget] = useState(1);
  const [remind, setRemind] = useState("");
  useEffect(() => {
    if (!visible) return;
    setTitle(habit?.title ?? ""); setIcon((habit?.icon as IconName) ?? "star"); setTarget(habit?.target ?? 1); setRemind(habit?.remindAt ?? "");
  }, [visible, habit]);

  const clock = remind.trim() ? parseClock(remind) : null;
  const badTime = !!remind.trim() && !clock;
  const done = () => { qc.invalidateQueries({ queryKey: ["habits"] }); onClose(); };
  const save = useMutation({
    mutationFn: () => {
      const body = { title: title.trim(), icon, target, remindAt: clock ? toHHMM(clock) : null };
      return habit ? patch(`/habits/${habit.id}`, body) : post("/habits", { ...body, remindAt: body.remindAt ?? undefined });
    },
    onSuccess: () => { haptic.success(); done(); }, onError: e => showError("Couldn't save habit", e),
  });
  const drop = useMutation({ mutationFn: () => del(`/habits/${habit!.id}`), onSuccess: done, onError: e => showError("Couldn't delete", e) });
  const confirmDelete = () => showAlert(`Delete "${habit!.title}"?`, "Its streak and history will be removed.", [
    { text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => drop.mutate() },
  ]);

  return (
    <Backdrop visible={visible} onClose={onClose}>
      <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: 12 }}>{habit ? "Edit habit" : "New habit"}</Text>
      {!habit && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {SUGGESTIONS.map(s => (
            <Pressable key={s.title} onPress={() => { haptic.select(); setTitle(s.title); setIcon(s.icon); setTarget(s.target ?? 1); }}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: title === s.title ? colors.primarySoft : "#fff", borderWidth: 1, borderColor: title === s.title ? colors.primary : colors.border }}>
              <Ionicons name={s.icon} size={14} color={colors.primary} /><Text style={{ fontWeight: "600", fontSize: 13 }}>{s.title}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Field label="What do you want to do every day?" value={title} onChangeText={setTitle} placeholder="Evening walk" maxLength={60} autoCapitalize="sentences" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        {HABIT_ICONS.map(n => (
          <Pressable key={n} onPress={() => { haptic.select(); setIcon(n); }} accessibilityLabel={`Icon ${n}`}
            style={{ width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: icon === n ? colors.primarySoft : "#fff", borderWidth: 2, borderColor: icon === n ? colors.primary : colors.border }}>
            <Ionicons name={n} size={20} color={icon === n ? colors.primary : colors.muted} />
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "700" }}>Times per day</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{target === 1 ? "Once a day" : `${target} times, e.g. glasses of water`}</Text>
        </View>
        <Pressable onPress={() => setTarget(Math.max(1, target - 1))} accessibilityLabel="Fewer" style={step}><Ionicons name="remove" size={20} color={colors.text} /></Pressable>
        <Text style={{ width: 40, textAlign: "center", fontWeight: "800", fontSize: 18 }}>{target}</Text>
        <Pressable onPress={() => setTarget(Math.min(20, target + 1))} accessibilityLabel="More" style={step}><Ionicons name="add" size={20} color={colors.text} /></Pressable>
      </View>
      <Field label="Remind me at (optional)" value={remind} onChangeText={setRemind} placeholder="7:30 PM" maxLength={8} autoCapitalize="none"
        hint={badTime ? "Use a time like 7:30 PM or 19:30" : "A daily reminder on this phone"} />
      <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
        {habit && <Button title="Delete" variant="ghost" onPress={confirmDelete} style={{ flex: 1 }} />}
        <Button title="Save" onPress={() => save.mutate()} loading={save.isPending} disabled={!title.trim() || badTime} style={{ flex: 1 }} />
      </View>
    </Backdrop>
  );
}
const step = { width: 40, height: 40, borderRadius: 20, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border };

function HabitRow({ h, onEdit }: { h: Habit; onEdit: () => void }) {
  const qc = useQueryClient();
  const tick = useMutation({
    mutationFn: (undo: boolean) => post<Habit>(`/habits/${h.id}/check`, { undo }),
    onSuccess: (fresh, undo) => {
      if (!undo && fresh.doneToday) haptic.success(); else haptic.tap();
      qc.setQueryData<Habit[]>(["habits"], old => old?.map(x => x.id === fresh.id ? fresh : x));
    },
    onError: e => showError("Couldn't update habit", e),
  });
  const press = () => tick.mutate(h.doneToday);
  return (
    <Card style={{ marginBottom: 10, padding: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable onPress={onEdit} accessibilityLabel={`Edit ${h.title}`} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <IconTile icon={h.icon as IconName} size={44} color={h.doneToday ? "#fff" : colors.primary} bg={h.doneToday ? colors.success : colors.primarySoft} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", fontSize: 16 }} numberOfLines={1}>{h.title}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
              <Ionicons name="flame" size={14} color={h.streak ? colors.warn : colors.faint} />
              <Text style={{ color: h.streak ? "#8A5A00" : colors.muted, fontSize: 12, fontWeight: "600" }}>
                {h.streak ? `${h.streak} day${h.streak > 1 ? "s" : ""} in a row` : "Start your streak today"}
              </Text>
            </View>
          </View>
        </Pressable>
        <Pressable onPress={press} disabled={tick.isPending} accessibilityRole="button"
          accessibilityLabel={h.doneToday ? `Undo ${h.title}` : h.target > 1 ? `Add one to ${h.title}` : `Mark ${h.title} done`}
          style={{ minWidth: 52, height: 52, paddingHorizontal: 6, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: h.doneToday ? colors.success : "#fff", borderWidth: 2, borderColor: h.doneToday ? colors.success : colors.primary }}>
          {h.doneToday ? <Ionicons name="checkmark" size={26} color="#fff" /> : h.target > 1
            ? <Text style={{ fontWeight: "800", color: colors.primary }}>{h.todayCount}/{h.target}</Text>
            : <Ionicons name="add" size={26} color={colors.primary} />}
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", gap: 6, marginTop: 12, marginLeft: 56 }}>
        {h.last7.map((d, i) => (
          <View key={d.date} accessibilityLabel={`${d.date} ${d.done ? "done" : "not done"}`}
            style={{ width: 22, height: 8, borderRadius: 4, backgroundColor: d.done ? colors.success : d.count > 0 ? "#9BE3C0" : colors.border, opacity: i === 6 ? 1 : 0.85 }} />
        ))}
      </View>
    </Card>
  );
}

/** "My habits" on the My Day tab: tick off daily habits and watch streaks grow. */
export function HabitsSection() {
  const habits = useQuery({ queryKey: ["habits"], queryFn: () => get<Habit[]>("/habits") });
  const [editing, setEditing] = useState<Habit | null>(null);
  const [open, setOpen] = useState(false);
  const left = (habits.data ?? []).filter(h => !h.doneToday).length;
  const edit = (h: Habit | null) => { setEditing(h); setOpen(true); };
  return (
    <>
      <SectionHeader title="My habits" action={habits.data?.length ? (left ? `${left} left` : "All done") : "Add"} onAction={habits.data?.length ? undefined : () => edit(null)} />
      {habits.isLoading ? <Loading rows={1} /> : (habits.data?.length ?? 0) === 0 ? (
        <Card><Empty compact icon="flame-outline" title="Build a daily habit" text="Drink water, walk, read, call family. Tick it off each day and grow your streak." actionLabel="Add a habit" onAction={() => edit(null)} /></Card>
      ) : (
        <>
          {habits.data!.map(h => <HabitRow key={h.id} h={h} onEdit={() => edit(h)} />)}
          <Button title="Add a habit" icon="add" variant="soft" size="sm" onPress={() => edit(null)} style={{ alignSelf: "flex-start" }} />
        </>
      )}
      <HabitSheet habit={editing} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
