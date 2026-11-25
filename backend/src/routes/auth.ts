import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db";
import { signToken, requireAuth } from "../auth";
import { DEV_CODES } from "../config";
import { HttpError, parse, wrap } from "../util";
import { consumeCode, issueCode } from "../services/codes";
import { codeText, emailConfigured, sendEmail, sendSms, smsConfigured } from "../services/messaging";
import { googleConfigured, verifyGoogleToken } from "../services/google";
import { isPremium } from "../services/premium";
import { deleteStoredFile } from "../services/files";

export const authRouter = Router();

const PHONE = z.string().regex(/^\+[1-9]\d{7,14}$/, "Use international format, e.g. +919876543210");
const PASSWORD = z.string().min(8, "Password must be at least 8 characters");

async function userOut(u: { id: string }) {
  const full = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { doctorProfile: { select: { id: true } } } });
  return {
    id: full.id, name: full.name, username: full.username, email: full.email, phone: full.phone,
    avatarUrl: full.avatarUrl, status: full.status, age: full.age, gender: full.gender,
    premium: await isPremium(full.id), hasPassword: !!full.passwordHash, doctorId: full.doctorProfile?.id ?? null,
  };
}
const session = async (u: { id: string }) => ({ token: signToken(u.id), user: await userOut(u) });

async function uniqueUsername(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "user";
  for (let i = 0; i < 20; i++) {
    const candidate = `${base}${crypto.randomInt(1000, 9999)}`;
    if (!(await prisma.user.findUnique({ where: { username: candidate } }))) return candidate;
  }
  return `${base}${crypto.randomUUID().slice(0, 8)}`;
}

/** Every new account gets safety settings and its own family circle. */
function createUser(data: { name: string; username: string; email?: string; phone?: string; googleId?: string; passwordHash?: string; avatarUrl?: string; age?: number; gender?: string }) {
  return prisma.user.create({ data: {
    ...data, safety: { create: {} },
    memberships: { create: { role: "owner", circle: { create: { name: `${data.name.split(" ")[0]}'s Family`, type: "Family" } } } },
  } });
}

// Which sign-in methods the server can actually deliver (the app hides the rest).
authRouter.get("/auth/methods", (_req, res) => {
  // Phone sign-in needs an SMS provider in production (in dev, codes are shown on screen instead).
  res.json({ email: true, phone: smsConfigured() || DEV_CODES, google: googleConfigured(), devCodes: DEV_CODES && (!smsConfigured() || !emailConfigured()) });
});

// ---------- Email + password ----------
authRouter.post("/auth/signup", wrap(async (req, res) => {
  const b = parse(z.object({
    name: z.string().trim().min(1), username: z.string().min(3).max(30).regex(/^[a-z0-9_.]+$/i, "Letters, numbers, _ and . only"),
    email: z.string().email(), password: PASSWORD, age: z.number().int().min(0).max(130).optional(), gender: z.string().optional(),
  }), req.body);
  const email = b.email.toLowerCase(), username = b.username.toLowerCase();
  if (await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } })) throw new HttpError(409, "Email or username already in use");
  const user = await createUser({ name: b.name, username, email, passwordHash: await bcrypt.hash(b.password, 10), age: b.age, gender: b.gender });
  res.status(201).json(await session(user));
}));

authRouter.post("/auth/login", wrap(async (req, res) => {
  const b = parse(z.object({ email: z.string().email(), password: z.string() }), req.body);
  const user = await prisma.user.findUnique({ where: { email: b.email.toLowerCase() } });
  if (user && !user.passwordHash) throw new HttpError(400, "This account uses phone or Google sign-in. Use that, or reset your password to add one.");
  if (!user || !(await bcrypt.compare(b.password, user.passwordHash!))) throw new HttpError(401, "Invalid email or password");
  res.json(await session(user));
}));

// ---------- Password reset (emailed 6-digit code) ----------
authRouter.post("/auth/password/forgot", wrap(async (req, res) => {
  const { email } = parse(z.object({ email: z.string().email() }), req.body);
  const target = email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: target } });
  let devCode: string | undefined;
  if (user) {
    const code = await issueCode("password_reset", target);
    await sendEmail(target, "Reset your password", codeText(code, "password reset"));
    if (DEV_CODES && !emailConfigured()) devCode = code;
  }
  // Same response whether or not the account exists, so emails can't be probed.
  res.json({ ok: true, message: "If that email has an account, we've sent a reset code.", ...(devCode ? { devCode } : {}) });
}));

authRouter.post("/auth/password/reset", wrap(async (req, res) => {
  const b = parse(z.object({ email: z.string().email(), code: z.string().length(6), password: PASSWORD }), req.body);
  const target = b.email.toLowerCase();
  await consumeCode("password_reset", target, b.code);
  const user = await prisma.user.findUnique({ where: { email: target } });
  if (!user) throw new HttpError(400, "Invalid or expired code");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(b.password, 10) } });
  res.json(await session(user));
}));

authRouter.post("/me/password", requireAuth, wrap(async (req, res) => {
  const b = parse(z.object({ current: z.string().optional(), password: PASSWORD }), req.body);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  if (u.passwordHash && !(b.current && (await bcrypt.compare(b.current, u.passwordHash)))) throw new HttpError(400, "Current password is incorrect");
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(b.password, 10) } });
  res.json({ ok: true });
}));

