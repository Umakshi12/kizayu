import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./config";
import { prisma } from "./db";
import { localDate } from "./services/time";
import { HttpError } from "./util";

declare global { namespace Express { interface Request { userId: string; today: string; tz: number } } }

export const signToken = (userId: string) => jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "30d" });

export function verifyToken(token: string): string {
  const p = jwt.verify(token, JWT_SECRET) as { sub: string };
  return p.sub;
}

/** Verifies the token AND that the account still exists (deleted accounts get a clean 401, not a 500). */
export async function authenticateFull(token: string): Promise<{ id: string; tz: number }> {
  const userId = verifyToken(token);
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, tzOffsetMin: true } });
  if (!u) throw new Error("account not found");
  return { id: u.id, tz: u.tzOffsetMin };
}
export const authenticate = async (token: string): Promise<string> => (await authenticateFull(token)).id;

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return next(new HttpError(401, "Missing token"));
  authenticateFull(h.slice(7))
    .then(u => { req.userId = u.id; req.tz = u.tz; req.today = localDate(new Date(), u.tz); next(); })
    .catch(() => next(new HttpError(401, "Your session has expired. Please sign in again.")));
}
