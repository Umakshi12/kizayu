import { Linking, Pressable, ScrollView, View } from "react-native";
import { Text } from "../components/Text";
import { router } from "expo-router";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { APP_NAME } from "../config";
import { Card, Header, IconName, Screen } from "../components/ui";
import { colors } from "../theme";

const ROWS: { icon: IconName; title: string; onPress: () => void }[] = [
  { icon: "document-text-outline", title: "Terms of Service", onPress: () => router.push("/legal/terms") },
  { icon: "shield-checkmark-outline", title: "Privacy Policy", onPress: () => router.push("/legal/privacy") },
  { icon: "map-outline", title: "Map data © OpenStreetMap contributors", onPress: () => Linking.openURL("https://www.openstreetmap.org/copyright") },
  { icon: "help-buoy-outline", title: "Help & Support", onPress: () => router.push("/help") },
];

export default function About() {
  const version = Constants.expoConfig?.version ?? "1.0.0";
  return (
    <Screen>
      <Header title={`About ${APP_NAME}`} back />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
        <View style={{ alignItems: "center", marginVertical: 20 }}>
          <Ionicons name="heart-circle" size={84} color={colors.primary} />
          <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text }}>{APP_NAME}</Text>
          <Text style={{ color: colors.muted, marginTop: 2 }}>Version {version}</Text>
        </View>
        <Card>
          <Text style={{ color: colors.text, lineHeight: 22 }}>
            {APP_NAME} keeps families close: share moments, look after each other's health, plan the day together and stay safe
            with location sharing and SOS. Your circles are private, so only the people you invite see what you share.
          </Text>
        </Card>
        <Card style={{ marginTop: 14, paddingVertical: 4 }}>
          {ROWS.map((r, i) => (
            <Pressable key={r.title} onPress={r.onPress}
              style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
              <Ionicons name={r.icon} size={22} color={colors.primary} />
              <Text style={{ flex: 1, fontWeight: "600", color: colors.text }}>{r.title}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ))}
        </Card>
        <Text style={{ color: colors.muted, textAlign: "center", marginTop: 20, fontSize: 12 }}>Made with 💜 for families</Text>
      </ScrollView>
    </Screen>
  );
}
