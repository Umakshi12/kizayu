import { useState } from "react";
import { FlatList, Image, Modal, Pressable, ScrollView, Share, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, mediaUrl, post } from "../../api";
import { showAlert, showError } from "../../alert";
import { ActionSheet, ReportSheet, ReportTarget, SheetAction, confirmBlock } from "../../components/Sheets";
import { useAuth } from "../../auth";
import { APP_NAME } from "../../config";
import { useNotifications } from "../../hooks";
import { SosBanner } from "../../components/SosBanner";
import { haptic } from "../../haptics";
import { pickAndUpload } from "../../media";
import { Text } from "../../components/Text";
import { Avatar, Button, ErrorView, GradientCard, IconButton, IconTile, Loading, Screen, timeAgo } from "../../components/ui";
import { colors, gradients, radius, shadow } from "../../theme";
import type { Circle, Post, StoryGroup } from "../../types";

type Feed = { items: Post[]; nextCursor: string | null };

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

function Stories() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const stories = useQuery({ queryKey: ["stories"], queryFn: () => get<StoryGroup[]>("/stories") });
  const [viewing, setViewing] = useState<StoryGroup | null>(null);
  const [idx, setIdx] = useState(0);

  const add = useMutation({
    mutationFn: async () => { const url = await pickAndUpload("library"); if (url) await post("/stories", { imageUrl: url }); },
    onSuccess: () => { haptic.success(); qc.invalidateQueries({ queryKey: ["stories"] }); },
    onError: e => showError("Couldn't add story", e),
  });
  const next = () => { if (!viewing) return; if (idx + 1 < viewing.stories.length) setIdx(idx + 1); else setViewing(null); };

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, gap: 16, paddingVertical: 6 }}>
        <Pressable onPress={() => add.mutate()} style={{ alignItems: "center", width: 66 }} accessibilityLabel="Add story">
          <View style={{ width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderStyle: "dashed", borderColor: "#7FD9F0", alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }}>
            <LinearGradient colors={gradients.primary} style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={add.isPending ? "hourglass-outline" : "add"} size={20} color="#fff" />
            </LinearGradient>
          </View>
          <Text style={{ fontSize: 12, marginTop: 6, fontWeight: "600" }}>Your story</Text>
        </Pressable>
        {(stories.data ?? []).map(g => (
          <Pressable key={g.author.id} onPress={() => { haptic.tap(); setIdx(0); setViewing(g); }} style={{ alignItems: "center", width: 66 }}>
            <Avatar uri={g.author.avatarUrl} name={g.author.name} size={64} ring />
            <Text style={{ fontSize: 12, marginTop: 6, fontWeight: "600" }} numberOfLines={1}>{g.author.id === user?.id ? "You" : g.author.name.split(" ")[0]}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Modal visible={!!viewing} animationType="fade" onRequestClose={() => setViewing(null)}>
        <Pressable onPress={next} style={{ flex: 1, backgroundColor: "#0B0718", justifyContent: "center" }}>
          {viewing && <Image source={{ uri: mediaUrl(viewing.stories[idx].imageUrl) }} style={{ width: "100%", height: "78%" }} resizeMode="contain" />}
          {viewing && (
            <View style={{ position: "absolute", top: 52, left: 16, right: 16 }}>
              <View style={{ flexDirection: "row", gap: 4, marginBottom: 12 }}>
                {viewing.stories.map((st, i) => <View key={st.id} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= idx ? "#fff" : "rgba(255,255,255,0.3)" }} />)}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Avatar uri={viewing.author.avatarUrl} name={viewing.author.name} size={38} />
                <Text style={{ color: "#fff", fontWeight: "700" }}>{viewing.author.name}</Text>
                <Text style={{ color: "rgba(255,255,255,0.7)" }}>{timeAgo(viewing.stories[idx].createdAt)}</Text>
                <View style={{ flex: 1 }} />
                <Pressable onPress={() => setViewing(null)} hitSlop={12} accessibilityLabel="Close story"><Ionicons name="close" size={28} color="#fff" /></Pressable>
              </View>
            </View>
          )}
        </Pressable>
      </Modal>
    </>
  );
}

