import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, assertInCircle, canView, circleIdsOf, parse, publicUser, pulse, wrap } from "../util";
import { blockedIds } from "./moderation";
import { afterWorkout, sharedDistanceThisWeek } from "./challenges";

export const activitiesRouter = Router();

/**
 * Per-kind numbers. Calories use the standard MET formula for a 70 kg person (we don't know anyone's weight),
 * steps are estimated from distance, and maxKmh rejects workouts that couldn't be real (keeps the leaderboard fair).
 */
const KINDS = {
  walk: { met: 3.5, maxKmh: 12, stride: 0.75, label: "walk" },
  run: { met: 9.8, maxKmh: 26, stride: 1.05, label: "run" },
  cycle: { met: 7.5, maxKmh: 55, stride: 0, label: "ride" },
} as const;
type Kind = keyof typeof KINDS;

const MIN_DISTANCE_M = 50;
const MIN_SECONDS = 30;
const MAX_SECONDS = 12 * 3600;
const MAX_ROUTE_POINTS = 600;
const BACKFILL_DAYS = 2;

type Row = {
  id: string; userId: string; kind: string; title: string | null; note: string | null; startedAt: Date; durationSec: number;
  distanceM: number; calories: number; steps: number | null; shared: boolean; createdAt: Date;
};

const out = (a: Row) => ({
  id: a.id, userId: a.userId, kind: a.kind, title: a.title, note: a.note, startedAt: a.startedAt, durationSec: a.durationSec,
  distanceM: a.distanceM, calories: a.calories, steps: a.steps, shared: a.shared,
});

const point = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

activitiesRouter.post("/activities", wrap(async (req, res) => {
  const b = parse(z.object({
    kind: z.enum(["walk", "run", "cycle"]),
    title: z.string().trim().max(80).optional(), note: z.string().trim().max(300).optional(),
    startedAt: z.string().datetime(),
    durationSec: z.number().int().min(MIN_SECONDS, "That workout was too short to save").max(MAX_SECONDS),
    distanceM: z.number().int().min(MIN_DISTANCE_M, "Move a little further before saving").max(400_000),
    route: z.array(point).min(2).max(MAX_ROUTE_POINTS),
    shared: z.boolean().default(true),
  }), req.body);

  const k = KINDS[b.kind as Kind];
  const started = new Date(b.startedAt);
  if (started.getTime() > Date.now() + 5 * 60_000) throw new HttpError(400, "That workout starts in the future");
  if (started.getTime() < Date.now() - BACKFILL_DAYS * 86400e3) throw new HttpError(400, `Workouts must be saved within ${BACKFILL_DAYS} days`);
  const kmh = (b.distanceM / 1000) / (b.durationSec / 3600);
  if (kmh > k.maxKmh) throw new HttpError(400, `That's too fast for a ${k.label} (${kmh.toFixed(1)} km/h). Was the phone in a vehicle?`);

  const before = b.shared ? await sharedDistanceThisWeek(req.userId) : 0;
  const a = await prisma.activity.create({
    data: {
      userId: req.userId, kind: b.kind, title: b.title || null, note: b.note || null, startedAt: started,
      durationSec: b.durationSec, distanceM: b.distanceM, route: b.route, shared: b.shared,
      calories: Math.round(k.met * 70 * (b.durationSec / 3600)),
      steps: k.stride ? Math.round(b.distanceM / k.stride) : null,
    },
  });
  if (a.shared) await pulse(req.userId, "completed", `finished a ${(a.distanceM / 1000).toFixed(1)} km ${k.label}`);
  await afterWorkout(req.userId, a.shared ? before : Number.MAX_SAFE_INTEGER).catch(e => console.warn("[challenges] update failed:", (e as Error).message));
  res.status(201).json(out(a));
}));

