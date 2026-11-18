import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, parse, publicUser, wrap } from "../util";
import { sendEmail } from "../services/messaging";

export const moderationRouter = Router();

/** Ids of everyone this user has blocked (their content is hidden from this user). */
export async function blockedIds(userId: string): Promise<string[]> {
  const rows = await prisma.block.findMany({ where: { blockerId: userId }, select: { blockedId: true } });
  return rows.map(r => r.blockedId);
}

moderationRouter.get("/blocks", wrap(async (req, res) => {
  const rows = await prisma.block.findMany({ where: { blockerId: req.userId }, include: { blocked: { select: publicUser } }, orderBy: { createdAt: "desc" } });
  res.json(rows.map(r => ({ user: r.blocked, createdAt: r.createdAt })));
}));

moderationRouter.post("/blocks", wrap(async (req, res) => {
  const { userId } = parse(z.object({ userId: z.string().min(1) }), req.body);
  if (userId === req.userId) throw new HttpError(400, "You can't block yourself");
  if (!(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw new HttpError(404, "User not found");
  await prisma.block.upsert({ where: { blockerId_blockedId: { blockerId: req.userId, blockedId: userId } }, update: {}, create: { blockerId: req.userId, blockedId: userId } });
  res.status(201).json({ blocked: true });
}));

moderationRouter.delete("/blocks/:userId", wrap(async (req, res) => {
  await prisma.block.deleteMany({ where: { blockerId: req.userId, blockedId: req.params.userId } });
  res.json({ blocked: false });
}));

const TARGETS = ["post", "comment", "message", "user"] as const;

async function targetExists(type: (typeof TARGETS)[number], id: string) {
  const where = { where: { id }, select: { id: true } } as const;
  switch (type) {
    case "post": return !!(await prisma.post.findUnique(where));
    case "comment": return !!(await prisma.comment.findUnique(where));
    case "message": return !!(await prisma.message.findUnique(where));
    case "user": return !!(await prisma.user.findUnique(where));
  }
}

// Report abusive content. The reporter stops seeing a reported post right away; the team is emailed.
moderationRouter.post("/reports", wrap(async (req, res) => {
  const b = parse(z.object({
    targetType: z.enum(TARGETS), targetId: z.string().min(1),
    reason: z.enum(["spam", "harassment", "inappropriate", "other"]), details: z.string().trim().max(1000).optional(),
  }), req.body);
  if (!(await targetExists(b.targetType, b.targetId))) throw new HttpError(404, "That content no longer exists");
  const r = await prisma.report.upsert({
    where: { reporterId_targetType_targetId: { reporterId: req.userId, targetType: b.targetType, targetId: b.targetId } },
    update: { reason: b.reason, details: b.details, status: "open" },
    create: { reporterId: req.userId, ...b },
  });
  if (process.env.SUPPORT_EMAIL) {
    await sendEmail(process.env.SUPPORT_EMAIL, `[Report] ${b.targetType} – ${b.reason}`, `Report ${r.id}\nReporter: ${req.userId}\nTarget: ${b.targetType} ${b.targetId}\nReason: ${b.reason}\n\n${b.details ?? ""}`)
      .catch(e => console.warn("[report] email failed:", (e as Error).message));
  }
  res.status(201).json({ id: r.id, status: r.status });
}));
