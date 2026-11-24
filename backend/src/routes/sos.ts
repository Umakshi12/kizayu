import crypto from "crypto";
import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../db";
import { PUBLIC_URL } from "../config";
import { HttpError, circleIdsOf, parse, publicUser, pulse, wrap } from "../util";
import { circleMatesOf, notify } from "../services/notify";
import { sendSms, smsConfigured } from "../services/messaging";
import { deleteStoredFile } from "../services/files";
import { saveBinary } from "../services/storage";
import { emitToCircle, sendMessage } from "./chat";
import { blockedIds } from "./moderation";

/** Signed-in routes: SOS contacts, starting/ending an SOS, location pings, clip uploads. */
export const sosRouter = Router();
/** Public routes: the private link page that contacts open (no account needed). */
export const sosPublicRouter = Router();

const MAX_CONTACTS = 5;
const MAX_STARTS_PER_DAY = 10;
const MAX_CLIPS = 300;                       // ~75 minutes of 15-second clips
const MAX_EVENT_BYTES = 400 * 1024 * 1024;
const MAX_CLIP_BYTES = 25 * 1024 * 1024;
const ACTIVE_HOURS = 3;                      // an SOS that was never ended stops counting as active after this
const UPLOAD_GRACE_MS = 5 * 60 * 1000;       // the last clip may arrive just after the SOS is ended
const LINK_AFTER_END_HOURS = 72;             // contacts can still open the page for a while after it ends
const RETENTION_DAYS = 30;                   // recordings are deleted after this

const baseUrl = (req: express.Request) => PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`;
const linkFor = (req: express.Request, token: string) => `${baseUrl(req).replace(/\/$/, "")}/s/${token}`;
const activeSince = () => new Date(Date.now() - ACTIVE_HOURS * 3600e3);

// ---------------------------------------------------------------- contacts

const contactOut = (c: { id: string; name: string; phone: string }) => ({ id: c.id, name: c.name, phone: c.phone });

sosRouter.get("/sos/contacts", wrap(async (req, res) => {
  res.json((await prisma.sosContact.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "asc" } })).map(contactOut));
}));

sosRouter.post("/sos/contacts", wrap(async (req, res) => {
  const b = parse(z.object({
    name: z.string().trim().min(1).max(60),
    phone: z.string().transform(s => s.replace(/[\s().-]/g, "")).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, "Include the country code, like +91 98765 43210")),
  }), req.body);
  if ((await prisma.sosContact.count({ where: { userId: req.userId } })) >= MAX_CONTACTS) throw new HttpError(400, `You can add up to ${MAX_CONTACTS} SOS contacts`);
  if (await prisma.sosContact.findUnique({ where: { userId_phone: { userId: req.userId, phone: b.phone } } })) throw new HttpError(409, "That number is already in your SOS contacts");
  res.status(201).json(contactOut(await prisma.sosContact.create({ data: { userId: req.userId, ...b } })));
}));

sosRouter.delete("/sos/contacts/:id", wrap(async (req, res) => {
  const r = await prisma.sosContact.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  if (!r.count) throw new HttpError(404, "Contact not found");
  res.status(204).end();
}));

// ---------------------------------------------------------------- start / end

const eventOut = (req: express.Request, e: { id: string; token: string; startedAt: Date; endedAt: Date | null; lat: number | null; lng: number | null }) => ({
  id: e.id, link: linkFor(req, e.token), startedAt: e.startedAt, endedAt: e.endedAt, lat: e.lat, lng: e.lng,
});

sosRouter.post("/sos/start", wrap(async (req, res) => {
  const settings = await prisma.safetySetting.findUnique({ where: { userId: req.userId } });
  if (settings && !settings.sosAlert) throw new HttpError(409, "SOS alerts are turned off in your settings");
  const b = parse(z.object({ lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() }), req.body ?? {});
  const contacts = await prisma.sosContact.findMany({ where: { userId: req.userId } });

  // Pressing SOS twice must not alert everyone twice: resume the SOS that is already running.
  const running = await prisma.sosEvent.findFirst({ where: { userId: req.userId, endedAt: null, startedAt: { gte: activeSince() } }, orderBy: { startedAt: "desc" } });
  if (running) return res.json({ ...eventOut(req, running), reused: true, contacts: contacts.length, smsSent: false, notifiedPeople: 0 });

  if ((await prisma.sosEvent.count({ where: { userId: req.userId, startedAt: { gte: new Date(Date.now() - 24 * 3600e3) } } })) >= MAX_STARTS_PER_DAY) {
    throw new HttpError(429, "Too many SOS alerts today. If you're in danger, call your local emergency number.");
  }

  const hasLoc = b.lat != null && b.lng != null;
  const ev = await prisma.sosEvent.create({
    data: { userId: req.userId, token: crypto.randomBytes(18).toString("base64url"), ...(hasLoc ? { lat: b.lat, lng: b.lng, locUpdatedAt: new Date() } : {}) },
  });
  const link = linkFor(req, ev.token);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  const where = hasLoc ? ` Location: https://www.openstreetmap.org/?mlat=${b.lat}&mlon=${b.lng}#map=17/${b.lat}/${b.lng}` : "";

  // 1) people in the app: chat message + urgent push
  const ids = await circleIdsOf(req.userId);
  await pulse(req.userId, "alert", "sent an SOS alert");
  for (const id of ids) await sendMessage(id, req.userId, `SOS! I need help.${where} Live view: ${link}`, undefined, { silent: true });
  const mates = await circleMatesOf(req.userId);
  await notify(mates, {
    from: req.userId, kind: "sos", urgent: true, title: `🚨 SOS from ${me.name}`, body: "They need help now. Tap to see their live location and video.",
    data: { screen: "sos", link, sosId: ev.id },
  });

  // 2) SOS contacts (often family without the app): SMS with the private link
  let smsSent = 0;
  const text = `🚨 ${me.name} sent an SOS and may need help. Live location, video and audio: ${link}`;
  for (const c of contacts) {
    try { await sendSms(c.phone, text); smsSent++; } catch (e) { console.warn("[sos] SMS failed:", (e as Error).message); }
  }
  res.status(201).json({ ...eventOut(req, ev), reused: false, contacts: contacts.length, smsSent: smsConfigured() ? smsSent : 0, smsConfigured: smsConfigured(), notifiedPeople: mates.length });
}));

