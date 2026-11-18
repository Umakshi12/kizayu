import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, View, StyleSheet } from "react-native";
import { Text } from "../../components/Text";
import { showAlert } from "../../alert";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../../api";
import { Button, Card, Empty, ErrorView, Field, GradientCard, Header, IconButton, IconName, IconTile, Loading, Pill, Screen, SectionHeader, fmtWhen } from "../../components/ui";
import { colors, gradients, radius } from "../../theme";
import { haptic } from "../../haptics";
import { LinearGradient } from "expo-linear-gradient";
import type { Appointment, Task } from "../../types";

const TASK_ICONS: Record<string, { name: IconName; color: string; bg: string }> = {
  pill: { name: "medkit", color: "#4F7DF3", bg: "#E5ECFF" },
  apple: { name: "nutrition", color: "#E5484D", bg: "#FDE8E8" },
  water: { name: "water", color: "#1E9BF0", bg: "#E1F2FD" },
  walk: { name: "walk", color: "#2F9E6B", bg: "#E1F5EA" },
  check: { name: "checkmark-circle", color: colors.primary, bg: colors.primarySoft },
};

const dayLabels = () => Array.from({ length: 5 }, (_, i) => {
  const d = new Date(); d.setDate(d.getDate() + i);
  return { key: d.toDateString(), dow: d.toLocaleDateString(undefined, { weekday: "short" }), num: d.getDate(), date: d };
});

