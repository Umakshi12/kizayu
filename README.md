# Kizayu

A private app for families: a shared feed and stories, daily tasks, a live Family Pulse, a Health Vault, a family doctor
with secure messaging, group chat, location sharing with SOS, games, and a Premium plan. Kizayu is a working name.

```
kizayu/
  backend/   Node + Express + Prisma (PostgreSQL) + Socket.IO
  mobile/    Expo SDK 58 (React Native, TypeScript, Expo Router) for Android, iOS, and a web preview
```

## Run it locally

You need Node 20+. No database install is needed: the project starts its own PostgreSQL 17.

**Terminal 1: database** (leave it running)

```bash
cd backend
npm install
npm run db
```

**Terminal 2: API**

```bash
cd backend
npx prisma migrate deploy
npm run seed
npm run dev
```

The API runs at http://localhost:4000. Run `npm test` for the end-to-end suite.

**Terminal 3: app**

```bash
cd mobile
npm install
npx expo start
```

- **Browser preview:** press `w`, or open http://localhost:8081. This is the quickest way to check every screen.
- **Phone:** scan the QR code with Expo Go. Your phone must be on the same Wi-Fi as this PC. If it can't connect, allow
  Node through Windows Firewall on port 4000.
- **Emulator:** press `a` for Android, or `i` for the iOS simulator (macOS only).

### First run

The app starts empty: there are no sample accounts, posts or doctors. `npm run seed` only adds the games catalog and
never touches your data, so it's safe to run any time.

1. Open the app and tap **Create an account**, or use **Phone** sign-in.
2. Home walks you through the first steps: inviting family, sharing a first moment, planning your day and setting up
   safety.
3. To try the family features, create a second account (for example in a private browser window) and join your circle
   with the invite code from **Profile → My Circles**.
4. To try doctor messaging, have the second account turn on **Profile → I'm a doctor**. Then add that doctor by email
   from **Family Doctor** in your first account.

**Dev mode codes:** until an SMS or email service is connected, sign-in and password-reset codes are shown on screen
in a yellow "Dev mode" box. This never happens in production.

## What's in it

