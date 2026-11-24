import cors from "cors";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { APP_NAME, CORS_ORIGINS, IS_PROD } from "./config";
import { requireAuth } from "./auth";
import { errorHandler } from "./util";
import { authRouter } from "./routes/auth";
import { circlesRouter } from "./routes/circles";
import { socialRouter } from "./routes/social";
import { dayRouter } from "./routes/day";
import { healthRouter } from "./routes/health";
import { doctorsRouter } from "./routes/doctors";
import { gamesRouter } from "./routes/games";
import { chatRouter } from "./routes/chat";
import { safetyRouter } from "./routes/safety";
import { uploadsRouter } from "./routes/uploads";
import { notificationsRouter } from "./routes/notifications";
import { premiumRouter } from "./routes/premium";
import { supportRouter } from "./routes/support";
import { moderationRouter } from "./routes/moderation";
import { legalRouter } from "./routes/legal";
import { listsRouter } from "./routes/lists";
import { emergencyRouter } from "./routes/emergency";
import { UPLOAD_DIR } from "./services/storage";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1); // correct client IPs behind a load balancer (rate limiting)
  app.disable("x-powered-by");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } })); // images are loaded by the app
  // Native apps send no Origin header. In production only listed web origins are allowed.
  app.use(cors({ origin: IS_PROD ? (CORS_ORIGINS.length ? CORS_ORIGINS : false) : true }));

  // Brute-force protection for sign-in and code endpoints, plus a general ceiling.
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: IS_PROD ? 30 : 1000, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many attempts. Try again in a few minutes." } });
  app.use("/auth", authLimit);
  app.use(rateLimit({ windowMs: 60 * 1000, limit: IS_PROD ? 300 : 10000, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many requests" } }));

  app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d", immutable: true }));
  // A missing/deleted image is a plain 404 (not a sign-in error).
  app.use("/uploads", (req, res, next) => (req.method === "GET" || req.method === "HEAD" ? res.status(404).end() : next()));
  app.use(uploadsRouter); // parses its own larger body, so it's mounted before the 1mb parser
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => res.json({ app: APP_NAME, status: "ok" }));
  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use(legalRouter); // public /privacy and /terms pages for the store listings
  app.use(authRouter); // public: signup, login, OTP, Google, password reset (/me is protected inside)

  app.use(requireAuth);
  app.use(circlesRouter, socialRouter, dayRouter, healthRouter, doctorsRouter, gamesRouter, chatRouter, safetyRouter,
    notificationsRouter, premiumRouter, supportRouter, moderationRouter, listsRouter, emergencyRouter);

  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);
  return app;
}
