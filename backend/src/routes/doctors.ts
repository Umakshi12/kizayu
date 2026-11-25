import { Router } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, canView, parse, publicUser, wrap } from "../util";
import { dayOfUser } from "../services/time";
import { notify, userRoom } from "../services/notify";

export const doctorsRouter = Router();

let io: Server | null = null;
export const setDoctorIo = (s: Server) => { io = s; };

// Doctors are private to each family: you only see doctors you've added.
// A doctor with their own Kizayu account (Doctor.userId) can message patients who added them.
const doctorOut = (d: { id: string; name: string; specialty: string; rating: number; reviews: number; phone: string | null; avatarUrl: string | null; userId: string | null }) => ({
  id: d.id, name: d.name, specialty: d.specialty, phone: d.phone, avatarUrl: d.avatarUrl,
  rating: d.reviews > 0 ? d.rating : null, reviews: d.reviews, hasAccount: !!d.userId, linked: true,
});

async function linkOf(userId: string, doctorId: string) {
  return prisma.doctorLink.findUnique({ where: { userId_doctorId: { userId, doctorId } }, include: { doctor: true } });
}
async function requireLink(userId: string, doctorId: string) {
  const l = await linkOf(userId, doctorId);
  if (!l) throw new HttpError(404, "Doctor not found");
  return l;
}

doctorsRouter.get("/doctors", wrap(async (req, res) => {
  const links = await prisma.doctorLink.findMany({ where: { userId: req.userId }, include: { doctor: true }, orderBy: { id: "asc" } });
  res.json(links.map(l => doctorOut(l.doctor)));
}));

// Add your doctor. If they're on Kizayu (found by their email), you're connected to their doctor profile.
doctorsRouter.post("/doctors", wrap(async (req, res) => {
  const b = parse(z.object({
    name: z.string().trim().min(2).max(80).optional(), specialty: z.string().trim().min(2).max(80).optional(),
    phone: z.string().trim().max(20).optional(), email: z.string().email().optional(),
  }), req.body);
  let doctor = null as Awaited<ReturnType<typeof prisma.doctor.findUnique>>;
  if (b.email) {
    const u = await prisma.user.findUnique({ where: { email: b.email.toLowerCase() }, include: { doctorProfile: true } });
    if (u?.id === req.userId) throw new HttpError(400, "You can't add yourself as your doctor");
    doctor = u?.doctorProfile ?? null;
    if (!doctor && !b.name) throw new HttpError(404, "No Kizayu doctor uses that email. Add their name and specialty instead.");
  }
  if (!doctor) {
    if (!b.name || !b.specialty) throw new HttpError(400, "Name and specialty are required");
    doctor = await prisma.doctor.create({ data: { name: b.name, specialty: b.specialty, phone: b.phone || null, rating: 0, reviews: 0 } });
  }
  await prisma.doctorLink.upsert({ where: { userId_doctorId: { userId: req.userId, doctorId: doctor.id } }, update: {}, create: { userId: req.userId, doctorId: doctor.id } });
  res.status(201).json(doctorOut(doctor));
}));

doctorsRouter.get("/doctors/:id", wrap(async (req, res) => {
  const { doctor, sharedWith: shared } = await requireLink(req.userId, req.params.id);
  const ids = shared.split(",").filter(Boolean);
  const sharedWith = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: publicUser }) : [];
  const nextAppointment = await prisma.appointment.findFirst({
    where: { userId: req.userId, kind: "doctor", startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" },
  });
  const records = await prisma.healthRecord.groupBy({ by: ["type"], where: { userId: req.userId }, _count: true });
  res.json({ doctor: doctorOut(doctor), linked: true, canMessage: !!doctor.userId, sharedWith, nextAppointment, recordCounts: records });
}));