/** My totals: last 7 days, today, and distance per day (days are the phone's local days: pass ?tz=<getTimezoneOffset()>). */
activitiesRouter.get("/activities/summary", wrap(async (req, res) => {
  const tz = Math.max(-840, Math.min(840, Number(req.query.tz ?? 0) || 0)); // minutes behind UTC, as JS reports it
  const dayKey = (d: Date) => new Date(d.getTime() - tz * 60_000).toISOString().slice(0, 10);
  const days = Array.from({ length: 7 }, (_, i) => dayKey(new Date(Date.now() - (6 - i) * 86400e3)));
  const rows = await prisma.activity.findMany({
    where: { userId: req.userId, startedAt: { gte: new Date(Date.now() - 8 * 86400e3) } },
    select: { startedAt: true, distanceM: true, durationSec: true, calories: true, steps: true },
  });
  const inWeek = rows.filter(r => days.includes(dayKey(r.startedAt)));
  const total = (list: typeof rows) => ({
    count: list.length, distanceM: list.reduce((s, r) => s + r.distanceM, 0), durationSec: list.reduce((s, r) => s + r.durationSec, 0),
    calories: list.reduce((s, r) => s + r.calories, 0), steps: list.reduce((s, r) => s + (r.steps ?? 0), 0),
  });
  res.json({
    week: total(inWeek), today: total(inWeek.filter(r => dayKey(r.startedAt) === days[6])),
    days: days.map(d => ({ date: d, distanceM: inWeek.filter(r => dayKey(r.startedAt) === d).reduce((s, r) => s + r.distanceM, 0) })),
  });
}));

// Recent workouts from me and the people in my circles (shared ones only for others).
activitiesRouter.get("/activities/feed", wrap(async (req, res) => {
  const mine = await circleIdsOf(req.userId);
  const blocked = new Set(await blockedIds(req.userId));
  const mates = await prisma.circleMember.findMany({ where: { circleId: { in: mine } }, select: { userId: true } });
  const ids = [...new Set(mates.map(m => m.userId))].filter(id => id === req.userId || !blocked.has(id));
  const rows = await prisma.activity.findMany({
    where: { userId: { in: [...ids, req.userId] }, startedAt: { gte: new Date(Date.now() - 30 * 86400e3) }, OR: [{ userId: req.userId }, { shared: true }] },
    orderBy: { startedAt: "desc" }, take: 30, include: { user: { select: publicUser } },
  });
  res.json(rows.map(r => ({ ...out(r), user: r.user })));
}));

// Who covered the most distance in a circle over the last 7 days (shared workouts only).
activitiesRouter.get("/activities/leaderboard", wrap(async (req, res) => {
  const { circleId } = parse(z.object({ circleId: z.string().min(1) }), req.query);
  await assertInCircle(req.userId, circleId);
  const members = await prisma.circleMember.findMany({ where: { circleId }, include: { user: { select: publicUser } } });
  const rows = await prisma.activity.findMany({
    where: { userId: { in: members.map(m => m.userId) }, shared: true, startedAt: { gte: new Date(Date.now() - 7 * 86400e3) } },
    select: { userId: true, distanceM: true, durationSec: true, steps: true },
  });
  const board = members.map(m => {
    const mine = rows.filter(r => r.userId === m.userId);
    return {
      user: m.user, count: mine.length, distanceM: mine.reduce((s, r) => s + r.distanceM, 0),
      durationSec: mine.reduce((s, r) => s + r.durationSec, 0), steps: mine.reduce((s, r) => s + (r.steps ?? 0), 0),
    };
  }).sort((a, b) => b.distanceM - a.distanceM || a.user.name.localeCompare(b.user.name));
  res.json(board);
}));

activitiesRouter.get("/activities/:id", wrap(async (req, res) => {
  const a = await prisma.activity.findUnique({ where: { id: req.params.id }, include: { user: { select: publicUser } } });
  if (!a) throw new HttpError(404, "Workout not found");
  if (a.userId !== req.userId) {
    const blocked = (await blockedIds(req.userId)).includes(a.userId);
    if (!a.shared || blocked || !(await canView(req.userId, a.userId))) throw new HttpError(404, "Workout not found");
  }
  res.json({ ...out(a), user: a.user, route: a.route });
}));

activitiesRouter.delete("/activities/:id", wrap(async (req, res) => {
  const r = await prisma.activity.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  if (!r.count) throw new HttpError(404, "Workout not found");
  res.status(204).end();
}));
