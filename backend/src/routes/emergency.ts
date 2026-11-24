import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, canView, circleIdsOf, parse, publicUser, wrap } from "../util";
import { blockedIds } from "./moderation";

export const emergencyRouter = Router();

const BLOOD = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
const text = (max: number) => z.string().trim().max(max).optional();

type Info = { bloodGroup: string | null; allergies: string | null; conditions: string | null; notes: string | null; updatedAt: Date };
type Contact = { id: string; name: string; relation: string | null; phone: string };

const contactOut = (c: Contact) => ({ id: c.id, name: c.name, relation: c.relation ?? "", phone: c.phone });

/**
 * The emergency card = medical details + the person's emergency contacts (the same list that gets texted during an SOS).
 * contactName / contactPhone are the first contact, kept so app version 1.0.0 still shows something.
 */
const out = (i: Info | null, contacts: Contact[]) => ({
  bloodGroup: i?.bloodGroup ?? "", allergies: i?.allergies ?? "", conditions: i?.conditions ?? "", notes: i?.notes ?? "",
  contacts: contacts.map(contactOut), contactName: contacts[0]?.name ?? "", contactPhone: contacts[0]?.phone ?? "",
  updatedAt: i?.updatedAt ?? null,
});
const filled = (i: Info | null, contacts: Contact[]) => !!(i?.bloodGroup || i?.allergies || i?.conditions || i?.notes || contacts.length);
const contactsOf = (userId: string) => prisma.sosContact.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

emergencyRouter.get("/emergency/me", wrap(async (req, res) => {
  const [info, contacts] = await Promise.all([prisma.emergencyInfo.findUnique({ where: { userId: req.userId } }), contactsOf(req.userId)]);
  res.json(out(info, contacts));
}));

emergencyRouter.put("/emergency/me", wrap(async (req, res) => {
  const b = parse(z.object({
    bloodGroup: z.enum(BLOOD).optional(), allergies: text(300), conditions: text(300), notes: text(500),
    // app 1.0.0 sent a single contact with the card; newer apps manage contacts separately (/sos/contacts)
    contactName: text(80), contactPhone: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, "Enter a valid phone number").or(z.literal("")).optional(),
  }), req.body);
  const { contactName, contactPhone, ...medical } = b;
  const data = Object.fromEntries(Object.entries(medical).map(([k, v]) => [k, v === "" ? null : v]));
  const info = await prisma.emergencyInfo.upsert({ where: { userId: req.userId }, update: data, create: { userId: req.userId, ...data } });

  if (contactPhone) { // legacy client: keep its single contact as the first one in the list
    const phone = contactPhone.replace(/[\s().-]/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new HttpError(400, "Include the country code, like +91 98765 43210");
    const first = (await contactsOf(req.userId))[0];
    const clash = await prisma.sosContact.findUnique({ where: { userId_phone: { userId: req.userId, phone } } });
    if (!clash) {
      if (first) await prisma.sosContact.update({ where: { id: first.id }, data: { phone, name: contactName || first.name } });
      else await prisma.sosContact.create({ data: { userId: req.userId, phone, name: contactName || "Emergency contact" } });
    }
  }
  res.json(out(info, await contactsOf(req.userId)));
}));

// Everyone in my circles who has filled in something on their emergency card.
emergencyRouter.get("/emergency/family", wrap(async (req, res) => {
  const mine = await circleIdsOf(req.userId);
  const blocked = await blockedIds(req.userId);
  const mates = await prisma.circleMember.findMany({ where: { circleId: { in: mine }, userId: { notIn: [req.userId, ...blocked] } }, select: { userId: true } });
  const ids = [...new Set(mates.map(m => m.userId))];
  const [infos, contacts, users] = await Promise.all([
    prisma.emergencyInfo.findMany({ where: { userId: { in: ids } } }),
    prisma.sosContact.findMany({ where: { userId: { in: ids } }, orderBy: { createdAt: "asc" } }),
    prisma.user.findMany({ where: { id: { in: ids } }, select: publicUser }),
  ]);
  const cards = users.map(user => {
    const info = infos.find(i => i.userId === user.id) ?? null;
    const cs = contacts.filter(c => c.userId === user.id);
    return filled(info, cs) ? { user, info: out(info, cs) } : null;
  });
  res.json(cards.filter(Boolean));
}));

emergencyRouter.get("/emergency/:userId", wrap(async (req, res) => {
  if (!(await canView(req.userId, req.params.userId))) throw new HttpError(403, "You can only see people in your circles");
  const user = await prisma.user.findUnique({ where: { id: req.params.userId }, select: publicUser });
  if (!user) throw new HttpError(404, "User not found");
  const [info, contacts] = await Promise.all([prisma.emergencyInfo.findUnique({ where: { userId: req.params.userId } }), contactsOf(req.params.userId)]);
  res.json({ user, info: out(info, contacts) });
}));
