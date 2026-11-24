import { Router } from "express";
import { APP_NAME, CONTACT_EMAIL } from "../config";

// Public Privacy Policy and Terms pages. The app stores require a web link to these in the listing.
// DRAFT TEXT: have a lawyer review and adapt both before publishing. Keep in sync with mobile/src/app/legal/[doc].tsx.
export const legalRouter = Router();

const PRIVACY: [string, string][] = [
  ["What we collect", "Account details (name, email or phone number), what you post and send in chats, health information you choose to enter (vitals, medications, records), and your location only while you choose to share it."],
  ["How we use it", `Only to run ${APP_NAME} for you and your circles: showing posts, sending notifications, sharing your location with the circle you pick, and letting a doctor you add see records you choose to share. We don't sell your data or use it for advertising.`],
  ["Who can see your information", "Members of the circles you share with. A doctor sees your health records only after you add them, and you choose which relatives can see them through that doctor. Service providers that host the app for us (cloud hosting, push notification, SMS and email delivery) process data only on our behalf."],
  ["Health information", "Health data is visible only as described above. You can edit or delete it at any time."],
  ["Location", "Location is collected only while you are sharing it, sharing stops automatically after the time you choose, and you can stop it at any time. We use it to show you on your circle's map and for arrived-home alerts."],
  ["Deleting your data", `You can delete your account at any time in the app (Profile → Account & Security → Delete account). This permanently removes your account, posts, photos, messages, health data and location. You can also email ${CONTACT_EMAIL}.`],
  ["Emergency (SOS) recording", "If you turn on SOS recording and trigger an SOS, the app records short video and audio clips and shares them, with your location, through a private link that is sent to the emergency contacts you chose and shown to people in your circles. Recording only happens during an SOS you start, while the app is open, with a visible on-screen indicator. Clips are deleted automatically after 30 days, or when you delete your account."],
  ["Security", "Data is sent over encrypted connections, passwords and one-time codes are stored hashed, and access is limited to what each feature needs."],
  ["Children", `${APP_NAME} is not intended for children under 13 (or the minimum age in your country) without a parent or guardian.`],
  ["Contact", `Questions about privacy: ${CONTACT_EMAIL}.`],
];

const TERMS: [string, string][] = [
  [`Using ${APP_NAME}`, `${APP_NAME} lets you share moments, health information and your location with people you invite into private circles. You must be at least 13 years old (or the minimum age in your country).`],
  ["Your account", "Keep your sign-in details safe. You're responsible for activity on your account. You can delete your account at any time in the app."],
  ["Your content", "You own what you post. You give us permission to store it and show it to the people you share it with, only to run the service. You can delete your posts, comments and messages at any time."],
  ["Acceptable use", "Don't harass anyone, share illegal or harmful content, impersonate others or access other people's data without permission. You can report content and block people in the app; we review reports and may remove content or accounts that break these rules."],
  ["Not medical or emergency advice", `${APP_NAME} is not a medical device and doesn't replace professional medical advice. SOS alerts notify your circles only. In an emergency, always call your local emergency number.`],
  ["Subscriptions", "If paid plans are offered, they renew automatically until canceled through the app store you bought from. Canceling keeps your plan until the end of the paid period."],
  ["Changes", "We may update these terms and will tell you about important changes."],
  ["Contact", `Questions: ${CONTACT_EMAIL}.`],
];

const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const page = (title: string, sections: [string, string][]) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(APP_NAME)}</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F7F4FF;color:#17112E;line-height:1.6}
main{max-width:720px;margin:0 auto;padding:32px 20px 64px}h1{font-size:30px;margin:0 0 4px}h2{font-size:19px;margin:28px 0 6px}
.brand{color:#6C3CF0;font-weight:800;letter-spacing:-.3px}.note{color:#6F6A86;font-size:14px}</style></head>
<body><main><div class="brand">${esc(APP_NAME)}</div><h1>${esc(title)}</h1><p class="note">Last updated ${new Date().toISOString().slice(0, 10)}</p>
${sections.map(([h, b]) => `<h2>${esc(h)}</h2><p>${esc(b)}</p>`).join("\n")}</main></body></html>`;

legalRouter.get("/privacy", (_req, res) => res.type("html").send(page("Privacy Policy", PRIVACY)));
legalRouter.get("/terms", (_req, res) => res.type("html").send(page("Terms of Service", TERMS)));
