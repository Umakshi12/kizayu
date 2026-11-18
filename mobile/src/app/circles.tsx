import { useState } from "react";
import { Pressable, ScrollView, Share, View } from "react-native";
import { Text } from "../components/Text";
import { showAlert, showError } from "../alert";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../api";
import { APP_NAME } from "../config";
import { Avatar, Button, Card, Empty, ErrorView, Field, Header, Loading, Screen, SectionHeader, Pill } from "../components/ui";
import { colors, radius } from "../theme";
import type { Circle } from "../types";

const TYPES = ["Family", "Friends", "Relatives"] as const;

export default function Circles() {
  const qc = useQueryClient();
  const circles = useQuery({ queryKey: ["circles"], queryFn: () => get<Circle[]>("/circles") });
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]>("Family");
  const refresh = () => { qc.invalidateQueries(); };

  const join = useMutation({
    mutationFn: () => post<Circle>("/circles/join", { code: code.trim() }),
    onSuccess: c => { setCode(""); refresh(); showAlert("Joined", `You're now in ${c.name}.`); },
    onError: e => showAlert("Couldn't join", e instanceof Error ? e.message : "Try again"),
  });
  const create = useMutation({
    mutationFn: () => post("/circles", { name: name.trim(), type }),
    onSuccess: () => { setName(""); refresh(); },
    onError: e => showError("Couldn't create", e),
  });

  return (
    <Screen>
      <Header title="My Circles" back />
      {circles.isLoading ? <Loading /> : circles.error ? <ErrorView error={circles.error} onRetry={() => circles.refetch()} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          {(circles.data?.length ?? 0) === 0 && <Empty icon="people-outline" text="You're not in any circle yet." />}
          {circles.data?.map(c => (
            <Card key={c.id} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name={c.type === "Family" ? "home" : c.type === "Friends" ? "happy" : "people"} size={22} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "800", fontSize: 17, color: colors.text }}>{c.name}</Text>
                  <Text style={{ color: colors.muted }}>{c.type} • {c.members.length} member{c.members.length === 1 ? "" : "s"}</Text>
                </View>
                <Pressable onPress={() => router.push(`/chat/${c.id}`)} accessibilityLabel={`Open ${c.name} chat`} hitSlop={8}>
                  <Ionicons name="chatbubbles" size={26} color={colors.primary} />
                </Pressable>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
                {c.members.map(m => (
                  <Pressable key={m.id} onPress={() => router.push(`/health/${m.id}`)} style={{ alignItems: "center", width: 56 }}>
                    <Avatar uri={m.avatarUrl} name={m.name} size={44} status={m.status} />
                    <Text numberOfLines={1} style={{ fontSize: 11, marginTop: 2, color: colors.text }}>{m.name}</Text>
                  </Pressable>
                ))}
              </View>
              <Button title="Invite someone" icon="share-social" variant="soft" style={{ marginTop: 12 }}
                onPress={() => Share.share({ message: `Join my ${c.type.toLowerCase()} circle "${c.name}" on ${APP_NAME}! Use invite code: ${c.inviteCode}` })} />
            </Card>
          ))}

          <SectionHeader title="Join a circle" />
          <Field label="Invite code" value={code} onChangeText={setCode} placeholder="Paste the code you received" />
          <Button title="Join" onPress={() => join.mutate()} loading={join.isPending} disabled={!code.trim()} />

          <SectionHeader title="Create a circle" />
          <Field label="Circle name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="Weekend Cousins" />
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
            {TYPES.map(t => (
              <Pill key={t} label={t} active={type === t} onPress={() => setType(t)} />
            ))}
          </View>
          <Button title="Create circle" onPress={() => create.mutate()} loading={create.isPending} disabled={!name.trim()} />
        </ScrollView>
      )}
    </Screen>
  );
}
