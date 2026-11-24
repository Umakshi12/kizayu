import { useEffect } from "react";
import { Platform, useWindowDimensions, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../auth";
import { NotificationsBridge, RemindersBridge } from "../components/NotificationsBridge";
import { colors } from "../theme";

// Only the five weights the app uses (loading the package index would bundle all 14 files).
const FONT_FILES = {
  PlusJakartaSans_400Regular: require("@expo-google-fonts/plus-jakarta-sans/400Regular/PlusJakartaSans_400Regular.ttf"),
  PlusJakartaSans_500Medium: require("@expo-google-fonts/plus-jakarta-sans/500Medium/PlusJakartaSans_500Medium.ttf"),
  PlusJakartaSans_600SemiBold: require("@expo-google-fonts/plus-jakarta-sans/600SemiBold/PlusJakartaSans_600SemiBold.ttf"),
  PlusJakartaSans_700Bold: require("@expo-google-fonts/plus-jakarta-sans/700Bold/PlusJakartaSans_700Bold.ttf"),
  PlusJakartaSans_800ExtraBold: require("@expo-google-fonts/plus-jakarta-sans/800ExtraBold/PlusJakartaSans_800ExtraBold.ttf"),
};

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } });

function Navigator({ fontsReady }: { fontsReady: boolean }) {
  const { user, loading } = useAuth();
  const ready = fontsReady && !loading;
  useEffect(() => { if (ready) void SplashScreen.hideAsync().catch(() => undefined); }, [ready]);
  if (!ready) return null; // the splash screen stays up until fonts and the session are ready
  return (
    <>
      <NotificationsBridge />
      {user && <RemindersBridge />}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: "slide_from_right" }}>
        <Stack.Protected guard={!!user} redirectTo="/sign-in">
          <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
          <Stack.Screen name="post/[id]" />
          <Stack.Screen name="health/[userId]" />
          <Stack.Screen name="doctor" />
          <Stack.Screen name="doctor-setup" />
          <Stack.Screen name="doctor-chat/[doctorId]" />
          <Stack.Screen name="doctor-inbox/index" />
          <Stack.Screen name="doctor-inbox/[threadId]" />
          <Stack.Screen name="games/index" />
          <Stack.Screen name="games/ludo" />
          <Stack.Screen name="games/wordhunt" />
          <Stack.Screen name="chat/[circleId]" />
          <Stack.Screen name="safety" />
          <Stack.Screen name="lists" />
          <Stack.Screen name="sos" options={{ animation: "fade", gestureEnabled: false }} />
          <Stack.Screen name="sos-contacts" />
          <Stack.Screen name="emergency" />
          <Stack.Screen name="circles" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="premium" options={{ animation: "slide_from_bottom" }} />
          <Stack.Screen name="help" />
          <Stack.Screen name="about" />
          <Stack.Screen name="account" />
        </Stack.Protected>
        <Stack.Protected guard={!user}>
          <Stack.Screen name="sign-in" options={{ animation: "fade" }} />
          <Stack.Screen name="sign-up" />
          <Stack.Screen name="forgot-password" />
        </Stack.Protected>
        <Stack.Screen name="legal/[doc]" />
      </Stack>
    </>
  );
}

// Pop-ups (bottom sheets, story viewer) are rendered by the browser outside the app column, pinned to the whole
// window. On wide screens, keep them inside the same 440px column so desktop matches what phones show.
if (Platform.OS === "web" && typeof document !== "undefined" && !document.getElementById("kizayu-frame-css")) {
  const style = document.createElement("style");
  style.id = "kizayu-frame-css";
  style.textContent = `*:focus, *:focus-visible { outline: none !important; }
  @media (min-width: 600px) {
    [role="dialog"][aria-modal="true"] { left: 50% !important; right: auto !important; width: 440px !important; transform: translateX(-50%); }
  }`;
  document.head.appendChild(style);
}

/** On a wide desktop browser, show the app in a centred phone-width column instead of stretching it edge to edge. */
function WebFrame({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  if (Platform.OS !== "web" || width < 600) return <>{children}</>;
  return (
    <LinearGradient colors={["#05080C", "#0B1F2B", "#00506A"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: "center" }}>
      <View style={{ flex: 1, width: 440, overflow: "hidden", backgroundColor: colors.bg, shadowColor: "#00D4FF", shadowOpacity: 0.25, shadowRadius: 40 }}>
        {children}
      </View>
    </LinearGradient>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="dark" />
          {/* If a font fails to load, carry on with the system font rather than blocking the app. */}
          <WebFrame>
            <Navigator fontsReady={fontsLoaded || !!fontError} />
          </WebFrame>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