async function ownedEvent(userId: string, id: string) {
  const ev = await prisma.sosEvent.findUnique({ where: { id } });
  if (!ev || ev.userId !== userId) throw new HttpError(404, "SOS not found");
  return ev;
}

// Position pings while the SOS is running.
sosRouter.post("/sos/:id/location", wrap(async (req, res) => {
  const b = parse(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }), req.body);
  const ev = await ownedEvent(req.userId, req.params.id);
  if (ev.endedAt) throw new HttpError(409, "This SOS has ended");
  await prisma.sosEvent.update({ where: { id: ev.id }, data: { lat: b.lat, lng: b.lng, locUpdatedAt: new Date() } });
  res.json({ ok: true });
}));

// A recorded clip (the request body is the raw mp4 / m4a file).
const isMp4 = (b: Buffer) => b.length >= 12 && b.subarray(4, 8).toString("latin1") === "ftyp";

sosRouter.post("/sos/:id/clips", express.raw({ type: () => true, limit: MAX_CLIP_BYTES }), wrap(async (req, res) => {
  const q = parse(z.object({ kind: z.enum(["video", "audio"]).default("video"), seconds: z.coerce.number().int().min(0).max(120).optional() }), req.query);
  const ev = await ownedEvent(req.userId, req.params.id);
  if (ev.endedAt && Date.now() - ev.endedAt.getTime() > UPLOAD_GRACE_MS) throw new HttpError(409, "This SOS has ended");
  const buf = req.body as unknown;
  if (!Buffer.isBuffer(buf) || !isMp4(buf)) throw new HttpError(400, "That isn't a valid video or audio clip");
  const agg = await prisma.sosClip.aggregate({ where: { eventId: ev.id }, _count: true, _sum: { bytes: true } });
  if (agg._count >= MAX_CLIPS || (agg._sum.bytes ?? 0) + buf.length > MAX_EVENT_BYTES) throw new HttpError(413, "This SOS has reached its recording limit");
  const url = await saveBinary(buf, q.kind === "audio" ? "m4a" : "mp4", q.kind === "audio" ? "audio/mp4" : "video/mp4", baseUrl(req));
  const clip = await prisma.sosClip.create({ data: { eventId: ev.id, kind: q.kind, url, bytes: buf.length, seconds: q.seconds } });
  for (const id of await circleIdsOf(req.userId)) emitToCircle(id, "sosClip", { sosId: ev.id, userId: req.userId });
  res.status(201).json({ id: clip.id, url });
}));

