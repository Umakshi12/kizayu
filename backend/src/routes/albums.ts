import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, assertInCircle, circleIdsOf, parse, publicUser, roleIn, wrap } from "../util";
import { notify } from "../services/notify";
import { deleteStoredFile } from "../services/files";
import { localDate, localMinutes } from "../services/time";

export const albumsRouter = Router();

const MAX_ALBUMS = 30, MAX_PHOTOS = 300;

albumsRouter.get("/albums", wrap(async (req, res) => {
  const { circleId } = parse(z.object({ circleId: z.string() }), req.query);
  await assertInCircle(req.userId, circleId);
  const rows = await prisma.album.findMany({ where: { circleId }, orderBy: { createdAt: "desc" }, include: { _count: { select: { photos: true } }, photos: { orderBy: { createdAt: "desc" }, take: 1 } } });
  res.json(rows.map(a => ({ id: a.id, title: a.title, count: a._count.photos, cover: a.photos[0]?.url ?? null, createdAt: a.createdAt })));
}));

albumsRouter.post("/albums", wrap(async (req, res) => {
  const b = parse(z.object({ circleId: z.string(), title: z.string().trim().min(1).max(60) }), req.body);
  await assertInCircle(req.userId, b.circleId);
  if ((await prisma.album.count({ where: { circleId: b.circleId } })) >= MAX_ALBUMS) throw new HttpError(400, "This circle has a lot of albums already");
  res.status(201).json({ id: (await prisma.album.create({ data: { ...b, createdById: req.userId } })).id });
}));

async function loadAlbum(userId: string, id: string) {
  const a = await prisma.album.findUnique({ where: { id } });
  if (!a || !(await roleIn(userId, a.circleId))) throw new HttpError(404, "Album not found");
  return a;
}

albumsRouter.get("/albums/:id", wrap(async (req, res) => {
  const a = await loadAlbum(req.userId, req.params.id);
  const photos = await prisma.albumPhoto.findMany({ where: { albumId: a.id }, orderBy: { createdAt: "desc" } });
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set(photos.map(p => p.uploadedById).filter((x): x is string => !!x))] } }, select: publicUser });
  const by = new Map(people.map(p => [p.id, p]));
  res.json({ id: a.id, title: a.title, createdById: a.createdById, photos: photos.map(p => ({ id: p.id, url: p.url, caption: p.caption, createdAt: p.createdAt, by: p.uploadedById ? by.get(p.uploadedById) ?? null : null })) });
}));

albumsRouter.delete("/albums/:id", wrap(async (req, res) => {
  const a = await loadAlbum(req.userId, req.params.id);
  if (a.createdById !== req.userId && (await roleIn(req.userId, a.circleId)) !== "owner") throw new HttpError(403, "Only the person who made it or a circle owner can delete it");
  const photos = await prisma.albumPhoto.findMany({ where: { albumId: a.id }, select: { url: true } });
  await prisma.album.delete({ where: { id: a.id } });
  await Promise.all(photos.map(p => deleteStoredFile(p.url)));
  res.status(204).end();
}));

albumsRouter.post("/albums/:id/photos", wrap(async (req, res) => {
  const a = await loadAlbum(req.userId, req.params.id);
  const b = parse(z.object({ url: z.string().url(), caption: z.string().trim().max(140).optional() }), req.body);
  if ((await prisma.albumPhoto.count({ where: { albumId: a.id } })) >= MAX_PHOTOS) throw new HttpError(400, "This album is full");
  const p = await prisma.albumPhoto.create({ data: { albumId: a.id, url: b.url, caption: b.caption || null, uploadedById: req.userId } });
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { name: true } });
  const mates = (await prisma.circleMember.findMany({ where: { circleId: a.circleId }, select: { userId: true } })).map(m => m.userId).filter(id => id !== req.userId);
  await notify(mates, { from: req.userId, kind: "comment", title: `${me.name} added a photo`, body: `to the album "${a.title}"`, data: { screen: "/albums" } });
  res.status(201).json({ id: p.id });
}));

albumsRouter.delete("/albums/photos/:id", wrap(async (req, res) => {
  const p = await prisma.albumPhoto.findUnique({ where: { id: req.params.id }, include: { album: true } });
  if (!p || !(await roleIn(req.userId, p.album.circleId))) throw new HttpError(404, "Photo not found");
  if (p.uploadedById !== req.userId && (await roleIn(req.userId, p.album.circleId)) !== "owner") throw new HttpError(403, "Only the person who added it or a circle owner can remove it");
  await prisma.albumPhoto.delete({ where: { id: p.id } });
  await deleteStoredFile(p.url);
  res.status(204).end();
}));

/** Photos and posts from this calendar day in earlier years, in the viewer's own day. */
export async function memoriesFor(userId: string, tz: number, now = new Date()) {
  const day = localDate(now, tz), mmdd = day.slice(5), year = Number(day.slice(0, 4));
  const circleIds = await circleIdsOf(userId);
  if (!circleIds.length) return [];
  const windowOf = (y: number) => { const start = new Date(Date.parse(`${y}-${mmdd}T00:00:00Z`) + tz * 60_000); return { gte: start, lt: new Date(start.getTime() + 86400e3) }; };
  const items: { kind: "post" | "photo"; id: string; url: string; text: string | null; yearsAgo: number; by: string | null }[] = [];
  for (let y = year - 1; y >= Math.max(year - 10, 2000); y--) {
    if (mmdd === "02-29" && new Date(Date.UTC(y, 1, 29)).getUTCMonth() !== 1) continue;
    const w = windowOf(y);
    const posts = await prisma.post.findMany({ where: { circleId: { in: circleIds }, imageUrl: { not: null }, createdAt: w }, include: { author: { select: { name: true } } }, take: 5 });
    for (const p of posts) items.push({ kind: "post", id: p.id, url: p.imageUrl!, text: p.caption, yearsAgo: year - y, by: p.author.name });
    const photos = await prisma.albumPhoto.findMany({ where: { album: { circleId: { in: circleIds } }, createdAt: w }, take: 5 });
    for (const p of photos) items.push({ kind: "photo", id: p.id, url: p.url, text: p.caption, yearsAgo: year - y, by: null });
  }
  return items.sort((a, b) => a.yearsAgo - b.yearsAgo).slice(0, 12);
}

albumsRouter.get("/memories/today", wrap(async (req, res) => {
  res.json(await memoriesFor(req.userId, req.tz));
}));

/** Scheduler job: a gentle "on this day" nudge around 9 AM local, only when there is something to show. */
export async function runMemories(now = new Date()) {
  let sent = 0;
  const users = await prisma.user.findMany({ where: { pushTokens: { some: {} } }, select: { id: true, tzOffsetMin: true, memoryDate: true } });
  for (const u of users) {
    const today = localDate(now, u.tzOffsetMin), mins = localMinutes(now, u.tzOffsetMin);
    if (u.memoryDate === today || mins < 9 * 60 || mins >= 11 * 60) continue;
    const c = await prisma.user.updateMany({ where: { id: u.id, OR: [{ memoryDate: null }, { memoryDate: { not: today } }] }, data: { memoryDate: today } });
    if (!c.count) continue;
    const mem = await memoriesFor(u.id, u.tzOffsetMin, now);
    if (!mem.length) continue;
    const yrs = mem[0].yearsAgo;
    await notify([u.id], { kind: "memory", title: "On this day 📸", body: `${mem.length} memor${mem.length > 1 ? "ies" : "y"} from ${yrs} year${yrs > 1 ? "s" : ""} ago`, data: { screen: "/" } });
    sent++;
  }
  return sent;
}
