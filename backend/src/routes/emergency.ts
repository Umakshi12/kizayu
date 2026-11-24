import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, canView, circleIdsOf, parse, publicUser, wrap } from "../util";
import { blockedIds } from "./moderation";

export const emergencyRouter = Router();

const BLOOD = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
const text = (max: number) => z.string().trim().max(max).optional();

const out = (i: { bloodGroup: string | null; allergies: string | null; conditions: string | null; contactName: string | null; contactPhone: string | null; notes: string | null; updatedAt: Date } | null) => ({
  bloodGroup: i?.bloodGroup ?? "", allergies: i?.allergies ?? "", conditions: i?.conditions ?? "",
  contactName: i?.contactName ?? "", contactPhone: i?.contactPhone ?? "", notes: i?.notes ?? "",
  updatedAt: i?.updatedAt ?? null,
});
const filled = (i: { bloodGroup: string | null; allergies: string | null; conditions: string | null; contactName: string | null; contactPhone: string | null; notes: string | null }) =>
  !!(i.bloodGroup || i.allergies || i.conditions || i.contactName || i.contactPhone || i.notes);

emergencyRouter.get("/emergency/me", wrap(async (req, res) => {
  res.json(out(await prisma.emergencyInfo.findUnique({ where: { userId: req.userId } })));
}));

emergencyRouter.put("/emergency/me", wrap(async (req, res) => {
  const b = parse(z.object({
    bloodGroup: z.enum(BLOOD).optional(), allergies: text(300), conditions: text(300), contactName: text(80),
    contactPhone: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, "Enter a valid phone number").or(z.literal("")).optional(), notes: text(500),
  }), req.body);
  const data = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v === "" ? null : v]));
  res.json(out(await prisma.emergencyInfo.upsert({ where: { userId: req.userId }, update: data, create: { userId: req.userId, ...data } })));
}));

// Everyone in my circles who has filled in an emergency card.
emergencyRouter.get("/emergency/family", wrap(async (req, res) => {
  const mine = await circleIdsOf(req.userId);
  const blocked = await blockedIds(req.userId);
  const mates = await prisma.circleMember.findMany({ where: { circleId: { in: mine }, userId: { notIn: [req.userId, ...blocked] } }, select: { userId: true } });
  const ids = [...new Set(mates.map(m => m.userId))];
  const rows = await prisma.emergencyInfo.findMany({ where: { userId: { in: ids } }, include: { user: { select: publicUser } } });
  res.json(rows.filter(filled).map(r => ({ user: r.user, info: out(r) })));
}));

emergencyRouter.get("/emergency/:userId", wrap(async (req, res) => {
  if (!(await canView(req.userId, req.params.userId))) throw new HttpError(403, "You can only see people in your circles");
  const user = await prisma.user.findUnique({ where: { id: req.params.userId }, select: publicUser });
  if (!user) throw new HttpError(404, "User not found");
  res.json({ user, info: out(await prisma.emergencyInfo.findUnique({ where: { userId: req.params.userId } })) });
}));
