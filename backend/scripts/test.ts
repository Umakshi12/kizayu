// `npm test`: runs the end-to-end suite against a separate *_test database so the app's data is never touched.
// Needs `npm run db` running. Creates the test database if missing, migrates it, loads fixtures, then runs the suite.
import { execSync } from "child_process";

async function main() {
  const appUrl = new URL(process.env.DATABASE_URL ?? "postgresql://kinloop:kinloop_dev_pw@localhost:5433/kinloop");
  const name = appUrl.pathname.slice(1).replace(/_test$/, "");
  const testName = `${name}_test`;

  // Create the test database (via the app database connection) if it doesn't exist yet.
  const { PrismaClient } = await import("@prisma/client");
  const admin = new PrismaClient({ datasources: { db: { url: appUrl.toString() } } });
  const exists = await admin.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM pg_database WHERE datname = '${testName}'`);
  if (!exists.length) await admin.$executeRawUnsafe(`CREATE DATABASE "${testName}" ENCODING 'UTF8' TEMPLATE template0`);
  await admin.$disconnect();

  const testUrl = new URL(appUrl.toString());
  testUrl.pathname = "/" + testName;
  process.env.DATABASE_URL = testUrl.toString();
  process.env.UPLOAD_DIR = ".test-uploads"; // keep test images out of the app's uploads folder
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: process.env });

  const { loadFixtures } = await import("../src/testing/fixtures");
  const prisma = new PrismaClient();
  await loadFixtures(prisma);
  await prisma.$disconnect();

  await import("../src/smoke");
}

main().catch(e => { console.error(e); process.exit(1); });