sosRouter.post("/sos/:id/end", wrap(async (req, res) => {
  const ev = await ownedEvent(req.userId, req.params.id);
  if (ev.endedAt) return res.json({ ended: true, already: true });
  await prisma.sosEvent.update({ where: { id: ev.id }, data: { endedAt: new Date() } });
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  for (const id of await circleIdsOf(req.userId)) await sendMessage(id, req.userId, "I'm safe. The SOS has ended.", undefined, { silent: true });
  await notify(await circleMatesOf(req.userId), { from: req.userId, kind: "sos", title: `✅ ${me.name} is safe`, body: "They ended the SOS.", data: { screen: "sos" } });
  for (const c of await prisma.sosContact.findMany({ where: { userId: req.userId } })) {
    await sendSms(c.phone, `✅ ${me.name} ended the SOS and says they're safe.`).catch(e => console.warn("[sos] SMS failed:", (e as Error).message));
  }
  res.json({ ended: true });
}));

// My running SOS (to resume after the app was closed) and SOS alerts from people in my circles.
sosRouter.get("/sos/active", wrap(async (req, res) => {
  const mine = await prisma.sosEvent.findFirst({ where: { userId: req.userId, endedAt: null, startedAt: { gte: activeSince() } }, orderBy: { startedAt: "desc" } });
  const mates = (await circleMatesOf(req.userId)).filter(id => id !== req.userId);
  const blocked = new Set(await blockedIds(req.userId));
  const others = await prisma.sosEvent.findMany({
    where: { userId: { in: mates.filter(id => !blocked.has(id)) }, endedAt: null, startedAt: { gte: activeSince() } },
    orderBy: { startedAt: "desc" }, include: { user: { select: publicUser }, _count: { select: { clips: true } } },
  });
  res.json({
    mine: mine ? eventOut(req, mine) : null,
    others: others.map(e => ({ ...eventOut(req, e), user: e.user, clipCount: e._count.clips })),
  });
}));

// ---------------------------------------------------------------- public link page

const publicLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many requests" } });

async function publicEvent(token: string) {
  const ev = await prisma.sosEvent.findUnique({
    where: { token }, include: { user: { select: { name: true, avatarUrl: true } }, clips: { orderBy: { createdAt: "asc" } } },
  });
  if (!ev) return null;
  if (ev.startedAt.getTime() < Date.now() - RETENTION_DAYS * 86400e3) return null;
  if (ev.endedAt && ev.endedAt.getTime() < Date.now() - LINK_AFTER_END_HOURS * 3600e3) return null;
  return ev;
}

sosPublicRouter.get("/s/:token/data", publicLimiter, wrap(async (req, res) => {
  const ev = await publicEvent(req.params.token);
  if (!ev) throw new HttpError(404, "This SOS link has expired or isn't valid");
  const running = !ev.endedAt && ev.startedAt.getTime() >= activeSince().getTime();
  res.set("Cache-Control", "no-store").json({
    name: ev.user.name, active: running, startedAt: ev.startedAt, endedAt: ev.endedAt,
    lat: ev.lat, lng: ev.lng, locUpdatedAt: ev.locUpdatedAt,
    clips: ev.clips.map(c => ({ id: c.id, kind: c.kind, url: c.url, seconds: c.seconds, createdAt: c.createdAt })),
  });
}));

const esc = (t: string) => t.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const PAGE_CSS = `*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0A0D12;color:#EAF2F7}
.bar{padding:14px 18px;font-weight:800;letter-spacing:.3px;background:#EF4565;color:#fff}.bar.safe{background:#18B26B}.bar.old{background:#475463}
main{max-width:640px;margin:0 auto;padding:18px}h1{margin:6px 0 2px;font-size:26px}.sub{color:#9FB2C0;margin:0 0 16px}
h2{font-size:17px;margin:22px 0 8px}.card{background:#121A22;border:1px solid #1E2B36;border-radius:16px;padding:12px}
iframe{width:100%;height:280px;border:0;border-radius:12px;background:#0B1F2B}a{color:#4FD8FF}
video{width:100%;border-radius:12px;background:#000;max-height:60vh}audio{width:100%}.clip{margin-bottom:14px}.when{color:#9FB2C0;font-size:13px;margin-bottom:4px}
.empty{color:#9FB2C0}.btn{display:inline-block;margin-top:10px;padding:10px 16px;border-radius:999px;background:#00B8E6;color:#00131A;font-weight:700;text-decoration:none}`;

