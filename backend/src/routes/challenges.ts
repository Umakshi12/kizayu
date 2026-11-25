import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, assertInCircle, parse, publicUser, roleIn, wrap } from "../util";
import { notify } from "../services/notify";
import { bestStreakOf } from "./habits";

export const challengesRouter = Router();

const DAY = 86400e3;

/** Everyone's progress in one challenge (shared workouts inside its dates only). */
async function progressFor(c: { circleId: string; metric: string; startsAt: Date; endsAt: Date }) {
  const members = await prisma.circleMember.findMany({ where: { circleId: c.circleId }, include: { user: { select: publicUser } } });
  const acts = await prisma.activity.findMany({
    where: { userId: { in: members.map(m => m.userId) }, shared: true, startedAt: { gte: c.startsAt, lte: c.endsAt } },
    select: { userId: true, distanceM: true },
  });
  return members.map(m => {
    const mine = acts.filter(a => a.userId === m.userId);
    return { user: m.user, value: c.metric === "distance" ? mine.reduce((s, a) => s + a.distanceM, 0) : mine.length };
  }).sort((a, b) => b.value - a.value);
}

challengesRouter.get("/challenges", wrap(async (req, res) => {
  const { circleId } = parse(z.object({ circleId: z.string() }), req.query);
  await assertInCircle(req.userId, circleId);
  const rows = await prisma.challenge.findMany({ where: { circleId, endsAt: { gte: new Date(Date.now() - 14 * DAY) } }, orderBy: { endsAt: "asc" }, include: { wins: true } });
  const out = [];
  for (const c of rows) {
    const standings = await progressFor(c);
    const winners = new Set(c.wins.map(w => w.userId));
    out.push({
      id: c.id, title: c.title, metric: c.metric, target: c.target, startsAt: c.startsAt, endsAt: c.endsAt, createdById: c.createdById,
      active: c.endsAt.getTime() >= Date.now(),
      standings: standings.map(s => ({ ...s, done: s.value >= c.target || winners.has(s.user.id) })),
      mine: standings.find(s => s.user.id === req.userId)?.value ?? 0,
    });
  }
  res.json(out);
}));

challengesRouter.post("/challenges", wrap(async (req, res) => {
  const b = parse(z.object({
    circleId: z.string(), title: z.string().trim().min(1).max(60), metric: z.enum(["distance", "workouts"]),
    target: z.number().int().min(1).max(1_000_000), days: z.number().int().min(1).max(60),
  }), req.body);
  await assertInCircle(req.userId, b.circleId);
  if (b.metric === "workouts" && b.target > 200) throw new HttpError(400, "That's a lot of workouts. Try a smaller goal");
  if (b.metric === "distance" && b.target < 100) throw new HttpError(400, "Distance goals are in metres, at least 100");
  if ((await prisma.challenge.count({ where: { circleId: b.circleId, endsAt: { gte: new Date() } } })) >= 5) throw new HttpError(400, "A circle can run 5 challenges at a time");
  const now = new Date();
  const c = await prisma.challenge.create({ data: { circleId: b.circleId, createdById: req.userId, title: b.title, metric: b.metric, target: b.target, startsAt: now, endsAt: new Date(now.getTime() + b.days * DAY) } });
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { name: true } });
  const mates = (await prisma.circleMember.findMany({ where: { circleId: b.circleId }, select: { userId: true } })).map(m => m.userId).filter(id => id !== req.userId);
  await notify(mates, { from: req.userId, kind: "fitness", title: `${me.name} started a challenge`, body: `${c.title}: ${b.metric === "distance" ? `${(b.target / 1000).toFixed(b.target % 1000 ? 1 : 0)} km` : `${b.target} workouts`} in ${b.days} day${b.days > 1 ? "s" : ""}`, data: { screen: "/fitness" } });
  res.status(201).json({ id: c.id });
}));

challengesRouter.delete("/challenges/:id", wrap(async (req, res) => {
  const c = await prisma.challenge.findUnique({ where: { id: req.params.id } });
  if (!c || !(await roleIn(req.userId, c.circleId))) throw new HttpError(404, "Challenge not found");
  if (c.createdById !== req.userId && (await roleIn(req.userId, c.circleId)) !== "owner") throw new HttpError(403, "Only the person who started it or a circle owner can remove it");
  await prisma.challenge.delete({ where: { id: c.id } });
  res.status(204).end();
}));

