import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, assertInCircle, circleIdsOf, parse, publicUser, pulse, wrap } from "../util";
import { sendMessage } from "./chat";
import { circleMatesOf, notify } from "../services/notify";
import { limitsFor } from "../services/premium";

export const safetyRouter = Router();

const HOME_RADIUS_M = 150;

function distanceM(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const settingsOut = (s: { homeAlerts: boolean; sosAlert: boolean; shareJourney: boolean; sosRecording: boolean; homeLat: number | null; homeLng: number | null }) => s;

safetyRouter.get("/safety", wrap(async (req, res) => {
  const s = await prisma.safetySetting.upsert({ where: { userId: req.userId }, update: {}, create: { userId: req.userId } });
  res.json(settingsOut(s));
}));

safetyRouter.put("/safety", wrap(async (req, res) => {
  const b = parse(z.object({
    homeAlerts: z.boolean().optional(), sosAlert: z.boolean().optional(), shareJourney: z.boolean().optional(), sosRecording: z.boolean().optional(),
    homeLat: z.number().min(-90).max(90).nullable().optional(), homeLng: z.number().min(-180).max(180).nullable().optional(),
  }), req.body);
  const s = await prisma.safetySetting.upsert({ where: { userId: req.userId }, update: b, create: { userId: req.userId, ...b } });
  res.json(settingsOut(s));
}));

// Device reports its position. Triggers an "arrived home" alert when entering the home radius.
safetyRouter.put("/location", wrap(async (req, res) => {
  const b = parse(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }), req.body);
  const [prev, settings] = await Promise.all([
    prisma.locationShare.findUnique({ where: { userId: req.userId } }),
    prisma.safetySetting.findUnique({ where: { userId: req.userId } }),
  ]);
  let label: string | null = null;
  if (settings?.homeLat != null && settings.homeLng != null) {
    const atHome = distanceM(b.lat, b.lng, settings.homeLat, settings.homeLng) <= HOME_RADIUS_M;
    label = atHome ? "At Home" : null;
    if (atHome && prev?.label !== "At Home" && settings.homeAlerts) {
      await pulse(req.userId, "completed", "arrived home safely");
      const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
      await notify(await circleMatesOf(req.userId), { from: req.userId, kind: "home", title: `${me.name} arrived home`, body: "Arrived home safely 🏠", data: { screen: "safety" } });
    }
  }
  const loc = await prisma.locationShare.upsert({
    where: { userId: req.userId }, update: { ...b, label }, create: { userId: req.userId, ...b, label },
  });
  res.json(loc);
}));

safetyRouter.post("/location/share", wrap(async (req, res) => {
  const b = parse(z.object({ circleId: z.string(), hours: z.number().min(0.25).max(24).default(4) }), req.body);
  await assertInCircle(req.userId, b.circleId);
  const limits = await limitsFor(req.userId);
  if (b.hours > limits.locationShareHours) throw new HttpError(402, `Sharing for more than ${limits.locationShareHours} hours needs Kizayu Premium`);
  const loc = await prisma.locationShare.findUnique({ where: { userId: req.userId } });
  if (!loc) throw new HttpError(409, "Send your location first");
  const sharingUntil = new Date(Date.now() + b.hours * 3600e3);
  res.json(await prisma.locationShare.update({ where: { userId: req.userId }, data: { sharingWith: b.circleId, sharingUntil } }));
}));

safetyRouter.post("/location/stop", wrap(async (req, res) => {
  await prisma.locationShare.updateMany({ where: { userId: req.userId }, data: { sharingWith: null, sharingUntil: null } });
  res.json({ sharing: false });
}));

// Members of a circle who are actively sharing their location with it.
safetyRouter.get("/location/circle/:id", wrap(async (req, res) => {
  await assertInCircle(req.userId, req.params.id);
  const shares = await prisma.locationShare.findMany({
    where: { sharingWith: req.params.id, sharingUntil: { gt: new Date() } },
    include: { user: { select: publicUser } },
  });
  res.json(shares.map(s => ({ user: s.user, lat: s.lat, lng: s.lng, label: s.label, updatedAt: s.updatedAt, sharingUntil: s.sharingUntil })));
}));

safetyRouter.post("/safety/sos", wrap(async (req, res) => {
  const settings = await prisma.safetySetting.findUnique({ where: { userId: req.userId } });
  if (settings && !settings.sosAlert) throw new HttpError(409, "SOS alerts are turned off in your settings");
  const b = parse(z.object({ lat: z.number().optional(), lng: z.number().optional() }), req.body ?? {});
  const where = b.lat != null && b.lng != null ? ` Location: https://www.openstreetmap.org/?mlat=${b.lat}&mlon=${b.lng}#map=17/${b.lat}/${b.lng}` : "";
  const ids = await circleIdsOf(req.userId);
  await pulse(req.userId, "alert", "sent an SOS alert");
  for (const id of ids) await sendMessage(id, req.userId, `SOS! I need help.${where}`, undefined, { silent: true });
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  const mates = await circleMatesOf(req.userId);
  await notify(mates, {
    kind: "sos", urgent: true, title: `🚨 SOS from ${me.name}`, body: where ? "Tap to see their location" : "They need help now",
    data: { screen: "safety", ...(b.lat != null && b.lng != null ? { lat: String(b.lat), lng: String(b.lng) } : {}) },
  });
  res.json({ notifiedCircles: ids.length, notifiedPeople: mates.length });
}));
