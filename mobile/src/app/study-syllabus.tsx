import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, del, get, patch, post } from "../api";
import { showAlert, showError } from "../alert";
import { haptic } from "../haptics";
import { Backdrop } from "../components/Sheets";
import { Text } from "../components/Text";
import { Button, Card, Chip, Empty, ErrorView, Field, GradientCard, Header, IconButton, Loading, Pill, Screen, SectionHeader } from "../components/ui";
import { colors, gradients } from "../theme";
import type { Chapter, Subject, TimetableSlot } from "../types";

const COLORS = ["#18B8D9", "#6C63FF", "#E0559A", "#F2A100", "#18B26B", "#EF4565", "#FF7A45", "#3B82F6"];
const EXAM_PRESETS: { label: string; days: number | null }[] = [{ label: "None", days: null }, { label: "In 2 weeks", days: 14 }, { label: "In 1 month", days: 30 }, { label: "In 2 months", days: 60 }];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysFromNow = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };
const validDate = (s: string) => DATE_RE.test(s) && !Number.isNaN(Date.parse(s));
const splitLines = (t: string) => t.split("\n").map(x => x.trim()).filter(Boolean);
const slotLabel = (date: string, startMin: number) => {
  const [y, m, d] = date.split("-").map(Number);
  const h = Math.floor(startMin / 60);
  return `${DAY_NAMES[new Date(y!, m! - 1, d).getDay()]} ${d} ${MONTHS[m! - 1]}, ${h % 12 || 12}:${pad(startMin % 60)} ${h < 12 ? "AM" : "PM"}`;
};

function invalidateStudy(qc: QueryClient) {
  for (const queryKey of [["subjects"], ["study-today"], ["timetable"]]) qc.invalidateQueries({ queryKey });
}
const putSubject = (qc: QueryClient, fresh: Subject) => qc.setQueryData<Subject[]>(["subjects"], old => old?.map(x => x.id === fresh.id ? fresh : x));

function SubjectSheet({ subject, visible, onClose }: { subject: Subject | null; visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]!);
  const [exam, setExam] = useState("");
  const [chapters, setChapters] = useState("");
  useEffect(() => {
    if (!visible) return;
    setName(subject?.name ?? ""); setColor(subject?.color ?? COLORS[0]!); setExam(subject?.examDate ?? ""); setChapters("");
  }, [visible, subject]);

  const titles = splitLines(chapters);
  const badDate = !!exam && !validDate(exam);
  const tooMany = titles.length > 60;
  const save = useMutation({
    mutationFn: () => subject
      ? patch(`/study/subjects/${subject.id}`, { name: name.trim(), color, examDate: exam || null })
      : post("/study/subjects", { name: name.trim(), color, examDate: exam || undefined, chapters: titles.length ? titles : undefined }),
    onSuccess: () => { haptic.success(); invalidateStudy(qc); onClose(); },
    onError: e => showError("Couldn't save subject", e),
  });
  const drop = useMutation({
    mutationFn: () => del(`/study/subjects/${subject!.id}`),
    onSuccess: () => { haptic.warning(); invalidateStudy(qc); onClose(); },
    onError: e => showError("Couldn't delete subject", e),
  });
  const confirmDrop = () => showAlert(`Delete "${subject!.name}"?`, `Its ${subject!.total} chapter${subject!.total === 1 ? "" : "s"} will be removed too.`, [
    { text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => drop.mutate() },
  ]);

  return (
    <Backdrop visible={visible} onClose={onClose}>
      <ScrollView style={{ maxHeight: 620 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: 12 }}>{subject ? "Edit subject" : "New subject"}</Text>
        <Field label="Subject name" value={name} onChangeText={setName} placeholder="Chemistry" maxLength={40} autoCapitalize="sentences" />

        <Text style={{ fontWeight: "700", marginBottom: 8 }}>Colour</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          {COLORS.map(c => (
            <Pressable key={c} onPress={() => { haptic.select(); setColor(c); }} accessibilityRole="button" accessibilityLabel={`Colour ${c}`} accessibilityState={{ selected: color === c }}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: color === c ? colors.text : "#fff" }}>
              {color === c && <Ionicons name="checkmark" size={18} color="#fff" />}
            </Pressable>
          ))}
        </View>

        <Text style={{ fontWeight: "700", marginBottom: 8 }}>Exam date (optional)</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {EXAM_PRESETS.map(p => (
            <Pill key={p.label} label={p.label} active={p.days === null ? !exam : exam === daysFromNow(p.days)} onPress={() => setExam(p.days === null ? "" : daysFromNow(p.days))} />
          ))}
        </View>
        <Field label="Or type a date" value={exam} onChangeText={setExam} placeholder="2026-12-20" maxLength={10} keyboardType="numbers-and-punctuation"
          hint={badDate ? "Use a date like 2026-12-20" : undefined} />

        {!subject && (
          <Field label="Chapters to start with (optional)" value={chapters} onChangeText={setChapters} multiline autoCapitalize="sentences"
            placeholder={"Atoms and molecules\nChemical bonding"} style={{ minHeight: 110, textAlignVertical: "top" }}
            hint={tooMany ? "Add up to 60 chapters at a time" : "One chapter per line"} />
        )}

        <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
          {subject && <Button title="Delete" variant="ghost" onPress={confirmDrop} loading={drop.isPending} style={{ flex: 1 }} />}
          <Button title="Save" onPress={() => save.mutate()} loading={save.isPending} disabled={!name.trim() || badDate || tooMany} style={{ flex: 1 }} />
        </View>
      </ScrollView>
    </Backdrop>
  );
}

