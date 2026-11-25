import type { Server } from "socket.io";
import { EXPO_ACCESS_TOKEN, EXPO_PUSH_URL } from "../config";
import { prisma } from "../db";

let io: Server | null = null;
export const setNotifyIo = (s: Server) => { io = s; };
export const userRoom = (userId: string) => `user:${userId}`;

export interface NotifyInput {
  /** Who caused it. People who blocked this user don't get the notification. */
  from?: string;
  kind: "chat" | "sos" | "comment" | "doctor" | "home" | "system" | "event" | "nudge" | "care" | "fitness" | "chores" | "checkin" | "memory";
  title: string;
  body: string;
  data?: Record<string, string>;
  urgent?: boolean;
}

/**
 * Which preference switch controls each kind of notification. SOS, check-in, doctor and system messages are safety or
 * direct messages and can't be switched off.
 */
export const PREF_FOR_KIND: Partial<Record<NotifyInput["kind"], "chat" | "comments" | "events" | "care" | "nudges" | "fitness" | "chores">> = {
  chat: "chat", comment: "comments", event: "events", care: "care", home: "care", nudge: "nudges", memory: "nudges", fitness: "fitness", chores: "chores",
};

/**
 * Notify users: stores an in-app notification, emits it over the socket, and sends an Expo push
 * to every registered device. Push failures never break the calling request.
 */
export async function notify(userIds: string[], n: NotifyInput) {
  let ids = [...new Set(userIds)];
  if (n.from) {
    const blockers = new Set((await prisma.block.findMany({ where: { blockedId: n.from, blockerId: { in: ids } }, select: { blockerId: true } })).map(b => b.blockerId));
    ids = ids.filter(id => !blockers.has(id));
  }
  const pref = PREF_FOR_KIND[n.kind];
  if (pref && ids.length) {
    const off = await prisma.notifyPrefs.findMany({ where: { userId: { in: ids }, [pref]: false } as never, select: { userId: true } });
    const offSet = new Set(off.map(o => o.userId));
    ids = ids.filter(id => !offSet.has(id));
  }
  if (!ids.length) return;
  const data = JSON.stringify(n.data ?? {});
  await prisma.notification.createMany({ data: ids.map(userId => ({ userId, kind: n.kind, title: n.title, body: n.body, data })) });
  for (const id of ids) io?.to(userRoom(id)).emit("notification", { kind: n.kind, title: n.title, body: n.body, data: n.data ?? {} });

  const tokens = await prisma.pushToken.findMany({ where: { userId: { in: ids } } });
  if (!tokens.length) return;
  const messages = tokens.map(t => ({
    to: t.token, title: n.title, body: n.body, data: { ...n.data, kind: n.kind },
    sound: "default", priority: n.urgent ? "high" : "default", channelId: n.urgent ? "urgent" : "default",
  }));
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json", accept: "application/json",
          ...(EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(batch),
      });
      const json = (await res.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null;
      // Remove tokens for uninstalled apps so we stop sending to them.
      const dead = (json?.data ?? [])
        .map((r, k) => (r.status === "error" && r.details?.error === "DeviceNotRegistered" ? batch[k].to : null))
        .filter((t): t is string => !!t);
      if (dead.length) await prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
    } catch (e) {
      console.warn("[push] send failed:", (e as Error).message);
    }
  }
}

/** Everyone sharing a circle with this user, excluding the user. */
export async function circleMatesOf(userId: string, circleId?: string) {
  const mine = circleId ? [circleId] : (await prisma.circleMember.findMany({ where: { userId }, select: { circleId: true } })).map(r => r.circleId);
  const rows = await prisma.circleMember.findMany({ where: { circleId: { in: mine }, userId: { not: userId } }, select: { userId: true } });
  return [...new Set(rows.map(r => r.userId))];
}
