import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, parse, wrap } from "../util";
import { circleMatesOf, notify } from "../services/notify";
import { sendSms, smsConfigured } from "../services/messaging";
import { fmtTime } from "../services/time";

export const checkinsRouter = Router();

const out = (c: { id: string; dueAt: Date; note: string | null; lat: number | null; lng: number | null; status: string; createdAt: Date; resolvedAt: Date | null }) => ({
  id: c.id, dueAt: c.dueAt, note: c.note, lat: c.lat, lng: c.lng, status: c.status, createdAt: c.createdAt, resolvedAt: c.resolvedAt,
});

const mapLink = (lat: number | null, lng: number | null) => (lat != null && lng != null ? `https://maps.google.com/?q=${lat},${lng}` : null);

// Safe-walk timer: "tell my family if I haven't said I'm safe by then".
checkinsRouter.post("/checkin", wrap(async (req, res) => {
  const b = parse(z.object({
    minutes: z.number().int().min(5).max(480), note: z.string().trim().max(120).optional(),
    lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(),
  }), req.body);
  if (await prisma.checkIn.findFirst({ where: { userId: req.userId, status: "active" } })) throw new HttpError(409, "You already have a check-in running");
  const c = await prisma.checkIn.create({ data: { userId: req.userId, dueAt: new Date(Date.now() + b.minutes * 60_000), note: b.note || null, lat: b.lat ?? null, lng: b.lng ?? null } });
  res.status(201).json(out(c));
}));

checkinsRouter.get("/checkin/active", wrap(async (req, res) => {
  // Also returns one that already alerted the family (within 12 hours), so the person can still say "I'm safe".
  const c = await prisma.checkIn.findFirst({ where: { userId: req.userId, status: { in: ["active", "alerted"] }, createdAt: { gte: new Date(Date.now() - 12 * 3600e3) } }, orderBy: { createdAt: "desc" } });
  res.json(c ? out(c) : null);
}));

// Add more time to a running check-in.
checkinsRouter.post("/checkin/:id/extend", wrap(async (req, res) => {
  const { minutes } = parse(z.object({ minutes: z.number().int().min(5).max(240) }), req.body);
  const c = await prisma.checkIn.findFirst({ where: { id: req.params.id, userId: req.userId, status: "active" } });
  if (!c) throw new HttpError(404, "No running check-in");
  const next = await prisma.checkIn.update({ where: { id: c.id }, data: { dueAt: new Date(Math.max(Date.now(), c.dueAt.getTime()) + minutes * 60_000) } });
  res.json(out(next));
}));

// "I'm safe": stops the timer. If the family was already alerted, tell them it's fine.
checkinsRouter.post("/checkin/:id/safe", wrap(async (req, res) => {
  const c = await prisma.checkIn.findFirst({ where: { id: req.params.id, userId: req.userId, status: { in: ["active", "alerted"] } } });
  if (!c) throw new HttpError(404, "No check-in to end");
  const next = await prisma.checkIn.update({ where: { id: c.id }, data: { status: "safe", resolvedAt: new Date() } });
  if (c.status === "alerted") {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { name: true } });
    await notify(await circleMatesOf(req.userId), { from: req.userId, kind: "checkin", title: `${me.name} is safe`, body: "They checked in after the timer ended.", data: { userId: req.userId } });
    if (smsConfigured()) {
      for (const sc of await prisma.sosContact.findMany({ where: { userId: req.userId } })) await sendSms(sc.phone, `✅ ${me.name} says they're safe.`).catch(() => undefined);
    }
  }
  res.json(out(next));
}));

/** Scheduler job: anyone whose timer ran out without a "safe" gets their family alerted (app + SMS to emergency contacts). */
export async function runCheckIns(now = new Date()) {
  let sent = 0;
  const due = await prisma.checkIn.findMany({ where: { status: "active", dueAt: { lte: now } }, include: { user: { select: { id: true, name: true, tzOffsetMin: true, location: { select: { lat: true, lng: true } } } } } });
  for (const c of due) {
    const claim = await prisma.checkIn.updateMany({ where: { id: c.id, status: "active" }, data: { status: "alerted" } });
    if (!claim.count) continue;
    const lat = c.user.location?.lat ?? c.lat, lng = c.user.location?.lng ?? c.lng;
    const link = mapLink(lat, lng);
    const mates = await circleMatesOf(c.userId);
    await notify(mates, {
      from: c.userId, kind: "checkin", urgent: true, title: `${c.user.name} hasn't checked in`,
      body: `Their safe-walk timer ended at ${fmtTime(c.dueAt, c.user.tzOffsetMin)}${c.note ? ` (${c.note})` : ""}. Try calling them.`,
      data: { userId: c.userId, screen: "/safety" },
    });
    if (smsConfigured()) {
      const text = `⚠️ ${c.user.name} set a safe-walk timer that ended at ${fmtTime(c.dueAt, c.user.tzOffsetMin)} and hasn't checked in.${link ? ` Last known place: ${link}` : ""} Please try calling them.`;
      for (const sc of await prisma.sosContact.findMany({ where: { userId: c.userId } })) await sendSms(sc.phone, text).catch(e => console.warn("[checkin] SMS failed:", (e as Error).message));
    }
    sent++;
  }
  return sent;
}
