import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, assertInCircle, parse, publicUser, pulse, today, wrap } from "../util";

export const dayRouter = Router();

// Tasks repeat daily: reset progress when the stored date is not today.
async function resetStale(userId: string) {
  await prisma.task.updateMany({
    where: { userId, OR: [{ doneDate: null }, { doneDate: { not: today() } }] },
    data: { doneCount: 0, doneDate: today() },
  });
}

dayRouter.get("/tasks", wrap(async (req, res) => {
  await resetStale(req.userId);
  const tasks = await prisma.task.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "asc" } });
  res.json({
    items: tasks.map(t => ({ ...t, done: t.doneCount >= t.targetCount })),
    remaining: tasks.filter(t => t.doneCount < t.targetCount).length,
  });
}));

dayRouter.post("/tasks", wrap(async (req, res) => {
  const b = parse(z.object({
    title: z.string().min(1),
    subtitle: z.string().optional(),
    icon: z.enum(["pill", "apple", "water", "walk", "check"]).default("check"),
    dueTime: z.string().optional(),
    targetCount: z.number().int().min(1).default(1),
  }), req.body);
  const t = await prisma.task.create({ data: { ...b, userId: req.userId, doneDate: today() } });
  res.status(201).json(t);
}));

dayRouter.post("/tasks/:id/done", wrap(async (req, res) => {
  await resetStale(req.userId);
  const t = await prisma.task.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!t) throw new HttpError(404, "Task not found");
  if (t.doneCount >= t.targetCount) return res.json({ ...t, done: true });
  const u = await prisma.task.update({ where: { id: t.id }, data: { doneCount: { increment: 1 } } });
  const done = u.doneCount >= u.targetCount;
  if (done) await pulse(req.userId, "completed", `completed "${t.title}"`);
  res.json({ ...u, done });
}));

dayRouter.delete("/tasks/:id", wrap(async (req, res) => {
  await prisma.task.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  res.status(204).end();
}));

dayRouter.get("/appointments", wrap(async (req, res) => {
  const items = await prisma.appointment.findMany({
    where: { userId: req.userId, startsAt: { gte: new Date() } },
    orderBy: { startsAt: "asc" },
  });
  res.json(items);
}));

dayRouter.post("/appointments", wrap(async (req, res) => {
  const b = parse(z.object({
    title: z.string().min(1),
    kind: z.enum(["doctor", "call", "other"]).default("other"),
    startsAt: z.coerce.date(),
  }), req.body);
  const a = await prisma.appointment.create({ data: { ...b, userId: req.userId } });
  if (b.kind === "doctor") await pulse(req.userId, "appointment", `has a doctor appointment on ${b.startsAt.toDateString()}`);
  res.status(201).json(a);
}));

dayRouter.delete("/appointments/:id", wrap(async (req, res) => {
  await prisma.appointment.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  res.status(204).end();
}));

// Family Pulse for a circle: members with status, recent events, and an overall summary.
dayRouter.get("/pulse/:circleId", wrap(async (req, res) => {
  await assertInCircle(req.userId, req.params.circleId);
  const [members, events] = await Promise.all([
    prisma.circleMember.findMany({ where: { circleId: req.params.circleId }, include: { user: { select: publicUser } } }),
    prisma.pulseEvent.findMany({
      where: { circleId: req.params.circleId }, orderBy: { createdAt: "desc" }, take: 30,
      include: { user: { select: publicUser } },
    }),
  ]);
  const alerts = events.filter(e => e.kind === "alert" && Date.now() - +e.createdAt < 24 * 3600e3);
  res.json({ members: members.map(m => m.user), events, summary: alerts.length ? "needs_attention" : "all_good" });
}));
