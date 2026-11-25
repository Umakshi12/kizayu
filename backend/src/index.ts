import http from "http";
import { createApp } from "./app";
import { purgeOldSos } from "./routes/sos";
import { APP_NAME, PORT } from "./config";
import { attachRealtime } from "./realtime";
import { startScheduler } from "./services/scheduler";

const server = http.createServer(createApp());
attachRealtime(server);
server.listen(PORT, () => console.log(`${APP_NAME} API listening on http://localhost:${PORT}`));

// Recordings from SOS alerts are deleted after 30 days.
const purge = () => purgeOldSos().then(n => { if (n) console.log(`[sos] deleted ${n} old SOS recording set(s)`); }).catch(e => console.warn("[sos] cleanup failed:", e.message));
void purge();
setInterval(purge, 6 * 3600e3).unref();

// Reminders, check-ins and nudges run once a minute.
startScheduler();
