import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, parse, wrap } from "../util";
import { notify } from "../services/notify";
import { deleteStoredFile } from "../services/files";
import { localDate, localMinutes } from "../services/time";
import { addDays } from "./habits";

export const studyRouter = Router();

const MAX_SUBJECTS = 20, MAX_CHAPTERS = 200, MAX_ASSIGNMENTS = 300, MAX_SLOTS = 150, MAX_NOTES = 300;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-01").refine(s => !Number.isNaN(Date.parse(s)), "That date doesn't exist");
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const weekdayOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400e3);

async function ownSubject(userId: string, id: string | null | undefined) {
  if (!id) return null;
  const s = await prisma.subject.findFirst({ where: { id, userId } });
  if (!s) throw new HttpError(404, "Subject not found");
  return s;
}

// ------------------------------------------------------------------ syllabus
type SubjectRow = { id: string; name: string; color: string; examDate: string | null; chapters: { id: string; title: string; done: boolean; position: number }[] };
function subjectView(s: SubjectRow, today: string) {
  const done = s.chapters.filter(c => c.done).length, total = s.chapters.length;
  const daysLeft = s.examDate ? daysBetween(today, s.examDate) : null;
  const left = total - done;
  // A gentle pace: how many chapters a week it takes to finish before the exam.
  const perWeek = daysLeft !== null && daysLeft > 0 && left > 0 ? Math.max(1, Math.ceil(left / Math.max(1, daysLeft / 7))) : null;
  return {
    id: s.id, name: s.name, color: s.color, examDate: s.examDate, daysLeft: daysLeft !== null && daysLeft >= 0 ? daysLeft : null, examPassed: daysLeft !== null && daysLeft < 0,
    done, total, percent: total ? Math.round((done / total) * 100) : 0, perWeek,
    chapters: [...s.chapters].sort((a, b) => a.position - b.position).map(c => ({ id: c.id, title: c.title, done: c.done })),
  };
}
const loadSubjects = (userId: string, where: object = {}) => prisma.subject.findMany({ where: { userId, ...where }, orderBy: { createdAt: "asc" }, include: { chapters: true } });

studyRouter.get("/study/subjects", wrap(async (req, res) => {
  res.json((await loadSubjects(req.userId)).map(s => subjectView(s, req.today)));
}));

studyRouter.post("/study/subjects", wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(40), color: color.optional(), examDate: date.optional(), chapters: z.array(z.string().trim().min(1).max(100)).max(60).optional() }), req.body);
  if ((await prisma.subject.count({ where: { userId: req.userId } })) >= MAX_SUBJECTS) throw new HttpError(400, `You can add up to ${MAX_SUBJECTS} subjects`);
  const s = await prisma.subject.create({
    data: { userId: req.userId, name: b.name, color: b.color, examDate: b.examDate, chapters: { create: (b.chapters ?? []).map((title, position) => ({ title, position })) } },
    include: { chapters: true },
  });
  res.status(201).json(subjectView(s, req.today));
}));

studyRouter.patch("/study/subjects/:id", wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(40).optional(), color: color.optional(), examDate: date.nullable().optional() }), req.body);
  await ownSubject(req.userId, req.params.id);
  const s = await prisma.subject.update({ where: { id: req.params.id }, data: b, include: { chapters: true } });
  res.json(subjectView(s, req.today));
}));

studyRouter.delete("/study/subjects/:id", wrap(async (req, res) => {
  const r = await prisma.subject.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  if (!r.count) throw new HttpError(404, "Subject not found");
  res.status(204).end();
}));

// Add chapters one by one or paste a whole list.
studyRouter.post("/study/subjects/:id/chapters", wrap(async (req, res) => {
  const { titles } = parse(z.object({ titles: z.array(z.string().trim().min(1).max(100)).min(1).max(60) }), req.body);
  const s = await ownSubject(req.userId, req.params.id);
  const have = await prisma.chapter.count({ where: { subjectId: s!.id } });
  if (have + titles.length > MAX_CHAPTERS) throw new HttpError(400, `A subject can have up to ${MAX_CHAPTERS} chapters`);
  await prisma.chapter.createMany({ data: titles.map((title, i) => ({ subjectId: s!.id, title, position: have + i })) });
  res.status(201).json(subjectView((await loadSubjects(req.userId, { id: s!.id }))[0], req.today));
}));

