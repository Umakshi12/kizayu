import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, patch, post, put } from "../api";
import { showAlert, showError } from "../alert";
import { haptic } from "../haptics";
import { useAuth } from "../auth";
import { CirclePills, useCircle } from "../components/CirclePicker";
import { Backdrop } from "../components/Sheets";
import { Text } from "../components/Text";
import { Avatar, Button, Card, Chip, Empty, ErrorView, Field, Header, IconButton, IconName, IconTile, Loading, Pill, Screen } from "../components/ui";
import { parseClock } from "../reminders";
import { colors, radius } from "../theme";
import type { FamilyEvent } from "../types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KIND: Record<FamilyEvent["kind"], { icon: IconName; label: string; bg: string; fg: string }> = {
  event: { icon: "calendar", label: "Event", bg: colors.primarySoft, fg: colors.primary },
  birthday: { icon: "gift", label: "Birthday", bg: "#FDE7F1", fg: "#E0559A" },
  anniversary: { icon: "heart", label: "Anniversary", bg: colors.dangerSoft, fg: colors.danger },
};
const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** All-day events are stored as a plain date (UTC midnight); timed ones as a real moment in the viewer's own timezone. */
const parts = (e: { startsAt: string; allDay: boolean }) => {
  const d = new Date(e.startsAt);
  return e.allDay ? { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate(), dow: d.getUTCDay() } : { y: d.getFullYear(), m: d.getMonth(), day: d.getDate(), dow: d.getDay() };
};
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function EventSheet({ circleId, visible, onClose, editing }: { circleId: string; visible: boolean; onClose: () => void; editing: FamilyEvent | null }) {
  const qc = useQueryClient();
  const today = new Date();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<FamilyEvent["kind"]>("event");
  const [y, setY] = useState(today.getFullYear());
  const [m, setM] = useState(today.getMonth());
  const [day, setDay] = useState(today.getDate());
  const [time, setTime] = useState("6:00 PM");
  const [notes, setNotes] = useState("");
  const [yearly, setYearly] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const t = new Date();
    if (editing) {
      const p = parts(editing);
      setTitle(editing.title); setKind(editing.kind); setY(p.y); setM(p.m); setDay(p.day); setNotes(editing.notes ?? ""); setYearly(editing.repeat === "yearly");
      setTime(editing.allDay ? "6:00 PM" : timeOf(editing.startsAt));
    } else { setTitle(""); setKind("event"); setY(t.getFullYear()); setM(t.getMonth()); setDay(t.getDate()); setTime("6:00 PM"); setNotes(""); setYearly(false); }
  }, [visible, editing]);

  const allDay = kind !== "event";
  const clock = parseClock(time);
  const dayOk = Math.min(day, daysIn(y, m));
  const startsAt = allDay ? new Date(Date.UTC(y, m, dayOk)) : clock ? new Date(y, m, dayOk, clock.hour, clock.minute) : null;
  const valid = !!title.trim() && !!startsAt && (allDay || !!clock);

  const save = useMutation({
    mutationFn: () => {
      const body = { title: title.trim(), kind, notes: notes.trim() || undefined, startsAt: startsAt!.toISOString(), allDay, repeat: allDay || yearly ? "yearly" : "none" };
      return editing ? patch(`/events/${editing.id}`, body) : post("/events", { circleId, ...body });
    },
    onSuccess: () => { haptic.success(); qc.invalidateQueries({ queryKey: ["events"] }); onClose(); },
    onError: e => showError("Couldn't save", e),
  });
  const years = [today.getFullYear() - (allDay ? 100 : 0), today.getFullYear() + 3];

  return (
    <Backdrop visible={visible} onClose={onClose}>
      <ScrollView style={{ maxHeight: 560 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: 12 }}>{editing ? "Edit" : "Add to calendar"}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {(Object.keys(KIND) as FamilyEvent["kind"][]).map(k => <Pill key={k} label={KIND[k].label} icon={KIND[k].icon} active={kind === k} onPress={() => setKind(k)} />)}
        </View>
        <Field label="Title" value={title} onChangeText={setTitle} autoCapitalize="sentences" maxLength={80}
          placeholder={kind === "birthday" ? "Nani's birthday" : kind === "anniversary" ? "Mom and Dad's anniversary" : "Sunday lunch"} />
        <Text style={{ fontWeight: "700", marginBottom: 8 }}>Date</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: 10 }}>
          {MONTHS.map((n, i) => <Pill key={n} label={n} active={m === i} onPress={() => setM(i)} />)}
        </ScrollView>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {Array.from({ length: daysIn(y, m) }, (_, i) => i + 1).map(n => (
            <Pressable key={n} onPress={() => { haptic.select(); setDay(n); }} accessibilityLabel={`Day ${n}`}
              style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: dayOk === n ? colors.primary : "#fff", borderWidth: 1, borderColor: dayOk === n ? colors.primary : colors.border }}>
              <Text style={{ fontWeight: "700", color: dayOk === n ? "#fff" : colors.text }}>{n}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
          <Text style={{ flex: 1, fontWeight: "700" }}>Year</Text>
          <Pressable onPress={() => setY(Math.max(years[0], y - 1))} accessibilityLabel="Earlier year" style={stepBtn}><Ionicons name="remove" size={20} color={colors.text} /></Pressable>
          <Text style={{ width: 64, textAlign: "center", fontWeight: "800", fontSize: 17 }}>{y}</Text>
          <Pressable onPress={() => setY(Math.min(years[1], y + 1))} accessibilityLabel="Later year" style={stepBtn}><Ionicons name="add" size={20} color={colors.text} /></Pressable>
        </View>
        {!allDay && (
          <>
            <Field label="Time" value={time} onChangeText={setTime} placeholder="6:00 PM" maxLength={8} autoCapitalize="none" hint={clock ? undefined : "Use a time like 6:30 PM or 18:30"} />
            <Pressable onPress={() => setYearly(!yearly)} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }} accessibilityRole="checkbox" accessibilityState={{ checked: yearly }}>
              <Ionicons name={yearly ? "checkbox" : "square-outline"} size={24} color={yearly ? colors.primary : colors.faint} />
              <Text style={{ fontWeight: "600" }}>Repeats every year</Text>
            </Pressable>
          </>
        )}
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} autoCapitalize="sentences" maxLength={500} multiline placeholder="Who is bringing what, where to meet…" />
        <Button title={editing ? "Save changes" : "Add and tell the family"} onPress={() => save.mutate()} loading={save.isPending} disabled={!valid} />
      </ScrollView>
    </Backdrop>
  );
}
const stepBtn = { width: 40, height: 40, borderRadius: 20, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border };

