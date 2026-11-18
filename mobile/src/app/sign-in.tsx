import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { Text } from "../components/Text";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { get, post } from "../api";
import { useAuth } from "../auth";
import { APP_NAME } from "../config";
import { Button, Card, Field, GradientCard, Screen } from "../components/ui";
import { GoogleButton, googleClientConfigured } from "../components/GoogleButton";
import { DevCode } from "../components/DevCode";
import { colors, radius, shadow } from "../theme";
import { haptic } from "../haptics";
import type { AuthMethods, Me } from "../types";

type Tab = "email" | "phone";

function EmailForm({ setError }: { setError: (e: string | null) => void }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await signIn(email.trim(), password); }
    catch (e) { setError(e instanceof Error ? e.message : "Sign in failed"); }
    finally { setBusy(false); }
  };
  return (
    <>
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" placeholder="you@example.com" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" placeholder="Your password" onSubmitEditing={submit} />
      <Text onPress={() => router.push("/forgot-password")} style={{ color: colors.primary, fontWeight: "600", alignSelf: "flex-end", marginTop: -6, marginBottom: 16 }}>Forgot password?</Text>
      <Button title="Sign in" onPress={submit} loading={busy} disabled={!email || !password} />
    </>
  );
}

function PhoneForm({ setError }: { setError: (e: string | null) => void }) {
  const { accept } = useAuth();
  const [phone, setPhone] = useState("+91");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isNew, setIsNew] = useState(false);
  const [devCode, setDevCode] = useState<string>();
  const [busy, setBusy] = useState(false);
  const normalized = phone.replace(/[\s-]/g, "");

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const r = await post<{ isNewUser: boolean; devCode?: string }>("/auth/otp/request", { phone: normalized });
      setIsNew(r.isNewUser); setDevCode(r.devCode); setStep("code");
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't send code"); }
    finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setError(null);
    try { await accept(await post<{ token: string; user: Me }>("/auth/otp/verify", { phone: normalized, code, ...(isNew ? { name: name.trim() } : {}) })); }
    catch (e) { setError(e instanceof Error ? e.message : "Verification failed"); }
    finally { setBusy(false); }
  };

  if (step === "phone") return (
    <>
      <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="+91 98765 43210" />
      <Text style={{ color: colors.muted, marginTop: -8, marginBottom: 14 }}>We'll text you a 6-digit code. Include your country code.</Text>
      <Button title="Send code" onPress={send} loading={busy} disabled={!/^\+[1-9]\d{7,14}$/.test(normalized)} />
    </>
  );
  return (
    <>
      <Text style={{ color: colors.muted, marginBottom: 12 }}>Code sent to <Text style={{ fontWeight: "700", color: colors.text }}>{normalized}</Text></Text>
      <DevCode code={devCode} />
      <Field label="6-digit code" value={code} onChangeText={t => setCode(t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" placeholder="123456" />
      {isNew && <Field label="Your name (new account)" value={name} onChangeText={setName} autoCapitalize="words" placeholder="Your full name" />}
      <Button title={isNew ? "Create account" : "Verify & sign in"} onPress={verify} loading={busy} disabled={code.length !== 6 || (isNew && !name.trim())} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14 }}>
        <Pressable onPress={() => { setStep("phone"); setCode(""); }}><Text style={{ color: colors.primary, fontWeight: "600" }}>Change number</Text></Pressable>
        <Pressable onPress={send} disabled={busy}><Text style={{ color: colors.primary, fontWeight: "600" }}>Resend code</Text></Pressable>
      </View>
    </>
  );
}

export default function SignIn() {
  const [tab, setTab] = useState<Tab>("email");
  const [error, setError] = useState<string | null>(null);
  const methods = useQuery({ queryKey: ["auth-methods"], queryFn: () => get<AuthMethods>("/auth/methods") });
  const showGoogle = !!methods.data?.google && googleClientConfigured();

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, flexGrow: 1, justifyContent: "center", maxWidth: 480, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled">
          <GradientCard style={{ alignItems: "center", paddingVertical: 30, marginBottom: -28, paddingBottom: 54 }}>
            <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" }}>
              <Ionicons name="heart" size={38} color="#fff" />
            </View>
            <Text style={{ fontSize: 32, fontWeight: "800", color: "#fff", marginTop: 14, letterSpacing: -0.8 }}>{APP_NAME}</Text>
            <Text style={{ color: "rgba(255,255,255,0.85)", marginTop: 4 }}>Stay close to the people who matter</Text>
          </GradientCard>

          <Card style={{ padding: 20, marginHorizontal: 6 }}>
            <View style={{ flexDirection: "row", backgroundColor: colors.primaryTint, borderRadius: radius.pill, padding: 4, marginBottom: 20 }}>
              {(["email", "phone"] as Tab[]).map(t => (
                <Pressable key={t} onPress={() => { haptic.select(); setTab(t); setError(null); }} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}
                  style={{ flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: radius.pill, backgroundColor: tab === t ? "#fff" : "transparent", ...(tab === t ? shadow : {}) }}>
                  <Text style={{ fontWeight: "700", color: tab === t ? colors.primary : colors.muted }}>{t === "email" ? "Email" : "Phone"}</Text>
                </Pressable>
              ))}
            </View>

            {tab === "email" ? <EmailForm setError={setError} /> : <PhoneForm setError={setError} />}
            {error && (
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: colors.dangerSoft, borderRadius: radius.sm, padding: 12, marginTop: 14 }}>
                <Ionicons name="alert-circle" size={18} color={colors.danger} />
                <Text style={{ color: colors.danger, flex: 1, fontWeight: "500" }}>{error}</Text>
              </View>
            )}

            {showGoogle && (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 18 }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                  <Text style={{ color: colors.muted, fontSize: 13 }}>or</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                </View>
                <GoogleButton onError={setError} />
              </>
            )}
          </Card>

          <View style={{ flexDirection: "row", justifyContent: "center", marginTop: 22 }}>
            <Text style={{ color: colors.muted }}>New here? </Text>
            <Text onPress={() => router.push("/sign-up")} style={{ color: colors.primary, fontWeight: "700" }}>Create an account</Text>
          </View>
          <Text style={{ color: colors.faint, textAlign: "center", marginTop: 14, fontSize: 12, lineHeight: 18 }}>
            By continuing you agree to our <Text onPress={() => router.push("/legal/terms")} style={{ color: colors.primary, fontSize: 12, fontWeight: "600" }}>Terms</Text> and{" "}
            <Text onPress={() => router.push("/legal/privacy")} style={{ color: colors.primary, fontSize: 12, fontWeight: "600" }}>Privacy Policy</Text>.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