function PostCard({ post: p }: { post: Post }) {
  const qc = useQueryClient();
  const like = useMutation({
    mutationFn: () => post<{ liked: boolean; likeCount: number }>(`/posts/${p.id}/like`),
    onMutate: async () => {
      haptic.tap();
      await qc.cancelQueries({ queryKey: ["feed"] });
      const prev = qc.getQueryData<Feed>(["feed"]);
      qc.setQueryData<Feed>(["feed"], old => old && ({ ...old, items: old.items.map(i => i.id === p.id ? { ...i, liked: !i.liked, likeCount: i.likeCount + (i.liked ? -1 : 1) } : i) }));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(["feed"], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ["feed"] }),
  });
  const { user } = useAuth();
  const mine = p.author.id === user?.id;
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["feed"] }); qc.invalidateQueries({ queryKey: ["stories"] }); };
  const remove = () => showAlert("Delete this post?", "It will be removed for everyone. This can't be undone.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => { del(`/posts/${p.id}`).then(() => { haptic.success(); refresh(); }).catch(e => showError("Couldn't delete", e)); } },
  ]);
  const actions: SheetAction[] = mine
    ? [{ label: "Delete post", icon: "trash-outline", destructive: true, onPress: remove }]
    : [
      { label: "Report post", icon: "flag-outline", destructive: true, onPress: () => setReport({ type: "post", id: p.id, label: "post" }) },
      { label: `Block ${p.author.name.split(" ")[0]}`, icon: "ban-outline", destructive: true, onPress: () => confirmBlock(p.author.name, p.author.id, refresh) },
    ];

  return (
    <View style={{ backgroundColor: "#fff", marginHorizontal: 16, marginBottom: 16, borderRadius: radius.xl, padding: 10, borderWidth: 1, borderColor: colors.hairline, ...shadow }}>
      <ActionSheet visible={menu} actions={actions} onClose={() => setMenu(false)} />
      <ReportSheet target={report} onClose={() => setReport(null)} />
      <View style={{ flexDirection: "row", alignItems: "center", padding: 6, gap: 10 }}>
        <Avatar uri={p.author.avatarUrl} name={p.author.name} size={42} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "700" }}>{p.author.name}</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{timeAgo(p.createdAt)}{p.circle ? ` • ${p.circle.name}` : ""}</Text>
        </View>
        {p.kind !== "snap" && (
          <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: p.kind === "checkin" ? colors.successSoft : colors.primarySoft }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: p.kind === "checkin" ? colors.success : colors.primary }}>{p.kind === "checkin" ? "Check-in" : "Activity"}</Text>
          </View>
        )}
        <Pressable onPress={() => { haptic.tap(); setMenu(true); }} hitSlop={10} accessibilityLabel="Post options" style={{ padding: 4 }}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.muted} />
        </Pressable>
      </View>
      {p.imageUrl ? (
        <View style={{ marginTop: 6 }}>
          <Image source={{ uri: mediaUrl(p.imageUrl) }} style={{ width: "100%", aspectRatio: 1, borderRadius: radius.lg, backgroundColor: colors.primaryTint }} />
          {p.caption && (
            <View style={{ position: "absolute", left: 12, bottom: 12, maxWidth: "85%", borderRadius: radius.pill, overflow: "hidden" }}>
              <LinearGradient colors={["rgba(10,13,18,0.72)", "rgba(10,13,18,0.5)"]} style={{ paddingHorizontal: 14, paddingVertical: 7 }}>
                <Text style={{ color: "#fff", fontWeight: "600" }}>{p.caption}</Text>
              </LinearGradient>
            </View>
          )}
        </View>
      ) : p.caption ? <Text style={{ paddingHorizontal: 8, paddingVertical: 6, fontSize: 17, lineHeight: 24 }}>{p.caption}</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingTop: 12, paddingBottom: 4, gap: 20 }}>
        <Pressable onPress={() => like.mutate()} style={{ flexDirection: "row", alignItems: "center", gap: 6 }} accessibilityLabel={p.liked ? "Unlike" : "Like"}>
          <Ionicons name={p.liked ? "heart" : "heart-outline"} size={25} color={p.liked ? colors.danger : colors.text} />
          <Text style={{ fontWeight: "700" }}>{p.likeCount}</Text>
        </Pressable>
        <Pressable onPress={() => router.push(`/post/${p.id}`)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }} accessibilityLabel="Comments">
          <Ionicons name="chatbubble-outline" size={23} color={colors.text} />
          <Text style={{ fontWeight: "700" }}>{p.commentCount}</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => Share.share({ message: `${p.author.name} on ${APP_NAME}: ${p.caption ?? "a photo"}` })} accessibilityLabel="Share">
          <Ionicons name="paper-plane-outline" size={23} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

