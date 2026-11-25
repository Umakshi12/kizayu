import { useState } from "react";
import { Image, Modal, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, mediaUrl, post } from "../api";
import { showAlert, showError } from "../alert";
import { haptic } from "../haptics";
import { useAuth } from "../auth";
import { pickAndUpload } from "../media";
import { CirclePills, useCircle } from "../components/CirclePicker";
import { MemoriesStrip } from "../components/Memories";
import { Backdrop } from "../components/Sheets";
import { Text } from "../components/Text";
import { Avatar, Button, Card, Empty, ErrorView, Field, Header, IconButton, Loading, Screen } from "../components/ui";
import { colors, radius } from "../theme";
import type { AlbumDetail, AlbumSummary, Memory } from "../types";

function NewAlbumSheet({ circleId, visible, onClose }: { circleId: string; visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const create = useMutation({
    mutationFn: () => post("/albums", { circleId, title: title.trim() }),
    onSuccess: () => { haptic.success(); setTitle(""); qc.invalidateQueries({ queryKey: ["albums", circleId] }); onClose(); }, onError: e => showError("Couldn't create album", e),
  });
  return (
    <Backdrop visible={visible} onClose={onClose}>
      <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: 12 }}>New album</Text>
      <Field label="Album name" value={title} onChangeText={setTitle} placeholder="Goa trip 2026" maxLength={60} autoCapitalize="sentences" />
      <Button title="Create album" onPress={() => create.mutate()} loading={create.isPending} disabled={!title.trim()} />
    </Backdrop>
  );
}

function AlbumView({ id, circleId, isOwner, onBack }: { id: string; circleId: string; isOwner: boolean; onBack: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const cell = (Math.min(width, 560) - 32 - 8) / 3;
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<AlbumDetail["photos"][number] | null>(null);
  const album = useQuery({ queryKey: ["album", id], queryFn: () => get<AlbumDetail>(`/albums/${id}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["album", id] }); qc.invalidateQueries({ queryKey: ["albums", circleId] }); };

  const add = async () => {
    setBusy(true);
    try {
      const url = await pickAndUpload("library");
      if (url) { await post(`/albums/${id}/photos`, { url }); haptic.success(); refresh(); }
    } catch (e) { showError("Couldn't add the photo", e); } finally { setBusy(false); }
  };
  const removePhoto = useMutation({ mutationFn: (pid: string) => del(`/albums/photos/${pid}`), onSuccess: () => { setViewing(null); refresh(); }, onError: e => showError("Couldn't remove", e) });
  const removeAlbum = useMutation({ mutationFn: () => del(`/albums/${id}`), onSuccess: () => { refresh(); onBack(); }, onError: e => showError("Couldn't delete album", e) });
  const a = album.data;
  const canDeleteAlbum = !!a && (a.createdById === user?.id || isOwner);

  return (
    <>
      <Header title={a?.title ?? "Album"} subtitle={a ? `${a.photos.length} photo${a.photos.length === 1 ? "" : "s"}` : undefined}
        right={canDeleteAlbum ? <IconButton icon="trash-outline" label="Delete album" onPress={() => showAlert(`Delete "${a!.title}"?`, "All its photos are removed for everyone.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => removeAlbum.mutate() }])} /> : undefined} />
      {album.isLoading ? <Loading /> : album.error ? <ErrorView error={album.error} onRetry={() => album.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
            <Button title="All albums" variant="soft" size="sm" icon="chevron-back" onPress={onBack} />
            <Button title="Add photo" size="sm" icon="add" onPress={add} loading={busy} />
          </View>
          {a!.photos.length === 0 ? (
            <Card><Empty compact icon="images-outline" title="No photos yet" text="Add the first one. Everyone in the circle can add more." actionLabel="Add a photo" onAction={add} /></Card>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
              {a!.photos.map(p => (
                <Pressable key={p.id} onPress={() => setViewing(p)} accessibilityLabel={p.caption ?? "Photo"}>
                  <Image source={{ uri: mediaUrl(p.url) }} style={{ width: cell, height: cell, borderRadius: radius.xs, backgroundColor: colors.border }} />
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}
      <Modal visible={!!viewing} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center" }}>
          {viewing && <Image source={{ uri: mediaUrl(viewing.url) }} resizeMode="contain" style={{ width: "100%", height: "70%" }} />}
          <View style={{ padding: 20, gap: 10 }}>
            {viewing?.by && <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><Avatar uri={viewing.by.avatarUrl} name={viewing.by.name} size={30} /><Text style={{ color: "#fff", fontWeight: "700" }}>{viewing.by.name}</Text></View>}
            {!!viewing?.caption && <Text style={{ color: "#fff" }}>{viewing.caption}</Text>}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button title="Close" variant="light" onPress={() => setViewing(null)} style={{ flex: 1 }} />
              {viewing && (viewing.by?.id === user?.id || isOwner) && <Button title="Remove" variant="danger" onPress={() => removePhoto.mutate(viewing.id)} style={{ flex: 1 }} />}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

export default function Albums() {
  const { circles, circle, circleId, setCircleId, isOwner } = useCircle();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const cell = (Math.min(width, 560) - 32 - 12) / 2;
  const albums = useQuery({ queryKey: ["albums", circleId], enabled: !!circleId, queryFn: () => get<AlbumSummary[]>(`/albums?circleId=${circleId}`) });
  const memories = useQuery({ queryKey: ["memories"], queryFn: () => get<Memory[]>("/memories/today") });

  return (
    <Screen>
      {openId && circleId ? <AlbumView id={openId} circleId={circleId} isOwner={isOwner} onBack={() => setOpenId(null)} /> : (
        <>
          <Header title="Photo albums" subtitle={circle?.name} back right={circleId ? <IconButton icon="add" label="New album" tint={colors.primary} onPress={() => setCreating(true)} /> : undefined} />
          {circles.isLoading ? <Loading /> : circles.error ? <ErrorView error={circles.error} onRetry={() => circles.refetch()} /> : (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
              <CirclePills circles={circles.data} circleId={circleId} onChange={setCircleId} />
              {(memories.data?.length ?? 0) > 0 && <MemoriesStrip items={memories.data!} />}
              {albums.isLoading ? <Loading rows={2} /> : albums.error ? <ErrorView error={albums.error} onRetry={() => albums.refetch()} /> : (albums.data?.length ?? 0) === 0 ? (
                <Card><Empty icon="images-outline" title="No albums yet" text="Make an album for a trip, a festival or a family get-together. Everyone can add photos."
                  actionLabel="Create an album" onAction={() => setCreating(true)} /></Card>
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                  {albums.data!.map(a => (
                    <Pressable key={a.id} onPress={() => { haptic.tap(); setOpenId(a.id); }} accessibilityLabel={`${a.title}, ${a.count} photos`} style={{ width: cell }}>
                      <View style={{ width: cell, height: cell, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
                        {a.cover ? <Image source={{ uri: mediaUrl(a.cover) }} style={{ width: cell, height: cell }} /> : <Ionicons name="images" size={36} color={colors.primary} />}
                      </View>
                      <Text style={{ fontWeight: "700", marginTop: 6 }} numberOfLines={1}>{a.title}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{a.count} photo{a.count === 1 ? "" : "s"}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </ScrollView>
          )}
          {circleId && <NewAlbumSheet circleId={circleId} visible={creating} onClose={() => setCreating(false)} />}
        </>
      )}
    </Screen>
  );
}