// Choose which family members can see my records via this doctor.
doctorsRouter.put("/doctors/:id/access", wrap(async (req, res) => {
  const b = parse(z.object({ sharedWith: z.array(z.string()) }), req.body);
  await requireLink(req.userId, req.params.id);
  for (const uid of b.sharedWith) {
    if (!(await canView(req.userId, uid))) throw new HttpError(400, "Can only share with people in your circles");
  }
  const link = await prisma.doctorLink.update({
    where: { userId_doctorId: { userId: req.userId, doctorId: req.params.id } }, data: { sharedWith: b.sharedWith.join(",") },
  });
  res.json({ linked: true, sharedWith: link.sharedWith.split(",").filter(Boolean) });
}));

// Remove a doctor from your list. Private doctor cards nobody else uses are deleted.
doctorsRouter.delete("/doctors/:id/access", wrap(async (req, res) => {
  const l = await requireLink(req.userId, req.params.id);
  await prisma.doctorLink.delete({ where: { id: l.id } });
  if (!l.doctor.userId && !(await prisma.doctorLink.count({ where: { doctorId: l.doctorId } }))) await prisma.doctor.delete({ where: { id: l.doctorId } });
  res.json({ linked: false });
}));

// ---------- Messaging ----------
const msgInclude = { sender: { select: publicUser } } as const;

async function postMessage(threadId: string, senderId: string, text: string) {
  const m = await prisma.doctorMessage.create({ data: { threadId, senderId, text }, include: msgInclude });
  const thread = await prisma.doctorThread.update({ where: { id: threadId }, data: { updatedAt: new Date() }, include: { doctor: true, patient: { select: publicUser } } });
  const recipients = [thread.patientId, thread.doctor.userId].filter((id): id is string => !!id && id !== senderId);
  for (const r of [thread.patientId, thread.doctor.userId]) if (r) io?.to(userRoom(r)).emit("doctorMessage", { ...m, threadId });
  const fromDoctor = senderId === thread.doctor.userId;
  await notify(recipients, {
    from: senderId, kind: "doctor",
    title: fromDoctor ? thread.doctor.name : `${thread.patient.name} (patient)`,
    body: text.length > 120 ? text.slice(0, 117) + "…" : text,
    data: fromDoctor ? { screen: "doctor-chat", doctorId: thread.doctorId } : { screen: "doctor-inbox", threadId },
  });
  return m;
}

// Patient side: my conversation with a doctor.
doctorsRouter.get("/doctors/:id/messages", wrap(async (req, res) => {
  await requireLink(req.userId, req.params.id);
  const thread = await prisma.doctorThread.findUnique({ where: { patientId_doctorId: { patientId: req.userId, doctorId: req.params.id } } });
  if (!thread) return res.json([]);
  await prisma.doctorMessage.updateMany({ where: { threadId: thread.id, senderId: { not: req.userId }, readAt: null }, data: { readAt: new Date() } });
  res.json(await prisma.doctorMessage.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: "asc" }, include: msgInclude }));
}));

doctorsRouter.post("/doctors/:id/messages", wrap(async (req, res) => {
  const { text } = parse(z.object({ text: z.string().trim().min(1).max(2000) }), req.body);
  const { doctor } = await requireLink(req.userId, req.params.id);
  if (!doctor.userId) throw new HttpError(409, "This doctor hasn't joined Kizayu messaging yet");
  if (doctor.userId === req.userId) throw new HttpError(400, "You can't message yourself");
  const thread = await prisma.doctorThread.upsert({
    where: { patientId_doctorId: { patientId: req.userId, doctorId: doctor.id } }, update: {}, create: { patientId: req.userId, doctorId: doctor.id },
  });
  res.status(201).json(await postMessage(thread.id, req.userId, text));
}));

// ---------- Doctor portal (the doctor's own login) ----------
doctorsRouter.get("/doctor-portal/profile", wrap(async (req, res) => {
  const d = await prisma.doctor.findUnique({ where: { userId: req.userId } });
  res.json(d ? { ...doctorOut(d), patients: await prisma.doctorLink.count({ where: { doctorId: d.id } }) } : null);
}));

