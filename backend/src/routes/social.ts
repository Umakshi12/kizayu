import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, assertInCircle, circleIdsOf, parse, publicUser, pulse, wrap } from "../util";
import { notify } from "../services/notify";
import { deleteStoredFile } from "../services/files";
import { blockedIds } from "./moderation";

export const socialRouter = Router();

/** A post is visible to its author and to members of the circle it was shared in. */
async function visiblePost(userId: string, postId: string) {
  const p = await prisma.post.findUnique({ where: { id: postId } });
  if (!p) throw new HttpError(404, "Post not found");
  if (p.authorId === userId) return p;
  if (!p.circleId) throw new HttpError(404, "Post not found");
  await assertInCircle(userId, p.circleId);
  return p;
}

socialRouter.get("/feed", wrap(async (req, res) => {
  const ids = await circleIdsOf(req.userId);
  const take = Math.min(Number(req.query.limit ?? 20), 50);
  const cursor = req.query.cursor as string | undefined;
  const posts = await prisma.post.findMany({
    where: {
      OR: [{ circleId: { in: ids } }, { authorId: req.userId }],
      authorId: { notIn: await blockedIds(req.userId) },
      id: { notIn: (await prisma.report.findMany({ where: { reporterId: req.userId, targetType: "post" }, select: { targetId: true } })).map(r => r.targetId) },
    },
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      author: { select: publicUser },
      circle: { select: { id: true, name: true, type: true } },
      _count: { select: { likes: true, comments: true } },
      likes: { where: { userId: req.userId }, select: { userId: true } },
    },
  });
  const nextCursor = posts.length > take ? posts[take - 1].id : null;
  res.json({
    items: posts.slice(0, take).map(p => ({
      id: p.id, kind: p.kind, caption: p.caption, imageUrl: p.imageUrl, createdAt: p.createdAt,
      author: p.author, circle: p.circle,
      likeCount: p._count.likes, commentCount: p._count.comments, liked: p.likes.length > 0,
    })),
    nextCursor,
  });
}));

socialRouter.post("/posts", wrap(async (req, res) => {
  const b = parse(z.object({
    circleId: z.string().optional(),
    kind: z.enum(["snap", "checkin", "activity"]).default("snap"),
    caption: z.string().max(500).optional(),
    imageUrl: z.string().url().optional(),
  }), req.body);
  if (!b.caption && !b.imageUrl) throw new HttpError(400, "Post needs a caption or image");
  if (b.circleId) await assertInCircle(req.userId, b.circleId);
  const p = await prisma.post.create({ data: { ...b, authorId: req.userId } });
  if (b.imageUrl && b.kind === "snap") await pulse(req.userId, "photo", "shared a photo", b.imageUrl);
  res.status(201).json(p);
}));

socialRouter.post("/posts/:id/like", wrap(async (req, res) => {
  await visiblePost(req.userId, req.params.id);
  const key = { postId: req.params.id, userId: req.userId };
  const ex = await prisma.like.findUnique({ where: { postId_userId: key } });
  if (ex) await prisma.like.delete({ where: { postId_userId: key } });
  else await prisma.like.create({ data: key });
  res.json({ liked: !ex, likeCount: await prisma.like.count({ where: { postId: req.params.id } }) });
}));

socialRouter.get("/posts/:id/comments", wrap(async (req, res) => {
  await visiblePost(req.userId, req.params.id);
  const cs = await prisma.comment.findMany({
    where: { postId: req.params.id, userId: { notIn: await blockedIds(req.userId) } }, orderBy: { createdAt: "asc" },
    include: { user: { select: publicUser } },
  });
  res.json(cs);
}));

socialRouter.post("/posts/:id/comments", wrap(async (req, res) => {
  const { text } = parse(z.object({ text: z.string().min(1).max(500) }), req.body);
  const p = await visiblePost(req.userId, req.params.id);
  const c = await prisma.comment.create({
    data: { postId: req.params.id, userId: req.userId, text },
    include: { user: { select: publicUser } },
  });
  if (p.authorId !== req.userId) {
    await notify([p.authorId], { from: req.userId, kind: "comment", title: `${c.user.name} commented`, body: text, data: { screen: "post", postId: p.id } });
  }
  res.status(201).json(c);
}));

socialRouter.get("/stories", wrap(async (req, res) => {
  const ids = await circleIdsOf(req.userId);
  const members = await prisma.circleMember.findMany({ where: { circleId: { in: ids } }, select: { userId: true } });
  const blocked = new Set(await blockedIds(req.userId));
  const authorIds = [...new Set(members.map(m => m.userId))].filter(id => !blocked.has(id));
  const stories = await prisma.story.findMany({
    where: { authorId: { in: authorIds }, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    include: { author: { select: publicUser } },
  });
  const byAuthor = new Map<string, { author: unknown; stories: unknown[] }>();
  for (const s of stories) {
    const g = byAuthor.get(s.authorId) ?? { author: s.author, stories: [] };
    g.stories.push({ id: s.id, imageUrl: s.imageUrl, createdAt: s.createdAt });
    byAuthor.set(s.authorId, g);
  }
  res.json([...byAuthor.values()]);
}));

socialRouter.post("/stories", wrap(async (req, res) => {
  const { imageUrl } = parse(z.object({ imageUrl: z.string().url() }), req.body);
  const s = await prisma.story.create({
    data: { authorId: req.userId, imageUrl, expiresAt: new Date(Date.now() + 24 * 3600e3) },
  });
  res.status(201).json(s);
}));

// Delete your own post (and its photo).
socialRouter.delete("/posts/:id", wrap(async (req, res) => {
  const p = await prisma.post.findUnique({ where: { id: req.params.id } });
  if (!p) throw new HttpError(404, "Post not found");
  if (p.authorId !== req.userId) throw new HttpError(403, "You can only delete your own posts");
  await prisma.post.delete({ where: { id: p.id } });
  await deleteStoredFile(p.imageUrl);
  res.status(204).end();
}));

// Delete a comment: its author, or the author of the post it's on.
socialRouter.delete("/comments/:id", wrap(async (req, res) => {
  const c = await prisma.comment.findUnique({ where: { id: req.params.id }, include: { post: { select: { authorId: true } } } });
  if (!c) throw new HttpError(404, "Comment not found");
  if (c.userId !== req.userId && c.post.authorId !== req.userId) throw new HttpError(403, "You can't delete this comment");
  await prisma.comment.delete({ where: { id: c.id } });
  res.status(204).end();
}));

socialRouter.delete("/stories/:id", wrap(async (req, res) => {
  const st = await prisma.story.findUnique({ where: { id: req.params.id } });
  if (!st || st.authorId !== req.userId) throw new HttpError(404, "Story not found");
  await prisma.story.delete({ where: { id: st.id } });
  await deleteStoredFile(st.imageUrl);
  res.status(204).end();
}));
