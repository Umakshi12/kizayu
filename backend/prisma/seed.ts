// Sets up the reference data the app needs (the games catalog). Creates no users or sample content.
// Safe to run on a live database: it only adds or updates catalog rows.
import { PrismaClient } from "@prisma/client";
import { seedReferenceData } from "./reference";

const prisma = new PrismaClient();
seedReferenceData(prisma)
  .then(() => console.log("Reference data ready (games catalog). No sample data was added."))
  .finally(() => prisma.$disconnect());
