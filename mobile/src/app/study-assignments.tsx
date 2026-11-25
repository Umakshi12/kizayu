import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { del, get, patch, post } from "../api";
import { showAlert, showError } from "../alert";
import { haptic } from "../haptics";
import { Backdrop } from "../components/Sheets";
import { Text } from "../components/Text";
import { Button, Card, Chip, Empty, ErrorView, Field, Header, IconButton, Loading, Pill, Screen, SectionHeader } from "../components/ui";
import { colors, radius, type } from "../theme";
import type { Assignment, Subject, TimetableSlot } from "../types";

const PRIORITIES: { id: Assignment["priority"]; label: string }[] = [{ id: "low", label: "Low" }, { id: "normal", label: "Normal" }, { id: "high", label: "High" }];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysFromNow = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const validDate = (s: string) => {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(y, m - 1, d);
  return t.getMonth() === m - 1 && t.getDate() === d;
};

/** 0 = midnight. 16 * 60 + 30 -> "4:30 PM" */
const fmtClock = (min: number) => `${(Math.floor(min / 60) % 12) || 12}:${String(min % 60).padStart(2, "0")} ${min >= 720 ? "PM" : "AM"}`;
/** "Tue, 5:00 PM" for a slot the API just created. */
function slotWhen(s: TimetableSlot) {
  if (!s.date) return fmtClock(s.startMin);
  const [y, m, d] = s.date.split("-").map(Number);
  return `${DAY_SHORT[new Date(y, m - 1, d).getDay()]}, ${fmtClock(s.startMin)}`;
}

function dueText(a: Assignment) {
  if (a.dueIn === null) return "No deadline";
  if (a.dueIn < 0) return `${-a.dueIn} day${a.dueIn === -1 ? "" : "s"} overdue`;
  if (a.dueIn === 0) return "Due today";
  if (a.dueIn === 1) return "Tomorrow";
  return `In ${a.dueIn} days`;
}

function refreshStudy(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["study-assignments"] });
  qc.invalidateQueries({ queryKey: ["study-today"] });
  qc.invalidateQueries({ queryKey: ["badges"] });
}

function CheckButton({ checked, celebrating, disabled, label, onPress }: { checked: boolean; celebrating: boolean; disabled: boolean; label: string; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!celebrating) return;
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.3, friction: 3, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
  }, [celebrating, scale]);
  return (
    <Pressable onPress={() => { haptic.tap(); onPress(); }} disabled={disabled} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked, disabled }} accessibilityLabel={label}>
      <Animated.View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", transform: [{ scale }], backgroundColor: checked ? colors.success : "#fff", borderWidth: 2, borderColor: checked ? colors.success : colors.primary }}>
        {checked && <Ionicons name="checkmark" size={18} color="#fff" />}
      </Animated.View>
    </Pressable>
  );
}