function pageHtml(nonce: string, title: string, bodyHtml: string, script = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body>${bodyHtml}${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`;
}

const PAGE_SCRIPT = `
var api = location.pathname.replace(/\\/$/, "") + "/data", shown = {}, mapKey = "";
function el(id){return document.getElementById(id)}
function ago(iso){var s=Math.max(0,(Date.now()-new Date(iso).getTime())/1000);if(s<60)return"just now";if(s<3600)return Math.floor(s/60)+" min ago";if(s<86400)return Math.floor(s/3600)+" h ago";return Math.floor(s/86400)+" d ago"}
function render(d){
  el("name").textContent = d.name;
  var bar = el("bar");
  if (d.active) { bar.className="bar"; bar.textContent="🚨 SOS ACTIVE: updating live"; }
  else if (d.endedAt) { bar.className="bar safe"; bar.textContent="✅ SOS ended. "+d.name+" marked themselves safe"; }
  else { bar.className="bar old"; bar.textContent="This SOS is no longer updating"; }
  el("sub").textContent = "Started " + ago(d.startedAt) + (d.locUpdatedAt ? " · location updated " + ago(d.locUpdatedAt) : "");
  var map = el("map");
  if (d.lat != null && d.lng != null) {
    map.style.display = "block";
    var key = d.lat.toFixed(5)+","+d.lng.toFixed(5);
    if (key !== mapKey) { mapKey = key;
      var dl=0.004, dg=0.006;
      el("osm").src = "https://www.openstreetmap.org/export/embed.html?bbox="+(d.lng-dg)+","+(d.lat-dl)+","+(d.lng+dg)+","+(d.lat+dl)+"&layer=mapnik&marker="+d.lat+","+d.lng;
      el("gmaps").href = "https://www.google.com/maps?q="+d.lat+","+d.lng;
    }
  } else { map.style.display = "none"; }
  var box = el("clips"), list = d.clips.slice().reverse();
  el("noclips").style.display = list.length ? "none" : "block";
  list.forEach(function(c, i){
    if (shown[c.id]) return;
    shown[c.id] = true;
    var wrap = document.createElement("div"); wrap.className = "clip";
    var when = document.createElement("div"); when.className="when"; when.textContent = (c.kind==="audio"?"Audio":"Video") + " · " + ago(c.createdAt);
    var m = document.createElement(c.kind==="audio"?"audio":"video"); m.controls = true; m.preload = "metadata"; m.src = c.url;
    if (c.kind!=="audio") m.setAttribute("playsinline","");
    wrap.appendChild(when); wrap.appendChild(m);
    box.insertBefore(wrap, box.firstChild);
  });
}
function load(){ fetch(api,{cache:"no-store"}).then(function(r){ if(!r.ok) throw 0; return r.json(); }).then(render).catch(function(){ el("bar").className="bar old"; el("bar").textContent="Couldn't update. Check your connection or the link."; }); }
load(); setInterval(load, 8000);`;

sosPublicRouter.get("/s/:token", publicLimiter, wrap(async (req, res) => {
  const nonce = crypto.randomBytes(16).toString("base64");
  res.set({
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src https: data:; media-src https: http:; frame-src https://www.openstreetmap.org; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
  });
  const ev = await publicEvent(req.params.token);
  if (!ev) {
    res.status(404).type("html").send(pageHtml(nonce, "SOS link", `<div class="bar old">SOS link</div><main><h1>This link has expired</h1><p class="sub">SOS links stop working a few days after the emergency ends. If someone you know needs help right now, call your local emergency number.</p></main>`));
    return;
  }
  res.type("html").send(pageHtml(nonce, `SOS · ${ev.user.name}`, `
<div class="bar" id="bar">🚨 SOS</div>
<main>
  <h1 id="name">${esc(ev.user.name)}</h1><p class="sub" id="sub"></p>
  <div id="map" style="display:none"><h2>Location</h2><div class="card"><iframe id="osm" title="Map" loading="lazy"></iframe><a class="btn" id="gmaps" target="_blank" rel="noopener noreferrer">Open in Google Maps</a></div></div>
  <h2>Video &amp; audio</h2>
  <div class="card"><div id="clips"></div><p class="empty" id="noclips">Nothing recorded yet. New clips appear here automatically every few seconds.</p></div>
  <p class="sub" style="margin-top:18px">If they're in danger, call your local emergency number. This page updates by itself.</p>
</main>`, PAGE_SCRIPT));
}));

// ---------------------------------------------------------------- retention

/** Deletes SOS events (and their recordings) older than the retention period. */
export async function purgeOldSos(maxAgeDays = RETENTION_DAYS): Promise<number> {
  const old = await prisma.sosEvent.findMany({ where: { startedAt: { lt: new Date(Date.now() - maxAgeDays * 86400e3) } }, include: { clips: { select: { url: true } } } });
  for (const e of old) {
    for (const c of e.clips) await deleteStoredFile(c.url);
    await prisma.sosEvent.delete({ where: { id: e.id } });
  }
  return old.length;
}
