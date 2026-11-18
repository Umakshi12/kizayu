import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { post } from "../api";
import { useAuth } from "../auth";
import type { Me } from "../types";
import { Button } from "./ui";

WebBrowser.maybeCompleteAuthSession();

// OAuth client IDs from Google Cloud Console (APIs & Services -> Credentials).
const IDS = {
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
};

/** True when this platform has a client ID, so the button can work. */
export const googleClientConfigured = () =>
  !!(Platform.OS === "ios" ? IDS.iosClientId : Platform.OS === "android" ? IDS.androidClientId : IDS.webClientId);

/** Render only when googleClientConfigured() is true (the hook requires a client ID). */
export function GoogleButton({ onError }: { onError: (msg: string) => void }) {
  const { accept } = useAuth();
  const [busy, setBusy] = useState(false);
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest(IDS);

  useEffect(() => {
    if (response?.type !== "success") { if (response) setBusy(false); return; }
    const idToken = response.params.id_token;
    post<{ token: string; user: Me }>("/auth/google", { idToken })
      .then(accept)
      .catch(e => onError(e instanceof Error ? e.message : "Google sign-in failed"))
      .finally(() => setBusy(false));
  }, [response]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Button title="Continue with Google" icon="logo-google" variant="soft" loading={busy} disabled={!request}
      onPress={() => { setBusy(true); void promptAsync(); }} />
  );
}
