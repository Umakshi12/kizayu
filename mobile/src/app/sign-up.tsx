import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../components/Text";
import { Button, Card, Field, GradientCard, IconButton, Screen } from "../components/ui";
import { Logo } from "../components/Logo";
import { useAuth } from "../auth";
import { APP_NAME } from "../config";
import { colors, radius } from "../theme";

export default function SignUp() {
  const { signUp } = useAuth();
  const [f, setF] = useState({ name: "", username: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF(p => ({ ...p, [k]: v }));

  const valid = f.name.trim() && /^[a-z0-9_.]{3,}$/i.test(f.username) && /\S+@\S+\.\S+/.test(f.email) && f.password.length >= 8;

  const submit = async () => {
    setBusy(true); setError(null);
    try { await signUp({ ...f, name: f.name.trim(), email: f.email.trim() }); }
    catch (e) { setError(e instanceof Error ? e.message : "Sign up failed"); }
    finally { setBusy(false); }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, flexGrow: 1, justifyContent: "center", maxWidth: 480, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled">
          <GradientCard style={{ alignItems: "center", paddingVertical: 24, marginBottom: -28, paddingBottom: 48 }}>
            <View style={{ position: "absolute", top: 14, left: 14 }}>
              <IconButton icon="chevron-back" label="Go back" onPress={() => router.back()} />
            </View>
            <Logo size={72} />
            <Text style={{ fontSize: 26, fontWeight: "800", color: "#fff", marginTop: 10, letterSpacing: -0.5 }}>Join {APP_NAME}</Text>
            <Text style={{ color: "rgba(255,255,255,0.85)", marginTop: 4 }}>Create your family's private space</Text>
          </GradientCard>

          <Card style={{ padding: 20, marginHorizontal: 6 }}>
            <Field label="Full name" value={f.name} onChangeText={set("name")} autoCapitalize="words" placeholder="Your full name" />
            <Field label="Username" value={f.username} onChangeText={set("username")} placeholder="choose a username" hint="Letters, numbers, dots or underscores" />
            <Field label="Email" value={f.email} onChangeText={set("email")} keyboardType="email-address" autoComplete="email" placeholder="you@example.com" />
            <Field label="Password" value={f.password} onChangeText={set("password")} secureTextEntry autoComplete="new-password" placeholder="Your password" hint="At least 8 characters" onSubmitEditing={() => valid && submit()} />
            {error && (
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: colors.dangerSoft, borderRadius: radius.sm, padding: 12, marginBottom: 14 }}>
                <Ionicons name="alert-circle" size={18} color={colors.danger} />
                <Text style={{ color: colors.danger, flex: 1, fontWeight: "500" }}>{error}</Text>
              </View>
            )}
            <Button title="Create account" onPress={submit} loading={busy} disabled={!valid} />
          </Card>

          <View style={{ flexDirection: "row", justifyContent: "center", marginTop: 22 }}>
            <Text style={{ color: colors.muted }}>Already have an account? </Text>
            <Text onPress={() => router.replace("/sign-in")} style={{ color: colors.primary, fontWeight: "700" }}>Sign in</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
