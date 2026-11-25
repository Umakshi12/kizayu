// Single place for the product name and all environment configuration.
export const APP_NAME = "Kizayu";

const env = process.env;
export const IS_PROD = env.NODE_ENV === "production";
export const PORT = Number(env.PORT ?? 4000);

if (IS_PROD && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) {
  throw new Error("JWT_SECRET must be set to a random string of at least 32 characters in production");
}
export const JWT_SECRET = env.JWT_SECRET ?? "dev-only-change-me";

/** Comma-separated list of allowed web origins. Native apps don't send Origin, so they're unaffected. */
export const CORS_ORIGINS = (env.CORS_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean);

/** Public base URL of this API (used for local upload URLs behind a proxy). */
export const PUBLIC_URL = env.PUBLIC_URL;

// Email (password reset). SMTP_URL like smtps://user:pass@smtp.example.com:465
export const SMTP_URL = env.SMTP_URL;
export const MAIL_FROM = env.MAIL_FROM ?? `${APP_NAME} <no-reply@kizayu.app>`;

// SMS (phone sign-in) via Twilio
export const TWILIO = { sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM };

// Google sign-in: OAuth client IDs (web, android, ios) whose ID tokens we accept
export const GOOGLE_CLIENT_IDS = (env.GOOGLE_CLIENT_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);

// Expo push service
export const EXPO_PUSH_URL = env.EXPO_PUSH_URL ?? "https://exp.host/--/api/v2/push/send";
export const EXPO_ACCESS_TOKEN = env.EXPO_ACCESS_TOKEN;

// Uploads: S3-compatible storage when S3_BUCKET is set, otherwise local disk (dev only)
export const S3 = {
  bucket: env.S3_BUCKET, region: env.S3_REGION ?? "us-east-1", endpoint: env.S3_ENDPOINT,
  publicUrl: env.S3_PUBLIC_URL, // e.g. https://cdn.example.com
};

/**
 * Dev codes: when no email/SMS provider is configured and we're not in production, verification codes are
 * returned in the API response (as `devCode`) so the flows can be tested end to end. Never enabled in production.
 */
export const DEV_CODES = !IS_PROD;

/**
 * Premium is off by default in production until store billing (Google Play / App Store, e.g. via RevenueCat) is
 * connected. While it's off, nobody sees Premium and everyone gets the higher limits. Set PREMIUM_ENABLED=true to turn it on.
 */
export const PREMIUM_ENABLED = env.PREMIUM_ENABLED ? env.PREMIUM_ENABLED === "true" : !IS_PROD;

/** Contact address shown on the public privacy/terms pages. */
export const CONTACT_EMAIL = env.SUPPORT_EMAIL ?? "support@kizayu.app";

// Study buddy: any OpenAI-compatible chat endpoint (OpenAI, Groq, OpenRouter, Together, or your own model served with vLLM / llama.cpp / Ollama).
// Read at call time, so it can be changed without a code change. Without it the buddy answers from simple built-in rules.
export const buddyConfig = () => ({ url: process.env.BUDDY_API_URL, key: process.env.BUDDY_API_KEY, model: process.env.BUDDY_MODEL ?? "gpt-4o-mini" });
