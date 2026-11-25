import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, parse, wrap } from "../util";
import { limitsFor } from "../services/premium";
import { CRISIS_REPLY, MOODS, buddyContext, isCrisis, modelConfigured, modelReply, scriptedReply, systemPrompt, type Mood } from "../services/buddy";

export const buddyRouter = Router();

const view = (m: { id: string; role: string; text: string; mood: string | null; source: string | null; createdAt: Date }) =>
  ({ id: m.id, role: m.role, text: m.text, mood: m.mood, source: m.source, createdAt: m.createdAt });

async function usage(userId: string, today: string) {
  const [used, limits] = await Promise.all([prisma.buddyMessage.count({ where: { userId, role: "user", date: today } }), limitsFor(userId)]);
  return { used, limit: limits.buddyPerDay };
}

// The conversation so far, how many of today's messages are used, and whether a real model is connected.
buddyRouter.get("/buddy", wrap(async (req, res) => {
  const rows = await prisma.buddyMessage.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" }, take: 40 });
  res.json({ messages: rows.reverse().map(view), ...(await usage(req.userId, req.today)), mode: modelConfigured() ? "model" : "scripted" });
}));

buddyRouter.post("/buddy/chat", wrap(async (req, res) => {
  const b = parse(z.object({ text: z.string().trim().min(1).max(500), mood: z.enum(MOODS as [Mood, ...Mood[]]).optional() }), req.body);
  const crisis = isCrisis(b.text);
  const before = await usage(req.userId, req.today);
  // Safety replies are never blocked by the daily limit.
  if (!crisis && before.used >= before.limit) {
    throw new HttpError(429, before.limit <= 8 ? "You've used today's free messages. Premium gives you many more, or come back tomorrow." : "That's all the buddy messages for today. Come back tomorrow.");
  }
  const ctx = await buddyContext(req.userId, req.tz, req.today);
  const mood = b.mood ?? null;

  let text: string, source: "model" | "scripted" | "safety";
  if (crisis) { text = CRISIS_REPLY; source = "safety"; }
  else {
    const past = await prisma.buddyMessage.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" }, take: 10 });
    const history = past.reverse().map(m => ({ role: m.role === "buddy" ? ("assistant" as const) : ("user" as const), content: m.text }));
    try { text = await modelReply(systemPrompt(ctx, mood), history, b.text); source = "model"; }
    catch (e) {
      if (modelConfigured()) console.warn("[buddy] model failed, using simple replies:", (e as Error).message);
      text = scriptedReply(ctx, b.text, mood); source = "scripted";
    }
  }
  const u = await prisma.buddyMessage.create({ data: { userId: req.userId, role: "user", text: b.text, mood, date: req.today } });
  const a = await prisma.buddyMessage.create({ data: { userId: req.userId, role: "buddy", text, source, date: req.today, createdAt: new Date(u.createdAt.getTime() + 1) } });
  res.status(201).json({ user: view(u), buddy: view(a), used: before.used + 1, limit: before.limit });
}));

buddyRouter.delete("/buddy", wrap(async (req, res) => {
  await prisma.buddyMessage.deleteMany({ where: { userId: req.userId } });
  res.status(204).end();
}));