/** After a workout is saved: finish any challenge the person just completed, and tell people they just overtook this week. */
export async function afterWorkout(userId: string, distanceBefore: number) {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  const memberships = await prisma.circleMember.findMany({ where: { userId }, select: { circleId: true } });
  const circleIds = memberships.map(m => m.circleId);
  const active = await prisma.challenge.findMany({ where: { circleId: { in: circleIds }, startsAt: { lte: new Date() }, endsAt: { gte: new Date() } }, include: { wins: { where: { userId } } } });
  for (const c of active) {
    if (c.wins.length) continue;
    const mine = (await progressFor(c)).find(s => s.user.id === userId)?.value ?? 0;
    if (mine < c.target) continue;
    try { await prisma.challengeWin.create({ data: { challengeId: c.id, userId } }); } catch { continue; } // already recorded by a parallel save
    const mates = (await prisma.circleMember.findMany({ where: { circleId: c.circleId }, select: { userId: true } })).map(m => m.userId).filter(id => id !== userId);
    await notify([userId], { kind: "fitness", title: "Challenge complete 🏆", body: `You finished "${c.title}"`, data: { screen: "/fitness" } });
    await notify(mates, { from: userId, kind: "fitness", title: `${me.name} finished a challenge`, body: c.title, data: { screen: "/fitness" } });
  }
  // "X passed you": last 7 days of shared distance
  const since = new Date(Date.now() - 7 * DAY);
  const mateIds = (await prisma.circleMember.findMany({ where: { circleId: { in: circleIds }, userId: { not: userId } }, select: { userId: true } })).map(m => m.userId);
  if (!mateIds.length) return;
  const rows = await prisma.activity.groupBy({ by: ["userId"], where: { userId: { in: [...new Set(mateIds)] }, shared: true, startedAt: { gte: since } }, _sum: { distanceM: true } });
  const after = (await prisma.activity.aggregate({ where: { userId, shared: true, startedAt: { gte: since } }, _sum: { distanceM: true } }))._sum.distanceM ?? 0;
  const passed = rows.filter(r => (r._sum.distanceM ?? 0) > 0 && (r._sum.distanceM ?? 0) >= distanceBefore && (r._sum.distanceM ?? 0) < after).map(r => r.userId);
  if (passed.length) await notify(passed, { from: userId, kind: "fitness", title: `${me.name} just passed you`, body: "On this week's distance board. Time for a walk?", data: { screen: "/fitness" } });
}

export async function sharedDistanceThisWeek(userId: string) {
  return (await prisma.activity.aggregate({ where: { userId, shared: true, startedAt: { gte: new Date(Date.now() - 7 * DAY) } }, _sum: { distanceM: true } }))._sum.distanceM ?? 0;
}

// Badges are worked out from what the person has already done, so there's nothing to keep in sync.
challengesRouter.get("/badges", wrap(async (req, res) => {
  const uid = req.userId;
  const [acts, wins, habits, chores, posts] = await Promise.all([
    prisma.activity.aggregate({ where: { userId: uid }, _count: true, _sum: { distanceM: true } }),
    prisma.challengeWin.count({ where: { userId: uid } }),
    prisma.habit.findMany({ where: { userId: uid }, include: { logs: { select: { date: true, count: true } } } }),
    prisma.choreDone.count({ where: { userId: uid, status: "approved" } }),
    prisma.post.count({ where: { authorId: uid } }),
  ]);
  const km = Math.floor((acts._sum.distanceM ?? 0) / 1000);
  const bestHabit = Math.max(0, ...habits.map(h => bestStreakOf(h.logs, h.target)));
  const def = (id: string, title: string, desc: string, icon: string, value: number, goal: number) => ({ id, title, desc, icon, value: Math.min(value, goal), goal, earned: value >= goal });
  res.json([
    def("first-steps", "First steps", "Save your first workout", "footsteps", acts._count, 1),
    def("ten-workouts", "Regular mover", "Save 10 workouts", "walk", acts._count, 10),
    def("hundred-km", "100 km club", "Cover 100 km in total", "trail-sign", km, 100),
    def("streak-7", "One good week", "Keep a habit going for 7 days", "flame", bestHabit, 7),
    def("streak-30", "Habit master", "Keep a habit going for 30 days", "ribbon", bestHabit, 30),
    def("challenge-win", "Challenger", "Finish a family challenge", "trophy", wins, 1),
    def("helper", "Family helper", "Get 10 chores approved", "hand-left", chores, 10),
    def("memory-maker", "Memory maker", "Share 5 photos or posts", "camera", posts, 5),
  ]);
}));
