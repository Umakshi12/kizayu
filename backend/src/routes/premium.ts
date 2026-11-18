import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { IS_PROD, PREMIUM_ENABLED } from "../config";
import { HttpError, parse, wrap } from "../util";
import { LIMITS, PLANS, activeSubscription, isPremium } from "../services/premium";

export const premiumRouter = Router();

premiumRouter.get("/premium/plans", (_req, res) => {
  res.json({
    enabled: PREMIUM_ENABLED,
    plans: Object.values(PLANS),
    features: [
      { title: "More circles", free: `${LIMITS.free.ownedCircles}`, premium: `${LIMITS.premium.ownedCircles}` },
      { title: "Location sharing", free: `Up to ${LIMITS.free.locationShareHours} hours`, premium: `Up to ${LIMITS.premium.locationShareHours} hours` },
      { title: "Health records", free: `${LIMITS.free.healthRecords}`, premium: "Unlimited" },
    ],
    // The app shows the test purchase button only when this is true.
    devPurchases: !IS_PROD,
  });
});

premiumRouter.get("/premium/status", wrap(async (req, res) => {
  const sub = await activeSubscription(req.userId);
  res.json({ premium: await isPremium(req.userId), subscription: sub });
}));

/**
 * Purchase. Real money flows through Google Play Billing / the App Store on the device; the server then verifies the
 * store receipt. Store verification isn't wired up yet (needs Play Console / App Store Connect credentials), so only
 * the "dev" provider works, and only outside production, to test the Premium flow end to end.
 */
premiumRouter.post("/premium/purchase", wrap(async (req, res) => {
  const b = parse(z.object({ plan: z.enum(["monthly", "yearly"]), provider: z.enum(["dev", "google", "apple"]), receipt: z.string().optional() }), req.body);
  if (!PREMIUM_ENABLED) throw new HttpError(404, "Premium isn't available yet");
  if (b.provider !== "dev") throw new HttpError(501, "Store billing isn't configured yet. Connect Google Play / App Store receipt verification first.");
  if (IS_PROD) throw new HttpError(403, "Test purchases are disabled in production");
  const current = await activeSubscription(req.userId);
  const start = current && current.expiresAt > new Date() ? current.expiresAt : new Date();
  const expiresAt = new Date(start.getTime() + PLANS[b.plan].days * 86400e3);
  if (current) await prisma.subscription.update({ where: { id: current.id }, data: { status: "active", plan: b.plan, expiresAt } });
  else await prisma.subscription.create({ data: { userId: req.userId, plan: b.plan, provider: "dev", status: "active", expiresAt } });
  res.json({ premium: await isPremium(req.userId), subscription: await activeSubscription(req.userId) });
}));

// Cancel = stop renewing. Premium stays on until the paid period ends.
premiumRouter.post("/premium/cancel", wrap(async (req, res) => {
  const sub = await activeSubscription(req.userId);
  if (!sub) throw new HttpError(404, "No active subscription");
  await prisma.subscription.update({ where: { id: sub.id }, data: { status: "canceled" } });
  res.json({ premium: await isPremium(req.userId), subscription: await activeSubscription(req.userId) });
}));
