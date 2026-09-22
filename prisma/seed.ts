/**
 * Seeds the settings row and a starter service menu: `npm run seed`.
 * Safe to run more than once — existing rows are left alone.
 */
import { prisma } from "../lib/prisma";
import { getSettings } from "../lib/automation";
import { ensureDefaultUser } from "../lib/auth";

const SERVICES = [
  { name: "Women's cut", category: "Cut", price: 65, duration: 60 },
  { name: "Men's cut", category: "Cut", price: 35, duration: 30 },
  { name: "Blowout", category: "Style", price: 45, duration: 45 },
  { name: "Single-process color", category: "Color", price: 95, duration: 90 },
  { name: "Partial highlights", category: "Color", price: 140, duration: 120 },
  { name: "Full highlights", category: "Color", price: 190, duration: 150 },
  { name: "Deep conditioning", category: "Treatment", price: 30, duration: 20 },
];

async function main() {
  await getSettings();
  await ensureDefaultUser();
  const existing = await prisma.service.count();
  if (existing === 0) {
    await prisma.service.createMany({ data: SERVICES });
    console.log(`seed: added ${SERVICES.length} services`);
  } else {
    console.log(`seed: ${existing} services already present, skipping`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
