import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, circleIdsOf, parse, publicUser, wrap } from "../util";

export const gamesRouter = Router();

gamesRouter.get("/games", wrap(async (_req, res) => {
  res.json(await prisma.game.findMany());
}));

gamesRouter.post("/games/:id/scores", wrap(async (req, res) => {
  const { score } = parse(z.object({ score: z.number().int().min(0) }), req.body);
  if (!(await prisma.game.findUnique({ where: { id: req.params.id } }))) throw new HttpError(404, "Game not found");
  const s = await prisma.gameScore.create({ data: { gameId: req.params.id, userId: req.userId, score } });
  res.status(201).json(s);
}));

// Best score per person among everyone I share a circle with.
gamesRouter.get("/games/:id/leaderboard", wrap(async (req, res) => {
  const ids = await circleIdsOf(req.userId);
  const members = await prisma.circleMember.findMany({ where: { circleId: { in: ids } }, select: { userId: true } });
  const userIds = [...new Set(members.map(m => m.userId))];
  const best = await prisma.gameScore.groupBy({
    by: ["userId"], where: { gameId: req.params.id, userId: { in: userIds } },
    _max: { score: true }, orderBy: { _max: { score: "desc" } }, take: 20,
  });
  const users = await prisma.user.findMany({ where: { id: { in: best.map(b => b.userId) } }, select: publicUser });
  const byId = new Map(users.map(u => [u.id, u]));
  res.json(best.map((b, i) => ({ rank: i + 1, user: byId.get(b.userId), score: b._max.score })));
}));
