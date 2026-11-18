// TEST-ONLY fixtures. Loaded by `npm test` into the separate *_test database, never into the app's database.
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { seedReferenceData } from "../../prisma/reference";

export const FIXTURE_PASSWORD = "password123";
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (d: number, h: number, m = 0) => { const t = new Date(); t.setDate(t.getDate() + d); t.setHours(h, m, 0, 0); return t; };
const ago = (min: number) => new Date(Date.now() - min * 60000);
const IMG = (n: number) => `https://example.com/fixture-${n}.png`;

export async function loadFixtures(prisma: PrismaClient) {
  const db = (await prisma.$queryRawUnsafe<{ d: string }[]>("SELECT current_database() AS d"))[0].d;
  if (!db.endsWith("_test")) throw new Error(`Refusing to load fixtures into "${db}": fixtures only go into a *_test database`);
  await prisma.$executeRawUnsafe('TRUNCATE "User", "Circle", "Doctor", "Game", "VerificationCode" CASCADE');
  await seedReferenceData(prisma);

  const passwordHash = await bcrypt.hash(FIXTURE_PASSWORD, 10);
  const mk = (name: string, username: string, age: number, gender: string, status = "Active") =>
    prisma.user.create({ data: { name, username, email: `${username}@kizayu.test`, passwordHash, age, gender, status, safety: { create: {} } } });

  const demo = await mk("Demo User", "demo", 30, "Female");
  const mom = await mk("Mom", "mom", 68, "Female");
  await prisma.user.update({ where: { id: mom.id }, data: { phone: "+919800000001" } });
  const dad = await mk("Dad", "dad", 71, "Male", "All good");
  const riya = await mk("Riya", "riya", 26, "Female", "Busy");
  const arjun = await mk("Arjun", "arjun", 29, "Male");

  const family = await prisma.circle.create({ data: { name: "Sharma Family", type: "Family", inviteCode: "SHARMA-FAMILY",
    members: { create: [demo, mom, dad, riya, arjun].map((u, i) => ({ userId: u.id, role: i === 0 ? "owner" : "member" })) } } });
  await prisma.circle.create({ data: { name: "College Friends", type: "Friends", inviteCode: "COLLEGE-GANG",
    members: { create: [demo, riya, arjun].map(u => ({ userId: u.id })) } } });

  await prisma.task.createMany({ data: [
    { userId: demo.id, title: "Take Medicine", subtitle: "8:00 PM", icon: "pill", dueTime: "8:00 PM", doneDate: today() },
    { userId: demo.id, title: "Eat an Apple", subtitle: "Daily • 1 time", icon: "apple", doneDate: today() },
    { userId: demo.id, title: "Drink Water", subtitle: "Today • 3 times", icon: "water", targetCount: 3, doneCount: 3, doneDate: today() },
    { userId: demo.id, title: "Morning Walk", subtitle: "7:00 AM", icon: "walk", dueTime: "7:00 AM", doneDate: today() },
  ] });
  await prisma.appointment.createMany({ data: [
    { userId: demo.id, title: "Doctor Appointment", kind: "doctor", startsAt: inDays(3, 11, 30) },
    { userId: demo.id, title: "Family Call", kind: "call", startsAt: inDays(4, 20) },
    { userId: mom.id, title: "Cardiology follow-up", kind: "doctor", startsAt: inDays(5, 10) },
  ] });

  await prisma.vital.createMany({ data: [
    { userId: mom.id, type: "heart_rate", value: "72", unit: "bpm" },
    { userId: mom.id, type: "bp", value: "128/82", unit: "mmHg" },
    { userId: mom.id, type: "spo2", value: "98", unit: "%" },
  ] });
  await prisma.medication.createMany({ data: [
    { userId: mom.id, name: "BP Medicine", schedule: "Daily • 8 AM", takenDate: today() },
    { userId: mom.id, name: "Vitamin D", schedule: "Weekly" },
  ] });
  await prisma.healthRecord.createMany({ data: [
    { userId: mom.id, type: "prescription", title: "BP Medicine - 3 months" },
    { userId: mom.id, type: "lab", title: "Lipid profile", notes: "Within normal range" },
  ] });

  // A doctor with their own Kizayu account (doctor inbox), linked by Demo.
  const docUser = await prisma.user.create({ data: { name: "Dr. Mehta Sharma", username: "drmehta", email: "dr.mehta@kizayu.test", passwordHash, safety: { create: {} } } });
  const doc = await prisma.doctor.create({ data: { name: "Dr. Mehta Sharma", specialty: "General Physician", rating: 0, reviews: 0, phone: "+910000000000", userId: docUser.id } });
  await prisma.doctorLink.create({ data: { userId: demo.id, doctorId: doc.id, sharedWith: `${mom.id},${dad.id}` } });
  await prisma.doctorThread.create({ data: { patientId: demo.id, doctorId: doc.id, messages: { create: [
    { senderId: demo.id, text: "Hello doctor, Mom's BP was 128/82 this morning. Is that okay?", createdAt: ago(300) },
    { senderId: docUser.id, text: "That's fine for her age. Keep the BP medicine at 8 AM and log it daily.", createdAt: ago(280) },
  ] } } });

  await prisma.post.create({ data: { authorId: riya.id, circleId: family.id, kind: "snap", caption: "Good vibes!", imageUrl: IMG(1), createdAt: ago(120),
    likes: { create: [{ userId: mom.id }, { userId: dad.id }] }, comments: { create: [{ userId: mom.id, text: "So cute!" }] } } });
  await prisma.post.create({ data: { authorId: mom.id, circleId: family.id, kind: "activity", caption: "Morning walk done!", imageUrl: IMG(2), createdAt: ago(180) } });
  for (const u of [mom, dad, riya, arjun]) await prisma.story.create({ data: { authorId: u.id, imageUrl: IMG(10), expiresAt: new Date(Date.now() + 20 * 3600e3) } });
  await prisma.pulseEvent.createMany({ data: [
    { circleId: family.id, userId: mom.id, kind: "completed", text: "completed her morning walk", createdAt: ago(2) },
    { circleId: family.id, userId: riya.id, kind: "photo", text: "shared a photo", imageUrl: IMG(3), createdAt: ago(30) },
  ] });
  await prisma.message.createMany({ data: [
    { circleId: family.id, userId: demo.id, text: "Good morning everyone!", createdAt: ago(60) },
    { circleId: family.id, userId: dad.id, text: "Medicine taken", createdAt: ago(55) },
  ] });
}