function DetailSheet({ ev, canEdit, onClose, onEdit }: { ev: FamilyEvent | null; canEdit: boolean; onClose: () => void; onEdit: () => void }) {
  const qc = useQueryClient();
  const rsvp = useMutation({
    mutationFn: (status: "yes" | "maybe" | "no") => put(`/events/${ev!.id}/rsvp`, { status }),
    onSuccess: () => { haptic.success(); qc.invalidateQueries({ queryKey: ["events"] }); onClose(); }, onError: e => showError("Couldn't save your answer", e),
  });
  const drop = useMutation({ mutationFn: () => del(`/events/${ev!.id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["events"] }); onClose(); }, onError: e => showError("Couldn't delete", e) });
  if (!ev) return <Backdrop visible={false} onClose={onClose}><View /></Backdrop>;
  const k = KIND[ev.kind], p = parts(ev);
  const confirmDelete = () => showAlert(`Delete "${ev.title}"?`, ev.repeat === "yearly" ? "It will stop repeating for everyone." : "It will be removed for everyone.", [
    { text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => drop.mutate() },
  ]);
  const People = ({ label, list }: { label: string; list: FamilyEvent["going"] }) => !list.length ? null : (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
      <Text style={{ width: 56, color: colors.muted, fontSize: 13 }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, flex: 1 }}>{list.map(u => <Avatar key={u.id} uri={u.avatarUrl} name={u.name} size={30} />)}</View>
    </View>
  );
  return (
    <Backdrop visible onClose={onClose}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <IconTile icon={k.icon} color={k.fg} bg={k.bg} size={46} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "800", fontSize: 20 }}>{ev.title}</Text>
          <Text style={{ color: colors.muted, marginTop: 2 }}>{DOW[p.dow]} {p.day} {MONTHS[p.m]} {p.y}{ev.allDay ? "" : ` · ${timeOf(ev.startsAt)}`}</Text>
        </View>
      </View>
      {!!ev.notes && <Text style={{ marginTop: 8, lineHeight: 21 }}>{ev.notes}</Text>}
      {ev.repeat === "none" ? (
        <>
          <Text style={{ fontWeight: "700", marginTop: 16, marginBottom: 8 }}>Are you coming?</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {([["yes", "Going"], ["maybe", "Maybe"], ["no", "Can't"]] as const).map(([s, label]) => (
              <Button key={s} title={label} variant={ev.myRsvp === s ? "primary" : "soft"} size="sm" onPress={() => rsvp.mutate(s)} style={{ flex: 1 }} />
            ))}
          </View>
          <People label="Going" list={ev.going} /><People label="Maybe" list={ev.maybe} /><People label="Can't" list={ev.no} />
        </>
      ) : <Chip label="Repeats every year" icon="repeat" tone="ghost" small />}
      {canEdit && (
        <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
          <Button title="Delete" variant="ghost" onPress={confirmDelete} style={{ flex: 1 }} />
          <Button title="Edit" variant="soft" onPress={onEdit} style={{ flex: 1 }} />
        </View>
      )}
    </Backdrop>
  );
}

export default function Calendar() {
  const { user } = useAuth();
  const { circles, circleId, setCircleId, circle, isOwner } = useCircle();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<FamilyEvent | null>(null);
  const [open, setOpen] = useState<FamilyEvent | null>(null);
  const range = useMemo(() => { const f = new Date(); f.setHours(0, 0, 0, 0); return { from: f.toISOString(), to: new Date(f.getTime() + 120 * 86400e3).toISOString() }; }, []);
  const events = useQuery({
    queryKey: ["events", circleId], enabled: !!circleId,
    queryFn: () => get<FamilyEvent[]>(`/events?circleId=${circleId}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`),
  });

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: FamilyEvent[] }[] = [];
    const t = new Date(); const todayKey = `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;
    const tm = new Date(t.getTime() + 86400e3); const tomorrowKey = `${tm.getFullYear()}-${tm.getMonth()}-${tm.getDate()}`;
    for (const e of events.data ?? []) {
      const p = parts(e), key = `${p.y}-${p.m}-${p.day}`;
      let g = out.find(x => x.key === key);
      if (!g) { g = { key, label: key === todayKey ? "Today" : key === tomorrowKey ? "Tomorrow" : `${DOW[p.dow]} ${p.day} ${MONTHS[p.m]}`, items: [] }; out.push(g); }
      g.items.push(e);
    }
    return out;
  }, [events.data]);

  return (
    <Screen>
      <Header title="Family calendar" subtitle={circle ? circle.name : undefined} back
        right={circleId ? <IconButton icon="add" label="Add event" tint={colors.primary} onPress={() => { setEditing(null); setAdding(true); }} /> : undefined} />
      {circles.isLoading ? <Loading /> : circles.error ? <ErrorView error={circles.error} onRetry={() => circles.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
          <CirclePills circles={circles.data} circleId={circleId} onChange={setCircleId} />
          {events.isLoading ? <Loading rows={2} /> : events.error ? <ErrorView error={events.error} onRetry={() => events.refetch()} /> : groups.length === 0 ? (
            <Card><Empty icon="calendar-outline" title="Nothing coming up" text="Add birthdays, anniversaries and family plans. Everyone is reminded the day before, and can say if they are coming."
              actionLabel="Add something" onAction={() => { setEditing(null); setAdding(true); }} /></Card>
          ) : groups.map(g => (
            <View key={g.key} style={{ marginBottom: 6 }}>
              <Text style={{ fontWeight: "800", fontSize: 15, marginVertical: 8, color: g.label === "Today" ? colors.primary : colors.text }}>{g.label}</Text>
              {g.items.map(e => {
                const k = KIND[e.kind];
                return (
                  <Card key={e.id + e.startsAt} onPress={() => setOpen(e)} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8, padding: 12 }}>
                    <IconTile icon={k.icon} color={k.fg} bg={k.bg} size={42} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "700", fontSize: 16 }} numberOfLines={1}>{e.title}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                        {e.allDay ? k.label : timeOf(e.startsAt)}{e.repeat === "none" && e.going.length ? ` · ${e.going.length} going` : ""}
                      </Text>
                    </View>
                    {e.repeat === "none" && e.myRsvp === "yes" && <Chip label="Going" tone="success" small />}
                    <Ionicons name="chevron-forward" size={18} color={colors.faint} />
                  </Card>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}
      {circleId && <EventSheet circleId={circleId} visible={adding} editing={editing} onClose={() => setAdding(false)} />}
      <DetailSheet ev={open} canEdit={!!open && (open.createdById === user?.id || isOwner)} onClose={() => setOpen(null)}
        onEdit={() => { setEditing(open); setOpen(null); setTimeout(() => setAdding(true), 250); }} />
    </Screen>
  );
}