async function ownChapter(userId: string, id: string) {
  const c = await prisma.chapter.findFirst({ where: { id, subject: { userId } } });
  if (!c) throw new HttpError(404, "Chapter not found");
  return c;
}

studyRouter.patch("/study/chapters/:id", wrap(async (req, res) => {
  const b = parse(z.object({ title: z.string().trim().min(1).max(100).optional(), done: z.boolean().optional() }), req.body);
  const c = await ownChapter(req.userId, req.params.id);
  await prisma.chapter.update({ where: { id: c.id }, data: b });
  res.json(subjectView((await loadSubjects(req.userId, { id: c.subjectId }))[0], req.today));
}));

studyRouter.delete("/study/chapters/:id", wrap(async (req, res) => {
  const c = await ownChapter(req.userId, req.params.id);
  await prisma.chapter.delete({ where: { id: c.id } });
  res.json(subjectView((await loadSubjects(req.userId, { id: c.subjectId }))[0], req.today));
}));

// ------------------------------------------------------------------ assignments
type AssignmentRow = { id: string; title: string; subjectId: string | null; dueDate: string | null; priority: string; done: boolean; doneAt: Date | null };
function assignmentView(a: AssignmentRow, subjects: Map<string, { name: string; color: string }>, today: string) {
  const s = a.subjectId ? subjects.get(a.subjectId) : null;
  const dueIn = a.dueDate ? daysBetween(today, a.dueDate) : null;
  return {
    id: a.id, title: a.title, subjectId: a.subjectId, subject: s?.name ?? null, color: s?.color ?? null, dueDate: a.dueDate, priority: a.priority,
    done: a.done, doneAt: a.doneAt, dueIn, overdue: !a.done && dueIn !== null && dueIn < 0,
  };
}
const subjectMap = async (userId: string) => new Map((await prisma.subject.findMany({ where: { userId }, select: { id: true, name: true, color: true } })).map(s => [s.id, s]));
const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

