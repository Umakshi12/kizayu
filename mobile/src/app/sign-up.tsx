import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { Text } from "../components/Text";
import { router } from "expo-router";
import { Screen, Field, Button, Header } from "../components/ui";
import { useAuth } from "../auth";
import { colors } from "../theme";

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
      <Header title="Create account" back />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
          <Field label="Full name" value={f.name} onChangeText={set("name")} autoCapitalize="words" placeholder="Your full name" />
          <Field label="Username" value={f.username} onChangeText={set("username")} placeholder="choose a username" />
          <Field label="Email" value={f.email} onChangeText={set("email")} keyboardType="email-address" placeholder="you@example.com" />
          <Field label="Password (min 8 characters)" value={f.password} onChangeText={set("password")} secureTextEntry placeholder="Your password" />
          {error && <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text>}
          <Button title="Sign up" onPress={submit} loading={busy} disabled={!valid} />
          <Text style={{ color: colors.muted, textAlign: "center", marginTop: 16 }}>
            Already have an account? <Text onPress={() => router.replace("/sign-in")} style={{ color: colors.primary, fontWeight: "700" }}>Sign in</Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
