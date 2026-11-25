import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, assertInCircle, circleIdsOf, parse, publicUser, roleIn, wrap } from "../util";
import { notify } from "../services/notify";
import { fmtDay, fmtTime } from "../services/time";

export const eventsRouter = Router();

const DAY = 86400e3;

/** The next time an event happens at or after `from` (yearly events repeat on the same month/day). */
export function nextOccurrence(e: { startsAt: Date; repeat: string }, from: Date): Date | null {
  if (e.repeat !== "yearly") return e.startsAt.getTime() >= from.getTime() ? e.startsAt : null;
  const s = e.startsAt;
  for (let y = from.getUTCFullYear(); y <= from.getUTCFullYear() + 1; y++) {
    // Feb 29 birthdays fall on Feb 28 in non-leap years
    const d = new Date(Date.UTC(y, s.getUTCMonth(), s.getUTCDate(), s.getUTCHours(), s.getUTCMinutes()));
    if (d.getUTCMonth() !== s.getUTCMonth()) d.setUTCDate(0);
    if (d.getTime() >= from.getTime()) return d;
  }
  return null;
}

type EventRow = Awaited<ReturnType<typeof loadEvents>>[number];

const loadEvents = (circleIds: string[], where: object = {}) => prisma.familyEvent.findMany({
  where: { circleId: { in: circleIds }, ...where }, include: { rsvps: { include: { user: { select: publicUser } } }, circle: { select: { name: true } } },
});

function view(e: EventRow, me: string, at: Date) {
  const mine = e.rsvps.find(r => r.userId === me)?.status ?? null;
  // RSVPs belong to the specific occurrence only for one-off events; yearly ones are shown without RSVPs.
  const rsvps = e.repeat === "yearly" ? [] : e.rsvps;
  return {
    id: e.id, circleId: e.circleId, circleName: e.circle.name, title: e.title, notes: e.notes, kind: e.kind, allDay: e.allDay, repeat: e.repeat,
    startsAt: at, createdById: e.createdById,
    myRsvp: e.repeat === "yearly" ? null : mine,
    going: rsvps.filter(r => r.status === "yes").map(r => r.user), maybe: rsvps.filter(r => r.status === "maybe").map(r => r.user), no: rsvps.filter(r => r.status === "no").map(r => r.user),
  };
}

// Events in a window (default: from today to 60 days ahead), yearly ones expanded into the window.
eventsRouter.get("/events", wrap(async (req, res) => {
  const q = parse(z.object({ circleId: z.string().optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional() }), req.query);
  const mine = await circleIdsOf(req.userId);
  if (q.circleId && !mine.includes(q.circleId)) throw new HttpError(403, "Not a member of this circle");
  const from = q.from ? new Date(q.from) : new Date(Date.now() - DAY);
  const to = q.to ? new Date(q.to) : new Date(from.getTime() + 60 * DAY);
  if (to.getTime() - from.getTime() > 400 * DAY) throw new HttpError(400, "Pick a shorter date range");
  const rows = await loadEvents(q.circleId ? [q.circleId] : mine);
  const items: ReturnType<typeof view>[] = [];
  for (const e of rows) {
    let cursor = from;
    for (let i = 0; i < 3; i++) { // a window under 400 days holds at most 2 yearly occurrences
      const at = nextOccurrence(e, cursor);
      if (!at || at.getTime() > to.getTime()) break;
      items.push(view(e, req.userId, at));
      if (e.repeat !== "yearly") break;
      cursor = new Date(at.getTime() + DAY);
    }
  }
  res.json(items.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()));
}));

const body = z.object({
  title: z.string().trim().min(1).max(80), notes: z.string().trim().max(500).optional(),
  kind: z.enum(["event", "birthday", "anniversary"]).default("event"),
  startsAt: z.string().datetime(), allDay: z.boolean().default(false), repeat: z.enum(["none", "yearly"]).default("none"),
});

eventsRouter.post("/events", wrap(async (req, res) => {
  const b = parse(body.extend({ circleId: z.string() }), req.body);
  await assertInCircle(req.userId, b.circleId);
  const startsAt = new Date(b.startsAt);
  const repeat = b.kind === "event" ? b.repeat : "yearly"; // birthdays and anniversaries always repeat
  if (repeat === "none" && startsAt.getTime() < Date.now() - DAY) throw new HttpError(400, "That date has already passed");
  const e = await prisma.familyEvent.create({ data: { ...b, repeat, startsAt, notes: b.notes || null, createdById: req.userId } });
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { name: true, tzOffsetMin: true } });
  const mates = (await prisma.circleMember.findMany({ where: { circleId: e.circleId }, select: { userId: true } })).map(m => m.userId);
  await notify(mates.filter(id => id !== req.userId), {
    from: req.userId, kind: "event", title: `${me.name} added ${e.kind === "event" ? "an event" : `a ${e.kind}`}`,
    body: `${e.title} · ${fmtDay(startsAt, me.tzOffsetMin)}${e.allDay ? "" : ` ${fmtTime(startsAt, me.tzOffsetMin)}`}`, data: { screen: "/calendar" },
  });
  res.status(201).json({ id: e.id });
}));

