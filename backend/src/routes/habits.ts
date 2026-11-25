import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, parse, wrap } from "../util";

export const habitsRouter = Router();

const MAX_HABITS = 12;
const ICONS = ["star", "water", "walk", "book", "bed", "fitness", "heart", "leaf", "nutrition", "medkit", "sunny", "musical-notes"] as const;
const hhmm = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Time must look like 07:30");

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

type Log = { date: string; count: number };

/** Consecutive completed days. A streak is still alive today if yesterday was completed and today isn't finished yet. */
export function streakOf(logs: Log[], target: number, today: string): number {
  const done = new Set(logs.filter(l => l.count >= target).map(l => l.date));
  let day = done.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (done.has(day)) { n++; day = addDays(day, -1); }
  return n;
}

/** Longest run of completed days ever. */
export function bestStreakOf(logs: Log[], target: number): number {
  const days = logs.filter(l => l.count >= target).map(l => l.date).sort();
  let best = 0, run = 0, prev = "";
  for (const d of days) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return best;
}

type HabitRow = { id: string; title: string; icon: string; target: number; remindAt: string | null; logs: Log[] };

function view(h: HabitRow, today: string) {
  const byDate = new Map(h.logs.map(l => [l.date, l.count]));
  const todayCount = byDate.get(today) ?? 0;
  return {
    id: h.id, title: h.title, icon: h.icon, target: h.target, remindAt: h.remindAt,
    todayCount, doneToday: todayCount >= h.target, streak: streakOf(h.logs, h.target, today), best: bestStreakOf(h.logs, h.target),
    last7: Array.from({ length: 7 }, (_, i) => { const date = addDays(today, i - 6); const count = byDate.get(date) ?? 0; return { date, count, done: count >= h.target }; }),
  };
}

const loadHabits = (userId: string, where: object = {}) => prisma.habit.findMany({
  where: { userId, archived: false, ...where }, orderBy: { createdAt: "asc" },
  include: { logs: { where: { date: { gte: addDays(new Date().toISOString().slice(0, 10), -400) } }, select: { date: true, count: true } } },
});

habitsRouter.get("/habits", wrap(async (req, res) => {
  res.json((await loadHabits(req.userId)).map(h => view(h, req.today)));
}));

habitsRouter.post("/habits", wrap(async (req, res) => {
  const b = parse(z.object({ title: z.string().trim().min(1).max(60), icon: z.enum(ICONS).default("star"), target: z.number().int().min(1).max(20).default(1), remindAt: hhmm.optional() }), req.body);
  if ((await prisma.habit.count({ where: { userId: req.userId, archived: false } })) >= MAX_HABITS) throw new HttpError(400, `You can track up to ${MAX_HABITS} habits`);
  const h = await prisma.habit.create({ data: { userId: req.userId, ...b }, include: { logs: { select: { date: true, count: true } } } });
  res.status(201).json(view(h, req.today));
}));

habitsRouter.patch("/habits/:id", wrap(async (req, res) => {
  const b = parse(z.object({
    title: z.string().trim().min(1).max(60).optional(), icon: z.enum(ICONS).optional(), target: z.number().int().min(1).max(20).optional(),
    remindAt: hhmm.nullable().optional(), archived: z.boolean().optional(),
  }), req.body);
  const own = await prisma.habit.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!own) throw new HttpError(404, "Habit not found");
  const h = await prisma.habit.update({ where: { id: own.id }, data: b, include: { logs: { select: { date: true, count: true } } } });
  res.json(view(h, req.today));
}));

habitsRouter.delete("/habits/:id", wrap(async (req, res) => {
  const r = await prisma.habit.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  if (!r.count) throw new HttpError(404, "Habit not found");
  res.status(204).end();
}));

// Tick a habit for today (or yesterday, to catch up). Multi-times-a-day habits count up; undo steps back.
habitsRouter.post("/habits/:id/check", wrap(async (req, res) => {
  const b = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), undo: z.boolean().optional() }), req.body ?? {});
  const date = b.date ?? req.today;
  if (date !== req.today && date !== addDays(req.today, -1)) throw new HttpError(400, "You can only update today or yesterday");
  const h = await prisma.habit.findFirst({ where: { id: req.params.id, userId: req.userId, archived: false } });
  if (!h) throw new HttpError(404, "Habit not found");
  const cur = await prisma.habitLog.findUnique({ where: { habitId_date: { habitId: h.id, date } } });
  const next = b.undo ? Math.max(0, (cur?.count ?? 0) - 1) : Math.min(h.target, (cur?.count ?? 0) + 1);
  if (next === 0) await prisma.habitLog.deleteMany({ where: { habitId: h.id, date } });
  else await prisma.habitLog.upsert({ where: { habitId_date: { habitId: h.id, date } }, update: { count: next }, create: { habitId: h.id, date, count: next } });
  const fresh = (await loadHabits(req.userId, { id: h.id }))[0];
  res.json(view(fresh, req.today));
}));
