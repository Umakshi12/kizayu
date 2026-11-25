import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { assertInCircle, parse, publicUser, wrap } from "../util";
import { addDays, bestStreakOf, streakOf } from "./habits";

export const brainRouter = Router();

export const GAMES = ["math", "matrix", "stroop", "quant"] as const;
type Game = (typeof GAMES)[number];

// The highest score a human can reasonably reach in one run. Anything above is rejected, so a family board stays fair.
const MAX_SCORE: Record<Game, number> = { math: 40, matrix: 20, stroop: 60, quant: 5 };
const XP_PER_POINT: Record<Game, number> = { math: 2, matrix: 10, stroop: 1.5, quant: 12 };
const DAILY_BONUS = 20;
const DAILY_XP_CAP = 500;

export const xpFor = (game: Game, score: number) => Math.round(Math.min(score, MAX_SCORE[game]) * XP_PER_POINT[game]);

/** Level L starts at 40 * (L-1)^2 XP, so early levels come quickly and later ones take longer. */
export function levelOf(xp: number) {
  const level = Math.floor(Math.sqrt(xp / 40)) + 1;
  const floor = 40 * (level - 1) ** 2, next = 40 * level ** 2;
  return { level, xpIntoLevel: xp - floor, xpForNext: next - floor };
}

/** A stable number for a date, so everyone gets the same Daily Challenge questions. */
export const seedOf = (date: string) => [...date].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7) % 1_000_000_007;

async function statsFor(userId: string, today: string) {
  const rows = await prisma.brainResult.findMany({ where: { userId }, select: { game: true, score: true, xp: true, date: true, daily: true } });
  const totalXp = rows.reduce((s, r) => s + r.xp, 0);
  const days = [...new Set(rows.map(r => r.date))].map(date => ({ date, count: 1 }));
  const weekFrom = addDays(today, -6);
  const best = Object.fromEntries(GAMES.map(g => [g, Math.max(0, ...rows.filter(r => r.game === g).map(r => r.score))]));
  const todayRows = rows.filter(r => r.date === today);
  return {
    totalXp, ...levelOf(totalXp),
    streak: streakOf(days, 1, today), best: bestStreakOf(days, 1),
    playedToday: todayRows.length > 0, todayXp: todayRows.reduce((s, r) => s + r.xp, 0),
    weekXp: rows.filter(r => r.date >= weekFrom).reduce((s, r) => s + r.xp, 0),
    bestScores: best, dailyDone: GAMES.filter(g => todayRows.some(r => r.game === g && r.daily)),
  };
}

brainRouter.get("/brain/stats", wrap(async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: req.userId }, select: { brainShare: true } });
  res.json({ ...(await statsFor(req.userId, req.today)), share: !!u?.brainShare });
}));

// Today's Daily Challenge: the same seed for everyone, one go per game.
brainRouter.get("/brain/daily", wrap(async (req, res) => {
  const stats = await statsFor(req.userId, req.today);
  res.json({ date: req.today, seed: seedOf(req.today), games: GAMES.map(g => ({ game: g, done: stats.dailyDone.includes(g) })), bonus: DAILY_BONUS });
}));

brainRouter.post("/brain/result", wrap(async (req, res) => {
  const b = parse(z.object({ game: z.enum(GAMES), score: z.number().int().min(0), daily: z.boolean().optional() }), req.body);
  if (b.score > MAX_SCORE[b.game]) return void res.status(400).json({ error: "That score doesn't look right" });
  const before = await statsFor(req.userId, req.today);
  const firstDaily = !!b.daily && !before.dailyDone.includes(b.game) && b.score > 0;
  const raw = xpFor(b.game, b.score) + (firstDaily ? DAILY_BONUS : 0);
  const xp = Math.max(0, Math.min(raw, DAILY_XP_CAP - before.todayXp));
  await prisma.brainResult.create({ data: { userId: req.userId, game: b.game, score: b.score, xp, date: req.today, daily: firstDaily } });
  const after = await statsFor(req.userId, req.today);
  res.status(201).json({
    xp, bonus: firstDaily ? DAILY_BONUS : 0, capped: xp < raw,
    newBest: b.score > before.bestScores[b.game], levelUp: after.level > before.level,
    streakStarted: !before.playedToday, stats: after,
  });
}));

brainRouter.put("/brain/settings", wrap(async (req, res) => {
  const { share } = parse(z.object({ share: z.boolean() }), req.body);
  await prisma.user.update({ where: { id: req.userId }, data: { brainShare: share } });
  res.json({ share });
}));

// Weekly XP board for a circle. People appear only if they chose to share (you always see yourself).
brainRouter.get("/brain/board", wrap(async (req, res) => {
  const { circleId } = parse(z.object({ circleId: z.string() }), req.query);
  await assertInCircle(req.userId, circleId);
  const members = await prisma.circleMember.findMany({ where: { circleId }, include: { user: { select: { ...publicUser, brainShare: true } } } });
  const visible = members.filter(m => m.userId === req.userId || m.user.brainShare);
  const rows = await Promise.all(visible.map(async m => {
    const day = req.today; // everyone is shown in the viewer's week; close enough for a family board
    const s = await statsFor(m.userId, day);
    return { user: { id: m.user.id, name: m.user.name, username: m.user.username, avatarUrl: m.user.avatarUrl }, weekXp: s.weekXp, streak: s.streak, level: s.level, me: m.userId === req.userId };
  }));
  res.json(rows.sort((a, b) => b.weekXp - a.weekXp || b.streak - a.streak));
}));
