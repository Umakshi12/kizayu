import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, assertInCircle, parse, publicUser, wrap } from "../util";
import { limitsFor } from "../services/premium";

export const circlesRouter = Router();

circlesRouter.get("/circles", wrap(async (req, res) => {
  const circles = await prisma.circle.findMany({
    where: { members: { some: { userId: req.userId } } },
    include: { members: { include: { user: { select: publicUser } } } },
  });
  res.json(circles.map(c => ({
    id: c.id, name: c.name, type: c.type, inviteCode: c.inviteCode,
    members: c.members.map(m => ({ ...m.user, role: m.role })),
  })));
}));

circlesRouter.post("/circles", wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(60), type: z.enum(["Family", "Friends", "Relatives"]) }), req.body);
  const owned = await prisma.circleMember.count({ where: { userId: req.userId, role: "owner" } });
  const limits = await limitsFor(req.userId);
  if (owned >= limits.ownedCircles) throw new HttpError(402, `Free accounts can own ${limits.ownedCircles} circles. Upgrade to Kizayu Premium for more.`);
  const c = await prisma.circle.create({ data: { ...b, members: { create: { userId: req.userId, role: "owner" } } } });
  res.status(201).json(c);
}));

circlesRouter.post("/circles/join", wrap(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().min(1) }), req.body);
  const c = await prisma.circle.findUnique({ where: { inviteCode: code } });
  if (!c) throw new HttpError(404, "Invalid invite code");
  await prisma.circleMember.upsert({
    where: { circleId_userId: { circleId: c.id, userId: req.userId } },
    update: {},
    create: { circleId: c.id, userId: req.userId },
  });
  res.json({ id: c.id, name: c.name, type: c.type });
}));

circlesRouter.get("/circles/:id/members", wrap(async (req, res) => {
  await assertInCircle(req.userId, req.params.id);
  const ms = await prisma.circleMember.findMany({
    where: { circleId: req.params.id },
    include: { user: { select: publicUser } },
  });
  res.json(ms.map(m => ({ ...m.user, role: m.role })));
}));
