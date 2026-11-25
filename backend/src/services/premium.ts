import { prisma } from "../db";
import { PREMIUM_ENABLED } from "../config";

export const PLANS = {
  monthly: { id: "monthly", title: "Monthly", priceLabel: "₹149 / month", days: 30 },
  yearly: { id: "yearly", title: "Yearly", priceLabel: "₹1,199 / year", days: 365 },
} as const;
export type PlanId = keyof typeof PLANS;

/** Free-tier limits; Premium removes them. */
export const LIMITS = {
  free: { ownedCircles: 2, locationShareHours: 4, healthRecords: 20, buddyPerDay: 8 },
  premium: { ownedCircles: 20, locationShareHours: 24, healthRecords: 1000, buddyPerDay: 100 },
};

export async function activeSubscription(userId: string) {
  return prisma.subscription.findFirst({
    where: { userId, status: { in: ["active", "canceled"] }, expiresAt: { gt: new Date() } },
    orderBy: { expiresAt: "desc" },
  });
}

/** True while a paid period is running (a canceled plan stays active until it expires). Keeps User.premium in sync. */
export async function isPremium(userId: string): Promise<boolean> {
  const active = !!(await activeSubscription(userId));
  await prisma.user.updateMany({ where: { id: userId, premium: !active }, data: { premium: active } });
  return active;
}

export async function limitsFor(userId: string) {
  if (!PREMIUM_ENABLED) return LIMITS.premium; // no paywall while Premium is switched off
  return (await isPremium(userId)) ? LIMITS.premium : LIMITS.free;
}
