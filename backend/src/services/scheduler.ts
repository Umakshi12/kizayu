import { prisma } from "../db";
import { circleMatesOf, notify } from "./notify";
import { fmtTime, localDate, localMinutes, parseHHMM } from "./time";
import { runCheckIns } from "../routes/checkins";
import { runEventReminders } from "../routes/events";
import { runMemories } from "../routes/albums";

// Background jobs. Every job takes an injectable `now` and claims its work with an atomic updateMany,
// so running twice (or on two servers) never sends the same notification twice.

const tzOf = (u: { tzOffsetMin: number }) => u.tzOffsetMin;

/** "Appointment tomorrow" (24h before) and "in an hour" reminders. */
export async function runAppointmentReminders(now = new Date()) {
  let sent = 0;
  const in1d = new Date(now.getTime() + 24 * 3600e3), in1h = new Date(now.getTime() + 3600e3);
  const hour = await prisma.appointment.findMany({ where: { notified1h: false, startsAt: { gt: now, lte: in1h } }, include: { user: { select: { tzOffsetMin: true } } } });
  for (const a of hour) {
    const c = await prisma.appointment.updateMany({ where: { id: a.id, notified1h: false }, data: { notified1h: true, notified1d: true } });
    if (!c.count) continue;
    await notify([a.userId], { kind: "doctor", title: "Coming up in an hour", body: `${a.title} at ${fmtTime(a.startsAt, tzOf(a.user))}`, data: { screen: "/health" } });
    sent++;
  }
  const day = await prisma.appointment.findMany({ where: { notified1d: false, startsAt: { gt: in1h, lte: in1d } }, include: { user: { select: { tzOffsetMin: true } } } });
  for (const a of day) {
    const c = await prisma.appointment.updateMany({ where: { id: a.id, notified1d: false }, data: { notified1d: true } });
    if (!c.count) continue;
    await notify([a.userId], { kind: "doctor", title: "Appointment tomorrow", body: `${a.title} at ${fmtTime(a.startsAt, tzOf(a.user))}`, data: { screen: "/health" } });
    sent++;
  }
  return sent;
}

/** Tell the family when a medicine with a reminder time is still not marked taken an hour later. */
export async function runMissedMedicine(now = new Date(), graceMin = 60) {
  let sent = 0;
  const meds = await prisma.medication.findMany({ where: { remindAt: { not: null } }, include: { user: { select: { id: true, name: true, tzOffsetMin: true } } } });
  for (const m of meds) {
    const tz = m.user.tzOffsetMin, today = localDate(now, tz), due = parseHHMM(m.remindAt);
    if (due === null || m.takenDate === today || m.missedDate === today) continue;
    const mins = localMinutes(now, tz);
    if (mins < due + graceMin || mins >= 24 * 60) continue; // not yet late, or day rolled over (due+grace may exceed midnight; skip)
    const c = await prisma.medication.updateMany({ where: { id: m.id, OR: [{ missedDate: null }, { missedDate: { not: today } }] }, data: { missedDate: today } });
    if (!c.count) continue;
    const mates = await circleMatesOf(m.user.id);
    await notify(mates, { from: m.user.id, kind: "care", title: `${m.user.name} may have missed a dose`, body: `${m.name} was due at ${m.remindAt} and isn't marked as taken yet.`, data: { screen: "/health", userId: m.user.id } });
    sent++;
  }
  return sent;
}

/** One gentle evening nudge (7–9 PM local) when tasks or habits are still open. Only people with a registered device. */
export async function runEveningNudges(now = new Date()) {
  let sent = 0;
  const users = await prisma.user.findMany({ where: { pushTokens: { some: {} } }, select: { id: true, tzOffsetMin: true, nudgeDate: true } });
  for (const u of users) {
    const today = localDate(now, u.tzOffsetMin), mins = localMinutes(now, u.tzOffsetMin);
    if (u.nudgeDate === today || mins < 19 * 60 || mins >= 21 * 60) continue;
    const c = await prisma.user.updateMany({ where: { id: u.id, OR: [{ nudgeDate: null }, { nudgeDate: { not: today } }] }, data: { nudgeDate: today } });
    if (!c.count) continue;
    const tasks = await prisma.task.findMany({ where: { userId: u.id }, select: { doneDate: true, doneCount: true, targetCount: true } });
    const openTasks = tasks.filter(t => !(t.doneDate === today && t.doneCount >= t.targetCount)).length;
    const habits = await prisma.habit.findMany({ where: { userId: u.id, archived: false }, include: { logs: { where: { date: today }, select: { count: true } } } });
    const openHabits = habits.filter(h => (h.logs[0]?.count ?? 0) < h.target).length;
    if (!openTasks && !openHabits) continue;
    const parts = [openTasks && `${openTasks} task${openTasks > 1 ? "s" : ""}`, openHabits && `${openHabits} habit${openHabits > 1 ? "s" : ""}`].filter(Boolean).join(" and ");
    await notify([u.id], { kind: "nudge", title: "Still on your list today", body: `You have ${parts} left. A few minutes is enough.`, data: { screen: "/" } });
    sent++;
  }
  return sent;
}

const JOBS: Array<[string, (now: Date) => Promise<number>]> = [
  ["appointments", runAppointmentReminders],
  ["missed-medicine", runMissedMedicine],
  ["evening-nudges", runEveningNudges],
  ["check-ins", runCheckIns],
  ["event-reminders", runEventReminders],
  ["memories", runMemories],
];

let running = false;
export async function runScheduler(now = new Date()) {
  if (running) return;
  running = true;
  try {
    for (const [name, fn] of JOBS) {
      try { const n = await fn(now); if (n) console.log(`[scheduler] ${name}: ${n}`); }
      catch (e) { console.warn(`[scheduler] ${name} failed:`, (e as Error).message); }
    }
  } finally { running = false; }
}

export function startScheduler(everyMs = 60_000) {
  const t = setInterval(() => void runScheduler(), everyMs);
  t.unref();
  return t;
}
