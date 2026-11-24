import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, assertInCircle, parse, publicUser, wrap } from "../util";
import { emitToCircle } from "./chat";

export const listsRouter = Router();

const MAX_LISTS = 20;
const MAX_ITEMS = 200;

const shape = (l: {
  id: string; circleId: string; title: string; icon: string; createdById: string | null; createdAt: Date;
  items: { id: string; text: string; doneAt: Date | null; doneById: string | null; addedById: string | null; createdAt: Date }[];
}) => ({
  id: l.id, circleId: l.circleId, title: l.title, icon: l.icon, createdById: l.createdById, createdAt: l.createdAt,
  items: l.items.map(i => ({ id: i.id, text: i.text, done: !!i.doneAt, doneById: i.doneById, addedById: i.addedById, createdAt: i.createdAt })),
});

/** Loads a list and checks the caller is in its circle. */
async function listFor(userId: string, listId: string) {
  const l = await prisma.sharedList.findUnique({ where: { id: listId }, include: { items: { orderBy: { createdAt: "asc" } } } });
  if (!l) throw new HttpError(404, "List not found");
  await assertInCircle(userId, l.circleId);
  return l;
}

const changed = (circleId: string, listId: string) => emitToCircle(circleId, "listChanged", { circleId, listId });

listsRouter.get("/circles/:id/lists", wrap(async (req, res) => {
  await assertInCircle(req.userId, req.params.id);
  const lists = await prisma.sharedList.findMany({
    where: { circleId: req.params.id }, orderBy: { createdAt: "asc" },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  res.json(lists.map(shape));
}));

listsRouter.post("/circles/:id/lists", wrap(async (req, res) => {
  const b = parse(z.object({ title: z.string().trim().min(1).max(60), icon: z.enum(["cart", "list", "airplane", "gift", "home", "medkit"]).optional() }), req.body);
  await assertInCircle(req.userId, req.params.id);
  if ((await prisma.sharedList.count({ where: { circleId: req.params.id } })) >= MAX_LISTS) throw new HttpError(400, `A circle can have up to ${MAX_LISTS} lists`);
  const l = await prisma.sharedList.create({
    data: { circleId: req.params.id, title: b.title, icon: b.icon ?? "list", createdById: req.userId }, include: { items: true },
  });
  changed(l.circleId, l.id);
  res.status(201).json(shape(l));
}));

// Delete a list: the person who made it, or a circle owner.
listsRouter.delete("/lists/:id", wrap(async (req, res) => {
  const l = await listFor(req.userId, req.params.id);
  const owner = await prisma.circleMember.findUnique({ where: { circleId_userId: { circleId: l.circleId, userId: req.userId } } });
  if (l.createdById !== req.userId && owner?.role !== "owner") throw new HttpError(403, "Only the person who made the list or a circle owner can delete it");
  await prisma.sharedList.delete({ where: { id: l.id } });
  changed(l.circleId, l.id);
  res.status(204).end();
}));

listsRouter.post("/lists/:id/items", wrap(async (req, res) => {
  const b = parse(z.object({ text: z.string().trim().min(1).max(120) }), req.body);
  const l = await listFor(req.userId, req.params.id);
  if (l.items.length >= MAX_ITEMS) throw new HttpError(400, `A list can have up to ${MAX_ITEMS} items`);
  const item = await prisma.sharedListItem.create({ data: { listId: l.id, text: b.text, addedById: req.userId } });
  changed(l.circleId, l.id);
  res.status(201).json({ id: item.id, text: item.text, done: false, addedById: item.addedById, doneById: null, createdAt: item.createdAt });
}));

// Tick or untick an item.
listsRouter.patch("/lists/:id/items/:itemId", wrap(async (req, res) => {
  const b = parse(z.object({ done: z.boolean() }), req.body);
  const l = await listFor(req.userId, req.params.id);
  if (!l.items.some(i => i.id === req.params.itemId)) throw new HttpError(404, "Item not found");
  await prisma.sharedListItem.update({ where: { id: req.params.itemId }, data: b.done ? { doneAt: new Date(), doneById: req.userId } : { doneAt: null, doneById: null } });
  changed(l.circleId, l.id);
  res.json({ id: req.params.itemId, done: b.done });
}));

listsRouter.delete("/lists/:id/items/:itemId", wrap(async (req, res) => {
  const l = await listFor(req.userId, req.params.id);
  if (!l.items.some(i => i.id === req.params.itemId)) throw new HttpError(404, "Item not found");
  await prisma.sharedListItem.delete({ where: { id: req.params.itemId } });
  changed(l.circleId, l.id);
  res.status(204).end();
}));

// Remove every ticked item at once.
listsRouter.post("/lists/:id/clear-done", wrap(async (req, res) => {
  const l = await listFor(req.userId, req.params.id);
  const r = await prisma.sharedListItem.deleteMany({ where: { listId: l.id, doneAt: { not: null } } });
  changed(l.circleId, l.id);
  res.json({ removed: r.count });
}));

// Who ticked what, for the "ticked by" label.
listsRouter.get("/lists/:id/people", wrap(async (req, res) => {
  const l = await listFor(req.userId, req.params.id);
  const ids = [...new Set(l.items.flatMap(i => [i.addedById, i.doneById]).filter((x): x is string => !!x))];
  res.json(ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: publicUser }) : []);
}));