// ---------- Phone sign-in (SMS one-time code) ----------
authRouter.post("/auth/otp/request", wrap(async (req, res) => {
  const { phone } = parse(z.object({ phone: PHONE }), req.body);
  const code = await issueCode("phone_login", phone);
  await sendSms(phone, codeText(code, "sign-in"));
  const isNewUser = !(await prisma.user.findUnique({ where: { phone } }));
  res.json({ ok: true, isNewUser, ...(DEV_CODES && !smsConfigured() ? { devCode: code } : {}) });
}));

authRouter.post("/auth/otp/verify", wrap(async (req, res) => {
  const b = parse(z.object({ phone: PHONE, code: z.string().length(6), name: z.string().trim().min(1).optional() }), req.body);
  const existing = await prisma.user.findUnique({ where: { phone: b.phone } });
  if (!existing && !b.name) throw new HttpError(400, "Please tell us your name to create your account");
  await consumeCode("phone_login", b.phone, b.code);
  const user = existing ?? await createUser({ name: b.name!, username: await uniqueUsername(b.name!), phone: b.phone });
  res.status(existing ? 200 : 201).json(await session(user));
}));

// ---------- Google sign-in ----------
authRouter.post("/auth/google", wrap(async (req, res) => {
  const { idToken } = parse(z.object({ idToken: z.string().min(10) }), req.body);
  const g = await verifyGoogleToken(idToken);
  let user = await prisma.user.findUnique({ where: { googleId: g.sub } });
  if (!user && g.email && g.emailVerified) {
    const byEmail = await prisma.user.findUnique({ where: { email: g.email.toLowerCase() } });
    if (byEmail) user = await prisma.user.update({ where: { id: byEmail.id }, data: { googleId: g.sub } });
  }
  const created = !user;
  if (!user) {
    const name = g.name ?? g.email?.split("@")[0] ?? "Kizayu user";
    user = await createUser({
      name, username: await uniqueUsername(name), googleId: g.sub, avatarUrl: g.picture,
      email: g.email && g.emailVerified ? g.email.toLowerCase() : undefined,
    });
  }
  res.status(created ? 201 : 200).json(await session(user));
}));

// ---------- Profile ----------
authRouter.get("/me", requireAuth, wrap(async (req, res) => {
  res.json(await userOut({ id: req.userId }));
}));

authRouter.patch("/me", requireAuth, wrap(async (req, res) => {
  const b = parse(z.object({
    name: z.string().trim().min(1).optional(), avatarUrl: z.string().url().nullable().optional(),
    status: z.enum(["Active", "All good", "Busy"]).optional(),
    age: z.number().int().min(0).max(130).optional(), gender: z.string().optional(),
  }), req.body);
  await prisma.user.update({ where: { id: req.userId }, data: b });
  res.json(await userOut({ id: req.userId }));
}));

// ---------- Delete account (required by Google Play and the App Store) ----------
// Removes the account and everything it created: posts, photos, messages, health data, location and more.
// Circles you own pass to the next member, or are deleted if you were the only one in them.
authRouter.post("/me/delete", requireAuth, wrap(async (req, res) => {
  const b = parse(z.object({ confirm: z.literal("DELETE"), password: z.string().optional() }), req.body);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  if (u.passwordHash && !(b.password && (await bcrypt.compare(b.password, u.passwordHash)))) throw new HttpError(400, "Password is incorrect");

  const [posts, stories, messages, sosClips, albumPhotos] = await Promise.all([
    prisma.post.findMany({ where: { authorId: u.id }, select: { imageUrl: true } }),
    prisma.story.findMany({ where: { authorId: u.id }, select: { imageUrl: true } }),
    prisma.message.findMany({ where: { userId: u.id }, select: { imageUrl: true } }),
    prisma.sosClip.findMany({ where: { event: { userId: u.id } }, select: { url: true } }),
    prisma.albumPhoto.findMany({ where: { uploadedById: u.id }, select: { url: true } }),
  ]);
  const files = [...posts.map(x => x.imageUrl), ...stories.map(x => x.imageUrl), ...messages.map(x => x.imageUrl), ...sosClips.map(x => x.url), ...albumPhotos.map(x => x.url)].concat(u.avatarUrl?.includes("/uploads/") ? [u.avatarUrl] : []);

  await prisma.$transaction(async tx => {
    const owned = await tx.circleMember.findMany({ where: { userId: u.id, role: "owner" } });
    for (const m of owned) {
      const next = await tx.circleMember.findFirst({ where: { circleId: m.circleId, userId: { not: u.id } }, orderBy: { id: "asc" } });
      if (next) await tx.circleMember.update({ where: { id: next.id }, data: { role: "owner" } });
      else await tx.circle.delete({ where: { id: m.circleId } });
    }
    await tx.albumPhoto.deleteMany({ where: { uploadedById: u.id } });
    const targets = [u.email, u.phone].filter((t): t is string => !!t);
    if (targets.length) await tx.verificationCode.deleteMany({ where: { target: { in: targets } } });
    await tx.user.delete({ where: { id: u.id } }); // cascades to all personal data
  });
  for (const f of files) await deleteStoredFile(f);
  res.status(204).end();
}));
