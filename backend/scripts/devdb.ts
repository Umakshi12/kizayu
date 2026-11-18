// Local development Postgres 17. No install and no admin password needed.
// Run `npm run db` in its own terminal and leave it running. Data persists in ./.pgdata.
//
// Default: the bundled embedded-postgres binaries.
// Fallback: set PG_BIN_DIR to an installed Postgres bin folder (e.g. C:\Program Files\PostgreSQL\17\bin) to run a
// separate private cluster with those programs (useful when the project path is too long for Windows' 260-char limit).
// It never touches an existing Postgres server: own data dir, own port, own dev credentials.
//
// In production, point DATABASE_URL at a managed Postgres instead (Neon, RDS, Supabase, etc.).
import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://kinloop:kinloop_dev_pw@localhost:5433/kinloop");
const dir = path.resolve(process.cwd(), ".pgdata");
const user = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
const port = Number(url.port || 5432);
const dbName = url.pathname.slice(1);
const fresh = !fs.existsSync(path.join(dir, "PG_VERSION"));
const ready = () => console.log(`Postgres ready on ${url.host}, database "${dbName}"${fresh ? " (new)" : ""}. Ctrl+C to stop.`);

async function withSystemBinaries(binDir: string) {
  const bin = (n: string) => path.join(binDir, process.platform === "win32" ? `${n}.exe` : n);
  if (fresh) {
    const pw = path.join(os.tmpdir(), `kizayu-pw-${process.pid}`);
    fs.writeFileSync(pw, password);
    try { execFileSync(bin("initdb"), ["-D", dir, "-U", user, `--pwfile=${pw}`, "--auth=scram-sha-256", "-E", "UTF8", "--no-locale"], { stdio: "inherit" }); }
    finally { fs.rmSync(pw, { force: true }); }
  }
  execFileSync(bin("pg_ctl"), ["-D", dir, "-o", `-p ${port}`, "-l", path.join(dir, "server.log"), "-w", "start"], { stdio: "inherit" });
  const env = { ...process.env, PGPASSWORD: password };
  for (const db of [dbName, `${dbName}_test`]) spawnSync(bin("createdb"), ["-h", "localhost", "-p", String(port), "-U", user, db], { env, stdio: "ignore" }); // ok if exists
  ready();
  const stop = () => { spawnSync(bin("pg_ctl"), ["-D", dir, "-m", "fast", "stop"], { stdio: "inherit" }); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  setInterval(() => undefined, 1 << 30); // keep alive
}

async function withEmbedded() {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  // Force UTF-8: on Windows initdb otherwise picks the system code page (WIN1252), which can't store emoji.
  const pg = new EmbeddedPostgres({
    databaseDir: dir, user, password, port, persistent: true, onLog: () => undefined,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  if (fresh) await pg.initialise();
  await pg.start();
  // App database + a separate *_test database used only by `npm test`.
  for (const db of [dbName, `${dbName}_test`]) { try { await pg.createDatabase(db); } catch { /* already exists */ } }
  ready();
  const stop = async () => { await pg.stop().catch(() => undefined); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

(process.env.PG_BIN_DIR ? withSystemBinaries(process.env.PG_BIN_DIR) : withEmbedded()).catch(e => {
  console.error(e);
  console.error("\nIf this is a path-length error on Windows, move the project to a short path (e.g. D:\\Kinloop) or set PG_BIN_DIR.");
  process.exit(1);
});
