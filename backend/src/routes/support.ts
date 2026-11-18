import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { parse, wrap } from "../util";
import { sendEmail } from "../services/messaging";

export const supportRouter = Router();

supportRouter.get("/support/tickets", wrap(async (req, res) => {
  res.json(await prisma.supportTicket.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" } }));
}));

supportRouter.post("/support/tickets", wrap(async (req, res) => {
  const b = parse(z.object({ subject: z.string().trim().min(3).max(120), message: z.string().trim().min(10).max(4000) }), req.body);
  const t = await prisma.supportTicket.create({ data: { ...b, userId: req.userId } });
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  if (process.env.SUPPORT_EMAIL) {
    await sendEmail(process.env.SUPPORT_EMAIL, `[Support] ${b.subject}`, `From: ${u.name} (@${u.username}, ${u.email ?? u.phone ?? "no contact"})\nTicket: ${t.id}\n\n${b.message}`)
      .catch(e => console.warn("[support] email failed:", (e as Error).message));
  }
  res.status(201).json(t);
}));
