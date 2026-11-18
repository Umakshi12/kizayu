import { useQuery } from "@tanstack/react-query";
import { get } from "./api";
import type { AppNotification, PlansResponse } from "./types";

/** Notifications inbox + unread count (refreshed live by NotificationsBridge via the socket). */
export const useNotifications = () =>
  useQuery({ queryKey: ["notifications"], queryFn: () => get<{ items: AppNotification[]; unread: number }>("/notifications"), refetchInterval: 60_000 });

/** Premium plans + whether Premium is switched on (it's off until store billing is connected). */
export const usePremiumPlans = () =>
  useQuery({ queryKey: ["premium-plans"], queryFn: () => get<PlansResponse>("/premium/plans"), staleTime: 5 * 60_000 });