// Turn on a doctor profile for this account, so patients can add you by your email and message you.
doctorsRouter.put("/doctor-portal/profile", wrap(async (req, res) => {
  const b = parse(z.object({ specialty: z.string().trim().min(2).max(80), phone: z.string().trim().max(20).optional() }), req.body);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  if (!me.email) throw new HttpError(400, "Add an email to your account first (Account & Security), so patients can find you");
  const d = await prisma.doctor.upsert({
    where: { userId: req.userId },
    update: { specialty: b.specialty, phone: b.phone || null, name: me.name, avatarUrl: me.avatarUrl },
    create: { userId: req.userId, name: me.name, specialty: b.specialty, phone: b.phone || null, avatarUrl: me.avatarUrl, rating: 0, reviews: 0 },
  });
  res.json(doctorOut(d));
}));
async function myDoctor(userId: string) {
  const d = await prisma.doctor.findUnique({ where: { userId } });
  if (!d) throw new HttpError(403, "This account isn't a doctor account");
  return d;
}

doctorsRouter.get("/doctor-portal/threads", wrap(async (req, res) => {
  const d = await myDoctor(req.userId);
  const threads = await prisma.doctorThread.findMany({
    where: { doctorId: d.id }, orderBy: { updatedAt: "desc" },
    include: { patient: { select: publicUser }, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const unread = await prisma.doctorMessage.groupBy({ by: ["threadId"], where: { thread: { doctorId: d.id }, senderId: { not: req.userId }, readAt: null }, _count: true });
  const u = new Map(unread.map(r => [r.threadId, r._count]));
  res.json(threads.map(t => ({ id: t.id, patient: t.patient, updatedAt: t.updatedAt, last: t.messages[0] ?? null, unread: u.get(t.id) ?? 0 })));
}));

async function myThread(userId: string, threadId: string) {
  const d = await myDoctor(userId);
  const t = await prisma.doctorThread.findFirst({ where: { id: threadId, doctorId: d.id }, include: { patient: { select: publicUser } } });
  if (!t) throw new HttpError(404, "Conversation not found");
  return t;
}

doctorsRouter.get("/doctor-portal/threads/:id", wrap(async (req, res) => {
  const t = await myThread(req.userId, req.params.id);
  await prisma.doctorMessage.updateMany({ where: { threadId: t.id, senderId: { not: req.userId }, readAt: null }, data: { readAt: new Date() } });
  const messages = await prisma.doctorMessage.findMany({ where: { threadId: t.id }, orderBy: { createdAt: "asc" }, include: msgInclude });
  const linked = !!(await prisma.doctorLink.findUnique({ where: { userId_doctorId: { userId: t.patientId, doctorId: t.doctorId } } }));
  res.json({ id: t.id, patient: t.patient, linked, messages });
}));

doctorsRouter.post("/doctor-portal/threads/:id/messages", wrap(async (req, res) => {
  const { text } = parse(z.object({ text: z.string().trim().min(1).max(2000) }), req.body);
  const t = await myThread(req.userId, req.params.id);
  res.status(201).json(await postMessage(t.id, req.userId, text));
}));

// A doctor sees a patient's vault only if that patient linked this doctor ("information you choose to share").
doctorsRouter.get("/doctor-portal/patients/:patientId/health", wrap(async (req, res) => {
  const d = await myDoctor(req.userId);
  const link = await prisma.doctorLink.findUnique({ where: { userId_doctorId: { userId: req.params.patientId, doctorId: d.id } } });
  if (!link) throw new HttpError(403, "This patient hasn't shared their health records with you");
  const userId = req.params.patientId;
  const [user, vitals, meds, records] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, age: true, gender: true, avatarUrl: true } }),
    prisma.vital.findMany({ where: { userId }, orderBy: { recordedAt: "desc" }, take: 30 }),
    prisma.medication.findMany({ where: { userId } }),
    prisma.healthRecord.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
  ]);
  const day = await dayOfUser(userId);
  res.json({ user, vitals, medications: meds.map(m => ({ id: m.id, name: m.name, schedule: m.schedule, taken: m.takenDate === day })), records });
}));