function SubjectCard({ subject: s, onEdit }: { subject: Subject; onEdit: () => void }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [newChapters, setNewChapters] = useState("");
  const titles = splitLines(newChapters);
  const tooMany = titles.length > 60;

  const toggle = useMutation({
    mutationFn: (c: Chapter) => patch<Subject>(`/study/chapters/${c.id}`, { done: !c.done }),
    onSuccess: (fresh, c) => {
      if (!c.done) haptic.success(); else haptic.tap();
      putSubject(qc, fresh);
      qc.invalidateQueries({ queryKey: ["study-today"] });
    },
    onError: e => showError("Couldn't update chapter", e),
  });
  const addChapters = useMutation({
    mutationFn: (list: string[]) => post<Subject>(`/study/subjects/${s.id}/chapters`, { titles: list }),
    onSuccess: fresh => { haptic.success(); putSubject(qc, fresh); setNewChapters(""); invalidateStudy(qc); },
    onError: e => showError("Couldn't add chapters", e),
  });
  const removeChapter = useMutation({
    mutationFn: (id: string) => api<Subject>("DELETE", `/study/chapters/${id}`),
    onSuccess: fresh => { putSubject(qc, fresh); invalidateStudy(qc); },
    onError: e => showError("Couldn't remove chapter", e),
  });
  const schedule = useMutation({
    mutationFn: (chapterId: string) => post<TimetableSlot>("/study/schedule", { chapterId }),
    onSuccess: slot => {
      haptic.success();
      invalidateStudy(qc);
      showAlert("Scheduled", `${slot.title}, ${slotLabel(slot.date ?? "", slot.startMin)}`);
    },
    onError: e => showError("Couldn't schedule", e),
  });
  const askRemove = (c: Chapter) => showAlert(`Remove "${c.title}"?`, undefined, [
    { text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => removeChapter.mutate(c.id) },
  ]);

  return (
    <Card style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
      <Pressable onPress={() => { haptic.tap(); setExpanded(!expanded); }} accessibilityRole="button" accessibilityState={{ expanded }} style={{ padding: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: s.color }} />
          <Text style={{ flex: 1, fontWeight: "800", fontSize: 17 }} numberOfLines={1}>{s.name}</Text>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>
          {s.total ? `${s.done} of ${s.total} chapter${s.total === 1 ? "" : "s"} done` : "No chapters yet"}
        </Text>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, marginTop: 10, overflow: "hidden" }}>
          <View style={{ width: `${s.percent}%`, height: 8, borderRadius: 4, backgroundColor: s.color }} />
        </View>
        {(s.daysLeft !== null || !!s.perWeek) && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 10 }}>
            {s.daysLeft !== null && (
              <Chip small icon="flag" tone={s.daysLeft <= 14 ? "amber" : "primary"} label={s.daysLeft === 0 ? "Exam today" : `Exam in ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"}`} />
            )}
            {!!s.perWeek && (
              <Text style={{ color: colors.muted, fontSize: 12, flexShrink: 1 }}>About {s.perWeek} chapter{s.perWeek === 1 ? "" : "s"} a week to finish on time</Text>
            )}
          </View>
        )}
      </Pressable>

      {expanded && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          {s.chapters.length === 0 && <Text style={{ color: colors.muted, fontSize: 13, paddingVertical: 8 }}>No chapters yet. Add the first one below.</Text>}
          {s.chapters.map(c => (
            <View key={c.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Pressable onPress={() => toggle.mutate(c)} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: c.done }} accessibilityLabel={c.title}>
                <Ionicons name={c.done ? "checkmark-circle" : "ellipse-outline"} size={24} color={c.done ? colors.success : s.color} />
              </Pressable>
              <Pressable style={{ flex: 1 }} onLongPress={() => askRemove(c)} delayLongPress={400}>
                <Text numberOfLines={2} style={{ color: c.done ? colors.muted : colors.text, textDecorationLine: c.done ? "line-through" : "none" }}>{c.title}</Text>
              </Pressable>
              <Pressable onPress={() => schedule.mutate(c.id)} disabled={schedule.isPending} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Schedule ${c.title}`}
                style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft }}>
                <Ionicons name="calendar-outline" size={17} color={colors.primary} />
              </Pressable>
              <Pressable onPress={() => askRemove(c)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${c.title}`}>
                <Ionicons name="trash-outline" size={18} color={colors.faint} />
              </Pressable>
            </View>
          ))}

          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14, marginTop: 4 }}>
            <Field label="Add chapters" value={newChapters} onChangeText={setNewChapters} multiline autoCapitalize="sentences"
              placeholder="One chapter, or paste a list with one per line" style={{ minHeight: 84, textAlignVertical: "top" }}
              hint={tooMany ? "Add up to 60 at a time" : undefined} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button title="Add" icon="add" size="sm" onPress={() => addChapters.mutate(titles)} disabled={!titles.length || tooMany} loading={addChapters.isPending} style={{ flex: 1 }} />
              <Button title="Edit subject" icon="pencil" size="sm" variant="soft" onPress={onEdit} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      )}
    </Card>
  );
}

