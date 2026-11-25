import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, assertInCircle, assertOwner, parse, publicUser, roleIn, wrap } from "../util";
import { notify } from "../services/notify";
import { addDays } from "./habits";

export const choresRouter = Router();

async function balanceOf(userId: string, circleId: string) {
  const earned = (await prisma.choreDone.aggregate({ where: { userId, status: "approved", chore: { circleId } }, _sum: { points: true } }))._sum.points ?? 0;
  const spent = (await prisma.rewardClaim.aggregate({ where: { userId, reward: { circleId } }, _sum: { cost: true } }))._sum.cost ?? 0;
  return earned - spent;
}

const ownersOf = async (circleId: string) => (await prisma.circleMember.findMany({ where: { circleId, role: "owner" }, select: { userId: true } })).map(m => m.userId);

// Everything the chores screen needs for one circle.
choresRouter.get("/chores", wrap(async (req, res) => {
  const { circleId } = parse(z.object({ circleId: z.string() }), req.query);
  await assertInCircle(req.userId, circleId);
  const isOwner = (await roleIn(req.userId, circleId)) === "owner";
  const [chores, rewards, members] = await Promise.all([
    prisma.chore.findMany({ where: { circleId, active: true }, orderBy: { createdAt: "asc" } }),
    prisma.reward.findMany({ where: { circleId, active: true }, orderBy: { cost: "asc" } }),
    prisma.circleMember.findMany({ where: { circleId }, include: { user: { select: publicUser } } }),
  ]);
  const since = addDays(req.today, -7);
  const dones = await prisma.choreDone.findMany({ where: { choreId: { in: chores.map(c => c.id) }, date: { gte: since }, status: { not: "rejected" } } });
  const balances = await Promise.all(members.map(async m => ({ user: m.user, role: m.role, points: await balanceOf(m.userId, circleId) })));
  const claims = await prisma.rewardClaim.findMany({ where: { reward: { circleId }, status: "pending" }, include: { reward: { select: { title: true } } }, orderBy: { createdAt: "asc" } });
  const pending = await prisma.choreDone.findMany({ where: { chore: { circleId }, status: "pending" }, include: { chore: { select: { title: true, points: true } } }, orderBy: { createdAt: "asc" } });
  const byId = new Map(members.map(m => [m.userId, m.user]));
  res.json({
    isOwner,
    chores: chores.map(c => {
      const mine = dones.filter(d => d.choreId === c.id && d.userId === req.userId);
      const todayDone = mine.find(d => d.date === req.today);
      const canDoNow = !todayDone && (c.repeat !== "weekly" || !mine.length) && (c.repeat !== "once" || !dones.some(d => d.choreId === c.id));
      return {
        id: c.id, title: c.title, points: c.points, repeat: c.repeat, assignee: c.assigneeId ? byId.get(c.assigneeId) ?? null : null,
        myStatus: todayDone?.status ?? null, canDo: canDoNow && (!c.assigneeId || c.assigneeId === req.userId),
      };
    }),
    rewards: rewards.map(r => ({ id: r.id, title: r.title, cost: r.cost })),
    balances: balances.sort((a, b) => b.points - a.points),
    myPoints: balances.find(b => b.user.id === req.userId)?.points ?? 0,
    pending: isOwner ? pending.map(p => ({ id: p.id, title: p.chore.title, points: p.chore.points, user: byId.get(p.userId) ?? null, date: p.date })) : [],
    claims: isOwner ? claims.map(c => ({ id: c.id, title: c.reward.title, cost: c.cost, user: byId.get(c.userId) ?? null })) : [],
  });
}));

const choreBody = z.object({ title: z.string().trim().min(1).max(60), points: z.number().int().min(1).max(100), assigneeId: z.string().nullable().optional(), repeat: z.enum(["once", "daily", "weekly"]).default("daily") });

choresRouter.post("/chores", wrap(async (req, res) => {
  const b = parse(choreBody.extend({ circleId: z.string() }), req.body);
  await assertOwner(req.userId, b.circleId);
  if (b.assigneeId && !(await roleIn(b.assigneeId, b.circleId))) throw new HttpError(400, "That person isn't in this circle");
  if ((await prisma.chore.count({ where: { circleId: b.circleId, active: true } })) >= 40) throw new HttpError(400, "That's plenty of chores. Remove some first");
  const c = await prisma.chore.create({ data: { ...b, assigneeId: b.assigneeId ?? null, createdById: req.userId } });
  if (c.assigneeId && c.assigneeId !== req.userId) await notify([c.assigneeId], { from: req.userId, kind: "chores", title: "New chore for you", body: `${c.title} · ${c.points} pts`, data: { screen: "/chores" } });
  res.status(201).json({ id: c.id });
}));

choresRouter.delete("/chores/:id", wrap(async (req, res) => {
  const c = await prisma.chore.findUnique({ where: { id: req.params.id } });
  if (!c) throw new HttpError(404, "Chore not found");
  await assertOwner(req.userId, c.circleId);
  await prisma.chore.update({ where: { id: c.id }, data: { active: false } }); // keeps earned points history
  res.status(204).end();
}));

