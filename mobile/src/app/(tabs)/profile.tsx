import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Text } from "../../components/Text";
import { showAlert } from "../../alert";
import { useAuth } from "../../auth";
import { APP_NAME } from "../../config";
import { useNotifications, usePremiumPlans } from "../../hooks";
import { haptic } from "../../haptics";
import { Avatar, Button, Card, IconName, IconTile } from "../../components/ui";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, glow, gradients, radius } from "../../theme";

type Row = { icon: IconName; tint: string; bg: string; title: string; sub?: string; href: string; badge?: number };

function Group({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <View style={{ marginTop: 22 }}>
      <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 12, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10, marginLeft: 4 }}>{title}</Text>
      <Card style={{ paddingVertical: 4, paddingHorizontal: 14 }}>
        {rows.map((r, i) => (
          <Pressable key={r.title} onPress={() => { haptic.tap(); router.push(r.href as never); }}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 13, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border, opacity: pressed ? 0.6 : 1 })}>
            <IconTile icon={r.icon} color={r.tint} bg={r.bg} size={38} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "600", fontSize: 15 }}>{r.title}</Text>
              {r.sub && <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>{r.sub}</Text>}
            </View>
            {!!r.badge && (
              <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }}>
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "800" }}>{r.badge}</Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={18} color={colors.faint} />
          </Pressable>
        ))}
      </Card>
    </View>
  );
}

export default function Profile() {
  const { user, signOut } = useAuth();
  const notifications = useNotifications();
  const premium = usePremiumPlans();
  if (!user) return null;

  const family: Row[] = [
    { icon: "people", tint: colors.primary, bg: colors.primarySoft, title: "My Circles", sub: "Family, friends and relatives", href: "/circles" },
    { icon: "pulse", tint: colors.danger, bg: colors.dangerSoft, title: "Health Vault", sub: "Vitals, medicines, records", href: "/health/me" },
    { icon: "medical", tint: colors.success, bg: colors.successSoft, title: "Family Doctor", href: "/doctor" },
    { icon: "shield-checkmark", tint: "#1E88E5", bg: "#E3F1FD", title: "Safety & Location", href: "/safety" },
    { icon: "game-controller", tint: "#F07A2B", bg: "#FFEEDF", title: "Games", href: "/games" },
  ];
  const account: Row[] = [
    { icon: "notifications", tint: colors.primary, bg: colors.primarySoft, title: "Notifications", href: "/notifications", badge: notifications.data?.unread },
    { icon: "lock-closed", tint: colors.text, bg: "#EEEDF3", title: "Account & Security", sub: user.hasPassword ? "Password, email, phone" : "Add a password", href: "/account" },
    user.doctorId
      ? { icon: "medkit", tint: colors.success, bg: colors.successSoft, title: "Patient messages", sub: "Your doctor inbox", href: "/doctor-inbox" }
      : { icon: "medkit-outline", tint: colors.success, bg: colors.successSoft, title: "I'm a doctor", sub: "Let patients connect with you", href: "/doctor-setup" },
  ];
  const support: Row[] = [
    { icon: "help-buoy", tint: "#7C4DFF", bg: colors.primarySoft, title: "Help & Support", href: "/help" },
    { icon: "information-circle", tint: colors.muted, bg: "#EEEDF3", title: `About ${APP_NAME}`, href: "/about" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingBottom: 70, borderBottomLeftRadius: 36, borderBottomRightRadius: 36 }}>
          <SafeAreaView edges={["top"]}>
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 22, paddingHorizontal: 20, paddingTop: 10 }}>Profile</Text>
          </SafeAreaView>
        </LinearGradient>
        <View style={{ paddingHorizontal: 16, marginTop: -58, maxWidth: 640, width: "100%", alignSelf: "center" }}>
          <Card style={{ alignItems: "center", paddingTop: 22 }}>
            <Avatar uri={user.avatarUrl} name={user.name} size={92} ring />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 }}>
              <Text style={{ fontSize: 22, fontWeight: "800", letterSpacing: -0.4 }}>{user.name}</Text>
              {user.premium && <Ionicons name="checkmark-circle" size={20} color={colors.primary} accessibilityLabel="Premium member" />}
            </View>
            <Text style={{ color: colors.muted, marginTop: 2 }}>@{user.username}</Text>
          </Card>

          {premium.data?.enabled && (
          <Pressable onPress={() => { haptic.tap(); router.push("/premium"); }} style={({ pressed }) => [{ marginTop: 16, borderRadius: radius.lg, transform: [{ scale: pressed ? 0.98 : 1 }] }, glow]}>
            <LinearGradient colors={gradients.premium} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.lg, padding: 18, flexDirection: "row", alignItems: "center", gap: 14 }}>
              <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: "rgba(255,200,69,0.18)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="diamond" size={24} color={colors.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 17 }}>{APP_NAME} Premium</Text>
                <Text style={{ color: "rgba(255,255,255,0.75)", marginTop: 2 }}>{user.premium ? "You're a member. Manage your plan" : "More circles, longer sharing, unlimited records"}</Text>
              </View>
              <Ionicons name="arrow-forward-circle" size={28} color={colors.gold} />
            </LinearGradient>
          </Pressable>
          )}

          <Group title="Family" rows={family} />
          <Group title="Account" rows={account} />
          <Group title="Support" rows={support} />

          <Button title="Log out" variant="ghost" icon="log-out-outline" style={{ marginTop: 24 }}
            onPress={() => showAlert("Log out?", "You'll need to sign in again.", [{ text: "Cancel", style: "cancel" }, { text: "Log out", style: "destructive", onPress: () => { void signOut(); } }])} />
        </View>
      </ScrollView>
    </View>
  );
}
