import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { HttpError } from "../util";

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 30 * 1000;

/** Creates a 6-digit one-time code (stored hashed) and returns the plain code for delivery. */
export async function issueCode(kind: string, target: string): Promise<string> {
  const recent = await prisma.verificationCode.findFirst({
    where: { kind, target, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
  });
  if (recent) throw new HttpError(429, "Please wait 30 seconds before requesting another code");
  // Invalidate older unused codes for this target
  await prisma.verificationCode.updateMany({ where: { kind, target, usedAt: null }, data: { usedAt: new Date() } });
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  await prisma.verificationCode.create({
    data: { kind, target, codeHash: await bcrypt.hash(code, 8), expiresAt: new Date(Date.now() + TTL_MS) },
  });
  return code;
}

/** Verifies and consumes a code. Throws a generic error on any failure. */
export async function consumeCode(kind: string, target: string, code: string) {
  const row = await prisma.verificationCode.findFirst({
    where: { kind, target, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" },
  });
  const fail = new HttpError(400, "Invalid or expired code");
  if (!row) throw fail;
  if (row.attempts >= MAX_ATTEMPTS) {
    await prisma.verificationCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    throw new HttpError(429, "Too many attempts. Request a new code.");
  }
  if (!(await bcrypt.compare(code, row.codeHash))) {
    await prisma.verificationCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw fail;
  }
  await prisma.verificationCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
}