/** First-run guide shown until the feed has posts. */
function Welcome({ name }: { name: string }) {
  const circles = useQuery({ queryKey: ["circles"], queryFn: () => get<Circle[]>("/circles") });
  const family = circles.data?.find(c => c.type === "Family") ?? circles.data?.[0];
  const alone = (family?.members.length ?? 1) <= 1;
  const steps = [
    ...(alone && family ? [{ icon: "people" as const, title: "Invite your family", text: "Share your invite code so they can join your circle.", grad: gradients.primary,
      onPress: () => Share.share({ message: `Join my family on ${APP_NAME}! Open the app, go to Profile → My Circles → Join a circle, and enter code: ${family.inviteCode}` }) }] : []),
    { icon: "camera" as const, title: "Share your first moment", text: "Post a photo or a quick check-in.", grad: gradients.sunrise, onPress: () => router.navigate("/camera") },
    { icon: "checkbox" as const, title: "Plan your day", text: "Add medicines, water or a walk to My Day.", grad: gradients.success, onPress: () => router.navigate("/my-day") },
    { icon: "shield-checkmark" as const, title: "Set up safety", text: "Save your home and turn on SOS alerts.", grad: gradients.ocean, onPress: () => router.push("/safety") },
    { icon: "id-card" as const, title: "Fill your emergency card", text: "Blood group, allergies and who to call.", grad: gradients.danger, onPress: () => router.push("/emergency") },
  ];
  return (
    <View style={{ paddingHorizontal: 16 }}>
      <GradientCard>
        <Text style={{ color: "rgba(255,255,255,0.8)", fontWeight: "600" }}>Welcome to {APP_NAME}</Text>
        <Text style={{ color: "#fff", fontSize: 24, fontWeight: "800", marginTop: 4, letterSpacing: -0.4 }}>Let's bring your family together, {name}</Text>
        <Text style={{ color: "rgba(255,255,255,0.85)", marginTop: 8, lineHeight: 21 }}>Your circle is private. Only the people you invite can see what you share.</Text>
      </GradientCard>
      <View style={{ gap: 12, marginTop: 16 }}>
        {steps.map(st => (
          <Pressable key={st.title} onPress={() => { haptic.tap(); void st.onPress(); }}
            style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#fff", borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.hairline, ...shadow }, pressed && { transform: [{ scale: 0.985 }] }]}>
            <IconTile icon={st.icon} gradient={st.grad} size={46} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "700", fontSize: 16 }}>{st.title}</Text>
              <Text style={{ color: colors.muted, marginTop: 2, fontSize: 13 }}>{st.text}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.faint} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function Home() {
  const { user } = useAuth();
  const feed = useQuery({ queryKey: ["feed"], queryFn: () => get<Feed>("/feed") });
  const n = useNotifications();
  const first = user?.name.split(" ")[0] ?? "";

  return (
    <Screen tab>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingTop: 10, paddingBottom: 8, gap: 12 }}>
        <Pressable onPress={() => router.navigate("/profile")} accessibilityLabel="Your profile">
          <Avatar uri={user?.avatarUrl} name={user?.name} size={46} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "500" }}>{greeting()},</Text>
          <Text style={{ fontSize: 22, fontWeight: "800", letterSpacing: -0.4 }} numberOfLines={1}>{first} 👋</Text>
        </View>
        <IconButton icon="people-outline" label="My circles" onPress={() => router.push("/circles")} />
        <IconButton icon="notifications-outline" label={n.data?.unread ? `Notifications, ${n.data.unread} unread` : "Notifications"} badge={n.data?.unread} onPress={() => router.push("/notifications")} />
      </View>
      {feed.isLoading ? <Loading /> : feed.error ? <ErrorView error={feed.error} onRetry={() => feed.refetch()} /> : (
        <FlatList
          data={feed.data?.items ?? []}
          keyExtractor={p => p.id}
          ListHeaderComponent={<View style={{ marginBottom: 10 }}><SosBanner /><Stories /></View>}
          renderItem={({ item }) => <PostCard post={item} />}
          ListEmptyComponent={<Welcome name={first} />}
          ListFooterComponent={(feed.data?.items.length ?? 0) > 0 ? <Button title="Share a moment" icon="camera" variant="soft" onPress={() => router.navigate("/camera")} style={{ marginHorizontal: 16, marginTop: 4 }} /> : undefined}
          refreshing={feed.isRefetching}
          onRefresh={() => feed.refetch()}
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      )}
    </Screen>
  );
}
