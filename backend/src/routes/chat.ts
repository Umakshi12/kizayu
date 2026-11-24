import { Router } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, assertInCircle, parse, publicUser, wrap } from "../util";
import { circleMatesOf, notify } from "../services/notify";
import { deleteStoredFile } from "../services/files";
import { blockedIds } from "./moderation";

export const chatRouter = Router();

let io: Server | null = null;
export const setIo = (server: Server) => { io = server; };
export const roomOf = (circleId: string) => `circle:${circleId}`;
/** Push a realtime event to everyone currently connected in a circle (chat, shared lists). */
export const emitToCircle = (circleId: string, event: string, payload: unknown) => { io?.to(roomOf(circleId)).emit(event, payload); };

const include = { user: { select: publicUser }, circle: { select: { name: true } } } as const;

export async function sendMessage(circleId: string, userId: string, text?: string, imageUrl?: string, opts: { silent?: boolean } = {}) {
  if (!text && !imageUrl) throw new HttpError(400, "Message is empty");
  const { circle, ...m } = await prisma.message.create({ data: { circleId, userId, text, imageUrl }, include });
  io?.to(roomOf(circleId)).emit("message", m);
  if (!opts.silent) {
    await notify(await circleMatesOf(userId, circleId), {
      from: userId, kind: "chat", title: `${m.user.name} in ${circle.name}`, body: text ?? "📷 Photo", data: { screen: "chat", circleId },
    });
  }
  return m;
}

chatRouter.get("/circles/:id/messages", wrap(async (req, res) => {
  await assertInCircle(req.userId, req.params.id);
  const before = req.query.before ? new Date(String(req.query.before)) : undefined;
  const items = await prisma.message.findMany({
    where: { circleId: req.params.id, userId: { notIn: await blockedIds(req.userId) }, ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: { createdAt: "desc" }, take: 50, include: { user: { select: publicUser } },
  });
  res.json(items.reverse());
}));

chatRouter.post("/circles/:id/messages", wrap(async (req, res) => {
  await assertInCircle(req.userId, req.params.id);
  const b = parse(z.object({ text: z.string().trim().max(2000).optional(), imageUrl: z.string().url().optional() }), req.body);
  res.status(201).json(await sendMessage(req.params.id, req.userId, b.text || undefined, b.imageUrl));
}));

// Delete your own chat message; everyone in the circle sees it disappear.
chatRouter.delete("/messages/:id", wrap(async (req, res) => {
  const m = await prisma.message.findUnique({ where: { id: req.params.id } });
  if (!m || m.userId !== req.userId) throw new HttpError(404, "Message not found");
  await prisma.message.delete({ where: { id: m.id } });
  await deleteStoredFile(m.imageUrl);
  io?.to(roomOf(m.circleId)).emit("messageDeleted", { id: m.id, circleId: m.circleId });
  res.status(204).end();
}));
