import { ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { get } from "../api";
import { Text } from "../components/Text";
import { Card, ErrorView, Header, IconName, IconTile, Loading, Screen } from "../components/ui";
import { colors, gradients } from "../theme";
import type { Badge } from "../types";

export default function Badges() {
  const q = useQuery({ queryKey: ["badges"], queryFn: () => get<Badge[]>("/badges") });
  const earned = (q.data ?? []).filter(b => b.earned).length;
  return (
    <Screen>
      <Header title="Badges" subtitle={q.data ? `${earned} of ${q.data.length} earned` : undefined} back />
      {q.isLoading ? <Loading /> : q.error ? <ErrorView error={q.error} onRetry={() => q.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, maxWidth: 560, width: "100%", alignSelf: "center" }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {q.data!.map(b => (
              <Card key={b.id} style={{ width: "47.8%", padding: 14, alignItems: "center", opacity: b.earned ? 1 : 0.85 }}>
                <IconTile icon={(b.earned ? b.icon : "lock-closed") as IconName} size={56} gradient={b.earned ? gradients.sunrise : undefined} color={colors.faint} bg={colors.border} />
                <Text style={{ fontWeight: "800", marginTop: 10, textAlign: "center" }}>{b.title}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 2 }}>{b.desc}</Text>
                {!b.earned && (
                  <>
                    <View style={{ alignSelf: "stretch", height: 6, borderRadius: 3, backgroundColor: colors.border, marginTop: 10, overflow: "hidden" }}>
                      <View style={{ width: `${(b.value / b.goal) * 100}%`, height: 6, backgroundColor: colors.primary }} />
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>{b.value} / {b.goal}</Text>
                  </>
                )}
              </Card>
            ))}
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}