function AssignmentRow({ a, celebrating, busy, scheduling, onEdit, onToggle, onSchedule }: {
  a: Assignment; celebrating: boolean; busy: boolean; scheduling: boolean; onEdit: () => void; onToggle: () => void; onSchedule: () => void;
}) {
  const done = a.done;
  const dueColor = done ? colors.muted : a.overdue ? colors.danger : a.dueIn === 0 ? "#8A5A00" : colors.muted;
  return (
    <Card style={{ marginBottom: 10, padding: 14 }}>
      {celebrating && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.successSoft, borderRadius: radius.sm, paddingVertical: 7, paddingHorizontal: 10, marginBottom: 10 }}>
          <Ionicons name="checkmark-circle" size={16} color="#0E7D4B" />
          <Text style={{ color: "#0E7D4B", fontWeight: "700", fontSize: 13 }}>Done, nice work</Text>
        </View>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <CheckButton checked={done || celebrating} celebrating={celebrating} disabled={busy || celebrating}
          label={`${done ? "Reopen" : "Finish"} ${a.title}`} onPress={onToggle} />
        <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${a.title}`} style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {!!a.subject && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: a.color ?? colors.primary }} />}
            {!!a.subject && <Chip label={a.subject} tone="ghost" small />}
            {a.priority === "high" && !done && <Chip label="High" tone="danger" small icon="flag" />}
          </View>
          <Text numberOfLines={2} style={{ fontWeight: "700", fontSize: 16, color: done ? colors.muted : colors.text, textDecorationLine: done ? "line-through" : "none" }}>{a.title}</Text>
          <Text style={{ color: dueColor, fontSize: 12, fontWeight: "600" }}>{done ? "Finished" : dueText(a)}</Text>
        </Pressable>
        {!done && !celebrating && <Button title="Schedule" size="sm" variant="soft" loading={scheduling} onPress={onSchedule} />}
      </View>
    </Card>
  );
}

function DueGroup({ title, tone, count, children }: { title: string; tone?: "danger"; count: number; children: ReactNode }) {
  const red = tone === "danger";
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 12 }}>
        <Text style={{ ...type.heading, color: red ? colors.danger : colors.text }}>{title}</Text>
        <Chip label={`${count}`} tone={red ? "danger" : "ghost"} small />
      </View>
      {children}
    </>
  );
}

function AssignmentSheet({ item, subjects, visible, onClose }: { item: Assignment | null; subjects: Subject[]; visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<Assignment["priority"]>("normal");
  useEffect(() => {
    if (!visible) return;
    setTitle(item?.title ?? ""); setSubjectId(item?.subjectId ?? null); setDue(item?.dueDate ?? ""); setPriority(item?.priority ?? "normal");
  }, [visible, item]);

  const dueQuick = [
    { label: "Today", value: daysFromNow(0) }, { label: "Tomorrow", value: daysFromNow(1) }, { label: "In 3 days", value: daysFromNow(3) },
    { label: "Next week", value: daysFromNow(7) }, { label: "None", value: "" },
  ];
  const badDate = !!due && !validDate(due);
  const save = useMutation({
    mutationFn: () => {
      const body = { title: title.trim(), subjectId, dueDate: due || null, priority };
      return item ? patch(`/study/assignments/${item.id}`, body) : post("/study/assignments", body);
    },
    onSuccess: () => { haptic.success(); refreshStudy(qc); onClose(); },
    onError: e => showError("Couldn't save assignment", e),
  });
  const drop = useMutation({
    mutationFn: () => del(`/study/assignments/${item!.id}`),
    onSuccess: () => { haptic.success(); refreshStudy(qc); onClose(); },
    onError: e => showError("Couldn't delete", e),
  });
  const confirmDelete = () => showAlert(`Delete "${item!.title}"?`, "This can't be undone.", [
    { text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => drop.mutate() },
  ]);

  return (
    <Backdrop visible={visible} onClose={onClose}>
      <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: 12 }}>{item ? "Edit assignment" : "New assignment"}</Text>
      <Field label="What is it?" value={title} onChangeText={setTitle} placeholder="Chapter 4 problem set" maxLength={120} autoCapitalize="sentences" />
      <Text style={{ fontWeight: "700", marginBottom: 8 }}>Subject</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
        <Pill label="None" active={!subjectId} onPress={() => setSubjectId(null)} />
        {subjects.map(s => <Pill key={s.id} label={s.name} active={subjectId === s.id} onPress={() => setSubjectId(s.id)} />)}
      </ScrollView>
      <Text style={{ fontWeight: "700", marginBottom: 8 }}>Due</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        {dueQuick.map(q => <Pill key={q.label} label={q.label} active={due === q.value} onPress={() => setDue(q.value)} />)}
      </View>
      <Field label="Or a date (YYYY-MM-DD)" value={due} onChangeText={setDue} placeholder="2026-12-01" maxLength={10} keyboardType="numbers-and-punctuation"
        hint={badDate ? "Use a date like 2026-12-01" : undefined} />
      <Text style={{ fontWeight: "700", marginBottom: 8 }}>Priority</Text>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
        {PRIORITIES.map(p => <Pill key={p.id} label={p.label} active={priority === p.id} onPress={() => setPriority(p.id)} />)}
      </View>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
        {item && <Button title="Delete" variant="ghost" onPress={confirmDelete} style={{ flex: 1 }} />}
        <Button title="Save" onPress={() => save.mutate()} loading={save.isPending} disabled={!title.trim() || badDate} style={{ flex: 1 }} />
      </View>
    </Backdrop>
  );
}

export default function StudyAssignments() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["study-assignments"], queryFn: () => get<Assignment[]>("/study/assignments") });
  const subjects = useQuery({ queryKey: ["subjects"], queryFn: () => get<Subject[]>("/study/subjects") });
  const [editing, setEditing] = useState<Assignment | null>(null);
  const [open, setOpen] = useState(false);
  const [showFinished, setShowFinished] = useState(false);
  const [celebrating, setCelebrating] = useState<string[]>([]);

  const toggle = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => patch<Assignment>(`/study/assignments/${v.id}`, { done: v.done }),
    onSuccess: (_, v) => {
      if (!v.done) { refreshStudy(qc); return; }
      haptic.success();
      // Keep the row on screen for a moment so the check and banner can play, then move it to Finished.
      setCelebrating(c => [...c, v.id]);
      setTimeout(() => { setCelebrating(c => c.filter(x => x !== v.id)); refreshStudy(qc); }, 1400);
    },
    onError: e => showError("Couldn't update", e),
  });
  const schedule = useMutation({
    mutationFn: (id: string) => post<TimetableSlot>("/study/schedule", { assignmentId: id }),
    onSuccess: slot => {
      haptic.success();
      qc.invalidateQueries({ queryKey: ["timetable"] });
      refreshStudy(qc);
      showAlert(`Scheduled for ${slotWhen(slot)}`, slot.title);
    },
    onError: e => showError("Couldn't schedule", e),
  });

  const openSheet = (a: Assignment | null) => { setEditing(a); setOpen(true); };
  const all = list.data ?? [];
  const open_ = all.filter(a => !a.done);
  const overdue = open_.filter(a => a.overdue);
  const upcoming = open_.filter(a => a.dueIn !== null && !a.overdue);
  const noDeadline = open_.filter(a => a.dueIn === null);
  const finished = all.filter(a => a.done);

  const row = (a: Assignment) => (
    <AssignmentRow key={a.id} a={a}
      celebrating={celebrating.includes(a.id)}
      busy={toggle.isPending && toggle.variables?.id === a.id}
      scheduling={schedule.isPending && schedule.variables === a.id}
      onEdit={() => openSheet(a)}
      onToggle={() => toggle.mutate({ id: a.id, done: !a.done })}
      onSchedule={() => schedule.mutate(a.id)} />
  );

  return (
    <Screen>
      <Header title="Assignments" back
        right={<IconButton icon="add" label="Add an assignment" tint={colors.primary} onPress={() => openSheet(null)} />} />
      {list.isLoading ? <Loading /> : list.error ? <ErrorView error={list.error} onRetry={() => list.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
          {all.length === 0 ? (
            <Card>
              <Empty icon="document-text-outline" title="No assignments yet"
                text="Add homework and projects with a deadline. We'll show what's due and help you fit it into your week."
                actionLabel="Add an assignment" onAction={() => openSheet(null)} />
            </Card>
          ) : (
            <>
              {overdue.length > 0 && <DueGroup title="Overdue" tone="danger" count={overdue.length}>{overdue.map(row)}</DueGroup>}
              {upcoming.length > 0 && <DueGroup title="Upcoming" count={upcoming.length}>{upcoming.map(row)}</DueGroup>}
              {noDeadline.length > 0 && <DueGroup title="No deadline" count={noDeadline.length}>{noDeadline.map(row)}</DueGroup>}
              {open_.length === 0 && <Card style={{ marginTop: 16 }}><Empty compact icon="checkmark-done-outline" title="All caught up" text="Nothing open right now. Nice work." /></Card>}
              {finished.length > 0 && (
                <>
                  <SectionHeader title="Finished" action={showFinished ? "Hide" : `Show ${finished.length}`} onAction={() => setShowFinished(v => !v)} />
                  {showFinished && finished.map(row)}
                </>
              )}
            </>
          )}
        </ScrollView>
      )}
      <AssignmentSheet item={editing} subjects={subjects.data ?? []} visible={open} onClose={() => setOpen(false)} />
    </Screen>
  );
}
