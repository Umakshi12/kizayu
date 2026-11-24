import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView } from "react-native";
import { Text } from "../components/Text";
import { post } from "../api";
import { useAuth } from "../auth";
import { Button, Field, Header, Screen } from "../components/ui";
import { colors } from "../theme";
import type { Me } from "../types";
import { DevCode } from "../components/DevCode";

export default function ForgotPassword() {
  const { accept } = useAuth();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "reset">("email");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [devCode, setDevCode] = useState<string>();
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const r = await post<{ message: string; devCode?: string }>("/auth/password/forgot", { email: email.trim() });
      setInfo(r.message); setDevCode(r.devCode); setStep("reset");
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't send code"); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true); setError(null);
    try { await accept(await post<{ token: string; user: Me }>("/auth/password/reset", { email: email.trim(), code, password })); }
    catch (e) { setError(e instanceof Error ? e.message : "Reset failed"); }
    finally { setBusy(false); }
  };

  return (
    <Screen>
      <Header title="Reset password" back />
      <KeyboardAvoidingView behavior={Platform.OS === "web" ? undefined : "padding"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, maxWidth: 480, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled">
          {step === "email" ? (
            <>
              <Text style={{ color: colors.muted, marginBottom: 16 }}>Enter the email on your account and we'll send you a 6-digit code.</Text>
              <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" placeholder="you@example.com" onSubmitEditing={send} />
              <Button title="Send reset code" onPress={send} loading={busy} disabled={!/\S+@\S+\.\S+/.test(email)} />
            </>
          ) : (
            <>
              {info && <Text style={{ color: colors.muted, marginBottom: 12 }}>{info}</Text>}
              <DevCode code={devCode} />
              <Field label="6-digit code" value={code} onChangeText={t => setCode(t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" placeholder="123456" />
              <Field label="New password (min 8 characters)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" placeholder="Your password" />
              <Button title="Set new password" onPress={reset} loading={busy} disabled={code.length !== 6 || password.length < 8} />
              <Pressable onPress={() => { setStep("email"); setCode(""); }} style={{ marginTop: 14 }}>
                <Text style={{ color: colors.primary, fontWeight: "600" }}>Use a different email</Text>
              </Pressable>
            </>
          )}
          {error && <Text style={{ color: colors.danger, marginTop: 12 }}>{error}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
