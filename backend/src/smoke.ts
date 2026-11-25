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
  const { purgeOldSos } = await import("./routes/sos");

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

  // =================================================================== shared lists
  section = "lists";
  const sMomL = await connect(mom.token);
  const listEvents: any[] = [];
  sMomL.on("listChanged", e => listEvents.push(e));
  check("outsider can't read a circle's lists", (await call("GET", `/circles/${family.id}/lists`, outsider)).status === 403);
  check("list needs a valid icon", (await call("POST", `/circles/${family.id}/lists`, riya.token, { title: "X", icon: "bomb" })).status === 400);
  check("list needs a title", (await call("POST", `/circles/${family.id}/lists`, riya.token, { title: "  " })).status === 400);
  const gl = await call("POST", `/circles/${family.id}/lists`, riya.token, { title: "Groceries", icon: "cart" });
  check("a member can create a list", gl.status === 201 && gl.data.title === "Groceries" && gl.data.items.length === 0, gl.data);
  check("outsider can't add items", (await call("POST", `/lists/${gl.data.id}/items`, outsider, { text: "milk" })).status === 403);
  const milk = await call("POST", `/lists/${gl.data.id}/items`, demo.token, { text: "Milk" });
  const eggs = await call("POST", `/lists/${gl.data.id}/items`, dad.token, { text: "Eggs" });
  check("members can add items", milk.status === 201 && eggs.status === 201);
  await wait(250);
  check("list changes reach other members live", listEvents.some(e => e.listId === gl.data.id && e.circleId === family.id), listEvents);
  const seen = (await call("GET", `/circles/${family.id}/lists`, mom.token)).data.find((l: any) => l.id === gl.data.id);
  check("everyone in the circle sees the items in order", seen.items.map((i: any) => i.text).join() === "Milk,Eggs", seen);
  check("tick an item", (await call("PATCH", `/lists/${gl.data.id}/items/${milk.data.id}`, mom.token, { done: true })).data.done === true);
  const afterTick = (await call("GET", `/circles/${family.id}/lists`, t)).data.find((l: any) => l.id === gl.data.id);
  check("ticked item records who did it", afterTick.items[0].done === true && afterTick.items[0].doneById === mom.user.id, afterTick.items[0]);
  check("untick an item", (await call("PATCH", `/lists/${gl.data.id}/items/${milk.data.id}`, mom.token, { done: false })).data.done === false);
  check("item can't be changed through the wrong list", (await call("PATCH", `/lists/${gl.data.id}/items/nope`, mom.token, { done: true })).status === 404);
  await call("PATCH", `/lists/${gl.data.id}/items/${milk.data.id}`, mom.token, { done: true });
  check("clear ticked items", (await call("POST", `/lists/${gl.data.id}/clear-done`, t)).data.removed === 1);
  check("only unticked items remain", (await call("GET", `/circles/${family.id}/lists`, t)).data.find((l: any) => l.id === gl.data.id).items.length === 1);
  check("remove a single item", (await call("DELETE", `/lists/${gl.data.id}/items/${eggs.data.id}`, dad.token)).status === 204);
  check("a member who isn't the maker or an owner can't delete the list", (await call("DELETE", `/lists/${gl.data.id}`, mom.token)).status === 403);
  check("the maker can delete their list", (await call("DELETE", `/lists/${gl.data.id}`, riya.token)).status === 204);
  const owned = await call("POST", `/circles/${family.id}/lists`, riya.token, { title: "Trip" });
  check("a circle owner can delete any list", (await call("DELETE", `/lists/${owned.data.id}`, t)).status === 204);
  sMomL.disconnect();

  // =================================================================== emergency card
  section = "emergency";
  const em0 = await call("GET", "/emergency/me", t);
  check("emergency card starts empty", em0.status === 200 && em0.data.bloodGroup === "" && em0.data.contacts.length === 0 && em0.data.contactPhone === "", em0.data);
  check("blood group must be valid", (await call("PUT", "/emergency/me", t, { bloodGroup: "Z+" })).status === 400);
  check("contact phone must look like a phone number", (await call("PUT", "/emergency/me", t, { contactPhone: "call me maybe" })).status === 400);
  const em1 = await call("PUT", "/emergency/me", t, { bloodGroup: "O+", allergies: "Penicillin, Peanuts", conditions: "Asthma", notes: "Inhaler in the bag" });
  check("save emergency card", em1.status === 200 && em1.data.bloodGroup === "O+" && em1.data.allergies === "Penicillin, Peanuts", em1.data);

  const ca = await call("POST", "/sos/contacts", t, { name: "Mom", relation: "Mother", phone: "+91 98000 00001" });
  const cb = await call("POST", "/sos/contacts", t, { name: "Dr. Rao", relation: "Doctor", phone: "+91 98000 00002" });
  check("add emergency contacts with a relationship", ca.status === 201 && ca.data.relation === "Mother" && cb.status === 201, [ca.data, cb.data]);
  const edited = await call("PUT", `/sos/contacts/${cb.data.id}`, t, { name: "Dr. Rao Sr.", relation: "Family doctor" });
  check("edit a contact", edited.status === 200 && edited.data.name === "Dr. Rao Sr." && edited.data.relation === "Family doctor" && edited.data.phone === "+919800000002", edited.data);
  check("editing to a number already in the list is refused", (await call("PUT", `/sos/contacts/${cb.data.id}`, t, { phone: "+91 98000 00001" })).status === 409);
  check("can't edit someone else's contact", (await call("PUT", `/sos/contacts/${cb.data.id}`, mom.token, { name: "Hacked" })).status === 404);

  const emNow = (await call("GET", "/emergency/me", t)).data;
  check("the card lists every contact, oldest first", emNow.contacts.map((c: any) => c.name).join() === "Mom,Dr. Rao Sr." && emNow.contactName === "Mom", emNow.contacts);
  check("circle members can view the card with contacts", ((await call("GET", `/emergency/${demo.user.id}`, mom.token)).data.info.contacts as any[]).length === 2);
  check("people outside the circle can't", (await call("GET", `/emergency/${demo.user.id}`, outsider)).status === 403);
  const famCards = await call("GET", "/emergency/family", mom.token);
  const demoCard = famCards.data.find((c: any) => c.user.id === demo.user.id);
  check("family list shows members who filled a card in", !!demoCard && demoCard.info.allergies === "Penicillin, Peanuts" && demoCard.info.contacts.length === 2, famCards.data);
  check("family list excludes yourself", !(await call("GET", "/emergency/family", t)).data.some((c: any) => c.user.id === demo.user.id));
  check("family list hides people outside the circle", (await call("GET", "/emergency/family", outsider)).data.length === 0);

  // app 1.0.0 compatibility: a single contact sent with the card becomes the first contact
  const legacy = await call("PUT", "/emergency/me", riya.token, { contactName: "Old Style", contactPhone: "+91 98111 11111" });
  check("older apps' single contact is kept as a contact", legacy.status === 200 && legacy.data.contacts.length === 1 && legacy.data.contacts[0].name === "Old Style", legacy.data);
  check("a number without a country code is explained", (await call("PUT", "/emergency/me", riya.token, { contactPhone: "98111 11111" })).status === 400);
  await prisma.sosContact.deleteMany({ where: { userId: riya.user.id } });

  // a card that is emptied (no medical info, no contacts) disappears from the family list
  await call("PUT", "/emergency/me", t, { bloodGroup: "", allergies: "", conditions: "", notes: "" });
  check("medical info alone off still leaves the contacts visible", (await call("GET", "/emergency/family", mom.token)).data.some((c: any) => c.user.id === demo.user.id));
  await call("DELETE", `/sos/contacts/${ca.data.id}`, t);
  await call("DELETE", `/sos/contacts/${cb.data.id}`, t);
  check("an emptied card disappears from the family list", !(await call("GET", "/emergency/family", mom.token)).data.some((c: any) => c.user.id === demo.user.id));

  // =================================================================== medicine reminders
  section = "reminders";
  check("reminder time must look like HH:MM", (await call("POST", "/health/medications", t, { name: "Vit C", schedule: "Daily", remindAt: "8:30pm" })).status === 400);
  const rem = await call("POST", "/health/medications", t, { name: "Vitamin C", schedule: "Daily • 8:30 AM", remindAt: "08:30" });
  check("medicine saves a reminder time", rem.status === 201 && rem.data.remindAt === "08:30", rem.data);
  const ov = await call("GET", `/health/${demo.user.id}`, t);
  check("overview includes the reminder time", ov.data.medications.find((m: any) => m.name === "Vitamin C")?.remindAt === "08:30", ov.data.medications);

  // =================================================================== SOS: contacts, recording, private link
  section = "sos";
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(40)]);
  const upClip = async (id: string, token: string, buf: Buffer, kind = "video") => {
    const r = await fetch(`${base}/sos/${id}/clips?kind=${kind}&seconds=15`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "video/mp4" }, body: new Uint8Array(buf) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };

  check("SOS contact needs a country code", (await call("POST", "/sos/contacts", t, { name: "Aunt", phone: "9876543210" })).status === 400);
  check("SOS contact needs a name", (await call("POST", "/sos/contacts", t, { name: " ", phone: "+919876543210" })).status === 400);
  const c1 = await call("POST", "/sos/contacts", t, { name: "Aunt Meera", relation: "Aunt", phone: "+91 98765-43210" });
  check("add an SOS contact (the number is cleaned up)", c1.status === 201 && c1.data.phone === "+919876543210" && c1.data.relation === "Aunt", c1.data);
  check("duplicate numbers are refused", (await call("POST", "/sos/contacts", t, { name: "Again", phone: "+919876543210" })).status === 409);
  const c2 = await call("POST", "/sos/contacts", t, { name: "Uncle Raj", phone: "+14155550123" });
  check("list SOS contacts", (await call("GET", "/sos/contacts", t)).data.length === 2);
  check("other people can't see my SOS contacts", (await call("GET", "/sos/contacts", mom.token)).data.length === 0);
  check("can't delete someone else's contact", (await call("DELETE", `/sos/contacts/${c2.data.id}`, mom.token)).status === 404);
  check("delete a contact", (await call("DELETE", `/sos/contacts/${c2.data.id}`, t)).status === 204);
  for (let i = 0; i < 4; i++) await call("POST", "/sos/contacts", t, { name: `Extra ${i}`, phone: `+9198000000${10 + i}` });
  check("up to five SOS contacts", (await call("POST", "/sos/contacts", t, { name: "Sixth", phone: "+919800000099" })).status === 400);

  check("SOS recording is off until the user opts in", (await call("GET", "/safety", t)).data.sosRecording === false);
  check("opt in to SOS recording", (await call("PUT", "/safety", t, { sosRecording: true })).data.sosRecording === true);
  await call("PUT", "/safety", t, { sosAlert: false });
  check("SOS can't start while SOS alerts are off", (await call("POST", "/sos/start", t, {})).status === 409);
  await call("PUT", "/safety", t, { sosAlert: true });

  const sMomS = await connect(mom.token);
  const sosClipEvents: any[] = [];
  sMomS.on("sosClip", e => sosClipEvents.push(e));
  pushes.length = 0;
  const st = await call("POST", "/sos/start", t, { lat: 19.07, lng: 72.87 });
  check("start an SOS", st.status === 201 && !!st.data.id && st.data.link.includes("/s/") && st.data.contacts === 5 && st.data.reused === false, st.data);
  await wait(400);
  const sp = pushes.find(p => p.to === riyaTok && p.title.includes("SOS"));
  check("people in circles get an urgent push with the live link", !!sp && sp.priority === "high" && sp.data.link === st.data.link && sp.data.screen === "sos", pushes);
  check("one SOS push per person", pushes.filter(p => p.to === riyaTok && p.title.includes("SOS")).length === 1);
  check("the chat message includes the live link", (await call("GET", `/circles/${family.id}/messages`, mom.token)).data.some((m: any) => (m.text ?? "").includes(st.data.link)));
  const again = await call("POST", "/sos/start", t, {});
  check("pressing SOS again resumes the same SOS (no second alert)", again.data.id === st.data.id && again.data.reused === true, again.data);
  check("location updates are accepted", (await call("POST", `/sos/${st.data.id}/location`, t, { lat: 19.08, lng: 72.88 })).status === 200);
  check("others can't update my SOS location", (await call("POST", `/sos/${st.data.id}/location`, mom.token, { lat: 1, lng: 1 })).status === 404);
  check("a location must be valid", (await call("POST", `/sos/${st.data.id}/location`, t, { lat: 999, lng: 1 })).status === 400);

  check("non-video uploads are refused", (await upClip(st.data.id, t, Buffer.from("this is just text, definitely not a video"))).status === 400);
  const clip1 = await upClip(st.data.id, t, mp4);
  check("upload a clip", clip1.status === 201 && String(clip1.data.url).endsWith(".mp4"), clip1);
  check("audio clips are stored as m4a", String((await upClip(st.data.id, t, mp4, "audio")).data?.url).endsWith(".m4a"));
  check("others can't upload to my SOS", (await upClip(st.data.id, mom.token, mp4)).status === 404);
  check("the clip file can be downloaded", (await fetch(clip1.data.url)).status === 200);
  await wait(300);
  check("circle members are told about new clips live", sosClipEvents.some(e => e.sosId === st.data.id && e.userId === demo.user.id), sosClipEvents);
  sMomS.disconnect();

  const active = await call("GET", "/sos/active", mom.token);
  check("circle members see the active SOS", active.data.others.some((e: any) => e.id === st.data.id && e.user.id === demo.user.id && e.clipCount === 2 && e.link === st.data.link), active.data);
  check("my own running SOS is reported back to me", (await call("GET", "/sos/active", t)).data.mine?.id === st.data.id);
  check("people outside the circles see nothing", (await call("GET", "/sos/active", outsider)).data.others.length === 0);

  const sosToken = st.data.link.split("/s/")[1];
  const pg = await fetch(`${base}/s/${sosToken}`);
  const html = await pg.text();
  check("contacts can open the link page without an account", pg.status === 200 && html.includes(demo.user.name) && html.includes("SOS"), pg.status);
  check("the link page sends a strict script policy", /script-src 'nonce-/.test(pg.headers.get("content-security-policy") ?? ""));
  const pd: any = await (await fetch(`${base}/s/${sosToken}/data`)).json();
  check("page data has the location and clips", pd.active === true && pd.lat === 19.08 && pd.clips.length === 2 && pd.name === demo.user.name, pd);
  check("page data doesn't leak private details", !JSON.stringify(pd).includes("@") && !("email" in pd) && !("phone" in pd), pd);
  check("a wrong link shows an expired page", (await fetch(`${base}/s/not-a-real-token`)).status === 404 && (await fetch(`${base}/s/not-a-real-token/data`)).status === 404);

  check("end the SOS", (await call("POST", `/sos/${st.data.id}/end`, t)).data.ended === true);
  check("ending twice is harmless", (await call("POST", `/sos/${st.data.id}/end`, t)).data.already === true);
  check("a clip arriving just after the end is still accepted", (await upClip(st.data.id, t, mp4)).status === 201);
  check("the page shows the SOS as ended", ((await (await fetch(`${base}/s/${sosToken}/data`)).json()) as any).active === false);
  check("an ended SOS no longer shows as active", (await call("GET", "/sos/active", mom.token)).data.others.length === 0);
  check("location updates are refused after the end", (await call("POST", `/sos/${st.data.id}/location`, t, { lat: 1, lng: 1 })).status === 409);

  // account deletion removes recordings too
  const sx = Date.now();
  const gx = await call("POST", "/auth/signup", undefined, { name: "Gone Soon", username: "gonesos" + sx, email: `gonesos${sx}@x.test`, password: "gonesos1234" });
  const gst = await call("POST", "/sos/start", gx.data.token, {});
  const gclip = await upClip(gst.data.id, gx.data.token, mp4);
  check("a second user can run their own SOS", gst.status === 201 && gclip.status === 201, gst.data);
  await call("POST", "/me/delete", gx.data.token, { confirm: "DELETE", password: "gonesos1234" });
  check("deleting the account deletes their recordings", (await fetch(gclip.data.url)).status === 404);
  check("and their SOS link stops working", (await fetch(`${base}/s/${gst.data.link.split("/s/")[1]}/data`)).status === 404);

  // retention: recordings older than 30 days are deleted
  await prisma.sosEvent.update({ where: { id: st.data.id }, data: { startedAt: new Date(Date.now() - 40 * 86400e3) } });
  check("old SOS recordings are cleaned up", (await purgeOldSos()) >= 1);
  check("the old recording file is gone", (await fetch(clip1.data.url)).status === 404);
  check("the old link no longer works", (await fetch(`${base}/s/${sosToken}`)).status === 404);

  // too many SOS alerts in one day is refused (protects contacts from SMS spam)
  await prisma.sosEvent.createMany({ data: Array.from({ length: 10 }, (_, i) => ({ userId: demo.user.id, token: `limit-${sx}-${i}`, endedAt: new Date() })) });
  check("a limit on SOS alerts per day", (await call("POST", "/sos/start", t, {})).status === 429);
  await prisma.sosEvent.deleteMany({ where: { token: { startsWith: `limit-${sx}` } } });

  // =================================================================== workouts: walk / run / cycle
  section = "fitness";
  const wroute = (n = 20) => Array.from({ length: n }, (_, i) => [19.07 + i * 0.0004, 72.87 + i * 0.0004]);
  const minsAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();
  const wk = (over: Record<string, unknown> = {}) => ({ kind: "walk", startedAt: minsAgo(3), durationSec: 1800, distanceM: 2500, route: wroute(), ...over });

  check("workout needs a valid kind", (await call("POST", "/activities", t, wk({ kind: "swim" }))).status === 400);
  check("a too-short workout is refused", (await call("POST", "/activities", t, wk({ durationSec: 10 }))).status === 400);
  check("a workout with almost no distance is refused", (await call("POST", "/activities", t, wk({ distanceM: 10 }))).status === 400);
  check("a workout in the future is refused", (await call("POST", "/activities", t, wk({ startedAt: new Date(Date.now() + 3600e3).toISOString() }))).status === 400);
  check("a workout from 3 days ago is refused", (await call("POST", "/activities", t, wk({ startedAt: minsAgo(3 * 24 * 60) }))).status === 400);
  const fast = await call("POST", "/activities", t, wk({ durationSec: 600, distanceM: 8000 }));
  check("an impossibly fast walk is refused with a reason", fast.status === 400 && /too fast/i.test(fast.data.error), fast.data);
  check("a route needs at least two points", (await call("POST", "/activities", t, wk({ route: [[19.07, 72.87]] }))).status === 400);
  check("route coordinates must be real", (await call("POST", "/activities", t, wk({ route: [[999, 72.87], [19.07, 72.87]] }))).status === 400);

  const w1 = await call("POST", "/activities", t, wk({ startedAt: minsAgo(3), title: "Morning walk" }));
  check("save a walk: calories and steps are estimated on the server", w1.status === 201 && w1.data.calories === 123 && w1.data.steps === 3333 && w1.data.title === "Morning walk", w1.data);
  const w2 = await call("POST", "/activities", t, wk({ kind: "run", startedAt: minsAgo(2), durationSec: 1500, distanceM: 5000 }));
  check("save a run", w2.status === 201 && w2.data.calories === 286 && w2.data.steps === 4762, w2.data);
  const w3 = await call("POST", "/activities", t, wk({ kind: "cycle", startedAt: minsAgo(1), durationSec: 1800, distanceM: 10000 }));
  check("a ride has no step estimate", w3.status === 201 && w3.data.steps === null && w3.data.calories === 263, w3.data);
  const momShared = await call("POST", "/activities", mom.token, wk({ distanceM: 3000 }));
  const momPrivate = await call("POST", "/activities", mom.token, wk({ distanceM: 4000, shared: false, startedAt: minsAgo(2) }));
  check("a workout can be kept private", momShared.status === 201 && momPrivate.status === 201 && momPrivate.data.shared === false);

  const wfeed = (await call("GET", "/activities/feed", t)).data as any[];
  check("the wfeed shows my workouts and my circles' shared ones, newest first", wfeed.some(a => a.id === momShared.data.id && a.user.id === mom.user.id) && wfeed.slice(0, 3).filter(a => a.userId === demo.user.id).length >= 2 && wfeed[0].startedAt >= wfeed[wfeed.length - 1].startedAt, wfeed.map(a => a.id));
  check("private workouts stay out of other people's wfeed", !wfeed.some(a => a.id === momPrivate.data.id));
  check("the wfeed list doesn't carry the heavy route data", !("route" in wfeed[0]));
  check("people outside the circles see none of it", !((await call("GET", "/activities/feed", outsider)).data as any[]).some(a => a.userId === demo.user.id || a.userId === mom.user.id));
  check("a workout appears on the family pulse", (await call("GET", `/pulse/${family.id}`, mom.token)).data.events.some((e: any) => /2\.5 km walk/.test(e.text)));

  const det = await call("GET", `/activities/${w1.data.id}`, t);
  check("workout detail includes the route", det.status === 200 && det.data.route.length === 20 && det.data.user.id === demo.user.id, det.status);
  check("a circle member can open a shared workout", (await call("GET", `/activities/${w1.data.id}`, mom.token)).status === 200);
  check("a private workout is hidden from others", (await call("GET", `/activities/${momPrivate.data.id}`, t)).status === 404);
  check("people outside the circles can't open a workout", (await call("GET", `/activities/${w1.data.id}`, outsider)).status === 404);

  const board = await call("GET", `/activities/leaderboard?circleId=${family.id}`, t);
  const order = (board.data as any[]).map(r => r.user.id);
  check("the leaderboard ranks by distance", board.status === 200 && order[0] === demo.user.id && board.data[0].distanceM === 17500 && board.data[0].count === 3, board.data.slice(0, 2));
  check("private workouts aren't counted on the leaderboard", board.data.find((r: any) => r.user.id === mom.user.id).distanceM === 3000);
  check("members without workouts are still listed", board.data.some((r: any) => r.distanceM === 0));
  check("only circle members can see a leaderboard", (await call("GET", `/activities/leaderboard?circleId=${family.id}`, outsider)).status === 403);

  const sum = await call("GET", "/activities/summary?tz=0", t);
  check("my weekly summary adds everything up", sum.data.week.count === 3 && sum.data.week.distanceM === 17500 && sum.data.week.steps === 3333 + 4762 && sum.data.week.calories === 123 + 286 + 263, sum.data.week);
  check("the summary has 7 days and today's total", sum.data.days.length === 7 && sum.data.days[6].distanceM === sum.data.today.distanceM && sum.data.today.count === 3, sum.data.days);

  await call("POST", "/blocks", t, { userId: mom.user.id });
  check("blocking someone hides their workouts", !((await call("GET", "/activities/feed", t)).data as any[]).some(a => a.userId === mom.user.id) && (await call("GET", `/activities/${momShared.data.id}`, t)).status === 404);
  await call("DELETE", `/blocks/${mom.user.id}`, t);

  check("someone else can't delete my workout", (await call("DELETE", `/activities/${w3.data.id}`, mom.token)).status === 404);
  check("delete my workout", (await call("DELETE", `/activities/${w3.data.id}`, t)).status === 204);
  check("a deleted workout is gone", (await call("GET", `/activities/${w3.data.id}`, t)).status === 404);

  // =================================================================== family hub: timezone, prefs, habits, scheduler
  section = "hub";
  check("timezone must be a sane number", (await call("PUT", "/prefs/timezone", t, { offsetMin: 5000 })).status === 400);
  check("the app can report its timezone", (await call("PUT", "/prefs/timezone", t, { offsetMin: -330 })).status === 200);
  const prefs0 = await call("GET", "/prefs/notifications", t);
  check("every notification category is on by default", prefs0.data.chat === true && prefs0.data.nudges === true && prefs0.data.chores === true, prefs0.data);
  check("I can switch a category off", (await call("PUT", "/prefs/notifications", t, { nudges: false })).data.nudges === false && (await call("GET", "/prefs/notifications", t)).data.nudges === false);
  await call("PUT", "/prefs/notifications", t, { nudges: true });

  const ist = (d = new Date()) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const dayShift = (n: number) => new Date(Date.parse(ist() + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
  const h1 = await call("POST", "/habits", t, { title: "Drink water", icon: "water", target: 2, remindAt: "09:30" });
  check("create a habit", h1.status === 201 && h1.data.target === 2 && h1.data.remindAt === "09:30" && h1.data.streak === 0, h1.data);
  check("a habit needs a title", (await call("POST", "/habits", t, { title: "  " })).status === 400);
  check("habit reminder time must be HH:MM", (await call("POST", "/habits", t, { title: "x", remindAt: "9am" })).status === 400);
  check("habit icon must be one we know", (await call("POST", "/habits", t, { title: "x", icon: "bomb" })).status === 400);
  const hc1 = await call("POST", `/habits/${h1.data.id}/check`, t, {});
  check("first tick counts 1 of 2", hc1.data.todayCount === 1 && !hc1.data.doneToday && hc1.data.streak === 0, hc1.data);
  const hc2 = await call("POST", `/habits/${h1.data.id}/check`, t, {});
  check("second tick completes it and starts a streak", hc2.data.doneToday && hc2.data.streak === 1 && hc2.data.last7[6].done && hc2.data.last7[6].date === ist(), hc2.data);
  const hc3 = await call("POST", `/habits/${h1.data.id}/check`, t, {});
  check("extra ticks don't go past the target", hc3.data.todayCount === 2);
  await call("POST", `/habits/${h1.data.id}/check`, t, { date: dayShift(-1) });
  const cy = await call("POST", `/habits/${h1.data.id}/check`, t, { date: dayShift(-1) });
  check("yesterday can be caught up and extends the streak", cy.data.streak === 2 && cy.data.best === 2, cy.data);
  check("older days can't be edited", (await call("POST", `/habits/${h1.data.id}/check`, t, { date: dayShift(-2) })).status === 400);
  check("future days can't be edited", (await call("POST", `/habits/${h1.data.id}/check`, t, { date: dayShift(1) })).status === 400);
  const u1 = await call("POST", `/habits/${h1.data.id}/check`, t, { undo: true });
  check("undo steps back and the streak waits for today", u1.data.todayCount === 1 && !u1.data.doneToday && u1.data.streak === 1, u1.data);
  check("someone else can't tick my habit", (await call("POST", `/habits/${h1.data.id}/check`, mom.token, {})).status === 404);
  check("someone else doesn't see my habits", (await call("GET", "/habits", mom.token)).data.length === 0);
  const hp = await call("PATCH", `/habits/${h1.data.id}`, t, { title: "Water", remindAt: null });
  check("edit a habit and clear its reminder", hp.data.title === "Water" && hp.data.remindAt === null, hp.data);
  check("habit list shows it", (await call("GET", "/habits", t)).data.length === 1);
  for (let i = 0; i < 11; i++) await call("POST", "/habits", t, { title: "H" + i });
  check("habits are capped at 12", (await call("POST", "/habits", t, { title: "one too many" })).status === 400);
  const arch = await call("PATCH", `/habits/${h1.data.id}`, t, { archived: true });
  check("archiving hides a habit and frees a slot", arch.status === 200 && (await call("GET", "/habits", t)).data.length === 11 && (await call("POST", "/habits", t, { title: "fits now" })).status === 201);
  check("delete a habit", (await call("DELETE", `/habits/${h1.data.id}`, t)).status === 204 && (await call("DELETE", `/habits/${h1.data.id}`, t)).status === 404);
  await prisma.habit.deleteMany({ where: { userId: demo.user.id } });
  check("a streak is counted across consecutive days only", await (async () => {
    const { streakOf, bestStreakOf } = await import("./routes/habits");
    const logs = ["2026-11-20", "2026-11-21", "2026-11-23", "2026-11-24"].map(date => ({ date, count: 1 }));
    return streakOf(logs, 1, "2026-11-24") === 2 && streakOf(logs, 1, "2026-11-25") === 2 && streakOf(logs, 1, "2026-11-26") === 0 && bestStreakOf(logs, 1) === 2 && streakOf([{ date: "2026-11-24", count: 1 }], 2, "2026-11-24") === 0;
  })());

  const sched = await import("./services/scheduler");
  const notesOf = (userId: string, kind: string) => prisma.notification.findMany({ where: { userId, kind }, orderBy: { createdAt: "desc" } });
  const T0 = new Date("2026-11-25T10:00:00Z"); // 15:30 for a user at UTC+5:30

  // appointment reminders
  await prisma.appointment.deleteMany({ where: { userId: demo.user.id } });
  const apSoon = await prisma.appointment.create({ data: { userId: demo.user.id, title: "Dr Rao", startsAt: new Date(T0.getTime() + 40 * 60_000) } });
  const apTmrw = await prisma.appointment.create({ data: { userId: demo.user.id, title: "Eye test", startsAt: new Date(T0.getTime() + 20 * 3600e3) } });
  const apFar = await prisma.appointment.create({ data: { userId: demo.user.id, title: "Dentist", startsAt: new Date(T0.getTime() + 5 * 86400e3) } });
  const apPast = await prisma.appointment.create({ data: { userId: demo.user.id, title: "Old visit", startsAt: new Date(T0.getTime() - 3600e3) } });
  const nApp0 = (await notesOf(demo.user.id, "doctor")).length;
  check("appointment reminders go out once, only for upcoming ones", (await sched.runAppointmentReminders(T0)) === 2 && (await sched.runAppointmentReminders(T0)) === 0);
  const nApp = await notesOf(demo.user.id, "doctor");
  check("an hour-away appointment says so, in the user's own time", nApp.length === nApp0 + 2 && nApp.some(n => n.title === "Coming up in an hour" && n.body === "Dr Rao at 4:10 PM"), nApp.slice(0, 2));
  check("tomorrow's appointment gets a day-before reminder", nApp.some(n => n.title === "Appointment tomorrow" && n.body === "Eye test at 11:30 AM"), nApp.slice(0, 2));
  check("far-off and past appointments are left alone", (await prisma.appointment.findMany({ where: { id: { in: [apFar.id, apPast.id] } } })).every(a => !a.notified1d && !a.notified1h) && !!apSoon && !!apTmrw);
  await prisma.appointment.deleteMany({ where: { userId: demo.user.id } });

  // missed medicine
  await prisma.medication.deleteMany({ where: { userId: demo.user.id } });
  const mLate = await prisma.medication.create({ data: { userId: demo.user.id, name: "Metformin", schedule: "1 a day", remindAt: "13:00" } });
  const mTaken = await prisma.medication.create({ data: { userId: demo.user.id, name: "Vitamin C", schedule: "1 a day", remindAt: "13:00", takenDate: "2026-11-25" } });
  const mSoon = await prisma.medication.create({ data: { userId: demo.user.id, name: "Calcium", schedule: "1 a day", remindAt: "15:00" } });
  const mNone = await prisma.medication.create({ data: { userId: demo.user.id, name: "Iron", schedule: "as needed" } });
  const nMom0 = (await notesOf(mom.user.id, "care")).length;
  check("a dose that is an hour overdue alerts the family once", (await sched.runMissedMedicine(T0)) === 1 && (await sched.runMissedMedicine(T0)) === 0);
  const nMom = await notesOf(mom.user.id, "care");
  check("the family message names the person and the medicine", nMom.length === nMom0 + 1 && nMom[0].title.includes("Demo User") && nMom[0].body.includes("Metformin"), nMom[0]);
  check("taken, not-yet-late and no-reminder medicines don't alert", !nMom[0].body.includes("Vitamin") && !nMom[0].body.includes("Calcium") && !!mTaken && !!mNone && (await prisma.medication.findUnique({ where: { id: mSoon.id } }))!.missedDate === null);
  check("the same dose can alert again the next day", (await sched.runMissedMedicine(new Date(T0.getTime() + 86400e3))) >= 1 && !!mLate);
  await prisma.medication.deleteMany({ where: { userId: demo.user.id } });

  // evening nudge
  await prisma.pushToken.upsert({ where: { token: "ExponentPushToken[demo-nudge]" }, update: {}, create: { token: "ExponentPushToken[demo-nudge]", userId: demo.user.id, platform: "android" } });
  await prisma.task.deleteMany({ where: { userId: demo.user.id } });
  await prisma.task.create({ data: { userId: demo.user.id, title: "Evening walk" } });
  await call("POST", "/habits", t, { title: "Read" });
  const EVE = new Date("2026-11-25T14:00:00Z"); // 19:30 local
  await prisma.user.updateMany({ data: { nudgeDate: null } });
  const nNudge0 = (await notesOf(demo.user.id, "nudge")).length;
  check("nobody is nudged outside 7-9 PM", (await sched.runEveningNudges(T0)) === 0);
  check("an evening nudge goes to people with open tasks", (await sched.runEveningNudges(EVE)) >= 1);
  const nudges = await notesOf(demo.user.id, "nudge");
  check("it counts open tasks and habits", nudges.length === nNudge0 + 1 && /1 task and 1 habit/.test(nudges[0].body), nudges[0]);
  check("only one nudge per day", (await sched.runEveningNudges(EVE)) === 0);
  await prisma.user.update({ where: { id: demo.user.id }, data: { nudgeDate: null } });
  await call("PUT", "/prefs/notifications", t, { nudges: false });
  await sched.runEveningNudges(EVE);
  check("a person who switched nudges off doesn't get one", (await notesOf(demo.user.id, "nudge")).length === nNudge0 + 1);
  await call("PUT", "/prefs/notifications", t, { nudges: true });
  await prisma.user.update({ where: { id: demo.user.id }, data: { nudgeDate: null } });
  await prisma.task.deleteMany({ where: { userId: demo.user.id } });
  await prisma.habit.deleteMany({ where: { userId: demo.user.id } });
  check("nothing open means no nudge", (await sched.runEveningNudges(EVE)) === 0);
  await prisma.pushToken.delete({ where: { token: "ExponentPushToken[demo-nudge]" } });
  await call("PUT", "/prefs/timezone", t, { offsetMin: 0 });

  // =================================================================== family hub: check-ins, calendar, challenges, chores, albums
  const hub = await prisma.circle.create({ data: { name: "Hub test", type: "Family", members: { create: [{ userId: demo.user.id, role: "owner" }, { userId: mom.user.id, role: "member" }, { userId: dad.user.id, role: "member" }] } } });
  const kid = mom.token, parent = t;
  const hubNotes = (userId: string, kind: string) => prisma.notification.findMany({ where: { userId, kind }, orderBy: { createdAt: "desc" } });

  // ---- safe-walk check-in
  section = "checkin";
  check("a check-in needs at least 5 minutes", (await call("POST", "/checkin", kid, { minutes: 1 })).status === 400);
  const ck = await call("POST", "/checkin", kid, { minutes: 30, note: "Walking home", lat: 12.97, lng: 77.59 });
  check("start a safe-walk timer", ck.status === 201 && ck.data.status === "active" && new Date(ck.data.dueAt).getTime() > Date.now() + 29 * 60_000, ck.data);
  check("only one timer at a time", (await call("POST", "/checkin", kid, { minutes: 10 })).status === 409);
  check("I can see my running timer", (await call("GET", "/checkin/active", kid)).data.id === ck.data.id && (await call("GET", "/checkin/active", parent)).data === null);
  const ext = await call("POST", `/checkin/${ck.data.id}/extend`, kid, { minutes: 15 });
  check("extending adds time", new Date(ext.data.dueAt).getTime() - new Date(ck.data.dueAt).getTime() === 15 * 60_000, ext.data);
  check("nobody else can end my timer", (await call("POST", `/checkin/${ck.data.id}/safe`, parent, {})).status === 404);
  const ckMod = await import("./routes/checkins");
  check("nothing happens before the timer runs out", (await ckMod.runCheckIns(new Date())) === 0);
  const aMom0 = (await hubNotes(demo.user.id, "checkin")).length;
  const later = new Date(Date.now() + 60 * 60_000);
  check("when it runs out the family is alerted once", (await ckMod.runCheckIns(later)) >= 1 && (await ckMod.runCheckIns(later)) === 0);
  const alert = (await hubNotes(demo.user.id, "checkin"))[0];
  check("the alert names the person and says when", (await hubNotes(demo.user.id, "checkin")).length === aMom0 + 1 && alert.title.includes("hasn't checked in") && /ended at/.test(alert.body) && alert.body.includes("Walking home"), alert);
  check("after an alert the timer shows as alerted, so I can still say I'm safe", (await call("GET", "/checkin/active", kid)).data?.status === "alerted");
  const nOk0 = (await hubNotes(demo.user.id, "checkin")).length;
  check("saying 'I'm safe' after an alert works", (await call("POST", `/checkin/${ck.data.id}/safe`, kid, {})).data.status === "safe");
  check("and tells the family it's fine", (await hubNotes(demo.user.id, "checkin")).length === nOk0 + 1 && (await hubNotes(demo.user.id, "checkin"))[0].title.includes("is safe"));
  const ck2 = await call("POST", "/checkin", kid, { minutes: 20 });
  check("marking safe in time cancels without any alert", (await call("POST", `/checkin/${ck2.data.id}/safe`, kid, {})).status === 200 && (await ckMod.runCheckIns(later)) === 0 && (await hubNotes(demo.user.id, "checkin")).length === nOk0 + 1);

  // ---- calendar
  section = "calendar";
  const inDays = (n: number, h = 10) => new Date(Date.UTC(2026, 10, 25 + n, h, 0)).toISOString();
  check("outsiders can't add events to my circle", (await call("POST", "/events", outsider, { circleId: hub.id, title: "x", startsAt: inDays(5) })).status === 403);
  check("an event needs a title", (await call("POST", "/events", kid, { circleId: hub.id, title: " ", startsAt: inDays(5) })).status === 400);
  const evA = await call("POST", "/events", kid, { circleId: hub.id, title: "Sunday lunch", startsAt: inDays(3), notes: "At Nani's" });
  check("add an event", evA.status === 201);
  check("the rest of the family hears about it", (await hubNotes(demo.user.id, "event")).some(n => n.body.startsWith("Sunday lunch")) && !(await hubNotes(mom.user.id, "event")).some(n => n.body.startsWith("Sunday lunch")));
  const bday = await call("POST", "/events", parent, { circleId: hub.id, title: "Mom's birthday", kind: "birthday", startsAt: "1968-11-28T00:00:00.000Z", allDay: true });
  check("a birthday repeats every year by itself", bday.status === 201 && (await prisma.familyEvent.findUnique({ where: { id: bday.data.id } }))!.repeat === "yearly");
  const win = (a: string, b: string) => `from=${encodeURIComponent(a)}&to=${encodeURIComponent(b)}&circleId=${hub.id}`;
  const list = await call("GET", `/events?${win(inDays(0), inDays(30))}`, dad.token);
  check("yearly events show up in this year's window", list.data.length === 2 && list.data.some((e: any) => e.title === "Sunday lunch") && list.data.some((e: any) => e.title === "Mom's birthday" && e.startsAt.startsWith("2026-11-28")) && list.data[0].startsAt <= list.data[1].startsAt, list.data.map((e: any) => [e.title, e.startsAt]));
  check("and again in next year's window", (await call("GET", `/events?${win("2027-11-01T00:00:00.000Z", "2027-12-31T00:00:00.000Z")}`, dad.token)).data.some((e: any) => e.title === "Mom's birthday" && e.startsAt.startsWith("2027-11-28")));
  check("a window can't be absurdly long", (await call("GET", `/events?${win("2026-01-01T00:00:00.000Z", "2030-01-01T00:00:00.000Z")}`, dad.token)).status === 400);
  check("outsiders can't see the calendar", (await call("GET", `/events?circleId=${hub.id}`, outsider)).status === 403);
  check("a past one-off date is rejected", (await call("POST", "/events", kid, { circleId: hub.id, title: "old", startsAt: "2020-01-01T10:00:00.000Z" })).status === 400);
  const nR0 = (await hubNotes(mom.user.id, "event")).length;
  check("RSVP: going", (await call("PUT", `/events/${evA.data.id}/rsvp`, dad.token, { status: "yes" })).data.status === "yes");
  check("the organiser is told", (await hubNotes(mom.user.id, "event")).length === nR0 + 1 && (await hubNotes(mom.user.id, "event"))[0].title.includes("going"));
  await call("PUT", `/events/${evA.data.id}/rsvp`, dad.token, { status: "yes" });
  check("repeating the same answer doesn't notify again", (await hubNotes(mom.user.id, "event")).length === nR0 + 1);
  await call("PUT", `/events/${evA.data.id}/rsvp`, parent, { status: "maybe" });
  const rsvpSeen = (await call("GET", `/events?${win(inDays(0), inDays(10))}`, dad.token)).data.find((e: any) => e.title === "Sunday lunch");
  check("everyone's answers are listed, plus mine", rsvpSeen.going.length === 1 && rsvpSeen.maybe.length === 1 && rsvpSeen.myRsvp === "yes", rsvpSeen);
  check("bad RSVP values are rejected", (await call("PUT", `/events/${evA.data.id}/rsvp`, dad.token, { status: "sure" })).status === 400);
  check("outsiders can't RSVP", (await call("PUT", `/events/${evA.data.id}/rsvp`, outsider, { status: "yes" })).status === 404);
  check("a member can't delete someone else's event", (await call("DELETE", `/events/${bday.data.id}`, dad.token)).status === 403);
  check("an owner can edit anyone's event", (await call("PATCH", `/events/${evA.data.id}`, parent, { title: "Sunday brunch" })).status === 200);

  const evMod = await import("./routes/events");
  const hubEv = await prisma.familyEvent.create({ data: { circleId: hub.id, createdById: mom.user.id, title: "Movie night", startsAt: new Date("2026-12-10T14:00:00Z") } });
  const nEv0 = (await hubNotes(dad.user.id, "event")).length;
  check("no reminder when it's far away", (await evMod.runEventReminders(new Date("2026-12-05T14:00:00Z"))) === 0);
  check("day-before reminder goes to everyone, once", (await evMod.runEventReminders(new Date("2026-12-09T20:00:00Z"))) === 1 && (await evMod.runEventReminders(new Date("2026-12-09T20:30:00Z"))) === 0 && (await hubNotes(dad.user.id, "event")).length === nEv0 + 1);
  check("an hour-before reminder follows", (await evMod.runEventReminders(new Date("2026-12-10T13:30:00Z"))) === 1 && (await hubNotes(dad.user.id, "event"))[0].title.includes("within the hour"));
  check("the birthday reminder fires the day before", (await evMod.runEventReminders(new Date("2026-11-27T12:00:00Z"))) >= 1 && (await hubNotes(dad.user.id, "event")).some(n => n.title.includes("Tomorrow: Mom's birthday")));
  check("a leap-day birthday lands on Feb 28 in normal years", evMod.nextOccurrence({ startsAt: new Date("2000-02-29T00:00:00Z"), repeat: "yearly" }, new Date("2027-01-01T00:00:00Z"))!.toISOString().startsWith("2027-02-28"));
  await prisma.familyEvent.delete({ where: { id: hubEv.id } });
  check("delete an event", (await call("DELETE", `/events/${bday.data.id}`, parent)).status === 204);

  // ---- challenges, badges
  section = "challenges";
  const chW = await call("POST", "/challenges", parent, { circleId: hub.id, title: "Walk 5 km this week", metric: "distance", target: 5000, days: 7 });
  check("start a challenge", chW.status === 201);
  check("members get told", (await hubNotes(mom.user.id, "fitness")).some(n => n.body.startsWith("Walk 5 km this week")));
  check("outsiders can't start one", (await call("POST", "/challenges", outsider, { circleId: hub.id, title: "x", metric: "workouts", target: 3, days: 3 })).status === 403);
  check("distance goals are at least 100 m", (await call("POST", "/challenges", parent, { circleId: hub.id, title: "x", metric: "distance", target: 5, days: 3 })).status === 400);
  const cs0 = (await call("GET", `/challenges?circleId=${hub.id}`, dad.token)).data.find((c: any) => c.id === chW.data.id);
  check("everyone starts at zero", cs0.active && cs0.standings.length === 3 && cs0.standings.every((s: any) => s.value === 0 && !s.done) && cs0.mine === 0, cs0);
  const wkt = (distanceM: number, mins = 60) => ({ kind: "walk", startedAt: new Date(Date.now() + mins * 0).toISOString(), durationSec: Math.max(60, Math.round(distanceM / 1.3)), distanceM, route: [[12.9, 77.5], [12.91, 77.51]], shared: true });
  await call("POST", "/activities", kid, wkt(2000, 50));
  await call("POST", "/activities", parent, wkt(1500, 40));
  await call("POST", "/activities", parent, wkt(2500, 30));
  const cs1 = (await call("GET", `/challenges?circleId=${hub.id}`, dad.token)).data.find((c: any) => c.id === chW.data.id);
  check("standings count shared workouts and rank them", cs1.standings[0].user.id === demo.user.id && cs1.standings[0].value >= 4000 && cs1.standings.find((s: any) => s.user.id === mom.user.id).value >= 2000, cs1.standings);
  await call("POST", "/activities", parent, wkt(1500, 20));
  const cs2 = (await call("GET", `/challenges?circleId=${hub.id}`, parent)).data.find((c: any) => c.id === chW.data.id);
  check("reaching the goal marks it done and celebrates", cs2.standings.find((s: any) => s.user.id === demo.user.id).done && (await hubNotes(demo.user.id, "fitness")).some(n => n.title.includes("Challenge complete")) && (await prisma.challengeWin.count({ where: { challengeId: chW.data.id, userId: demo.user.id } })) === 1, cs2.standings);
  await call("POST", "/activities", parent, wkt(1000, 10));
  check("a win is only counted once", (await prisma.challengeWin.count({ where: { challengeId: chW.data.id, userId: demo.user.id } })) === 1 && (await hubNotes(demo.user.id, "fitness")).filter(n => n.title.includes("Challenge complete") && n.body.includes("Walk 5 km")).length === 1);
  const badges = await call("GET", "/badges", parent);
  const bd = (id: string) => badges.data.find((b: any) => b.id === id);
  check("badges are worked out from real activity", badges.data.length === 12 && bd("first-steps").earned && bd("challenge-win").earned && !bd("hundred-km").earned && bd("hundred-km").goal === 100, badges.data);
  check("someone who has done nothing has none", (await call("GET", "/badges", outsider)).data.every((b: any) => !b.earned));
  check("a member can't delete someone else's challenge", (await call("DELETE", `/challenges/${chW.data.id}`, dad.token)).status === 403);
  check("the creator can", (await call("DELETE", `/challenges/${chW.data.id}`, parent)).status === 204);
  const nPassed0 = (await hubNotes(mom.user.id, "fitness")).filter(n => n.title.includes("just passed you")).length;
  await call("POST", "/activities", dad.token, wkt(3000));
  check("a lower total doesn't trigger a pass", (await hubNotes(mom.user.id, "fitness")).filter(n => n.title.includes("just passed you")).length === nPassed0);
  await call("POST", "/activities", dad.token, wkt(3000));
  check("overtaking someone this week tells them", (await hubNotes(mom.user.id, "fitness")).filter(n => n.title.includes("just passed you")).length === nPassed0 + 1 && (await hubNotes(mom.user.id, "fitness"))[0].title.includes("Dad"));
  await prisma.activity.deleteMany({ where: { userId: { in: [demo.user.id, mom.user.id, dad.user.id] }, createdAt: { gte: new Date(Date.now() - 3600e3) }, startedAt: { gte: new Date(Date.now() - 2 * 3600e3) } } });

  // ---- chores and rewards
  section = "chores";
  check("only a parent can create chores", (await call("POST", "/chores", kid, { circleId: hub.id, title: "Dishes", points: 5 })).status === 403);
  check("points must be positive", (await call("POST", "/chores", parent, { circleId: hub.id, title: "Dishes", points: 0 })).status === 400);
  const chD = await call("POST", "/chores", parent, { circleId: hub.id, title: "Wash dishes", points: 10, assigneeId: mom.user.id, repeat: "daily" });
  const chO = await call("POST", "/chores", parent, { circleId: hub.id, title: "Clean the garage", points: 30, repeat: "once" });
  check("create chores", chD.status === 201 && chO.status === 201);
  check("the assignee is told", (await hubNotes(mom.user.id, "chores")).some(n => n.title === "New chore for you"));
  const board0 = (await call("GET", `/chores?circleId=${hub.id}`, kid)).data;
  check("the kid sees chores they can do, with zero points", board0.chores.length === 2 && board0.chores.find((c: any) => c.id === chD.data.id).canDo && board0.myPoints === 0 && !board0.isOwner && board0.pending.length === 0, board0);
  check("a chore for someone else can't be done", (await call("POST", `/chores/${chD.data.id}/done`, dad.token, {})).status === 403);
  check("outsiders can't see chores", (await call("GET", `/chores?circleId=${hub.id}`, outsider)).status === 403);
  const nOwn0 = (await hubNotes(demo.user.id, "chores")).length;
  const dn = await call("POST", `/chores/${chD.data.id}/done`, kid, {});
  check("marking done waits for approval", dn.status === 201 && dn.data.status === "pending" && (await call("GET", `/chores?circleId=${hub.id}`, kid)).data.myPoints === 0);
  check("the parent is asked to approve", (await hubNotes(demo.user.id, "chores")).length === nOwn0 + 1);
  check("can't do it twice in a day", (await call("POST", `/chores/${chD.data.id}/done`, kid, {})).status === 409);
  const pb = (await call("GET", `/chores?circleId=${hub.id}`, parent)).data;
  check("the parent sees it in the approval list", pb.isOwner && pb.pending.length === 1 && pb.pending[0].points === 10 && pb.pending[0].user.id === mom.user.id, pb.pending);
  check("a kid can't approve", (await call("POST", `/chores/done/${dn.data.id}/review`, kid, { approve: true })).status === 403);
  check("approve gives the points", (await call("POST", `/chores/done/${dn.data.id}/review`, parent, { approve: true })).data.status === "approved" && (await call("GET", `/chores?circleId=${hub.id}`, kid)).data.myPoints === 10);
  check("and tells the kid", (await hubNotes(mom.user.id, "chores"))[0].title === "+10 points");
  check("it can't be approved twice", (await call("POST", `/chores/done/${dn.data.id}/review`, parent, { approve: true })).status === 409 && (await call("GET", `/chores?circleId=${hub.id}`, kid)).data.myPoints === 10);
  const dn2 = await call("POST", `/chores/${chO.data.id}/done`, kid, {});
  check("reject sends it back", (await call("POST", `/chores/done/${dn2.data.id}/review`, parent, { approve: false })).data.status === "rejected" && (await call("GET", `/chores?circleId=${hub.id}`, kid)).data.myPoints === 10);
  const dn3 = await call("POST", `/chores/${chO.data.id}/done`, kid, {});
  check("a rejected chore can be redone", dn3.status === 201 && dn3.data.status === "pending");
  await call("POST", `/chores/done/${dn3.data.id}/review`, parent, { approve: true });
  check("a one-time chore can't be done again", (await call("POST", `/chores/${chO.data.id}/done`, dad.token, {})).status === 409 && (await call("GET", `/chores?circleId=${hub.id}`, kid)).data.myPoints === 40);
  const lead = (await call("GET", `/chores?circleId=${hub.id}`, dad.token)).data.balances;
  check("balances rank everyone", lead[0].user.id === mom.user.id && lead[0].points === 40 && lead.length === 3, lead);

  const rw = await call("POST", "/rewards", parent, { circleId: hub.id, title: "Ice cream trip", cost: 50 });
  const rw2 = await call("POST", "/rewards", parent, { circleId: hub.id, title: "Extra screen time", cost: 30 });
  check("a kid can't make rewards", (await call("POST", "/rewards", kid, { circleId: hub.id, title: "x", cost: 1 })).status === 403 && rw.status === 201);
  check("can't claim without enough points", (await call("POST", `/rewards/${rw.data.id}/claim`, kid, {})).status === 400);
  const cl = await call("POST", `/rewards/${rw2.data.id}/claim`, kid, {});
  check("claiming spends the points", cl.status === 201 && cl.data.points === 10 && (await call("GET", `/chores?circleId=${hub.id}`, kid)).data.myPoints === 10, cl.data);
  check("a second claim can't overspend", (await call("POST", `/rewards/${rw2.data.id}/claim`, kid, {})).status === 400);
  const pc = (await call("GET", `/chores?circleId=${hub.id}`, parent)).data.claims;
  check("the parent sees the request", pc.length === 1 && pc[0].title === "Extra screen time" && pc[0].user.id === mom.user.id, pc);
  check("a kid can't mark it given", (await call("POST", `/rewards/claims/${cl.data.id}/given`, kid, {})).status === 403);
  check("the parent marks it given", (await call("POST", `/rewards/claims/${cl.data.id}/given`, parent, {})).data.status === "given" && (await call("POST", `/rewards/claims/${cl.data.id}/given`, parent, {})).status === 409);
  check("removing a chore keeps points history", (await call("DELETE", `/chores/${chD.data.id}`, parent)).status === 204 && (await call("GET", `/chores?circleId=${hub.id}`, kid)).data.myPoints === 10 && (await call("GET", `/chores?circleId=${hub.id}`, kid)).data.chores.length === 1);
  check("a badge comes from approved chores", (await call("GET", "/badges", kid)).data.find((b: any) => b.id === "helper").value === 2);

  // ---- albums and memories
  section = "albums";
  const al = await call("POST", "/albums", kid, { circleId: hub.id, title: "Goa trip" });
  check("create an album", al.status === 201 && (await call("POST", "/albums", outsider, { circleId: hub.id, title: "x" })).status === 403);
  const ph = await call("POST", `/albums/${al.data.id}/photos`, kid, { url: "http://localhost/uploads/a.jpg", caption: "Beach" });
  check("add a photo", ph.status === 201);
  check("a photo needs a real URL", (await call("POST", `/albums/${al.data.id}/photos`, kid, { url: "nope" })).status === 400);
  check("the family is told about new photos", (await hubNotes(dad.user.id, "comment")).some(n => n.title.includes("added a photo") && n.body.includes("Goa trip")));
  const lst = await call("GET", `/albums?circleId=${hub.id}`, dad.token);
  check("album list shows count and cover", lst.data.length === 1 && lst.data[0].count === 1 && lst.data[0].cover === "http://localhost/uploads/a.jpg", lst.data);
  const ad = await call("GET", `/albums/${al.data.id}`, dad.token);
  check("album shows photos with who added them", ad.data.photos.length === 1 && ad.data.photos[0].by.id === mom.user.id && ad.data.photos[0].caption === "Beach", ad.data);
  check("outsiders can't open an album", (await call("GET", `/albums/${al.data.id}`, outsider)).status === 404);
  check("only the adder or an owner can remove a photo", (await call("DELETE", `/albums/photos/${ph.data.id}`, dad.token)).status === 403);

  const mm = new Date(); mm.setUTCFullYear(mm.getUTCFullYear() - 2);
  await prisma.albumPhoto.create({ data: { albumId: al.data.id, url: "http://localhost/uploads/old.jpg", caption: "Two years ago", uploadedById: mom.user.id, createdAt: mm } });
  const mem = await call("GET", "/memories/today", dad.token);
  check("on this day shows photos from earlier years", mem.data.some((m: any) => m.yearsAgo === 2 && m.url.endsWith("old.jpg") && m.text === "Two years ago") && !mem.data.some((m: any) => m.url.endsWith("a.jpg")), mem.data);
  check("outsiders see no memories from my circle", (await call("GET", "/memories/today", outsider)).data.length === 0);
  await prisma.pushToken.upsert({ where: { token: "ExponentPushToken[dad-mem]" }, update: {}, create: { token: "ExponentPushToken[dad-mem]", userId: dad.user.id, platform: "android" } });
  await prisma.user.updateMany({ data: { memoryDate: null } });
  const albMod = await import("./routes/albums");
  const nine = new Date(); nine.setUTCHours(9, 30, 0, 0);
  const nMem0 = (await hubNotes(dad.user.id, "memory")).length;
  check("no memory nudge in the middle of the night", (await albMod.runMemories(new Date(nine.getTime() - 9 * 3600e3))) === 0);
  check("a morning nudge when there are memories, once", (await albMod.runMemories(nine)) >= 1 && (await albMod.runMemories(nine)) === 0 && (await hubNotes(dad.user.id, "memory")).length === nMem0 + 1);
  await prisma.pushToken.delete({ where: { token: "ExponentPushToken[dad-mem]" } });
  check("an owner can remove any photo", (await call("DELETE", `/albums/photos/${ph.data.id}`, parent)).status === 204);
  check("deleting an album removes its photos", (await call("DELETE", `/albums/${al.data.id}`, kid)).status === 204 && (await prisma.albumPhoto.count({ where: { albumId: al.data.id } })) === 0);


  // ---- Brain Gym ----
  section = "brain";
  const st0 = await call("GET", "/brain/stats", kid);
  check("brain stats start empty", st0.status === 200 && st0.data.totalXp === 0 && st0.data.streak === 0 && st0.data.level === 1 && st0.data.share === false, st0.data);
  check("an impossible score is refused", (await call("POST", "/brain/result", kid, { game: "math", score: 41 })).status === 400 && (await call("POST", "/brain/result", kid, { game: "chess", score: 1 })).status === 400);
  const dk = await call("GET", "/brain/daily", kid), dk2 = await call("GET", "/brain/daily", parent);
  check("the Daily Challenge is the same for everyone", dk.data.seed === dk2.data.seed && dk.data.games.length === 4 && dk.data.games.every((g: any) => !g.done), dk.data);
  const r1 = await call("POST", "/brain/result", kid, { game: "math", score: 10, daily: true });
  check("a daily run earns XP plus a bonus and starts the streak", r1.status === 201 && r1.data.xp === 40 && r1.data.bonus === 20 && r1.data.streakStarted && r1.data.stats.streak === 1 && r1.data.levelUp, r1.data);
  const r2 = await call("POST", "/brain/result", kid, { game: "math", score: 12, daily: true });
  check("the daily bonus only counts once per game", r2.data.xp === 24 && r2.data.bonus === 0 && r2.data.newBest, r2.data);
  check("daily shows that game as done", (await call("GET", "/brain/daily", kid)).data.games.find((g: any) => g.game === "math").done === true);
  const yday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10), y2 = new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10);
  const kidId = mom.user.id;
  await prisma.brainResult.createMany({ data: [{ userId: kidId, game: "quant", score: 3, xp: 36, date: yday }, { userId: kidId, game: "quant", score: 3, xp: 36, date: y2 }] });
  const st1 = await call("GET", "/brain/stats", kid);
  check("the streak counts consecutive days", st1.data.streak === 3 && st1.data.best >= 3, st1.data);
  const levelBefore = st1.data.level;
  for (let i = 0; i < 30; i++) await call("POST", "/brain/result", kid, { game: "stroop", score: 60 });
  const st2 = await call("GET", "/brain/stats", kid);
  check("XP is capped per day so it cannot be farmed", st2.data.todayXp === 500 && st2.data.level > levelBefore, st2.data);
  const board1 = await call("GET", `/brain/board?circleId=${hub.id}`, parent);
  check("the board hides people who have not opted in", board1.status === 200 && board1.data.length === 1 && board1.data[0].me, board1.data);
  check("sharing can be switched on", (await call("PUT", "/brain/settings", kid, { share: true })).data.share === true);
  const board2 = await call("GET", `/brain/board?circleId=${hub.id}`, parent);
  check("opted-in people appear, ranked by weekly XP", board2.data.length === 2 && board2.data[0].user.id === kidId && board2.data[0].streak === 3, board2.data);
  check("outsiders cannot see the board", (await call("GET", `/brain/board?circleId=${hub.id}`, outsider)).status === 403);
  const sched2 = await import("./services/scheduler");
  await prisma.pushToken.upsert({ where: { token: "ExponentPushToken[dad-brain]" }, update: {}, create: { token: "ExponentPushToken[dad-brain]", userId: dad.user.id, platform: "android" } });
  await prisma.brainResult.create({ data: { userId: dad.user.id, game: "math", score: 5, xp: 10, date: yday } });
  await prisma.user.updateMany({ data: { nudgeDate: null } });
  const EVE2 = new Date(); EVE2.setUTCHours(20, 0, 0, 0);
  await sched2.runEveningNudges(EVE2);
  check("a streak at risk gets an evening nudge", (await hubNotes(dad.user.id, "nudge")).some(n => n.body.includes("Brain Gym")));
  await prisma.pushToken.delete({ where: { token: "ExponentPushToken[dad-brain]" } });
  await prisma.brainResult.deleteMany({ where: { userId: dad.user.id } });

  // ---- Aaj Ka Plan ----
  section = "study";
  const sub = await call("POST", "/study/subjects", kid, { name: "Maths", chapters: ["Algebra", "Geometry", "Trigonometry", "Statistics"], examDate: new Date(Date.now() + 28 * 86400e3).toISOString().slice(0, 10) });
  check("create a subject with chapters", sub.status === 201 && sub.data.total === 4 && sub.data.percent === 0 && sub.data.daysLeft >= 27 && sub.data.perWeek >= 1, sub.data);
  const ch = sub.data.chapters;
  const sub2 = await call("PATCH", `/study/chapters/${ch[0].id}`, kid, { done: true });
  check("ticking a chapter updates progress", sub2.data.done === 1 && sub2.data.percent === 25, sub2.data);
  check("add more chapters in bulk", (await call("POST", `/study/subjects/${sub.data.id}/chapters`, kid, { titles: ["Probability", "Mensuration"] })).data.total === 6);
  check("a bad exam date is refused", (await call("POST", "/study/subjects", kid, { name: "X", examDate: "2026-13-45" })).status === 400);
  check("other people cannot see or touch my syllabus", (await call("GET", "/study/subjects", outsider)).data.length === 0 && (await call("PATCH", `/study/subjects/${sub.data.id}`, outsider, { name: "hack" })).status === 404 && (await call("PATCH", `/study/chapters/${ch[1].id}`, outsider, { done: true })).status === 404);

  const tmr = new Date(Date.now() + 86400e3).toISOString().slice(0, 10), last = new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10);
  const as1 = await call("POST", "/study/assignments", kid, { title: "Worksheet 4", subjectId: sub.data.id, dueDate: tmr, priority: "high" });
  const as2 = await call("POST", "/study/assignments", kid, { title: "Old essay", dueDate: last });
  const as3 = await call("POST", "/study/assignments", kid, { title: "Someday project" });
  check("create assignments", as1.status === 201 && as1.data.subject === "Maths" && as1.data.dueIn === 1 && as2.data.overdue === true && as3.data.dueIn === null, [as1.data, as2.data]);
  const al1 = await call("GET", "/study/assignments", kid);
  check("open work is sorted by deadline, overdue first", al1.data.map((a: any) => a.title).join() === "Old essay,Worksheet 4,Someday project", al1.data.map((a: any) => a.title));
  check("an assignment cannot use someone else's subject", (await call("POST", "/study/assignments", outsider, { title: "x", subjectId: sub.data.id })).status === 404);
  const dnA = await call("PATCH", `/study/assignments/${as2.data.id}`, kid, { done: true });
  check("finish an assignment", dnA.data.done === true && dnA.data.overdue === false && (await call("GET", "/study/assignments", kid)).data.at(-1).title === "Old essay");

  const mon = await call("POST", "/study/timetable", kid, { title: "Maths class", subjectId: sub.data.id, weekday: 1, startMin: 16 * 60, endMin: 17 * 60 });
  check("add a weekly slot", mon.status === 201 && mon.data.repeats && mon.data.color, mon.data);
  check("overlapping slots are refused", (await call("POST", "/study/timetable", kid, { title: "Clash", weekday: 1, startMin: 16 * 60 + 30, endMin: 17 * 60 + 30 })).status === 409);
  check("a slot needs a weekday or a date, not both", (await call("POST", "/study/timetable", kid, { title: "x", weekday: 1, date: tmr, startMin: 600, endMin: 660 })).status === 400 && (await call("POST", "/study/timetable", kid, { title: "x", startMin: 600, endMin: 660 })).status === 400);
  check("the end must be after the start", (await call("POST", "/study/timetable", kid, { title: "x", weekday: 2, startMin: 700, endMin: 700 })).status === 400);
  const one = await call("POST", `/study/schedule`, kid, { assignmentId: as1.data.id, minutes: 45 });
  check("one tap scheduling finds a free window", one.status === 201 && one.data.title === "Worksheet 4" && one.data.startMin >= 900 && one.data.endMin <= 1260 && one.data.date >= new Date().toISOString().slice(0, 10), one.data);
  const two = await call("POST", `/study/schedule`, kid, { chapterId: ch[1].id, minutes: 60 });
  check("scheduling a chapter names it after the subject", two.status === 201 && two.data.title === "Maths: Geometry" && !(two.data.date === one.data.date && two.data.startMin < one.data.endMin && one.data.startMin < two.data.endMin), two.data);
  const tl = await call("GET", "/study/timetable", kid);
  check("timetable lists weekly and upcoming one-off slots", tl.data.length === 3, tl.data);
  const td = await call("GET", "/study/today", kid);
  check("today shows slots, deadlines and chapters left", td.status === 200 && Array.isArray(td.data.slots) && td.data.assignments.some((a: any) => a.title === "Worksheet 4") && !td.data.assignments.some((a: any) => a.title === "Old essay") && td.data.chaptersLeft === 5, td.data);
  check("delete a slot", (await call("DELETE", `/study/timetable/${two.data.id}`, kid)).status === 204 && (await call("DELETE", `/study/timetable/${two.data.id}`, kid)).status === 404);

  const n1 = await call("POST", "/study/notes", kid, { title: "Quadratic formula", kind: "formula", body: "x = (-b ± √(b²-4ac)) / 2a", subjectId: sub.data.id });
  const n2 = await call("POST", "/study/notes", kid, { title: "Khan Academy", kind: "link", url: "https://www.khanacademy.org/math" });
  const n3 = await call("POST", "/study/notes", kid, { title: "Board photo", kind: "file", url: "http://localhost/uploads/board.jpg" });
  check("save formulas, links and photos", n1.status === 201 && n2.status === 201 && n3.status === 201);
  check("a link note needs a link and a text note needs text", (await call("POST", "/study/notes", kid, { title: "x", kind: "link" })).status === 400 && (await call("POST", "/study/notes", kid, { title: "x", kind: "note", body: "  " })).status === 400);
  const nl = await call("GET", "/study/notes?q=quadratic", kid);
  check("search finds notes", nl.data.length === 1 && nl.data[0].subject === "Maths", nl.data);
  check("filter notes by subject", (await call("GET", `/study/notes?subjectId=${sub.data.id}`, kid)).data.length === 1 && (await call("GET", "/study/notes", kid)).data.length === 3);
  check("other people cannot read or change my notes", (await call("GET", "/study/notes", outsider)).data.length === 0 && (await call("DELETE", `/study/notes/${n1.data.id}`, outsider)).status === 404);
  check("delete a note", (await call("DELETE", `/study/notes/${n2.data.id}`, kid)).status === 204);

  const studyMod = await import("./routes/study");
  await prisma.pushToken.upsert({ where: { token: "ExponentPushToken[kid-study]" }, update: {}, create: { token: "ExponentPushToken[kid-study]", userId: kidId, platform: "android" } });
  const eve = new Date(); eve.setUTCHours(18, 0, 0, 0);
  const night = new Date(eve); night.setUTCHours(3, 0, 0, 0);
  const nStudy0 = (await hubNotes(kidId, "study")).length;
  check("no assignment alerts in the middle of the night", (await studyMod.runAssignmentReminders(night)) === 0);
  check("a 'due tomorrow' alert in the evening, once", (await studyMod.runAssignmentReminders(eve)) >= 1 && (await studyMod.runAssignmentReminders(eve)) === 0 && (await hubNotes(kidId, "study")).length === nStudy0 + 1);
  check("the alert names the assignment", (await hubNotes(kidId, "study"))[0].body.includes("Worksheet 4"));
  await call("PUT", "/prefs/notifications", kid, { study: false });
  await prisma.assignment.updateMany({ where: { userId: kidId }, data: { notifiedOn: null } });
  await studyMod.runAssignmentReminders(eve);
  check("study alerts can be switched off", (await hubNotes(kidId, "study")).length === nStudy0 + 1);
  await call("PUT", "/prefs/notifications", kid, { study: true });
  await prisma.pushToken.delete({ where: { token: "ExponentPushToken[kid-study]" } });
  const bdg = (await call("GET", "/badges", kid)).data;
  check("brain and homework badges come from real progress", bdg.find((b: any) => b.id === "brain-warmup").earned && bdg.find((b: any) => b.id === "brain-streak-7").value === 3 && bdg.find((b: any) => b.id === "homework-hero").value === 1, bdg);
  await prisma.brainResult.deleteMany({ where: { userId: kidId } });
  await prisma.subject.deleteMany({ where: { userId: kidId } });
  await prisma.assignment.deleteMany({ where: { userId: kidId } });
  await prisma.timetableSlot.deleteMany({ where: { userId: kidId } });
  await prisma.studyNote.deleteMany({ where: { userId: kidId } });


  // ---- Study buddy ----
  section = "buddy";
  const b0 = await call("GET", "/buddy", kid);
  check("the buddy starts with an empty chat", b0.status === 200 && b0.data.messages.length === 0 && b0.data.used === 0 && b0.data.limit >= 8 && b0.data.mode === "scripted", b0.data);
  const myFirst = mom.user.name.split(" ")[0];
  const hi = await call("POST", "/buddy/chat", kid, { text: "hi" });
  check("without a model it answers from simple rules and greets by name", hi.status === 201 && hi.data.buddy.source === "scripted" && hi.data.buddy.text.includes(myFirst) && hi.data.used === 1, hi.data);
  const bTmr = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  await call("POST", "/study/assignments", kid, { title: "Chemistry lab file", dueDate: bTmr });
  const pl = await call("POST", "/buddy/chat", kid, { text: "What's due?", mood: "stressed" });
  check("it knows what is due and answers the mood", pl.data.buddy.text.includes("Chemistry lab file") && pl.data.buddy.text.includes("tomorrow") && pl.data.user.mood === "stressed", pl.data);
  const bad = await call("POST", "/buddy/chat", kid, { text: "   " });
  check("an empty message is refused", bad.status === 400 && (await call("POST", "/buddy/chat", kid, { text: "x".repeat(501) })).status === 400 && (await call("POST", "/buddy/chat", kid, { text: "hi", mood: "angry" })).status === 400);
  const cr = await call("POST", "/buddy/chat", kid, { text: "I want to die" });
  check("a message about self-harm gets a safe reply with a helpline, not a model reply", cr.status === 201 && cr.data.buddy.source === "safety" && cr.data.buddy.text.includes("14416"), cr.data);

  // A pretend OpenAI-compatible model, so we can check exactly what the server sends.
  const http2 = await import("http");
  let llmSeen: any = null, llmMode: "ok" | "fail" = "ok";
  const llm = http2.createServer((rq, rs) => {
    let raw = ""; rq.on("data", c => (raw += c));
    rq.on("end", () => {
      llmSeen = { url: rq.url, auth: rq.headers.authorization, body: JSON.parse(raw) };
      if (llmMode === "fail") { rs.statusCode = 500; return void rs.end("boom"); }
      rs.setHeader("content-type", "application/json");
      rs.end(JSON.stringify({ choices: [{ message: { content: "  Try the last step yourself: what is 6 x 7?  " } }] }));
    });
  });
  await new Promise<void>(r => llm.listen(0, r));
  process.env.BUDDY_API_URL = `http://localhost:${(llm.address() as any).port}/v1`;
  process.env.BUDDY_API_KEY = "test-key"; process.env.BUDDY_MODEL = "tiny-model";
  check("the chat reports that a model is connected", (await call("GET", "/buddy", kid)).data.mode === "model");
  const ml = await call("POST", "/buddy/chat", kid, { text: "Explain multiplication", mood: "sleepy" });
  const sys = llmSeen?.body?.messages?.[0]?.content ?? "";
  check("with a model connected the reply comes from it", ml.data.buddy.source === "model" && ml.data.buddy.text === "Try the last step yourself: what is 6 x 7?", ml.data);
  check("the model gets the key, model name and endpoint", llmSeen.url === "/v1/chat/completions" && llmSeen.auth === "Bearer test-key" && llmSeen.body.model === "tiny-model" && llmSeen.body.max_tokens === 300, llmSeen);
  check("the model is told about the student's plan and mood but not given other data", sys.includes(myFirst) && sys.includes("Chemistry lab file") && sys.includes("feel sleepy") && sys.includes("AI, not a person") && !sys.includes("@"), sys);
  const msgs = llmSeen.body.messages;
  check("recent conversation is sent as history, last turn is the new message", msgs[msgs.length - 1].role === "user" && msgs[msgs.length - 1].content === "Explain multiplication" && msgs.some((m: any) => m.role === "assistant"), msgs.map((m: any) => m.role));
  const callsBefore = llmSeen;
  llmSeen = null;
  const crisis2 = await call("POST", "/buddy/chat", kid, { text: "I want to kill myself" });
  check("self-harm messages never reach the model", crisis2.data.buddy.source === "safety" && llmSeen === null, crisis2.data);
  llmMode = "fail";
  const fb = await call("POST", "/buddy/chat", kid, { text: "hello" });
  check("if the model is down, the buddy falls back to simple replies", fb.status === 201 && fb.data.buddy.source === "scripted", fb.data);
  llmMode = "ok";

  const lim = (await call("GET", "/buddy", kid)).data;
  await prisma.buddyMessage.createMany({ data: Array.from({ length: Math.max(0, lim.limit - lim.used) }, () => ({ userId: kidId, role: "user", text: "filler", date: new Date().toISOString().slice(0, 10) })) });
  const over = await call("POST", "/buddy/chat", kid, { text: "one more" });
  check("the daily message limit is enforced", over.status === 429 && /tomorrow|Premium/.test(over.data.error), over);
  check("but safety replies still work at the limit", (await call("POST", "/buddy/chat", kid, { text: "I want to die" })).status === 201);
  check("other people cannot see my buddy chat", (await call("GET", "/buddy", outsider)).data.messages.length === 0);
  check("the chat can be cleared", (await call("DELETE", "/buddy", kid)).status === 204 && (await call("GET", "/buddy", kid)).data.messages.length === 0);
  delete process.env.BUDDY_API_URL; delete process.env.BUDDY_API_KEY; delete process.env.BUDDY_MODEL;
  llm.close();
  void callsBefore;
  await prisma.assignment.deleteMany({ where: { userId: kidId } });

  await prisma.circle.delete({ where: { id: hub.id } });
  section = "hub";

  [sDemo, sMom, sOut, sDoc].forEach(s => s.disconnect());
  server.close(); pushServer.close();
  await prisma.$disconnect();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
