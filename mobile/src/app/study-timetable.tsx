import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { del, get, patch, post } from "../api";
import { showAlert, showError } from "../alert";
import { haptic } from "../haptics";
import { parseClock } from "../reminders";
import { Backdrop } from "../components/Sheets";
import { Text } from "../components/Text";
import { Button, Card, Chip, Empty, ErrorView, Field, Header, IconButton, Loading, Pill, Screen, SectionHeader } from "../components/ui";
import { colors } from "../theme";
import type { Subject, TimetableSlot } from "../types";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEK = [1, 2, 3, 4, 5, 6, 0]; // Monday first. Values are JS getDay() numbers.
const QUICK = [{ title: "Study", minutes: 45 }, { title: "Revision", minutes: 30 }, { title: "Homework", minutes: 60 }];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const offsetDate = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
/** The next date (within 7 days, today included) that falls on this weekday. */
const dayAt = (wd: number) => offsetDate((wd - new Date().getDay() + 7) % 7);
const validDate = (s: string) => {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(y, m - 1, d);
  return t.getMonth() === m - 1 && t.getDate() === d;
};
const labelOf = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  const x = new Date(y, m - 1, d);
  return `${DAY_SHORT[x.getDay()]} ${x.getDate()}`;
};

/** 0 = midnight. 16 * 60 + 30 -> "4:30 PM" */
const fmtClock = (min: number) => `${(Math.floor(min / 60) % 12) || 12}:${String(min % 60).padStart(2, "0")} ${min >= 720 ? "PM" : "AM"}`;
/** "Tue, 5:00 PM" for a slot the API just created. */
function slotWhen(s: TimetableSlot) {
  if (!s.date) return fmtClock(s.startMin);
  const [y, m, d] = s.date.split("-").map(Number);
  return `${DAY_SHORT[new Date(y, m - 1, d).getDay()]}, ${fmtClock(s.startMin)}`;
}
const parseMin = (text: string) => { const c = parseClock(text); return c ? c.hour * 60 + c.minute : null; };

function refreshTimetable(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["timetable"] });
  qc.invalidateQueries({ queryKey: ["study-today"] });
}

function SlotCard({ s, onEdit }: { s: TimetableSlot; onEdit: () => void }) {
  return (
    <Card onPress={onEdit} style={{ marginBottom: 10, padding: 0, flexDirection: "row", overflow: "hidden" }}>
      <View style={{ width: 5, backgroundColor: s.color ?? colors.primary }} />
      <View style={{ flex: 1, padding: 14, gap: 4 }}>
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>{`${fmtClock(s.startMin)} - ${fmtClock(s.endMin)}`}</Text>
        <Text style={{ fontWeight: "700", fontSize: 16 }} numberOfLines={1}>{s.title}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
          {!!s.subject && <Text style={{ color: colors.muted, fontSize: 12 }}>{s.subject}</Text>}
          <Chip label={s.repeats ? "Repeats weekly" : "One time"} tone={s.repeats ? "primary" : "amber"} small />
        </View>
      </View>
    </Card>
  );
}

function SlotSheet({ slot, day, dayKey, subjects, visible, onClose }: {
  slot: TimetableSlot | null; day: number; dayKey: string; subjects: Subject[]; visible: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [mode, setMode] = useState<"weekly" | "date">("weekly");
  const [weekday, setWeekday] = useState(day);
  const [date, setDate] = useState(dayKey);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  useEffect(() => {
    if (!visible) return;
    setTitle(slot?.title ?? ""); setSubjectId(slot?.subjectId ?? null);
    setMode(slot && !slot.repeats ? "date" : "weekly");
    setWeekday(slot?.weekday ?? day); setDate(slot?.date ?? dayKey);
    setStart(slot ? fmtClock(slot.startMin) : ""); setEnd(slot ? fmtClock(slot.endMin) : "");
  }, [visible, slot, day, dayKey]);

  const startMin = parseMin(start), endMin = parseMin(end);
  const badStart = !!start.trim() && startMin === null;
  const badEnd = !!end.trim() && endMin === null;
  const badOrder = startMin !== null && endMin !== null && endMin <= startMin;
  const badDate = mode === "date" && !validDate(date);
  const ok = !!title.trim() && startMin !== null && endMin !== null && !badOrder && !badDate;

  // Next 7 days as pills. An existing one-off slot further out keeps its own pill so it can still be shown.
  const dateOpts = [0, 1, 2, 3, 4, 5, 6].map(n => ymd(offsetDate(n)));
  if (validDate(date) && !dateOpts.includes(date)) dateOpts.push(date);
  dateOpts.sort();

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: title.trim(), subjectId,
        weekday: mode === "weekly" ? weekday : null,
        date: mode === "date" ? date : null,
        startMin: startMin ?? 0, endMin: endMin ?? 0,
      };
      return slot ? patch(`/study/timetable/${slot.id}`, body) : post("/study/timetable", body);
    },
    onSuccess: () => { haptic.success(); refreshTimetable(qc); onClose(); },
    onError: e => showError("Couldn't save slot", e),
  });
  const drop = useMutation({
    mutationFn: () => del(`/study/timetable/${slot!.id}`),
    onSuccess: () => { haptic.success(); refreshTimetable(qc); onClose(); },
    onError: e => showError("Couldn't delete", e),
  });
  const confirmDelete = () => showAlert(`Delete "${slot!.title}"?`, "This can't be undone.", [
    { text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => drop.mutate() },
  ]);

  const timeHint = (bad: boolean) => (bad ? "Use a time like 4:30 PM or 16:30" : undefined);
  return (
    <Backdrop visible={visible} onClose={onClose}>
      <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: 12 }}>{slot ? "Edit slot" : "New slot"}</Text>
      <Field label="What is it?" value={title} onChangeText={setTitle} placeholder="Maths lecture" maxLength={60} autoCapitalize="sentences" />
      <Text style={{ fontWeight: "700", marginBottom: 8 }}>Subject</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
        <Pill label="None" active={!subjectId} onPress={() => setSubjectId(null)} />
        {subjects.map(s => <Pill key={s.id} label={s.name} active={subjectId === s.id} onPress={() => setSubjectId(s.id)} />)}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <Pill label="Every week" active={mode === "weekly"} onPress={() => setMode("weekly")} />
        <Pill label="One date" active={mode === "date"} onPress={() => setMode("date")} />
      </View>
      {mode === "weekly" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {WEEK.map(wd => <Pill key={wd} label={DAY_SHORT[wd]} active={weekday === wd} onPress={() => setWeekday(wd)} />)}
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {dateOpts.map(o => <Pill key={o} label={labelOf(o)} active={date === o} onPress={() => setDate(o)} />)}
        </View>
      )}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Field label="Starts" value={start} onChangeText={setStart} placeholder="4:30 PM" maxLength={8}
            hint={timeHint(badStart)} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Ends" value={end} onChangeText={setEnd} placeholder="5:30 PM" maxLength={8}
            hint={badEnd ? "Use a time like 5:30 PM" : badOrder ? "Ends after it starts" : undefined} />
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
        {slot && <Button title="Delete" variant="ghost" onPress={confirmDelete} style={{ flex: 1 }} />}
        <Button title="Save" onPress={() => save.mutate()} loading={save.isPending} disabled={!ok} style={{ flex: 1 }} />
      </View>
    </Backdrop>
  );
}

