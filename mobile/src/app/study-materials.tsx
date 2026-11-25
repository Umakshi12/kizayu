import { useEffect, useState } from "react";
import { Image, Linking, Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, mediaUrl, patch, post } from "../api";
import { showAlert, showError } from "../alert";
import { haptic } from "../haptics";
import { pickAndUpload } from "../media";
import { Backdrop } from "../components/Sheets";
import { Text } from "../components/Text";
import { Button, Card, Empty, ErrorView, Field, Header, IconButton, IconName, IconTile, Loading, Pill, Screen } from "../components/ui";
import { colors, radius } from "../theme";
import type { StudyNote, Subject } from "../types";

type Kind = StudyNote["kind"];
const KINDS: { id: Kind; label: string; icon: IconName; color: string; bg: string }[] = [
  { id: "note", label: "Note", icon: "document-text", color: colors.primary, bg: colors.primarySoft },
  { id: "formula", label: "Formula", icon: "calculator", color: "#6C63FF", bg: "#ECEBFF" },
  { id: "link", label: "Link", icon: "link", color: "#3B82F6", bg: "#E5EFFD" },
  { id: "file", label: "Photo", icon: "image", color: "#E0559A", bg: "#FDE7F1" },
];
const kindOf = (k: Kind) => KINDS.find(x => x.id === k) ?? KINDS[0]!;
const hostOf = (u: string) => u.replace(/^https?:\/\//i, "").split("/")[0] ?? u;
type SheetState = { visible: boolean; note: StudyNote | null; view: boolean };

function SubjectTag({ name, color }: { name: string; color: string | null }) {
  const c = color ?? colors.primary;
  return (
    <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: `${c}22` }}>
      <Text style={{ color: c, fontWeight: "700", fontSize: 11 }}>{name}</Text>
    </View>
  );
}

