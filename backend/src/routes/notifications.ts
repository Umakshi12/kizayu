import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { parse, wrap } from "../util";

export const notificationsRouter = Router();

// Device registers its Expo push token after the user grants notification permission.
notificationsRouter.post("/push/register", wrap(async (req, res) => {
  const b = parse(z.object({
    token: z.string().regex(/^Expo(nent)?PushToken\[.+\]$/, "Not an Expo push token"),
    platform: z.enum(["ios", "android"]),
  }), req.body);
  // A token belongs to one device; if another account used this device before, move it.
  await prisma.pushToken.upsert({ where: { token: b.token }, update: { userId: req.userId, platform: b.platform }, create: { ...b, userId: req.userId } });
  res.json({ ok: true });
}));

notificationsRouter.post("/push/unregister", wrap(async (req, res) => {
  const { token } = parse(z.object({ token: z.string() }), req.body);
  await prisma.pushToken.deleteMany({ where: { token, userId: req.userId } });
  res.json({ ok: true });
}));

notificationsRouter.get("/notifications", wrap(async (req, res) => {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.notification.count({ where: { userId: req.userId, readAt: null } }),
  ]);
  res.json({ items: items.map(n => ({ ...n, data: JSON.parse(n.data) })), unread });
}));

notificationsRouter.post("/notifications/read", wrap(async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(z.string()).optional() }), req.body);
  await prisma.notification.updateMany({ where: { userId: req.userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
  res.json({ ok: true });
}));
