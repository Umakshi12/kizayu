import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./config";
import { prisma } from "./db";
import { HttpError } from "./util";

declare global { namespace Express { interface Request { userId: string } } }

export const signToken = (userId: string) => jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "30d" });

export function verifyToken(token: string): string {
  const p = jwt.verify(token, JWT_SECRET) as { sub: string };
  return p.sub;
}

/** Verifies the token AND that the account still exists (deleted accounts get a clean 401, not a 500). */
export async function authenticate(token: string): Promise<string> {
  const userId = verifyToken(token);
  if (!(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw new Error("account not found");
  return userId;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return next(new HttpError(401, "Missing token"));
  authenticate(h.slice(7))
    .then(id => { req.userId = id; next(); })
    .catch(() => next(new HttpError(401, "Your session has expired. Please sign in again.")));
}