export default function StudySyllabus() {
  const subjects = useQuery({ queryKey: ["subjects"], queryFn: () => get<Subject[]>("/study/subjects") });
  const [sheet, setSheet] = useState<{ open: boolean; subject: Subject | null }>({ open: false, subject: null });
  const open = (subject: Subject | null) => setSheet({ open: true, subject });
  const list = subjects.data ?? [];
  const total = list.reduce((n, s) => n + s.total, 0);
  const done = list.reduce((n, s) => n + s.done, 0);
  const overall = total ? Math.round((done / total) * 100) : 0;

  return (
    <Screen>
      <Header title="Syllabus" subtitle={subjects.data ? `${list.length} subject${list.length === 1 ? "" : "s"}` : undefined} back
        right={<IconButton icon="add" label="Add subject" tint={colors.primary} onPress={() => open(null)} />} />
      {subjects.isLoading ? <Loading rows={2} /> : subjects.error ? <ErrorView error={subjects.error} onRetry={() => subjects.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
          {list.length === 0 ? (
            <Card><Empty icon="library-outline" title="Add your subjects" text="Add a subject, paste in its chapters and set an exam date. We'll show how far along you are and how to finish in time."
              actionLabel="Add a subject" onAction={() => open(null)} /></Card>
          ) : (
            <>
              <GradientCard colors={gradients.hero}>
                <Text style={{ color: "rgba(255,255,255,0.8)", fontWeight: "700" }}>Overall progress</Text>
                <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 4 }}>
                  <Text style={{ color: "#fff", fontSize: 40, fontWeight: "800" }}>{overall}%</Text>
                  <Text style={{ color: "rgba(255,255,255,0.85)", fontWeight: "600", marginBottom: 6 }}>{done} of {total} chapters</Text>
                </View>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.2)", marginTop: 12, overflow: "hidden" }}>
                  <View style={{ width: `${overall}%`, height: 8, borderRadius: 4, backgroundColor: colors.accent }} />
                </View>
              </GradientCard>

              <SectionHeader title="Your subjects" />
              {list.map(s => <SubjectCard key={s.id} subject={s} onEdit={() => open(s)} />)}
            </>
          )}
        </ScrollView>
      )}
      <SubjectSheet subject={sheet.subject} visible={sheet.open} onClose={() => setSheet(x => ({ ...x, open: false }))} />
    </Screen>
  );
}
