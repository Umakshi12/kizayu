import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { parse, wrap } from "../util";

export const prefsRouter = Router();

const FLAGS = ["chat", "comments", "events", "care", "nudges", "fitness", "chores"] as const;

// The app tells the server its timezone on every launch, so "today", reminders and nudges use the user's real day.
prefsRouter.put("/prefs/timezone", wrap(async (req, res) => {
  const { offsetMin } = parse(z.object({ offsetMin: z.number().int().min(-840).max(840) }), req.body);
  if (offsetMin !== req.tz) await prisma.user.update({ where: { id: req.userId }, data: { tzOffsetMin: offsetMin } });
  res.json({ offsetMin });
}));

prefsRouter.get("/prefs/notifications", wrap(async (req, res) => {
  const p = await prisma.notifyPrefs.findUnique({ where: { userId: req.userId } });
  res.json(Object.fromEntries(FLAGS.map(f => [f, p ? p[f] : true])));
}));

prefsRouter.put("/prefs/notifications", wrap(async (req, res) => {
  const b = parse(z.object(Object.fromEntries(FLAGS.map(f => [f, z.boolean().optional()]))), req.body);
  const p = await prisma.notifyPrefs.upsert({ where: { userId: req.userId }, update: b, create: { userId: req.userId, ...b } });
  res.json(Object.fromEntries(FLAGS.map(f => [f, p[f]])));
}));