function NoteCard({ note: n, onOpen, onDelete }: { note: StudyNote; onOpen: () => void; onDelete: () => void }) {
  const k = kindOf(n.kind);
  const textKind = n.kind === "note" || n.kind === "formula";
  const photo = n.kind === "file" ? mediaUrl(n.url) : undefined;
  const target = n.kind === "link" ? n.url : photo;
  const onPress = textKind ? onOpen : target ? () => { Linking.openURL(target).catch(e => showError("Couldn't open it", e)); } : undefined;
  return (
    <Card onPress={onPress} style={{ marginBottom: 10, padding: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <IconTile icon={k.icon} size={42} color={k.color} bg={k.bg} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "700", fontSize: 16 }} numberOfLines={1}>{n.title}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600" }}>{k.label}</Text>
            {n.subject && <SubjectTag name={n.subject} color={n.color} />}
          </View>
        </View>
        <Pressable onPress={onDelete} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Delete ${n.title}`}>
          <Ionicons name="trash-outline" size={19} color={colors.faint} />
        </Pressable>
      </View>
      {n.kind === "link" && !!n.url && (
        <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600", marginTop: 10 }} numberOfLines={1}>{hostOf(n.url)}</Text>
      )}
      {textKind && !!n.body && <Text style={{ color: colors.muted, marginTop: 10, lineHeight: 20 }} numberOfLines={2}>{n.body}</Text>}
      {!!photo && <Image source={{ uri: photo }} resizeMode="cover" style={{ width: "100%", height: 170, borderRadius: radius.sm, marginTop: 12, backgroundColor: colors.border }} />}
    </Card>
  );
}

function NoteSheet({ visible, view, note, subjects, onClose, onEdit, onDelete }: {
  visible: boolean; view: boolean; note: StudyNote | null; subjects: Subject[];
  onClose: () => void; onEdit: () => void; onDelete: (n: StudyNote) => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>("note");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setKind(note?.kind ?? "note"); setTitle(note?.title ?? ""); setBody(note?.body ?? ""); setUrl(note?.url ?? "");
    setPhoto(note?.kind === "file" ? note.url : null); setSubjectId(note?.subjectId ?? null);
  }, [visible, note, view]);

  const textKind = kind === "note" || kind === "formula";
  const badUrl = kind === "link" && !!url.trim() && !/^https?:\/\//i.test(url.trim());
  const ready = !!title.trim() && (textKind ? !!body.trim() : kind === "link" ? !!url.trim() && !badUrl : !!photo);

  const save = useMutation({
    mutationFn: () => note
      ? patch(`/study/notes/${note.id}`, { title: title.trim(), body: body.trim(), subjectId })
      : post("/study/notes", {
        title: title.trim(), kind, body: textKind ? body.trim() : "",
        url: kind === "link" ? url.trim() : kind === "file" ? photo : null, subjectId,
      }),
    onSuccess: () => { haptic.success(); qc.invalidateQueries({ queryKey: ["notes"] }); onClose(); },
    onError: e => showError("Couldn't save", e),
  });

  const pick = async () => {
    setBusy(true);
    try { const u = await pickAndUpload("library"); if (u) setPhoto(u); }
    catch (e) { showError("Couldn't add the photo", e); }
    finally { setBusy(false); }
  };

  if (note && view) {
    return (
      <Backdrop visible={visible} onClose={onClose}>
        <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 22, fontWeight: "800" }}>{note.title}</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4, marginBottom: 14 }}>
            {kindOf(note.kind).label}{note.subject ? ` · ${note.subject}` : ""}
          </Text>
          <View style={{ backgroundColor: "#fff", borderRadius: radius.md, padding: 16, borderWidth: 1, borderColor: colors.border }}>
            <Text selectable style={{ lineHeight: 22 }}>{note.body}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
            <Button title="Delete" variant="ghost" onPress={() => onDelete(note)} style={{ flex: 1 }} />
            <Button title="Edit" icon="pencil" onPress={onEdit} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </Backdrop>
    );
  }

  return (
    <Backdrop visible={visible} onClose={onClose}>
      <ScrollView style={{ maxHeight: 620 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: 12 }}>{note ? "Edit note" : "Save for study"}</Text>
        {!note && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            {KINDS.map(k => <Pill key={k.id} label={k.label} icon={k.icon} active={kind === k.id} onPress={() => setKind(k.id)} />)}
          </View>
        )}
        <Field label="Title" value={title} onChangeText={setTitle} placeholder={kind === "formula" ? "Kinematics" : "Chapter 3 summary"} maxLength={80} autoCapitalize="sentences" />

        {textKind && (
          <Field label={kind === "formula" ? "Formulas" : "Notes"} value={body} onChangeText={setBody} multiline maxLength={5000}
            autoCapitalize={kind === "formula" ? "none" : "sentences"} placeholder={kind === "formula" ? "v = u + at" : "Write it down"}
            hint={kind === "formula" ? "Write one formula per line" : undefined} style={{ minHeight: 140, textAlignVertical: "top" }} />
        )}

        {kind === "link" && (
          <Field label="Link" value={url} onChangeText={setUrl} placeholder="https://" keyboardType="url"
            hint={badUrl ? "Start with http:// or https://" : "Paste the link to the page or video"} />
        )}

        {kind === "file" && (
          <View style={{ marginBottom: 16 }}>
            {!!photo && <Image source={{ uri: mediaUrl(photo) }} resizeMode="cover" style={{ width: "100%", height: 180, borderRadius: radius.md, marginBottom: 12, backgroundColor: colors.border }} />}
            <Button title={photo ? "Choose another photo" : "Choose a photo"} icon="image-outline" variant="soft" onPress={pick} loading={busy} />
          </View>
        )}

        <Text style={{ fontWeight: "700", marginBottom: 8 }}>Subject</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: subjects.length ? 16 : 8 }}>
          <Pill label="None" active={!subjectId} onPress={() => setSubjectId(null)} />
          {subjects.map(s => <Pill key={s.id} label={s.name} active={subjectId === s.id} onPress={() => setSubjectId(s.id)} />)}
        </ScrollView>
        {subjects.length === 0 && <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 16 }}>Add subjects on the Syllabus screen to group your notes.</Text>}

        <Button title={note ? "Save changes" : "Save"} onPress={() => save.mutate()} loading={save.isPending} disabled={!ready} />
      </ScrollView>
    </Backdrop>
  );
}

export default function StudyMaterials() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>({ visible: false, note: null, view: false });

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const subjects = useQuery({ queryKey: ["subjects"], queryFn: () => get<Subject[]>("/study/subjects") });
  const notes = useQuery({
    queryKey: ["notes", subjectId, q],
    queryFn: () => {
      const qs = [subjectId && `subjectId=${encodeURIComponent(subjectId)}`, q && `q=${encodeURIComponent(q)}`].filter(Boolean).join("&");
      return get<StudyNote[]>(`/study/notes${qs ? `?${qs}` : ""}`);
    },
  });
  const drop = useMutation({
    mutationFn: (id: string) => del(`/study/notes/${id}`),
    onSuccess: () => { haptic.success(); qc.invalidateQueries({ queryKey: ["notes"] }); setSheet(s => ({ ...s, visible: false })); },
    onError: e => showError("Couldn't delete", e),
  });
  const askDelete = (n: StudyNote) => showAlert(`Delete "${n.title}"?`, "This can't be undone.", [
    { text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => drop.mutate(n.id) },
  ]);

  const openNew = () => setSheet({ visible: true, note: null, view: false });
  const openNote = (n: StudyNote) => setSheet({ visible: true, note: n, view: true });
  const list = notes.data ?? [];
  const filtering = !!q || !!subjectId;

  return (
    <Screen>
      <Header title="Study materials" subtitle={list.length ? `${list.length} saved` : undefined} back
        right={<IconButton icon="add" label="Add material" tint={colors.primary} onPress={openNew} />} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
        <Field label="Search" value={search} onChangeText={setSearch} placeholder="Formulas, notes, links" returnKeyType="search" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 14 }}>
          <Pill label="All" active={!subjectId} onPress={() => setSubjectId(null)} />
          {(subjects.data ?? []).map(s => <Pill key={s.id} label={s.name} active={subjectId === s.id} onPress={() => setSubjectId(s.id)} />)}
        </ScrollView>

        {notes.isLoading ? <Loading rows={3} /> : notes.error ? <ErrorView error={notes.error} onRetry={() => notes.refetch()} /> : list.length === 0 ? (
          <Card>
            {filtering
              ? <Empty compact icon="search-outline" title="Nothing found" text="Try another word, or pick a different subject." />
              : <Empty icon="library-outline" title="Your study vault is empty" text="Save formulas, short notes, useful links and photos of the board, so they are one tap away before an exam."
                actionLabel="Save something" onAction={openNew} />}
          </Card>
        ) : list.map(n => <NoteCard key={n.id} note={n} onOpen={() => openNote(n)} onDelete={() => askDelete(n)} />)}
      </ScrollView>

      <NoteSheet visible={sheet.visible} view={sheet.view} note={sheet.note} subjects={subjects.data ?? []}
        onClose={() => setSheet(s => ({ ...s, visible: false }))}
        onEdit={() => setSheet(s => ({ ...s, view: false }))}
        onDelete={askDelete} />
    </Screen>
  );
}
