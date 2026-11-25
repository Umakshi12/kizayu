import { prisma } from "../db";

// "Today" must mean the user's own day. The app reports its timezone as JS getTimezoneOffset() does:
// minutes BEHIND UTC (India = -330, New York in winter = 300). local time = UTC - offset.

const shift = (now: Date, tz: number) => new Date(now.getTime() - tz * 60_000);

/** The user's local calendar day, "YYYY-MM-DD". */
export const localDate = (now: Date, tz: number) => shift(now, tz).toISOString().slice(0, 10);

/** Minutes since local midnight (0..1439). */
export const localMinutes = (now: Date, tz: number) => { const d = shift(now, tz); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

/** "HH:MM" (24h) → minutes since midnight, or null. */
export const parseHHMM = (s?: string | null): number | null => {
  const m = (s ?? "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** "11:30 AM" in the user's timezone. */
export const fmtTime = (d: Date, tz: number) => {
  const l = shift(d, tz); const h = l.getUTCHours(), m = l.getUTCMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/** "Fri 28 Nov" in the user's timezone. */
export const fmtDay = (d: Date, tz: number) => {
  const l = shift(d, tz);
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][l.getUTCDay()]} ${l.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][l.getUTCMonth()]}`;
};

/** A specific user's local day right now (used when looking at someone else's data). */
export async function dayOfUser(userId: string, now = new Date()): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { tzOffsetMin: true } });
  return localDate(now, u?.tzOffsetMin ?? 0);
}

/** "4:30 PM" from minutes since midnight. */
export const fmtMin = (m: number) => { const h = Math.floor(m / 60) % 24; return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