studyRouter.get("/study/assignments", wrap(async (req, res) => {
  const [rows, subs] = await Promise.all([prisma.assignment.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" }, take: MAX_ASSIGNMENTS }), subjectMap(req.userId)]);
  const list = rows.map(a => assignmentView(a, subs, req.today));
  // Open work first: soonest deadline, then priority. Finished work last, newest first.
  const open = list.filter(a => !a.done).sort((a, b) => (a.dueIn ?? 9e9) - (b.dueIn ?? 9e9) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  const finished = list.filter(a => a.done).sort((a, b) => +new Date(b.doneAt ?? 0) - +new Date(a.doneAt ?? 0));
  res.json([...open, ...finished]);
}));

const assignmentBody = z.object({ title: z.string().trim().min(1).max(120), subjectId: z.string().nullable().optional(), dueDate: date.nullable().optional(), priority: z.enum(["low", "normal", "high"]).optional() });

studyRouter.post("/study/assignments", wrap(async (req, res) => {
  const b = parse(assignmentBody, req.body);
  if ((await prisma.assignment.count({ where: { userId: req.userId, done: false } })) >= MAX_ASSIGNMENTS) throw new HttpError(400, "That's a lot of open assignments. Finish a few first");
  await ownSubject(req.userId, b.subjectId);
  const a = await prisma.assignment.create({ data: { userId: req.userId, title: b.title, subjectId: b.subjectId ?? null, dueDate: b.dueDate ?? null, priority: b.priority ?? "normal" } });
  res.status(201).json(assignmentView(a, await subjectMap(req.userId), req.today));
}));

studyRouter.patch("/study/assignments/:id", wrap(async (req, res) => {
  const b = parse(assignmentBody.partial().extend({ done: z.boolean().optional() }), req.body);
  const own = await prisma.assignment.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!own) throw new HttpError(404, "Assignment not found");
  if (b.subjectId !== undefined) await ownSubject(req.userId, b.subjectId);
  const { done, ...rest } = b;
  const a = await prisma.assignment.update({
    where: { id: own.id },
    data: { ...rest, ...(done === undefined ? {} : { done, doneAt: done ? new Date() : null }) },
  });
  res.json(assignmentView(a, await subjectMap(req.userId), req.today));
}));

studyRouter.delete("/study/assignments/:id", wrap(async (req, res) => {
  const r = await prisma.assignment.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  if (!r.count) throw new HttpError(404, "Assignment not found");
  res.status(204).end();
}));

// ------------------------------------------------------------------ timetable
const clock = z.number().int().min(0).max(24 * 60);
const slotBody = z.object({
  title: z.string().trim().min(1).max(60), subjectId: z.string().nullable().optional(), note: z.string().trim().max(200).nullable().optional(),
  weekday: z.number().int().min(0).max(6).nullable().optional(), date: date.nullable().optional(), startMin: clock, endMin: clock,
});

type SlotRow = { id: string; title: string; subjectId: string | null; weekday: number | null; date: string | null; startMin: number; endMin: number; note: string | null };
const slotView = (s: SlotRow, subjects: Map<string, { name: string; color: string }>) => ({
  id: s.id, title: s.title, subjectId: s.subjectId, subject: s.subjectId ? subjects.get(s.subjectId)?.name ?? null : null, color: s.subjectId ? subjects.get(s.subjectId)?.color ?? null : null,
  weekday: s.weekday, date: s.date, startMin: s.startMin, endMin: s.endMin, note: s.note, repeats: s.weekday !== null,
});
const slotOn = (s: { weekday: number | null; date: string | null }, day: string) => (s.date ? s.date === day : s.weekday === weekdayOf(day));

/** Does a new slot overlap an existing one on the same day? */
async function findClash(userId: string, w: { weekday: number | null; date: string | null; startMin: number; endMin: number }, ignoreId?: string) {
  const all = await prisma.timetableSlot.findMany({ where: { userId, ...(ignoreId ? { id: { not: ignoreId } } : {}) } });
  return all.find(o => {
    const sameDay = w.date ? slotOn(o, w.date) : o.weekday === w.weekday || (o.date && weekdayOf(o.date) === w.weekday);
    return sameDay && o.startMin < w.endMin && w.startMin < o.endMin;
  });
}

function checkSlot(b: z.infer<typeof slotBody>, today: string) {
  const weekday = b.weekday ?? null, d = b.date ?? null;
  if ((weekday === null) === (d === null)) throw new HttpError(400, "Pick either a weekday that repeats, or one date");
  if (b.endMin <= b.startMin) throw new HttpError(400, "The end time must be after the start");
  if (d && d < today) throw new HttpError(400, "That date has already passed");
  return { weekday, date: d };
}

studyRouter.get("/study/timetable", wrap(async (req, res) => {
  const [rows, subs] = await Promise.all([prisma.timetableSlot.findMany({ where: { userId: req.userId, OR: [{ weekday: { not: null } }, { date: { gte: req.today } }] }, orderBy: { startMin: "asc" } }), subjectMap(req.userId)]);
  res.json(rows.map(s => slotView(s, subs)));
}));

studyRouter.post("/study/timetable", wrap(async (req, res) => {
  const b = parse(slotBody, req.body);
  const when = checkSlot(b, req.today);
  await ownSubject(req.userId, b.subjectId);
  if ((await prisma.timetableSlot.count({ where: { userId: req.userId } })) >= MAX_SLOTS) throw new HttpError(400, "Your timetable is full. Remove a few slots first");
  const clash = await findClash(req.userId, { ...when, startMin: b.startMin, endMin: b.endMin });
  if (clash) throw new HttpError(409, `That overlaps with "${clash.title}"`);
  const s = await prisma.timetableSlot.create({ data: { userId: req.userId, title: b.title, subjectId: b.subjectId ?? null, note: b.note ?? null, startMin: b.startMin, endMin: b.endMin, ...when } });
  res.status(201).json(slotView(s, await subjectMap(req.userId)));
}));

studyRouter.patch("/study/timetable/:id", wrap(async (req, res) => {
  const b = parse(slotBody, req.body);
  const own = await prisma.timetableSlot.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!own) throw new HttpError(404, "Slot not found");
  const when = checkSlot(b, req.today);
  await ownSubject(req.userId, b.subjectId);
  const clash = await findClash(req.userId, { ...when, startMin: b.startMin, endMin: b.endMin }, own.id);
  if (clash) throw new HttpError(409, `That overlaps with "${clash.title}"`);
  const s = await prisma.timetableSlot.update({ where: { id: own.id }, data: { title: b.title, subjectId: b.subjectId ?? null, note: b.note ?? null, startMin: b.startMin, endMin: b.endMin, ...when } });
  res.json(slotView(s, await subjectMap(req.userId)));
}));

studyRouter.delete("/study/timetable/:id", wrap(async (req, res) => {
  const r = await prisma.timetableSlot.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  if (!r.count) throw new HttpError(404, "Slot not found");
  res.status(204).end();
}));

// One tap scheduling: put a task into the next free study window (3 PM to 9 PM) in the coming week.
const WINDOW = { from: 15 * 60, to: 21 * 60, step: 15 };
studyRouter.post("/study/schedule", wrap(async (req, res) => {
  const b = parse(z.object({ assignmentId: z.string().optional(), chapterId: z.string().optional(), title: z.string().trim().min(1).max(60).optional(), minutes: z.number().int().min(15).max(180).default(45) }), req.body);
  let title = b.title, subjectId: string | null = null;
  if (b.assignmentId) {
    const a = await prisma.assignment.findFirst({ where: { id: b.assignmentId, userId: req.userId } });
    if (!a) throw new HttpError(404, "Assignment not found");
    title = title ?? a.title.slice(0, 60); subjectId = a.subjectId;
  } else if (b.chapterId) {
    const c = await ownChapter(req.userId, b.chapterId);
    const s = await prisma.subject.findUniqueOrThrow({ where: { id: c.subjectId } });
    title = title ?? `${s.name}: ${c.title}`.slice(0, 60); subjectId = s.id;
  }
  if (!title) throw new HttpError(400, "Say what to schedule");
  if ((await prisma.timetableSlot.count({ where: { userId: req.userId } })) >= MAX_SLOTS) throw new HttpError(400, "Your timetable is full. Remove a few slots first");

  const nowMin = localMinutes(new Date(), req.tz);
  const rows = await prisma.timetableSlot.findMany({ where: { userId: req.userId } });
  for (let i = 0; i < 7; i++) {
    const day = addDays(req.today, i);
    const busy = rows.filter(s => slotOn(s, day));
    let start = Math.max(WINDOW.from, i === 0 ? Math.ceil((nowMin + 10) / WINDOW.step) * WINDOW.step : 0);
    for (; start + b.minutes <= WINDOW.to; start += WINDOW.step) {
      if (busy.some(o => o.startMin < start + b.minutes && start < o.endMin)) continue;
      const s = await prisma.timetableSlot.create({ data: { userId: req.userId, title, subjectId, date: day, startMin: start, endMin: start + b.minutes } });
      return void res.status(201).json(slotView(s, await subjectMap(req.userId)));
    }
  }
  throw new HttpError(409, "No free time in the next 7 days between 3 PM and 9 PM");
}));

// ------------------------------------------------------------------ today
studyRouter.get("/study/today", wrap(async (req, res) => {
  const [slots, open, subs, nextChapters] = await Promise.all([
    prisma.timetableSlot.findMany({ where: { userId: req.userId, OR: [{ date: req.today }, { weekday: weekdayOf(req.today) }] }, orderBy: { startMin: "asc" } }),
    prisma.assignment.findMany({ where: { userId: req.userId, done: false, dueDate: { not: null, lte: addDays(req.today, 2) } }, orderBy: { dueDate: "asc" } }),
    subjectMap(req.userId),
    prisma.chapter.count({ where: { done: false, subject: { userId: req.userId } } }),
  ]);
  const nowMin = localMinutes(new Date(), req.tz);
  const view = slots.map(s => ({ ...slotView(s, subs), now: s.startMin <= nowMin && nowMin < s.endMin, past: s.endMin <= nowMin }));
  res.json({
    date: req.today, slots: view,
    assignments: open.map(a => assignmentView(a, subs, req.today)),
    chaptersLeft: nextChapters,
  });
}));

// ------------------------------------------------------------------ study materials
const noteBody = z.object({
  title: z.string().trim().min(1).max(80), kind: z.enum(["note", "formula", "link", "file"]).default("note"), body: z.string().max(5000).default(""),
  url: z.string().url().max(500).nullable().optional(), subjectId: z.string().nullable().optional(),
});

studyRouter.get("/study/notes", wrap(async (req, res) => {
  const q = parse(z.object({ subjectId: z.string().optional(), q: z.string().trim().max(60).optional() }), req.query);
  const subs = await subjectMap(req.userId);
  const rows = await prisma.studyNote.findMany({
    where: { userId: req.userId, ...(q.subjectId ? { subjectId: q.subjectId } : {}), ...(q.q ? { OR: [{ title: { contains: q.q, mode: "insensitive" } }, { body: { contains: q.q, mode: "insensitive" } }] } : {}) },
    orderBy: { createdAt: "desc" }, take: MAX_NOTES,
  });
  res.json(rows.map(n => ({ id: n.id, title: n.title, kind: n.kind, body: n.body, url: n.url, subjectId: n.subjectId, subject: n.subjectId ? subs.get(n.subjectId)?.name ?? null : null, color: n.subjectId ? subs.get(n.subjectId)?.color ?? null : null, createdAt: n.createdAt })));
}));

studyRouter.post("/study/notes", wrap(async (req, res) => {
  const b = parse(noteBody, req.body);
  if (b.kind === "link" && !b.url) throw new HttpError(400, "Paste the link");
  if (b.kind === "file" && !b.url) throw new HttpError(400, "Add a photo");
  if ((b.kind === "note" || b.kind === "formula") && !b.body.trim()) throw new HttpError(400, "Write something in it");
  if ((await prisma.studyNote.count({ where: { userId: req.userId } })) >= MAX_NOTES) throw new HttpError(400, "Your vault is full. Delete some old notes first");
  await ownSubject(req.userId, b.subjectId);
  const n = await prisma.studyNote.create({ data: { userId: req.userId, title: b.title, kind: b.kind, body: b.body, url: b.url ?? null, subjectId: b.subjectId ?? null } });
  res.status(201).json({ id: n.id });
}));

studyRouter.patch("/study/notes/:id", wrap(async (req, res) => {
  const b = parse(noteBody.partial().omit({ kind: true }), req.body);
  const own = await prisma.studyNote.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!own) throw new HttpError(404, "Note not found");
  if (b.subjectId !== undefined) await ownSubject(req.userId, b.subjectId);
  await prisma.studyNote.update({ where: { id: own.id }, data: b });
  res.json({ id: own.id });
}));

