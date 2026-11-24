import { useEffect } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { setBeforeSignOut, useAuth } from "../auth";
import { closeSocket, getSocket } from "../realtime";
import { registerForPush, routeFor, unregisterPush } from "../push";
import { get } from "../api";
import { parseClock, syncReminders, type Reminder } from "../reminders";
import type { HealthOverview, Task } from "../types";

/** Wires push + realtime for the signed-in user: registers the device, handles taps, refreshes data live. */
export function NotificationsBridge() {
  const { user } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!user) { closeSocket(); return; }
    setBeforeSignOut(async () => { await unregisterPush(); await syncReminders([]); closeSocket(); });

    void registerForPush().then(r => { if (!r.ok) console.log("[push]", r.reason); });

    const socket = getSocket();
    const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] });
    socket?.on("notification", refresh);
    socket?.on("doctorMessage", () => {
      qc.invalidateQueries({ queryKey: ["doctor-messages"] });
      qc.invalidateQueries({ queryKey: ["doctor-threads"] });
    });

    let sub: Notifications.EventSubscription | undefined;
    if (Platform.OS !== "web") {
      sub = Notifications.addNotificationResponseReceivedListener(resp => {
        const to = routeFor(resp.notification.request.content.data as Record<string, unknown>);
        if (to) router.push(to as never);
      });
    }
    return () => {
      socket?.off("notification", refresh);
      socket?.off("doctorMessage");
      sub?.remove();
    };
  }, [user?.id, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/** Schedules a daily phone reminder for every medicine with a reminder time and every task with a time. */
export function RemindersBridge() {
  const { user } = useAuth();
  const health = useQuery({ queryKey: ["health", user?.id], enabled: !!user, queryFn: () => get<HealthOverview>(`/health/${user!.id}`) });
  const tasks = useQuery({ queryKey: ["tasks"], enabled: !!user, queryFn: () => get<{ items: Task[]; remaining: number }>("/tasks") });

  const list: Reminder[] = [];
  for (const m of health.data?.medications ?? []) {
    const t = parseClock(m.remindAt);
    if (t) list.push({ id: `med-${m.id}`, title: `Time for ${m.name}`, body: m.schedule, ...t });
  }
  for (const k of tasks.data?.items ?? []) {
    const t = parseClock(k.dueTime);
    if (t) list.push({ id: `task-${k.id}`, title: k.title, body: "From your Kizayu day plan", ...t });
  }
  const signature = JSON.stringify(list.map(r => [r.id, r.title, r.hour, r.minute]));

  useEffect(() => {
    if (!user) { void syncReminders([]); return; }
    if (health.isSuccess && tasks.isSuccess) void syncReminders(list);
  }, [user?.id, signature, health.isSuccess, tasks.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