export default function StudyTimetable() {
  const qc = useQueryClient();
  const slots = useQuery({ queryKey: ["timetable"], queryFn: () => get<TimetableSlot[]>("/study/timetable") });
  const subjects = useQuery({ queryKey: ["subjects"], queryFn: () => get<Subject[]>("/study/subjects") });
  const todayWd = new Date().getDay();
  const [day, setDay] = useState(todayWd);
  const [editing, setEditing] = useState<TimetableSlot | null>(null);
  const [open, setOpen] = useState(false);

  const dayDate = dayAt(day);
  const dayKey = ymd(dayDate);
  const daySlots = (slots.data ?? [])
    .filter(s => (s.weekday !== null && s.weekday === day) || (s.date !== null && s.date === dayKey))
    .sort((a, b) => a.startMin - b.startMin);

  const openSheet = (s: TimetableSlot | null) => { setEditing(s); setOpen(true); };

  // Finds the next free 3 to 9 PM window in the coming week on its own.
  const quick = useMutation({
    mutationFn: (q: { title: string; minutes: number }) => post<TimetableSlot>("/study/schedule", q),
    onSuccess: slot => {
      haptic.success();
      refreshTimetable(qc);
      showAlert(`Scheduled for ${slotWhen(slot)}`, slot.title);
    },
    onError: e => showError("Couldn't find a free slot", e),
  });

  return (
    <Screen>
      <Header title="Timetable" back
        right={<IconButton icon="add" label="Add a slot" tint={colors.primary} onPress={() => openSheet(null)} />} />
      {slots.isLoading ? <Loading /> : slots.error ? <ErrorView error={slots.error} onRetry={() => slots.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 4 }}>
            {WEEK.map(wd => (
              <View key={wd} style={{ alignItems: "center", gap: 5 }}>
                <Pill label={DAY_SHORT[wd]} active={day === wd} onPress={() => setDay(wd)} />
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: wd === todayWd ? colors.primary : "transparent" }} />
              </View>
            ))}
          </ScrollView>

          <SectionHeader title={`${DAY_LONG[day]}, ${MONTHS[dayDate.getMonth()]} ${dayDate.getDate()}`} action="Add" onAction={() => openSheet(null)} />

          {daySlots.length === 0 ? (
            <>
              <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "600", marginBottom: 8 }}>Quick add</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                {QUICK.map(q => (
                  <Button key={q.title} title={`${q.title} ${q.minutes} min`} size="sm" variant="soft" icon="flash-outline"
                    loading={quick.isPending && quick.variables?.title === q.title} onPress={() => quick.mutate(q)} />
                ))}
              </View>
              <Card>
                <Empty compact icon="calendar-outline" title="Nothing planned" text="Add a class, or use quick add to fit in a study block between 3 and 9 PM."
                  actionLabel="Add a slot" onAction={() => openSheet(null)} />
              </Card>
            </>
          ) : daySlots.map(s => <SlotCard key={s.id} s={s} onEdit={() => openSheet(s)} />)}
        </ScrollView>
      )}
      <SlotSheet slot={editing} day={day} dayKey={dayKey} subjects={subjects.data ?? []} visible={open} onClose={() => setOpen(false)} />
    </Screen>
  );
}
