import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Text } from "../components/Text";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../api";
import { showAlert } from "../alert";
import { useAuth } from "../auth";
import { APP_NAME } from "../config";
import { Button, Card, ErrorView, Header, Loading, Screen, SectionHeader, Empty } from "../components/ui";
import { colors, radius } from "../theme";
import type { PlansResponse, PremiumStatus } from "../types";

export default function Premium() {
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const plans = useQuery({ queryKey: ["premium-plans"], queryFn: () => get<PlansResponse>("/premium/plans") });
  const status = useQuery({ queryKey: ["premium-status"], queryFn: () => get<PremiumStatus>("/premium/status") });
  const [plan, setPlan] = useState<"monthly" | "yearly">("yearly");

  const after = async (r: PremiumStatus) => { qc.setQueryData(["premium-status"], r); await refresh(); };
  const buy = useMutation({
    mutationFn: () => post<PremiumStatus>("/premium/purchase", { plan, provider: "dev" }),
    onSuccess: async r => { await after(r); showAlert("Welcome to Premium! 👑", "Test purchase complete. No money was charged."); },
    onError: e => showAlert("Purchase failed", e instanceof Error ? e.message : "Try again"),
  });
  const cancel = useMutation({
    mutationFn: () => post<PremiumStatus>("/premium/cancel"),
    onSuccess: async r => { await after(r); showAlert("Subscription canceled", `Premium stays on until ${new Date(r.subscription!.expiresAt).toLocaleDateString()}.`); },
    onError: e => showAlert("Couldn't cancel", e instanceof Error ? e.message : "Try again"),
  });

  const sub = status.data?.subscription;
  return (
    <Screen>
      <Header title={`${APP_NAME} Premium`} back />
      {plans.isLoading || status.isLoading ? <Loading /> : plans.error ? <ErrorView error={plans.error} onRetry={() => plans.refetch()} /> : !plans.data!.enabled ? (
        <Empty icon="diamond-outline" title="Premium is coming soon" text="Everyone currently gets all features for free. We'll let you know when Premium plans are available." />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
          <LinearGradient colors={["#0088B8", "#00506A"]} style={{ borderRadius: radius.lg, padding: 22, alignItems: "center" }}>
            <Ionicons name="trophy" size={48} color="#FFD34D" />
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 6 }}>
              {status.data?.premium ? "You're on Premium" : "Do more together"}
            </Text>
            <Text style={{ color: "#BFEFFB", textAlign: "center", marginTop: 4 }}>
              {sub ? `${sub.plan === "yearly" ? "Yearly" : "Monthly"} plan • ${sub.status === "canceled" ? "ends" : "renews"} ${new Date(sub.expiresAt).toLocaleDateString()}`
                : "More circles, longer location sharing and unlimited health records."}
            </Text>
          </LinearGradient>

          <SectionHeader title="What you get" />
          <Card style={{ paddingVertical: 4 }}>
            <View style={{ flexDirection: "row", paddingVertical: 10 }}>
              <Text style={{ flex: 1.4 }} />
              <Text style={{ flex: 1, fontWeight: "700", color: colors.muted, textAlign: "center" }}>Free</Text>
              <Text style={{ flex: 1, fontWeight: "800", color: colors.primary, textAlign: "center" }}>Premium</Text>
            </View>
            {plans.data!.features.map(f => (
              <View key={f.title} style={{ flexDirection: "row", paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border, alignItems: "center" }}>
                <Text style={{ flex: 1.4, fontWeight: "600", color: colors.text }}>{f.title}</Text>
                <Text style={{ flex: 1, color: colors.muted, textAlign: "center" }}>{f.free}</Text>
                <Text style={{ flex: 1, color: colors.text, fontWeight: "700", textAlign: "center" }}>{f.premium}</Text>
              </View>
            ))}
          </Card>

          {!status.data?.premium && (
            <>
              <SectionHeader title="Choose a plan" />
              <View style={{ flexDirection: "row", gap: 10 }}>
                {plans.data!.plans.map(p => {
                  const on = plan === p.id;
                  return (
                    <Pressable key={p.id} onPress={() => setPlan(p.id)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                      style={{ flex: 1, padding: 16, borderRadius: radius.md, backgroundColor: on ? colors.primarySoft : colors.card, borderWidth: 2, borderColor: on ? colors.primary : colors.border }}>
                      {p.id === "yearly" && <Text style={{ color: colors.success, fontWeight: "800", fontSize: 12, marginBottom: 4 }}>SAVE 33%</Text>}
                      <Text style={{ fontWeight: "800", fontSize: 16, color: colors.text }}>{p.title}</Text>
                      <Text style={{ color: colors.muted, marginTop: 2 }}>{p.priceLabel}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {plans.data!.devPurchases ? (
                <>
                  <Button title="Subscribe (test purchase)" icon="trophy" onPress={() => buy.mutate()} loading={buy.isPending} style={{ marginTop: 16 }} />
                  <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 8 }}>
                    Test mode: no money is charged. Real payments go through Google Play and the App Store once billing is connected.
                  </Text>
                </>
              ) : (
                <Text style={{ color: colors.muted, textAlign: "center", marginTop: 16 }}>Subscriptions will be available through Google Play and the App Store.</Text>
              )}
            </>
          )}

          {status.data?.premium && sub?.status === "active" && (
            <Button title="Cancel subscription" variant="soft" onPress={() => showAlert("Cancel Premium?", "You'll keep Premium until the end of the current period.", [
              { text: "Keep Premium", style: "cancel" }, { text: "Cancel subscription", style: "destructive", onPress: () => cancel.mutate() },
            ])} loading={cancel.isPending} style={{ marginTop: 20 }} />
          )}
        </ScrollView>
      )}
    </Screen>
  );
}
