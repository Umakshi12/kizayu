import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, canView, parse, pulse, today, wrap } from "../util";
import { limitsFor } from "../services/premium";

export const healthRouter = Router();

const VITAL_TYPES = ["heart_rate", "bp", "spo2"] as const;

async function assertCanView(viewerId: string, targetId: string) {
  if (!(await canView(viewerId, targetId))) throw new HttpError(403, "You don't have access to this health vault");
}

// Overview: profile, latest vital of each type, medications, next doctor appointment.
healthRouter.get("/health/:userId", wrap(async (req, res) => {
  const { userId } = req.params;
  await assertCanView(req.userId, userId);
  const user = await prisma.user.findUnique({
    where: { id: userId }, select: { id: true, name: true, age: true, gender: true, avatarUrl: true },
  });
  if (!user) throw new HttpError(404, "User not found");
  const vitals = await Promise.all(VITAL_TYPES.map(type =>
    prisma.vital.findFirst({ where: { userId, type }, orderBy: { recordedAt: "desc" } })));
  const meds = await prisma.medication.findMany({ where: { userId }, orderBy: { name: "asc" } });
  const next = await prisma.appointment.findFirst({
    where: { userId, kind: "doctor", startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" },
  });
  res.json({
    user,
    vitals: vitals.filter(Boolean),
    medications: meds.map(m => ({ id: m.id, name: m.name, schedule: m.schedule, taken: m.takenDate === today() })),
    nextAppointment: next,
  });
}));

healthRouter.get("/health/:userId/vitals", wrap(async (req, res) => {
  await assertCanView(req.userId, req.params.userId);
  const type = req.query.type as string | undefined;
  const items = await prisma.vital.findMany({
    where: { userId: req.params.userId, ...(type ? { type } : {}) },
    orderBy: { recordedAt: "desc" }, take: 100,
  });
  res.json(items);
}));

healthRouter.post("/health/vitals", wrap(async (req, res) => {
  const b = parse(z.object({
    type: z.enum(VITAL_TYPES), value: z.string().min(1), unit: z.string().min(1),
  }), req.body);
  const v = await prisma.vital.create({ data: { ...b, userId: req.userId } });
  res.status(201).json(v);
}));

healthRouter.post("/health/medications", wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().min(1), schedule: z.string().min(1) }), req.body);
  const m = await prisma.medication.create({ data: { ...b, userId: req.userId } });
  res.status(201).json(m);
}));

healthRouter.post("/health/medications/:id/take", wrap(async (req, res) => {
  const m = await prisma.medication.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!m) throw new HttpError(404, "Medication not found");
  const u = await prisma.medication.update({ where: { id: m.id }, data: { takenDate: today() } });
  await pulse(req.userId, "completed", `took ${m.name}`);
  res.json({ id: u.id, taken: true });
}));

healthRouter.delete("/health/medications/:id", wrap(async (req, res) => {
  await prisma.medication.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  res.status(204).end();
}));

healthRouter.get("/health/:userId/records", wrap(async (req, res) => {
  await assertCanView(req.userId, req.params.userId);
  const type = req.query.type as string | undefined;
  res.json(await prisma.healthRecord.findMany({
    where: { userId: req.params.userId, ...(type ? { type } : {}) }, orderBy: { createdAt: "desc" },
  }));
}));

healthRouter.post("/health/records", wrap(async (req, res) => {
  const b = parse(z.object({
    type: z.enum(["prescription", "lab", "history", "appointment"]),
    title: z.string().min(1), notes: z.string().optional(), fileUrl: z.string().url().optional(),
  }), req.body);
  const limits = await limitsFor(req.userId);
  if ((await prisma.healthRecord.count({ where: { userId: req.userId } })) >= limits.healthRecords) {
    throw new HttpError(402, `Free accounts can store ${limits.healthRecords} records. Upgrade to Kizayu Premium for unlimited.`);
  }
  res.status(201).json(await prisma.healthRecord.create({ data: { ...b, userId: req.userId } }));
}));
