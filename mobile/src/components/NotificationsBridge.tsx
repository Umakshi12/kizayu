import { useEffect } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import { useQueryClient } from "@tanstack/react-query";
import { setBeforeSignOut, useAuth } from "../auth";
import { closeSocket, getSocket } from "../realtime";
import { registerForPush, routeFor, unregisterPush } from "../push";

/** Wires push + realtime for the signed-in user: registers the device, handles taps, refreshes data live. */
export function NotificationsBridge() {
  const { user } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!user) { closeSocket(); return; }
    setBeforeSignOut(async () => { await unregisterPush(); closeSocket(); });

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