studyRouter.delete("/study/notes/:id", wrap(async (req, res) => {
  const own = await prisma.studyNote.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!own) throw new HttpError(404, "Note not found");
  await prisma.studyNote.delete({ where: { id: own.id } });
  if (own.kind === "file") await deleteStoredFile(own.url);
  res.status(204).end();
}));

// ------------------------------------------------------------------ reminders (called by the scheduler)
/** "Due today" in the morning and "due tomorrow" in the evening, once each per assignment. */
export async function runAssignmentReminders(now = new Date()) {
  let sent = 0;
  const users = await prisma.user.findMany({ where: { pushTokens: { some: {} }, assignments: { some: { done: false, dueDate: { not: null } } } }, select: { id: true, tzOffsetMin: true } });
  for (const u of users) {
    const today = localDate(now, u.tzOffsetMin), mins = localMinutes(now, u.tzOffsetMin);
    const pass: { when: string; mark: string; label: string; ok: boolean }[] = [
      { when: today, mark: `d:${today}`, label: "due today", ok: mins >= 8 * 60 && mins < 12 * 60 },
      { when: addDays(today, 1), mark: `t:${today}`, label: "due tomorrow", ok: mins >= 17 * 60 && mins < 21 * 60 },
    ];
    for (const p of pass) {
      if (!p.ok) continue;
      const due = await prisma.assignment.findMany({ where: { userId: u.id, done: false, dueDate: p.when, OR: [{ notifiedOn: null }, { notifiedOn: { not: p.mark } }] } });
      const claimed: string[] = [];
      for (const a of due) {
        const c = await prisma.assignment.updateMany({ where: { id: a.id, OR: [{ notifiedOn: null }, { notifiedOn: { not: p.mark } }] }, data: { notifiedOn: p.mark } });
        if (c.count) claimed.push(a.title);
      }
      if (!claimed.length) continue;
      await notify([u.id], {
        kind: "study", title: claimed.length === 1 ? `Assignment ${p.label}` : `${claimed.length} assignments ${p.label}`,
        body: claimed.slice(0, 3).join(", ") + (claimed.length > 3 ? ` and ${claimed.length - 3} more` : ""), data: { screen: "/study-assignments" },
      });
      sent++;
    }
  }
  return sent;
}
