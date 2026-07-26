/**
 * Dev seed entry (`npm run db:seed` → tsx prisma/seed.ts).
 * The actual logic lives in src/seed.ts so it also compiles to dist/seed.js for
 * the packaged desktop app's first-run bootstrap. Safe to re-run (all upserts).
 */
import { PrismaClient } from "@prisma/client";
import { runSeed } from "../src/seed";

const prisma = new PrismaClient();

runSeed(prisma)
  .then(() => {
    console.log("✅ Seed complete: units, categories, payment methods, expense categories, settings, permissions.");
    console.log("👉 Now open the app and create your admin account on the Register page.");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
