import type { PrismaClient } from "@prisma/client";

// Reference data the app needs to work: the games catalog. No users, posts or other personal data.
export const GAMES = [
  { title: "Trivia", tagline: "Test your knowledge", icon: "trophy" },
  { title: "Ludo", tagline: "Play together", icon: "dice" },
  { title: "Memory Match", tagline: "Train your brain", icon: "cards" },
  { title: "Word Hunt", tagline: "Find the words", icon: "abc" },
];

/** Idempotent: safe to run any number of times, never deletes anything. */
export async function seedReferenceData(prisma: PrismaClient) {
  for (const g of GAMES) {
    const existing = await prisma.game.findFirst({ where: { title: g.title } });
    if (existing) await prisma.game.update({ where: { id: existing.id }, data: g });
    else await prisma.game.create({ data: g });
  }
}