async function canEdit(userId: string, e: { createdById: string | null; circleId: string }) {
  if (e.createdById === userId) return true;
  return (await roleIn(userId, e.circleId)) === "owner";
}

eventsRouter.patch("/events/:id", wrap(async (req, res) => {
  const b = parse(body.partial(), req.body);
  const e = await prisma.familyEvent.findUnique({ where: { id: req.params.id } });
  if (!e || !(await roleIn(req.userId, e.circleId))) throw new HttpError(404, "Event not found");
  if (!(await canEdit(req.userId, e))) throw new HttpError(403, "Only the person who made it or a circle owner can change it");
  const data: Record<string, unknown> = { ...b };
  if (b.startsAt) { data.startsAt = new Date(b.startsAt); data.notified1dFor = null; data.notified1hFor = null; }
  await prisma.familyEvent.update({ where: { id: e.id }, data });
  res.json({ ok: true });
}));

eventsRouter.delete("/events/:id", wrap(async (req, res) => {
  const e = await prisma.familyEvent.findUnique({ where: { id: req.params.id } });
  if (!e || !(await roleIn(req.userId, e.circleId))) throw new HttpError(404, "Event not found");
  if (!(await canEdit(req.userId, e))) throw new HttpError(403, "Only the person who made it or a circle owner can delete it");
  await prisma.familyEvent.delete({ where: { id: e.id } });
  res.status(204).end();
}));

eventsRouter.put("/events/:id/rsvp", wrap(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(["yes", "maybe", "no"]) }), req.body);
  const e = await prisma.familyEvent.findUnique({ where: { id: req.params.id } });
  if (!e || !(await roleIn(req.userId, e.circleId))) throw new HttpError(404, "Event not found");
  const had = await prisma.eventRsvp.findUnique({ where: { eventId_userId: { eventId: e.id, userId: req.userId } } });
  await prisma.eventRsvp.upsert({ where: { eventId_userId: { eventId: e.id, userId: req.userId } }, update: { status }, create: { eventId: e.id, userId: req.userId, status } });
  if (e.createdById && e.createdById !== req.userId && had?.status !== status) {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { name: true } });
    await notify([e.createdById], { from: req.userId, kind: "event", title: `${me.name}: ${status === "yes" ? "going" : status === "maybe" ? "maybe" : "can't make it"}`, body: e.title, data: { screen: "/calendar" } });
  }
  res.json({ status });
}));

/** Scheduler job: "tomorrow" and "in an hour" reminders for everyone in the circle, once per occurrence. */
export async function runEventReminders(now = new Date()) {
  let sent = 0;
  const rows = await prisma.familyEvent.findMany({ include: { circle: { include: { members: { include: { user: { select: { id: true, tzOffsetMin: true } } } } } } } });
  for (const e of rows) {
    const at = nextOccurrence(e, new Date(now.getTime() - 60_000));
    if (!at) continue;
    const ms = at.getTime() - now.getTime();
    const people = e.circle.members.map(m => m.user);
    const label = (tz: number) => e.allDay ? fmtDay(at, 0) : `${fmtDay(at, tz)} ${fmtTime(at, tz)}`;
    const icon = e.kind === "birthday" ? "🎂 " : e.kind === "anniversary" ? "💍 " : "";
    if (!e.allDay && ms > 0 && ms <= 3600e3 && e.notified1hFor?.getTime() !== at.getTime()) {
      const c = await prisma.familyEvent.updateMany({ where: { id: e.id, OR: [{ notified1hFor: null }, { notified1hFor: { not: at } }] }, data: { notified1hFor: at, notified1dFor: at } });
      if (c.count) { await notify(people.map(p => p.id), { kind: "event", title: `${icon}Starting within the hour`, body: `${e.title} at ${fmtTime(at, people[0]?.tzOffsetMin ?? 0)}`, data: { screen: "/calendar" } }); sent++; }
    } else if (ms > 3600e3 && ms <= DAY && e.notified1dFor?.getTime() !== at.getTime()) {
      const c = await prisma.familyEvent.updateMany({ where: { id: e.id, OR: [{ notified1dFor: null }, { notified1dFor: { not: at } }] }, data: { notified1dFor: at } });
      if (c.count) { await notify(people.map(p => p.id), { kind: "event", title: `${icon}Tomorrow: ${e.title}`, body: label(people[0]?.tzOffsetMin ?? 0), data: { screen: "/calendar" } }); sent++; }
    }
  }
  return sent;
}