// "I did it": waits for a parent to approve before any points are given.
choresRouter.post("/chores/:id/done", wrap(async (req, res) => {
  const c = await prisma.chore.findFirst({ where: { id: req.params.id, active: true } });
  if (!c || !(await roleIn(req.userId, c.circleId))) throw new HttpError(404, "Chore not found");
  if (c.assigneeId && c.assigneeId !== req.userId) throw new HttpError(403, "This chore is for someone else");
  const recent = await prisma.choreDone.findMany({ where: { choreId: c.id, status: { not: "rejected" }, ...(c.repeat === "once" ? {} : { date: { gte: addDays(req.today, c.repeat === "weekly" ? -6 : 0) } }) } });
  if (c.repeat === "once" && recent.length) throw new HttpError(409, "This chore has already been done");
  if (c.repeat !== "once" && recent.some(d => d.userId === req.userId)) throw new HttpError(409, c.repeat === "weekly" ? "Already done this week" : "Already done today");
  const existing = await prisma.choreDone.findUnique({ where: { choreId_userId_date: { choreId: c.id, userId: req.userId, date: req.today } } });
  const d = existing
    ? await prisma.choreDone.update({ where: { id: existing.id }, data: { status: "pending", points: c.points } }) // a rejected one can be redone
    : await prisma.choreDone.create({ data: { choreId: c.id, userId: req.userId, date: req.today, points: c.points } });
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { name: true } });
  await notify((await ownersOf(c.circleId)).filter(id => id !== req.userId), { from: req.userId, kind: "chores", title: `${me.name} finished a chore`, body: `${c.title} · ${c.points} pts. Tap to approve`, data: { screen: "/chores" } });
  res.status(201).json({ id: d.id, status: d.status });
}));

choresRouter.post("/chores/done/:id/review", wrap(async (req, res) => {
  const { approve } = parse(z.object({ approve: z.boolean() }), req.body);
  const d = await prisma.choreDone.findUnique({ where: { id: req.params.id }, include: { chore: true } });
  if (!d) throw new HttpError(404, "Not found");
  await assertOwner(req.userId, d.chore.circleId);
  if (d.userId === req.userId) throw new HttpError(403, "Ask another parent to approve your own chores");
  const r = await prisma.choreDone.updateMany({ where: { id: d.id, status: "pending" }, data: { status: approve ? "approved" : "rejected", approvedById: req.userId } });
  if (!r.count) throw new HttpError(409, "Already reviewed");
  await notify([d.userId], { from: req.userId, kind: "chores", title: approve ? `+${d.points} points` : "Chore needs another go", body: approve ? `"${d.chore.title}" was approved` : `"${d.chore.title}" wasn't approved. You can do it again`, data: { screen: "/chores" } });
  res.json({ status: approve ? "approved" : "rejected" });
}));

choresRouter.post("/rewards", wrap(async (req, res) => {
  const b = parse(z.object({ circleId: z.string(), title: z.string().trim().min(1).max(60), cost: z.number().int().min(1).max(5000) }), req.body);
  await assertOwner(req.userId, b.circleId);
  if ((await prisma.reward.count({ where: { circleId: b.circleId, active: true } })) >= 30) throw new HttpError(400, "That's plenty of rewards. Remove some first");
  res.status(201).json({ id: (await prisma.reward.create({ data: { ...b, createdById: req.userId } })).id });
}));

choresRouter.delete("/rewards/:id", wrap(async (req, res) => {
  const r = await prisma.reward.findUnique({ where: { id: req.params.id } });
  if (!r) throw new HttpError(404, "Reward not found");
  await assertOwner(req.userId, r.circleId);
  await prisma.reward.update({ where: { id: r.id }, data: { active: false } });
  res.status(204).end();
}));

choresRouter.post("/rewards/:id/claim", wrap(async (req, res) => {
  const r = await prisma.reward.findFirst({ where: { id: req.params.id, active: true } });
  if (!r || !(await roleIn(req.userId, r.circleId))) throw new HttpError(404, "Reward not found");
  if ((await balanceOf(req.userId, r.circleId)) < r.cost) throw new HttpError(400, "Not enough points yet");
  const claim = await prisma.rewardClaim.create({ data: { rewardId: r.id, userId: req.userId, cost: r.cost } });
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { name: true } });
  await notify((await ownersOf(r.circleId)).filter(id => id !== req.userId), { from: req.userId, kind: "chores", title: `${me.name} wants a reward`, body: `${r.title} · ${r.cost} pts`, data: { screen: "/chores" } });
  res.status(201).json({ id: claim.id, points: await balanceOf(req.userId, r.circleId) });
}));

choresRouter.post("/rewards/claims/:id/given", wrap(async (req, res) => {
  const c = await prisma.rewardClaim.findUnique({ where: { id: req.params.id }, include: { reward: true } });
  if (!c) throw new HttpError(404, "Not found");
  await assertOwner(req.userId, c.reward.circleId);
  const u = await prisma.rewardClaim.updateMany({ where: { id: c.id, status: "pending" }, data: { status: "given" } });
  if (!u.count) throw new HttpError(409, "Already marked as given");
  await notify([c.userId], { from: req.userId, kind: "chores", title: "Reward on its way 🎁", body: c.reward.title, data: { screen: "/chores" } });
  res.json({ status: "given" });
}));
