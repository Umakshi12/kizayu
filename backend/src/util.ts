import { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError, ZodTypeAny, z } from "zod";
import { prisma } from "./db";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof ZodError) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}

export const today = () => new Date().toISOString().slice(0, 10);

export async function circleIdsOf(userId: string): Promise<string[]> {
  const rows = await prisma.circleMember.findMany({ where: { userId }, select: { circleId: true } });
  return rows.map(r => r.circleId);
}

export async function assertInCircle(userId: string, circleId: string) {
  const m = await prisma.circleMember.findUnique({ where: { circleId_userId: { circleId, userId } } });
  if (!m) throw new HttpError(403, "Not a member of this circle");
}

/** True if viewer is the user or shares at least one circle with them. */
export async function canView(viewerId: string, targetId: string) {
  if (viewerId === targetId) return true;
  const mine = await circleIdsOf(viewerId);
  const shared = await prisma.circleMember.findFirst({ where: { userId: targetId, circleId: { in: mine } } });
  return !!shared;
}

export async function pulse(userId: string, kind: string, text: string, imageUrl?: string | null) {
  const ids = await circleIdsOf(userId);
  if (!ids.length) return;
  await prisma.pulseEvent.createMany({ data: ids.map(circleId => ({ circleId, userId, kind, text, imageUrl })) });
}

export const publicUser = { id: true, name: true, username: true, avatarUrl: true, status: true } as const;
