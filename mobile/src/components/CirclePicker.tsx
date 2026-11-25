import { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { get } from "../api";
import { useAuth } from "../auth";
import { Pill } from "./ui";
import type { Circle } from "../types";

/** The circle a screen is showing (defaults to the family circle), plus whether I'm an owner (parent) of it. */
export function useCircle() {
  const { user } = useAuth();
  const circles = useQuery({ queryKey: ["circles"], queryFn: () => get<Circle[]>("/circles") });
  const [circleId, setCircleId] = useState<string | null>(null);
  useEffect(() => {
    if (!circleId && circles.data?.length) setCircleId((circles.data.find(c => c.type === "Family") ?? circles.data[0]).id);
  }, [circles.data, circleId]);
  const circle = circles.data?.find(c => c.id === circleId) ?? null;
  const isOwner = !!circle?.members.find(m => m.id === user?.id && m.role === "owner");
  return { circles, circle, circleId, setCircleId, isOwner };
}

/** Pills to switch circle, shown only when there's more than one. */
export function CirclePills({ circles, circleId, onChange }: { circles?: Circle[]; circleId: string | null; onChange: (id: string) => void }) {
  if ((circles?.length ?? 0) < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
      {circles!.map(c => <Pill key={c.id} label={c.name} active={c.id === circleId} onPress={() => onChange(c.id)} />)}
    </ScrollView>
  );
}