function TaskRow({ task, onDone, busy }: { task: Task; onDone: () => void; busy: boolean }) {
  const ic = TASK_ICONS[task.icon] ?? TASK_ICONS.check;
  const sub = task.targetCount > 1 ? `${task.subtitle ?? "Today"} • ${task.doneCount}/${task.targetCount}` : task.subtitle;
  return (
    <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 }}>
      <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: ic.bg, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={ic.name} size={24} color={ic.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "700", fontSize: 16, color: colors.text }}>{task.title}</Text>
        {sub ? <Text style={{ color: colors.muted, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      {task.done ? (
        <Ionicons name="checkmark-circle" size={32} color={colors.success} accessibilityLabel="Done" />
      ) : (
        <Button title="Done" onPress={onDone} loading={busy} style={{ paddingVertical: 8, paddingHorizontal: 18, minHeight: 36 }} />
      )}
    </Card>
  );
}

function AddTaskModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("check");
  const [time, setTime] = useState("");
  const [count, setCount] = useState("1");
  const add = useMutation({
    mutationFn: () => post("/tasks", {
      title: title.trim(), icon, dueTime: time.trim() || undefined,
      subtitle: time.trim() || (Number(count) > 1 ? `Today • ${count} times` : "Daily • 1 time"),
      targetCount: Math.max(1, parseInt(count, 10) || 1),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); setTitle(""); setTime(""); setCount("1"); onClose(); },
    onError: e => showAlert("Couldn't add task", e instanceof Error ? e.message : "Try again"),
  });
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: colors.bg, padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
          <Text style={{ fontSize: 20, fontWeight: "800", marginBottom: 14 }}>New task</Text>
          <Field label="What do you need to do?" value={title} onChangeText={setTitle} autoCapitalize="sentences" placeholder="Take vitamins" />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}><Field label="Time (optional)" value={time} onChangeText={setTime} placeholder="8:00 PM" /></View>
            <View style={{ width: 110 }}><Field label="Times a day" value={count} onChangeText={setCount} keyboardType="number-pad" /></View>
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
            {Object.entries(TASK_ICONS).map(([k, v]) => (
              <Pressable key={k} onPress={() => setIcon(k)} accessibilityLabel={`Icon ${k}`}
                style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: v.bg, alignItems: "center", justifyContent: "center", borderWidth: icon === k ? 2 : 0, borderColor: colors.primary }}>
                <Ionicons name={v.name} size={22} color={v.color} />
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button title="Cancel" variant="soft" onPress={onClose} style={{ flex: 1 }} />
            <Button title="Add task" onPress={() => add.mutate()} loading={add.isPending} disabled={!title.trim()} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function AddAppointmentModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); d.setHours(0, 0, 0, 0); return d; }), []);
  const [kind, setKind] = useState<"doctor" | "call" | "other">("doctor");
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(0);
  const [time, setTime] = useState("10:00");
  const [pm, setPm] = useState(false);
  const m = time.match(/^(\d{1,2}):(\d{2})$/);
  const valid = !!m && +m[1] >= 1 && +m[1] <= 12 && +m[2] < 60;
  const add = useMutation({
    mutationFn: () => {
      const d = new Date(days[day]);
      d.setHours((+m![1] % 12) + (pm ? 12 : 0), +m![2], 0, 0);
      const fallback = kind === "doctor" ? "Doctor appointment" : kind === "call" ? "Family call" : "Reminder";
      return post("/appointments", { title: title.trim() || fallback, kind, startsAt: d.toISOString() });
    },
    onSuccess: () => { haptic.success(); qc.invalidateQueries({ queryKey: ["appointments"] }); setTitle(""); onClose(); },
    onError: e => showAlert("Couldn't save", e instanceof Error ? e.message : "Try again"),
  });
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(10,13,18,0.55)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: colors.bg, padding: 20, borderTopLeftRadius: 30, borderTopRightRadius: 30 }}>
          <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: 14 }} />
          <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: 14 }}>New appointment</Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
            <Pill label="Doctor" icon="medical" active={kind === "doctor"} onPress={() => setKind("doctor")} />
            <Pill label="Call" icon="call" active={kind === "call"} onPress={() => setKind("call")} />
            <Pill label="Other" icon="calendar" active={kind === "other"} onPress={() => setKind("other")} />
          </View>
          <Field label="Title (optional)" value={title} onChangeText={setTitle} autoCapitalize="sentences"
            placeholder={kind === "doctor" ? "Check-up with your doctor" : kind === "call" ? "Sunday family call" : "Pick up medicines"} />
          <Text style={{ fontWeight: "600", fontSize: 13, marginBottom: 8 }}>Day</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 16 }}>
            {days.map((d, i) => (
              <Pill key={i} label={i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} active={day === i} onPress={() => setDay(i)} />
            ))}
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}><Field label="Time" value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" placeholder="10:30" /></View>
            <View style={{ flexDirection: "row", gap: 6, marginBottom: 16 }}>
              <Pill label="AM" active={!pm} onPress={() => setPm(false)} />
              <Pill label="PM" active={pm} onPress={() => setPm(true)} />
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
            <Button title="Cancel" variant="soft" onPress={onClose} style={{ flex: 1 }} />
            <Button title="Save" onPress={() => add.mutate()} loading={add.isPending} disabled={!valid} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function MyDay() {
  const qc = useQueryClient();
  const days = useMemo(dayLabels, []);
  const [selected, setSelected] = useState(days[0].key);
  const [adding, setAdding] = useState(false);
  const [addingAppt, setAddingAppt] = useState(false);

  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => get<{ items: Task[]; remaining: number }>("/tasks") });
  const appts = useQuery({ queryKey: ["appointments"], queryFn: () => get<Appointment[]>("/appointments") });
  const done = useMutation({
    mutationFn: (id: string) => post(`/tasks/${id}/done`),
    onSuccess: () => { haptic.success(); qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["pulse"] }); },
    onError: e => showAlert("Couldn't update task", e instanceof Error ? e.message : "Try again"),
  });

  const isToday = selected === days[0].key;
  const upcoming = (appts.data ?? []).filter(a => isToday || new Date(a.startsAt).toDateString() === selected);
  const total = tasks.data?.items.length ?? 0;
  const finished = total - (tasks.data?.remaining ?? 0);
  const pct = total ? finished / total : 0;

  return (
    <Screen>
      <Header title="My Day" subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
        right={<IconButton icon="add" label="Add task" tint={colors.primary} onPress={() => setAdding(true)} />} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
        <GradientCard>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "rgba(255,255,255,0.8)", fontWeight: "600" }}>Today's progress</Text>
              <Text style={{ color: "#fff", fontSize: 26, fontWeight: "800", marginTop: 2 }}>{total ? `${finished} of ${total} done` : "Plan your day"}</Text>
            </View>
            <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{Math.round(pct * 100)}%</Text>
            </View>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.22)", marginTop: 16, overflow: "hidden" }}>
            <View style={{ width: `${pct * 100}%`, height: 8, borderRadius: 4, backgroundColor: "#fff" }} />
          </View>
        </GradientCard>

        <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
          {days.map(d => {
            const on = d.key === selected;
            return (
              <Pressable key={d.key} onPress={() => { haptic.select(); setSelected(d.key); }}
                style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: radius.md, overflow: "hidden", backgroundColor: on ? "transparent" : "#fff", borderWidth: on ? 0 : 1, borderColor: colors.hairline }}>
                {on && <LinearGradient colors={gradients.primary} style={StyleSheet.absoluteFill} />}
                <Text style={{ color: on ? "rgba(255,255,255,0.85)" : colors.muted, fontWeight: "600", fontSize: 12 }}>{d.dow}</Text>
                <Text style={{ color: on ? "#fff" : colors.text, fontWeight: "800", fontSize: 19, marginTop: 2 }}>{d.num}</Text>
              </Pressable>
            );
          })}
        </View>

        <SectionHeader title="Today's tasks" action={tasks.data?.items.length ? `${tasks.data.remaining} left` : undefined} />
        {tasks.isLoading ? <Loading rows={2} /> : tasks.error ? <ErrorView error={tasks.error} onRetry={() => tasks.refetch()} /> :
          !isToday ? <Card><Empty compact icon="repeat" text="Tasks repeat every day. Switch to today to check them off." /></Card> :
          tasks.data!.items.length === 0 ? <Card><Empty compact icon="checkbox-outline" title="No tasks yet" text="Add medicines, water, a walk or anything you want to remember." actionLabel="Add a task" onAction={() => setAdding(true)} /></Card> :
          tasks.data!.items.map(t => (
            <TaskRow key={t.id} task={t} onDone={() => done.mutate(t.id)} busy={done.isPending && done.variables === t.id} />
          ))}

        <SectionHeader title="Upcoming" action="Add" onAction={() => setAddingAppt(true)} />
        {appts.isLoading ? <Loading rows={1} /> : upcoming.length === 0 ? (
          <Card><Empty compact icon="calendar-outline" title="Nothing scheduled" text="Add a doctor visit or a family call so everyone stays in the loop." /></Card>
        ) : upcoming.map(a => (
          <Card key={a.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <IconTile icon={a.kind === "call" ? "call" : a.kind === "doctor" ? "medical" : "calendar"} gradient={a.kind === "call" ? gradients.success : a.kind === "doctor" ? gradients.primary : gradients.sunrise} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "700" }}>{a.title}</Text>
              <Text style={{ color: colors.muted, marginTop: 2, fontSize: 13 }}>{fmtWhen(a.startsAt)}</Text>
            </View>
          </Card>
        ))}
      </ScrollView>
      <AddTaskModal visible={adding} onClose={() => setAdding(false)} />
      <AddAppointmentModal visible={addingAppt} onClose={() => setAddingAppt(false)} />
    </Screen>
  );
}