| Area | What works |
|---|---|
| Sign-in | Email and password; phone number with SMS code (new numbers create an account); Google (appears once configured); forgot password with an emailed code; add or change a password |
| Feed | Posts, likes, comments, 24-hour stories, photo upload, share to a chosen circle |
| Home | Personal greeting, stories, feed, and a step-by-step welcome guide for new families |
| My Day | Daily repeating tasks with a progress card; add doctor visits and calls. Tasks with a time get a daily phone reminder |
| Family Pulse | Live activity per circle, member status, SOS highlight |
| Health Vault | Vitals, medications (with optional daily reminder times), records. Visible to your circles; a doctor sees them only after you link them |
| Family Doctor | Add your own doctor: by email if they use Kizayu (unlocks secure chat), or as a contact card. Choose which relatives can see your records. Doctors are private to your family |
| Doctor inbox | Any account can turn on a doctor profile; doctors reply to patients and view records patients have shared |
| Chat | Group chat per circle, live over WebSocket, with photos |
| Notifications | In-app inbox with unread badge; push notifications for chat, comments, SOS (urgent), arrived home and doctor replies |
| Safety | OpenStreetMap map, time-limited location sharing, arrived-home alerts, and a "Who's sharing" list with last-seen times (a phone that is off or offline can't report, so you see where it last was and when) |
| Fitness | Strava-style workouts: record a walk, run or ride with a live route map, distance, time and pace. Calories and steps are estimated on the server, and impossible speeds are rejected to keep the family leaderboard fair. Weekly totals with a 7-day chart, a family leaderboard (last 7 days, shared workouts only), a feed of recent workouts, and a route map for each one. Tracking works while the app is open on screen |
| SOS | 5-second cancel countdown, then urgent alerts to your circles and an SMS with a private link to up to 5 SOS contacts (no app needed). With recording turned on (opt-in, with a disclosure), the phone records video and audio in 15-second clips and uploads each one as it finishes, so contacts see near-live video, audio and a live map on the link page. Recordings are deleted after 30 days |
| Family lists | Shared grocery, to-do and packing lists for a circle: everyone adds and ticks items, and changes appear live for the others |
| Emergency card | A medical ID: blood group, allergies and conditions as chips, notes for a helper, and up to 5 emergency contacts with a one-tap Call button. Family cards expand to show the same. Visible to people in your circles. The contacts are the same list that gets texted during an SOS |
| Daily habits | Make your own habits (drink water 6 times, walk, read, call family), tick them off on My Day, and watch the streak grow. Optional phone reminder at a time you choose. Yesterday can be caught up, older days can't be edited |
| Safe walk | Set a 15 minute to 2 hour timer before you walk home or travel. Tap I'm safe when you arrive. If you don't, the server alerts your circles (and texts your emergency contacts when SMS is on) with your last known place. It works even if the phone switches off, because the alert comes from the server |
| Family calendar | Events, birthdays and anniversaries (these repeat every year, leap days land on 28 Feb). Everyone is reminded the day before and an hour before, and can answer Going, Maybe or Can't |
| Challenges and badges | Start a distance or workouts challenge for a circle (3 to 30 days). Progress comes from shared workouts only. Finishing is celebrated, and you're told when someone passes you on the weekly board. Eight badges are worked out from what you've actually done |
| Chores and rewards | Parents add chores with points. Kids tick them off, a parent approves, points are earned. Points are spent on rewards parents define; a parent marks the reward as given. Points are never created without a parent's approval |
| Photo albums and memories | Shared albums per circle, and an On this day strip (and a 9 AM nudge) with photos and posts from earlier years. Shows nothing when there are no memories |
| Smart reminders | Evening nudge (7 to 9 PM, once a day) when tasks or habits are still open, a family alert when a medicine is an hour overdue, and 1 day and 1 hour reminders for appointments. Every category can be switched off in Notification settings (safety alerts can't be) |
| Games | Ludo (2 to 4 players, family or computer), Word Hunt, Trivia, Memory Match, family leaderboards |
| Premium | Plans, free-tier limits, test purchases, cancel (stays active until the period ends) |
| Help & About | FAQ, contact-support form with your past requests, About page, Terms and Privacy drafts |

## Tests

```bash
cd backend && npm test                     # 299 end-to-end checks against the real API, database and sockets
cd mobile && npm run test:games            # 16 checks of the Ludo and Word Hunt rules
cd mobile && npx tsc --noEmit              # typecheck
```

The backend suite never touches your data. It runs against a separate `kizayu_test` database and `.test-uploads`
folder, loads its own test-only fixtures (`backend/src/testing/fixtures.ts`), and refuses to load them into any
database whose name doesn't end in `_test`. It starts the real server and a fake Expo push service, so it checks
exactly what each push notification would contain, and connects live socket clients to test realtime chat.

## Design

The look follows your reference screens: soft lavender backgrounds, deep-violet gradients, rounded cards with gentle
shadows, gradient story rings, a floating tab bar with a glowing camera button, and the Plus Jakarta Sans typeface.
Phones also get subtle haptic feedback on taps. All design tokens (colours, gradients, radii, type sizes) live in
`mobile/src/theme.ts`, and the shared components live in `mobile/src/components/ui.tsx`. Change them there to
restyle the whole app.

### Fitness limits worth knowing

- Workouts are tracked with the phone's GPS while Kizayu is open on screen (the screen is kept awake). Tracking in the background would need extra Google Play approval.
- All-day step counting (like a pedometer) isn't included. Phones only hand that data to apps through Health Connect (Android) or Apple Health, which needs a separate native setup and a health-data declaration on Google Play. Steps shown for walks and runs are estimated from distance.

### Reminders and "today"

- The phone tells the server its timezone every time the app opens, so "today", habit streaks, the evening nudge and morning memories all use the person's own day.
- A background scheduler on the server runs every minute (appointments, calendar, missed medicine, safe-walk timers, nudges, memories). Each job claims its work atomically, so a restart or a second server never sends the same message twice.
- Push messages reach Android phones only after Firebase (FCM) is set up for the app. Until then every alert is still saved in the in-app notification list and arrives live while the app is open.

### SOS limits worth knowing

- Phones only let apps use the camera while they are open on screen, so Kizayu must stay open during an SOS (the screen is kept awake). True live streaming would need a paid video service; clips are near-live instead.
- The camera and microphone need a new app build (not just an update). Google Play will ask you to explain camera and microphone use, and to list audio and video in the data safety form.

## Needs your accounts before it works for real

All the code is in place. Each item below starts working when you add its keys to `backend/.env`; see
`backend/.env.example` and `backend/src/config.ts` for the names.

| Feature | What to set up | Settings |
|---|---|---|
| SMS (sign-in codes and SOS alerts) | Twilio account and phone number. Without it, SOS can't text contacts automatically: the SOS screen offers a "Text my contacts" button that opens the phone's own messages app instead | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` |
| Email codes | Any SMTP provider (SendGrid, Mailgun, Amazon SES and so on) | `SMTP_URL`, `MAIL_FROM` |
| Google sign-in | OAuth client IDs from Google Cloud Console | Backend: `GOOGLE_CLIENT_IDS`. App: `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `_ANDROID_`, `_IOS_` |
| Push notifications | An Expo account: run `npx eas-cli init` in `mobile/`, then make a development build | Optional `EXPO_ACCESS_TOKEN` |
| Premium (optional) | Store billing via Google Play / App Store (RevenueCat is the easiest), then receipt checks in `backend/src/routes/premium.ts` | `PREMIUM_ENABLED=true`. It's off in production by default: Premium is hidden and everyone gets the higher limits |
| Report emails | An address where content reports and support requests are sent | `SUPPORT_EMAIL` |
| Photo storage | An S3 bucket, or another S3-compatible store such as Cloudflare R2 | `S3_BUCKET`, `S3_REGION`, `S3_PUBLIC_URL` |
| Map tiles at scale | A tile provider such as MapTiler or Stadia | `EXPO_PUBLIC_MAP_TILE_URL` |

Push notifications and Google sign-in don't work in Expo Go or the browser preview. They need a development build:
`npx eas-cli build --profile development`.

## Publishing

### What the app already has for the stores

- **Account deletion** in the app (Profile → Account & Security → Delete account). It removes all personal data and
  photos, and passes owned circles to another member. Both stores require this.
- **Content safety**: delete your own posts, comments and messages; report posts, comments, messages and people (a
  reported post is hidden from you immediately, and the report is emailed to `SUPPORT_EMAIL`); block people (their
  posts, comments, stories, messages and notifications are hidden). Apple requires these for apps where users share
  content.
- **Public Privacy Policy and Terms pages** at `https://<your-api>/privacy` and `/terms`. Use these links in both store
  listings. They're drafts: have a lawyer review `backend/src/routes/legal.ts` and `mobile/src/app/legal/[doc].tsx`.
- **App icon and splash screen**: regenerate them with `node scripts/make-icons.js` in `mobile/` if you change colours.
- **Store builds**: `mobile/eas.json` has `development`, `preview` (an installable test APK) and `production` profiles.
  Version numbers increase automatically.
- **Store-friendly settings**: phone-only on iOS (so no iPad screenshots are needed), the encryption export
  declaration is set, and Android background location and microphone are blocked because the app doesn't use them.
- **Server ready to host**: `backend/Dockerfile`. On every start it applies database migrations, makes sure the games
  catalog exists, and starts the API.

### Step by step

1. **Pick the final name and package ID** (see "Renaming the app" below).
2. **Host the server.** Create a managed PostgreSQL database (Neon or Supabase), then deploy `backend/` with its
   Dockerfile to Railway, Render or Fly.io. Set these variables:
   `DATABASE_URL`, `NODE_ENV=production`, `JWT_SECRET` (a random string of 32+ characters), `PUBLIC_URL` (your API
   address), plus the SMS, email and storage settings from the table above. Check that `https://<your-api>/health`
   returns `{"ok":true}`.
3. **Point the app at it.** Replace `https://kizayu.onrender.com` in `mobile/eas.json` with your API address.
4. **Create an Expo account**, then run these in `mobile/`: `npx eas-cli login`, then `npx eas-cli init`. This
   connects the project and turns on push notifications.
5. **Test build:** `npx eas-cli build --profile preview --platform android` gives you an APK to install on Android
   phones. For iPhone, use a production build and TestFlight.
6. **Store builds:** `npx eas-cli build --profile production` for Android and iOS, then upload them with
   `npx eas-cli submit`.
7. **Store listings:** screenshots, a description, the `/privacy` link, Google's data safety form and health-app
   declaration, and Apple's privacy labels. Kizayu collects name, email/phone, photos, health data and location,
   none of it used for ads.
8. **Google's testing rule:** new personal Play accounts need a closed test with at least 12 testers for 14 days before
   the app can go public. Start this early.

Production mode already gives you: security headers, rate-limited sign-in, hashed one-time codes that lock after 5
wrong tries, image checks on upload, CORS locked to `CORS_ORIGINS`, and no dev codes or test purchases. Health data is
sensitive, so consider encryption at rest and audit logging as you grow.

## Renaming the app

The name lives in `backend/src/config.ts`, `mobile/src/config.ts` and `mobile/app.json` (`name`, `slug`, `scheme`,
`ios.bundleIdentifier`, `android.package`). Choose the final name and package IDs before your first store build,
because package IDs can't change after publishing.
