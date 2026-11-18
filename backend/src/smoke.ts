// End-to-end test suite. Run with `npm test` (needs `npm run db` running): it uses a separate *_test database with fixtures.
// Starts the real API + Socket.IO server on a random port, plus a fake Expo push service to capture pushes.
import http from "http";
import type { AddressInfo } from "net";
import { io as ioClient, Socket } from "socket.io-client";

let failures = 0, passes = 0, section = "";
const check = (name: string, ok: boolean, extra?: unknown) => {
  if (ok) passes++; else failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  [${section}] ${name}${ok ? "" : "  -> " + JSON.stringify(extra)?.slice(0, 400)}`);
};
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  // ---- fake Expo push service ----
  const pushes: { to: string; title: string; body: string; data: Record<string, string>; priority: string }[] = [];
  const pushServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      const msgs = JSON.parse(body) as typeof pushes;
      pushes.push(...msgs);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: msgs.map(m => m.to.includes("DEAD") ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: "x" }) }));
    });
  });
  await new Promise<void>(r => pushServer.listen(0, r));
  process.env.EXPO_PUSH_URL = `http://localhost:${(pushServer.address() as AddressInfo).port}/push`;

  // Import after env is set (config reads env at load time).
  const { createApp } = await import("./app");
  const { attachRealtime } = await import("./realtime");
  const { setGoogleVerifier } = await import("./services/google");
  const { prisma } = await import("./db");
  const { HttpError } = await import("./util");

  const server = http.createServer(createApp());
  attachRealtime(server);
  await new Promise<void>(r => server.listen(0, r));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
  const login = async (email: string, password = "password123") => {
    const r = await call("POST", "/auth/login", undefined, { email, password });
    return { token: r.data.token as string, user: r.data.user };
  };

  // =================================================================== security & infra
  section = "security";
  const root = await call("GET", "/");
  check("security headers set (helmet)", root.headers.get("x-content-type-options") === "nosniff" && !root.headers.get("x-powered-by"));
  check("unauthenticated request is rejected", (await call("GET", "/feed")).status === 401);
  check("forged token is rejected", (await call("GET", "/feed", "abc.def.ghi")).status === 401);
  {
    const ghost = await call("POST", "/auth/signup", undefined, { name: "Ghost", username: "ghost" + Date.now(), email: `ghost${Date.now()}@x.test`, password: "ghostpass1" });
    await prisma.user.delete({ where: { id: ghost.data.user.id } });
    check("token for a deleted account gets 401 (not 500)", (await call("GET", "/me", ghost.data.token)).status === 401);
  }
  check("unknown route is 404", (await call("GET", "/nope", (await login("demo@kizayu.test")).token)).status === 404);
  check("rate limit headers present on auth", !!(await call("POST", "/auth/login", undefined, { email: "x@y.z", password: "p" })).headers.get("ratelimit-policy"));

  // =================================================================== auth: email
  section = "auth";
  check("bad password is rejected", (await call("POST", "/auth/login", undefined, { email: "demo@kizayu.test", password: "nope" })).status === 401);
  const demo = await login("demo@kizayu.test");
  check("login works", !!demo.token && demo.user.username === "demo", demo.user);
  const t = demo.token;
  const mom = await login("mom@kizayu.test");
  const dad = await login("dad@kizayu.test");
  const drm = await login("dr.mehta@kizayu.test");
  check("doctor account is flagged as doctor", !!drm.user.doctorId, drm.user);
  check("methods endpoint reports dev codes", (await call("GET", "/auth/methods")).data.devCodes === true);

  const uname = "smoke" + Date.now();
  const su = await call("POST", "/auth/signup", undefined, { name: "Smoke Test", username: uname, email: `${uname}@x.test`, password: "secret123" });
  check("signup creates user + default circle", su.status === 201 && !!su.data.token, su.data);
  check("signup rejects short password", (await call("POST", "/auth/signup", undefined, { name: "x", username: uname + "b", email: `${uname}b@x.test`, password: "short" })).status === 400);
  check("signup rejects duplicate", (await call("POST", "/auth/signup", undefined, { name: "x", username: uname, email: `${uname}@x.test`, password: "secret123" })).status === 409);
  const outsider = su.data.token as string;
  check("new user owns exactly one circle", (await call("GET", "/circles", outsider)).data.length === 1);

  // =================================================================== auth: password reset
  section = "password-reset";
  const forgotUnknown = await call("POST", "/auth/password/forgot", undefined, { email: "nobody@nowhere.test" });
  check("forgot: unknown email gets same generic answer, no code", forgotUnknown.status === 200 && !forgotUnknown.data.devCode);
  const forgot = await call("POST", "/auth/password/forgot", undefined, { email: `${uname}@x.test` });
  check("forgot: known email issues a code (dev mode)", forgot.status === 200 && /^\d{6}$/.test(forgot.data.devCode), forgot.data);
  check("forgot: resend is throttled", (await call("POST", "/auth/password/forgot", undefined, { email: `${uname}@x.test` })).status === 429);
  check("code is stored hashed, not in plain text", !(await prisma.verificationCode.findFirst({ where: { codeHash: forgot.data.devCode } })));
  const wrong = forgot.data.devCode === "000000" ? "111111" : "000000";
  check("reset: wrong code rejected", (await call("POST", "/auth/password/reset", undefined, { email: `${uname}@x.test`, code: wrong, password: "newpass123" })).status === 400);
  const reset = await call("POST", "/auth/password/reset", undefined, { email: `${uname}@x.test`, code: forgot.data.devCode, password: "newpass123" });
  check("reset: right code sets new password and signs in", reset.status === 200 && !!reset.data.token, reset.data);
  check("reset: code can't be reused", (await call("POST", "/auth/password/reset", undefined, { email: `${uname}@x.test`, code: forgot.data.devCode, password: "another123" })).status === 400);
  check("old password no longer works", (await call("POST", "/auth/login", undefined, { email: `${uname}@x.test`, password: "secret123" })).status === 401);
  check("new password works", (await call("POST", "/auth/login", undefined, { email: `${uname}@x.test`, password: "newpass123" })).status === 200);
  // brute force: 5 wrong attempts burns the code
  await prisma.verificationCode.deleteMany({ where: { target: `${uname}@x.test` } });
  const f2 = await call("POST", "/auth/password/forgot", undefined, { email: `${uname}@x.test` });
  const bad2 = f2.data.devCode === "999999" ? "888888" : "999999";
  for (let i = 0; i < 5; i++) await call("POST", "/auth/password/reset", undefined, { email: `${uname}@x.test`, code: bad2, password: "x12345678" });
  check("code is locked after 5 wrong attempts", (await call("POST", "/auth/password/reset", undefined, { email: `${uname}@x.test`, code: f2.data.devCode, password: "x12345678" })).status !== 200);

  // =================================================================== auth: phone OTP
  section = "phone-otp";
  check("rejects non-international phone", (await call("POST", "/auth/otp/request", undefined, { phone: "9876543210" })).status === 400);
  const momOtp = await call("POST", "/auth/otp/request", undefined, { phone: "+919800000001" });
  check("existing phone: code sent, not a new user", momOtp.status === 200 && momOtp.data.isNewUser === false && /^\d{6}$/.test(momOtp.data.devCode), momOtp.data);
  const momIn = await call("POST", "/auth/otp/verify", undefined, { phone: "+919800000001", code: momOtp.data.devCode });
  check("existing phone signs into the same account", momIn.status === 200 && momIn.data.user.id === mom.user.id, momIn.data);
  const newPhone = "+9198" + String(Date.now()).slice(-8);
  const np = await call("POST", "/auth/otp/request", undefined, { phone: newPhone });
  check("new phone flagged as new user", np.data.isNewUser === true);
  check("new phone without name is refused before using the code", (await call("POST", "/auth/otp/verify", undefined, { phone: newPhone, code: np.data.devCode })).status === 400);
  const npIn = await call("POST", "/auth/otp/verify", undefined, { phone: newPhone, code: np.data.devCode, name: "Phone Person" });
  check("new phone + name creates account with family circle", npIn.status === 201 && npIn.data.user.phone === newPhone && (await call("GET", "/circles", npIn.data.token)).data.length === 1, npIn.data);

  // =================================================================== auth: Google
  section = "google";
  const gsub = "g-" + Date.now();
  check("not configured -> clear 501 error", (await call("POST", "/auth/google", undefined, { idToken: "x".repeat(20) })).status === 501);
  setGoogleVerifier(async tok => {
    if (tok === "bad-token-xxxxxxxx") throw new HttpError(401, "Invalid Google token");
    if (tok === "link-demo-xxxxxxxx") return { sub: gsub + "-demo", email: "demo@kizayu.test", emailVerified: true, name: "Demo" };
    return { sub: gsub, email: `${gsub}@gmail.test`, emailVerified: true, name: "Gee Person", picture: "https://example.com/p.png" };
  });
  const g1 = await call("POST", "/auth/google", undefined, { idToken: "new-user-xxxxxxxxx" });
  check("google: new account created", g1.status === 201 && g1.data.user.email === `${gsub}@gmail.test`, g1.data);
  const g2 = await call("POST", "/auth/google", undefined, { idToken: "new-user-xxxxxxxxx" });
  check("google: second sign-in reuses account", g2.status === 200 && g2.data.user.id === g1.data.user.id);
  const g3 = await call("POST", "/auth/google", undefined, { idToken: "link-demo-xxxxxxxx" });
  check("google: verified email links to existing account", g3.status === 200 && g3.data.user.id === demo.user.id, g3.data);
  check("google: invalid token rejected with 401", (await call("POST", "/auth/google", undefined, { idToken: "bad-token-xxxxxxxx" })).status === 401);
  setGoogleVerifier(null);

  // =================================================================== uploads
  section = "uploads";
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  check("upload requires auth", (await call("POST", "/uploads", undefined, { data: png, ext: "png" })).status === 401);
  check("upload rejects bad extension", (await call("POST", "/uploads", t, { data: png, ext: "exe" })).status === 400);
  check("upload rejects non-image bytes", (await call("POST", "/uploads", t, { data: Buffer.from("<script>alert(1)</script>").toString("base64"), ext: "png" })).status === 400);
  const up = await call("POST", "/uploads", t, { data: png, ext: "png" });
  check("upload returns a URL", up.status === 201 && /\/uploads\/.+\.png$/.test(up.data.url), up.data);
  const fetched = await fetch(up.data.url);
  check("uploaded file is served back", fetched.status === 200 && (await fetched.arrayBuffer()).byteLength > 0, fetched.status);

  // =================================================================== circles + feed
  section = "feed";
  const circles = await call("GET", "/circles", t);
  const family = circles.data.find((c: any) => c.type === "Family");
  check("circles list has Family with 5 members", family?.members.length === 5, circles.data);
  const feed = await call("GET", "/feed", t);
  check("feed returns fixture posts", feed.data.items.length >= 2, feed.data);
  const postId = feed.data.items.find((p: any) => p.author.id !== demo.user.id).id;
  const like = await call("POST", `/posts/${postId}/like`, t);
  const unlike = await call("POST", `/posts/${postId}/like`, t);
  check("like toggles", like.data.liked === true && unlike.data.liked === false, [like.data, unlike.data]);
  check("outsider can't like a family post", (await call("POST", `/posts/${postId}/like`, outsider)).status === 403);
  check("outsider can't read its comments", (await call("GET", `/posts/${postId}/comments`, outsider)).status === 403);
  check("outsider can't comment on it", (await call("POST", `/posts/${postId}/comments`, outsider, { text: "hi" })).status === 403);
  check("create post", (await call("POST", "/posts", t, { circleId: family.id, caption: "smoke post" })).status === 201);
  check("cannot post to a circle you're not in", (await call("POST", "/posts", outsider, { circleId: family.id, caption: "x" })).status === 403);
  check("outsider feed doesn't leak family posts", (await call("GET", "/feed", outsider)).data.items.every((p: any) => p.circle?.id !== family.id));
  check("stories grouped by author", (await call("GET", "/stories", t)).data.length >= 4);

  // =================================================================== push + notifications
  section = "push";
  check("rejects a non-Expo push token", (await call("POST", "/push/register", t, { token: "hello", platform: "android" })).status === 400);
  const riya = await login("riya@kizayu.test");
  const riyaTok = "ExponentPushToken[riya-device-1]";
  check("register push token", (await call("POST", "/push/register", riya.token, { token: riyaTok, platform: "android" })).status === 200);
  await call("POST", "/push/register", dad.token, { token: "ExponentPushToken[DEAD-dad]", platform: "ios" });
  pushes.length = 0;
  const commented = await call("POST", `/posts/${postId}/comments`, t, { text: "Lovely photo!" });
  check("comment created", commented.status === 201);
  await wait(150);
  const riyaPush = pushes.find(p => p.to === riyaTok);
  check("post author gets a push for the comment", !!riyaPush && riyaPush.title.includes("commented") && riyaPush.body === "Lovely photo!", pushes);
  const inbox = await call("GET", "/notifications", riya.token);
  check("comment also lands in the in-app inbox", inbox.data.items.some((n: any) => n.kind === "comment" && n.data.postId === postId), inbox.data.items[0]);
  check("unread count reported", inbox.data.unread >= 1);
  await call("POST", "/notifications/read", riya.token, {});
  check("mark all read", (await call("GET", "/notifications", riya.token)).data.unread === 0);

  // =================================================================== realtime chat
  section = "realtime";
  const connect = (token: string) => new Promise<Socket>((resolve, reject) => {
    const s = ioClient(base, { auth: { token }, transports: ["websocket"], forceNew: true });
    s.once("ready", () => resolve(s));
    s.once("connect_error", reject);
  });
  const rejected = await connect("not-a-token").then(() => false, () => true);
  check("socket rejects a bad token", rejected);
  const sDemo = await connect(t);
  const sMom = await connect(mom.token);
  const sOut = await connect(outsider);
  check("sockets connect with valid tokens", sDemo.connected && sMom.connected && sOut.connected);
  const gotByMom: any[] = [], gotByOutsider: any[] = [], notifMom: any[] = [];
  sMom.on("message", m => gotByMom.push(m));
  sOut.on("message", m => gotByOutsider.push(m));
  sMom.on("notification", n => notifMom.push(n));

  pushes.length = 0;
  const viaRest = await call("POST", `/circles/${family.id}/messages`, t, { text: "hello via REST" });
  await wait(200);
  check("REST message is delivered live to other members", gotByMom.some(m => m.id === viaRest.data.id));
  check("message isn't delivered to non-members", gotByOutsider.length === 0);
  check("live notification event delivered to member", notifMom.some(n => n.kind === "chat" && n.body === "hello via REST"));
  check("chat push sent to members with devices", pushes.some(p => p.to === riyaTok && p.body === "hello via REST" && p.data.circleId === family.id), pushes);
  check("sender gets no push for own message", !pushes.some(p => p.title.startsWith("Demo User") && p.to === "ExponentPushToken[demo]"));

  const ack: any = await new Promise(r => sDemo.emit("message", { circleId: family.id, text: "hello via socket" }, r));
  await wait(200);
  check("socket send is acknowledged", ack.ok === true && ack.message.text === "hello via socket", ack);
  check("socket message delivered live", gotByMom.some(m => m.text === "hello via socket"));
  check("socket message saved to history", (await call("GET", `/circles/${family.id}/messages`, mom.token)).data.some((m: any) => m.text === "hello via socket"));
  const badAck: any = await new Promise(r => sOut.emit("message", { circleId: family.id, text: "intruder" }, r));
  check("non-member can't send over socket", badAck.ok === false);
  check("outsider can't read chat over REST", (await call("GET", `/circles/${family.id}/messages`, outsider)).status === 403);
  check("dead push tokens are cleaned up", !(await prisma.pushToken.findUnique({ where: { token: "ExponentPushToken[DEAD-dad]" } })));

  // =================================================================== My Day + pulse
  section = "my-day";
  const tasks = await call("GET", "/tasks", t);
  check("tasks: 3 remaining of 4", tasks.data.remaining === 3, tasks.data.remaining);
  const apple = tasks.data.items.find((x: any) => x.title === "Eat an Apple");
  check("complete task", (await call("POST", `/tasks/${apple.id}/done`, t)).data.done === true);
  check("remaining drops to 2", (await call("GET", "/tasks", t)).data.remaining === 2);
  const pulse = await call("GET", `/pulse/${family.id}`, t);
  check("pulse shows the completion event", pulse.data.events.some((e: any) => e.text.includes("Eat an Apple")));
  check("pulse blocked for non-members", (await call("GET", `/pulse/${family.id}`, outsider)).status === 403);
  check("appointments sorted, 2 upcoming", (await call("GET", "/appointments", t)).data.length === 2);

  // =================================================================== health vault
  section = "health";
  const hv = await call("GET", `/health/${mom.user.id}`, t);
  check("circle member can view Mom's vault", hv.data.vitals.length === 3 && hv.data.medications.length === 2, hv.data);
  check("outsider cannot view Mom's vault", (await call("GET", `/health/${mom.user.id}`, outsider)).status === 403);
  const med = hv.data.medications.find((m: any) => !m.taken);
  check("can't mark someone else's medication", (await call("POST", `/health/medications/${med.id}/take`, t)).status === 404);
  check("Mom can mark her own medication", (await call("POST", `/health/medications/${med.id}/take`, mom.token)).data.taken === true);

  // =================================================================== doctor
  section = "doctor";
  const docs = await call("GET", "/doctors", t);
  const mehta = docs.data.find((d: any) => d.name === "Dr. Mehta Sharma");
  check("you only see doctors you added", docs.data.length === 1 && !!mehta && mehta.hasAccount === true && mehta.rating === null, docs.data);
  check("other families can't see your doctors", (await call("GET", "/doctors", outsider)).data.length === 0);
  check("other families can't open your doctor", (await call("GET", `/doctors/${mehta.id}`, outsider)).status === 404);
  const doc = await call("GET", `/doctors/${mehta.id}`, t);
  check("doctor detail with access list + messaging enabled", doc.data.sharedWith.length === 2 && doc.data.canMessage === true, doc.data);
  check("cannot share records with a stranger", (await call("PUT", `/doctors/${mehta.id}/access`, t, { sharedWith: [su.data.user.id] })).status === 400);
  check("add doctor needs a name and specialty", (await call("POST", "/doctors", t, { name: "Dr X" })).status === 400);
  const priv = await call("POST", "/doctors", t, { name: "Dr. Kavya Rao", specialty: "Cardiologist", phone: "+911234567890" });
  check("add a private doctor card", priv.status === 201 && priv.data.hasAccount === false, priv.data);
  check("private doctor can't be messaged", (await call("POST", `/doctors/${priv.data.id}/messages`, t, { text: "hi" })).status === 409);
  check("unknown doctor email is explained", (await call("POST", "/doctors", outsider, { email: "nobody@nowhere.test" })).status === 404);
  const byEmail = await call("POST", "/doctors", outsider, { email: "dr.mehta@kizayu.test" });
  check("add a Kizayu doctor by email connects to their profile", byEmail.status === 201 && byEmail.data.id === mehta.id && byEmail.data.hasAccount, byEmail.data);
  check("can't add yourself as your doctor", (await call("POST", "/doctors", drm.token, { email: "dr.mehta@kizayu.test" })).status === 400);
  await call("DELETE", `/doctors/${priv.data.id}/access`, t);
  check("removing a private doctor deletes the card", !(await prisma.doctor.findUnique({ where: { id: priv.data.id } })));
  await call("DELETE", `/doctors/${mehta.id}/access`, outsider);
  check("removing a Kizayu doctor keeps their profile", !!(await prisma.doctor.findUnique({ where: { id: mehta.id } })));
  const prof = await call("PUT", "/doctor-portal/profile", outsider, { specialty: "Pediatrician" });
  check("any account can set up a doctor profile", prof.status === 200 && prof.data.hasAccount && prof.data.specialty === "Pediatrician", prof.data);
  check("doctor profile is readable", (await call("GET", "/doctor-portal/profile", outsider)).data?.specialty === "Pediatrician");
  check("non-doctor has no profile", (await call("GET", "/doctor-portal/profile", t)).data === null);
  await prisma.doctor.deleteMany({ where: { userId: su.data.user.id } });
  const history = await call("GET", `/doctors/${mehta.id}/messages`, t);
  check("patient sees seeded conversation", history.data.length === 2, history.data);
  await call("POST", "/push/register", drm.token, { token: "ExponentPushToken[doctor-phone]", platform: "ios" });
  pushes.length = 0;
  const sDoc = await connect(drm.token);
  const docLive: any[] = [];
  sDoc.on("doctorMessage", m => docLive.push(m));
  const pm = await call("POST", `/doctors/${mehta.id}/messages`, t, { text: "Doctor, should Mom take Vitamin D daily?" });
  await wait(200);
  check("patient message sent", pm.status === 201);
  check("doctor receives it live", docLive.some(m => m.id === pm.data.id));
  check("doctor gets a push", pushes.some(p => p.to === "ExponentPushToken[doctor-phone]" && p.body.includes("Vitamin D")), pushes);
  const threads = await call("GET", "/doctor-portal/threads", drm.token);
  const thread = threads.data.find((x: any) => x.patient.id === demo.user.id);
  check("doctor inbox lists the thread with unread count", !!thread && thread.unread >= 1, threads.data);
  check("non-doctor can't open the doctor inbox", (await call("GET", "/doctor-portal/threads", t)).status === 403);
  const open = await call("GET", `/doctor-portal/threads/${thread.id}`, drm.token);
  check("doctor opens thread; patient has linked them", open.data.messages.length === 3 && open.data.linked === true, open.data);
  check("opening marks messages read", (await call("GET", "/doctor-portal/threads", drm.token)).data.find((x: any) => x.id === thread.id).unread === 0);
  const sDemoDoc: any[] = [];
  sDemo.on("doctorMessage", m => sDemoDoc.push(m));
  const reply = await call("POST", `/doctor-portal/threads/${thread.id}/messages`, drm.token, { text: "Weekly is enough for her." });
  await wait(200);
  check("doctor reply delivered live to patient", reply.status === 201 && sDemoDoc.some(m => m.id === reply.data.id));
  check("patient gets a 'doctor' notification", (await call("GET", "/notifications", t)).data.items.some((n: any) => n.kind === "doctor" && n.body.includes("Weekly")));
  check("doctor can view linked patient's vault", (await call("GET", `/doctor-portal/patients/${demo.user.id}/health`, drm.token)).status === 200);
  check("doctor can't view an unlinked patient's vault", (await call("GET", `/doctor-portal/patients/${mom.user.id}/health`, drm.token)).status === 403);
  check("other doctor's threads are hidden", (await call("GET", `/doctor-portal/threads/${thread.id}`, mom.token)).status === 403);

  // =================================================================== premium
  section = "premium";
  const plans = await call("GET", "/premium/plans", outsider);
  check("plans + feature table available", plans.data.plans.length === 2 && plans.data.features.length >= 3 && plans.data.devPurchases === true, plans.data);
  check("new user is not premium", (await call("GET", "/premium/status", outsider)).data.premium === false);
  check("free: 2nd owned circle allowed", (await call("POST", "/circles", outsider, { name: "Second", type: "Friends" })).status === 201);
  check("free: 3rd owned circle blocked (402)", (await call("POST", "/circles", outsider, { name: "Third", type: "Relatives" })).status === 402);
  const outCircle = (await call("GET", "/circles", outsider)).data[0].id;
  await call("PUT", "/location", outsider, { lat: 12.97, lng: 77.59 });
  check("free: 12-hour location share blocked (402)", (await call("POST", "/location/share", outsider, { circleId: outCircle, hours: 12 })).status === 402);
  check("store purchase not yet wired -> 501", (await call("POST", "/premium/purchase", outsider, { plan: "monthly", provider: "google", receipt: "x" })).status === 501);
  const buy = await call("POST", "/premium/purchase", outsider, { plan: "yearly", provider: "dev" });
  check("test purchase activates premium for ~1 year", buy.data.premium === true && new Date(buy.data.subscription.expiresAt).getTime() - Date.now() > 360 * 86400e3, buy.data);
  check("/me reflects premium", (await call("GET", "/me", outsider)).data.premium === true);
  check("premium: 3rd circle now allowed", (await call("POST", "/circles", outsider, { name: "Third", type: "Relatives" })).status === 201);
  check("premium: 12-hour share now allowed", (await call("POST", "/location/share", outsider, { circleId: outCircle, hours: 12 })).status === 200);
  const cancel = await call("POST", "/premium/cancel", outsider);
  check("cancel keeps premium until period ends", cancel.data.premium === true && cancel.data.subscription.status === "canceled", cancel.data);
  await prisma.subscription.updateMany({ where: { userId: su.data.user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  check("expired subscription -> premium off", (await call("GET", "/premium/status", outsider)).data.premium === false);

  // =================================================================== support
  section = "support";
  check("support ticket validation", (await call("POST", "/support/tickets", t, { subject: "x", message: "short" })).status === 400);
  const ticket = await call("POST", "/support/tickets", t, { subject: "Can't upload photo", message: "When I tap Gallery nothing happens on my phone." });
  check("create support ticket", ticket.status === 201 && ticket.data.status === "open");
  check("list my tickets", (await call("GET", "/support/tickets", t)).data.some((x: any) => x.id === ticket.data.id));
  check("tickets are private", !(await call("GET", "/support/tickets", outsider)).data.some((x: any) => x.id === ticket.data.id));

  // =================================================================== games
  section = "games";
  const games = await call("GET", "/games", t);
  check("4 games listed", games.data.length === 4);
  for (const title of ["Ludo", "Word Hunt"]) {
    const g = games.data.find((x: any) => x.title === title);
    check(`${title}: score saved`, (await call("POST", `/games/${g.id}/scores`, t, { score: 150 })).status === 201);
  }
  const trivia = games.data.find((x: any) => x.title === "Trivia");
  await call("POST", `/games/${trivia.id}/scores`, t, { score: 120 });
  await call("POST", `/games/${trivia.id}/scores`, mom.token, { score: 90 });
  const lb = await call("GET", `/games/${trivia.id}/leaderboard`, t);
  check("leaderboard ranks best first", lb.data[0]?.score === 120 && lb.data[0].rank === 1, lb.data);
  check("negative score rejected", (await call("POST", `/games/${trivia.id}/scores`, t, { score: -5 })).status === 400);

  // =================================================================== safety
  section = "safety";
  await call("PUT", "/safety", t, { homeLat: 19.076, homeLng: 72.8777 });
  await call("PUT", "/location", t, { lat: 19.2, lng: 72.9 });
  check("share location with circle", (await call("POST", "/location/share", t, { circleId: family.id, hours: 2 })).status === 200);
  check("circle member sees shared location", (await call("GET", `/location/circle/${family.id}`, mom.token)).data.length === 1);
  pushes.length = 0;
  await call("PUT", "/location", t, { lat: 19.0761, lng: 72.8778 });
  await wait(150);
  check("entering home radius labels 'At Home'", (await call("GET", `/location/circle/${family.id}`, t)).data[0].label === "At Home");
  check("arrived-home push sent to family", pushes.some(p => p.to === riyaTok && p.title.includes("arrived home")), pushes);
  await call("POST", "/location/stop", t);
  check("stop sharing hides location", (await call("GET", `/location/circle/${family.id}`, t)).data.length === 0);
  pushes.length = 0;
  const sos = await call("POST", "/safety/sos", t, { lat: 19.07, lng: 72.87 });
  await wait(150);
  check("SOS notifies both circles", sos.data.notifiedCircles === 2, sos.data);
  const sosPush = pushes.find(p => p.to === riyaTok);
  check("SOS push is high priority with location", !!sosPush && sosPush.priority === "high" && sosPush.data.lat === "19.07", pushes);
  check("SOS sends one push per person (not per circle)", pushes.filter(p => p.to === riyaTok).length === 1, pushes.length);
  check("SOS marks pulse as needs_attention", (await call("GET", `/pulse/${family.id}`, t)).data.summary === "needs_attention");
  await call("PUT", "/safety", t, { sosAlert: false });
  check("SOS blocked when turned off", (await call("POST", "/safety/sos", t, {})).status === 409);
  await call("PUT", "/safety", t, { sosAlert: true });

  // =================================================================== account
  section = "account";
  const pw = await call("POST", "/me/password", npIn.data.token, { password: "phonepass123" });
  check("phone-only user can add a password", pw.status === 200);
  check("changing password requires current one", (await call("POST", "/me/password", t, { current: "wrong", password: "whatever123" })).status === 400);
  check("status update", (await call("PATCH", "/me", t, { status: "Busy" })).data.status === "Busy");
  await call("PATCH", "/me", t, { status: "Active" });

  // =================================================================== moderation: report, block, delete
  section = "moderation";
  const feedNow = (await call("GET", "/feed", t)).data.items as any[];
  const riyaPost = feedNow.find(p => p.author.id === riya.user.id);
  check("report needs a valid reason", (await call("POST", "/reports", t, { targetType: "post", targetId: riyaPost.id, reason: "meh" })).status === 400);
  check("report of missing content is 404", (await call("POST", "/reports", t, { targetType: "post", targetId: "nope", reason: "spam" })).status === 404);
  check("report a post", (await call("POST", "/reports", t, { targetType: "post", targetId: riyaPost.id, reason: "inappropriate", details: "test" })).status === 201);
  check("reported post disappears from the reporter's feed", !(await call("GET", "/feed", t)).data.items.some((p: any) => p.id === riyaPost.id));
  check("others still see it", (await call("GET", "/feed", mom.token)).data.items.some((p: any) => p.id === riyaPost.id));
  check("report a user", (await call("POST", "/reports", t, { targetType: "user", targetId: riya.user.id, reason: "harassment" })).status === 201);

  check("can't block yourself", (await call("POST", "/blocks", t, { userId: demo.user.id })).status === 400);
  const momPost = feedNow.find(p => p.author.id === mom.user.id);
  await call("POST", `/posts/${momPost.id}/comments`, riya.token, { text: "riya comment before block" });
  check("block a user", (await call("POST", "/blocks", t, { userId: riya.user.id })).status === 201);
  check("blocked list shows them", (await call("GET", "/blocks", t)).data.some((b: any) => b.user.id === riya.user.id));
  check("blocked user's comments are hidden", !(await call("GET", `/posts/${momPost.id}/comments`, t)).data.some((c: any) => c.user.id === riya.user.id));
  check("blocked user's stories are hidden", !(await call("GET", "/stories", t)).data.some((g: any) => g.author.id === riya.user.id));
  await call("POST", `/circles/${family.id}/messages`, riya.token, { text: "message from blocked riya" });
  await wait(150);
  check("blocked user's chat messages are hidden", !(await call("GET", `/circles/${family.id}/messages`, t)).data.some((m: any) => m.text === "message from blocked riya"));
  check("no notification from a blocked user", !(await call("GET", "/notifications", t)).data.items.some((n: any) => n.body === "message from blocked riya"));
  check("others still get it", (await call("GET", "/notifications", mom.token)).data.items.some((n: any) => n.body === "message from blocked riya"));
  check("unblock", (await call("DELETE", `/blocks/${riya.user.id}`, t)).data.blocked === false);
  check("after unblock their comments show again", (await call("GET", `/posts/${momPost.id}/comments`, t)).data.some((c: any) => c.user.id === riya.user.id));

  const mine = await call("POST", "/posts", t, { circleId: family.id, caption: "to be deleted", imageUrl: up.data.url });
  check("others can't delete my post", (await call("DELETE", `/posts/${mine.data.id}`, mom.token)).status === 403);
  const momComment = await call("POST", `/posts/${mine.data.id}/comments`, mom.token, { text: "nice" });
  check("a third person can't delete someone's comment", (await call("DELETE", `/comments/${momComment.data.id}`, riya.token)).status === 403);
  check("post author can delete a comment on their post", (await call("DELETE", `/comments/${momComment.data.id}`, t)).status === 204);
  check("delete my own post", (await call("DELETE", `/posts/${mine.data.id}`, t)).status === 204);
  check("deleted post is gone from the feed", !(await call("GET", "/feed", mom.token)).data.items.some((p: any) => p.id === mine.data.id));
  check("its photo is deleted too", (await fetch(up.data.url)).status === 404);

  const sMom2 = await connect(mom.token);
  const deletedLive: any[] = [];
  sMom2.on("messageDeleted", e => deletedLive.push(e));
  const msg = await call("POST", `/circles/${family.id}/messages`, t, { text: "oops, wrong chat" });
  check("can't delete someone else's message", (await call("DELETE", `/messages/${msg.data.id}`, mom.token)).status === 404);
  check("delete my own message", (await call("DELETE", `/messages/${msg.data.id}`, t)).status === 204);
  await wait(200);
  check("deletion reaches others live", deletedLive.some(e => e.id === msg.data.id));
  check("deleted message is gone from history", !(await call("GET", `/circles/${family.id}/messages`, mom.token)).data.some((m: any) => m.id === msg.data.id));
  sMom2.disconnect();

  // =================================================================== account deletion
  section = "delete-account";
  const gone = "gone" + Date.now();
  const g = await call("POST", "/auth/signup", undefined, { name: "Leaving Soon", username: gone, email: `${gone}@x.test`, password: "leaving123" });
  const gt = g.data.token as string;
  const myCircles = (await call("GET", "/circles", gt)).data;
  const shared = await call("POST", "/circles", gt, { name: "Shared one", type: "Friends" });
  const sharedCode = (await call("GET", "/circles", gt)).data.find((c: any) => c.id === shared.data.id).inviteCode;
  await call("POST", "/circles/join", mom.token, { code: sharedCode });
  const pic = await call("POST", "/uploads", gt, { data: png, ext: "png" });
  await call("POST", "/posts", gt, { circleId: shared.data.id, caption: "bye", imageUrl: pic.data.url });
  check("delete needs the word DELETE", (await call("POST", "/me/delete", gt, { password: "leaving123" })).status === 400);
  check("delete needs the right password", (await call("POST", "/me/delete", gt, { confirm: "DELETE", password: "wrong" })).status === 400);
  check("delete account", (await call("POST", "/me/delete", gt, { confirm: "DELETE", password: "leaving123" })).status === 204);
  check("can't sign in afterwards", (await call("POST", "/auth/login", undefined, { email: `${gone}@x.test`, password: "leaving123" })).status === 401);
  check("old session stops working", (await call("GET", "/me", gt)).status === 401);
  check("their photos are deleted", (await fetch(pic.data.url)).status === 404);
  check("circle with other members passes to the next member", (await call("GET", "/circles", mom.token)).data.find((c: any) => c.id === shared.data.id)?.members.find((m: any) => m.id === mom.user.id)?.role === "owner");
  check("circle where they were alone is deleted", !(await prisma.circle.findUnique({ where: { id: myCircles[0].id } })));
  check("their posts are gone", !(await call("GET", "/feed", mom.token)).data.items.some((p: any) => p.caption === "bye"));
  check("phone-only account can delete without a password", (await call("POST", "/me/delete", npIn.data.token, { confirm: "DELETE", password: "phonepass123" })).status === 204);

  // =================================================================== public pages
  section = "legal";
  const privPage = await fetch(base + "/privacy");
  const privText = await privPage.text();
  check("privacy page is public HTML", privPage.status === 200 && (privPage.headers.get("content-type") ?? "").includes("html") && privText.includes("Delete account"));
  check("terms page is public", (await fetch(base + "/terms")).status === 200);
  check("premium switch reported to the app", typeof (await call("GET", "/premium/plans", t)).data.enabled === "boolean");

  [sDemo, sMom, sOut, sDoc].forEach(s => s.disconnect());
  server.close(); pushServer.close();
  await prisma.$disconnect();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
