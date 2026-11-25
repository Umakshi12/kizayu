import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tabs } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts, glow, gradients } from "../../theme";
import { haptic } from "../../haptics";

const icon = (active: string, inactive: string) =>
  ({ color, focused }: { color: unknown; focused: boolean }) => (
    <View style={{ width: 46, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: focused ? colors.primarySoft : "transparent" }}>
      <Ionicons name={(focused ? active : inactive) as never} size={22} color={color as string} />
    </View>
  );

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, Platform.OS === "ios" ? 20 : 8); // room for the phone's navigation bar / home indicator
  const barHeight = 64 + bottom;
  return (
    <Tabs
      screenListeners={{ tabPress: () => haptic.select() }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.faint,
        tabBarLabelStyle: { fontSize: 11, fontFamily: fonts.semibold, marginTop: 2 },
        tabBarStyle: {
          height: barHeight, paddingTop: 8, paddingBottom: bottom,
          backgroundColor: "#fff", borderTopWidth: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28,
          shadowColor: "#0B2533", shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: -6 }, elevation: 16,
          position: "absolute",
        },
        sceneStyle: { backgroundColor: colors.bg, paddingBottom: barHeight },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("home", "home-outline") }} />
      <Tabs.Screen name="my-day" options={{ title: "My Day", tabBarIcon: icon("checkbox", "checkbox-outline") }} />
      <Tabs.Screen
        name="camera"
        options={{
          title: "",
          tabBarAccessibilityLabel: "Share a moment",
          tabBarIcon: () => null,
          tabBarButton: props => (
            <View style={{ flex: 1, alignItems: "center" }}>
              <Pressable onPress={e => { haptic.tap(); props.onPress?.(e); }} accessibilityRole="button" accessibilityLabel="Share a moment"
                style={({ pressed }) => [{ marginTop: -30, borderRadius: 34, transform: [{ scale: pressed ? 0.94 : 1 }] }, glow]}>
                <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={{ width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: "#fff" }}>
                  <Ionicons name="camera" size={27} color="#fff" />
                </LinearGradient>
              </Pressable>
            </View>
          ),
        }}
      />
      <Tabs.Screen name="study" options={{ title: "Study", tabBarIcon: icon("school", "school-outline") }} />
      <Tabs.Screen name="care" options={{ title: "Care", tabBarIcon: icon("heart", "heart-outline") }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: icon("person", "person-outline") }} />
    </Tabs>
  );
}
