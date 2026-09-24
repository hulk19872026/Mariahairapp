/**
 * One-off changes to the salon's data, run on every start (`npm start`)
 * right after the schema is synced. Each one runs once: its id is recorded
 * in DataMigration and it's skipped from then on, so editing the menu in the
 * app afterwards is never undone by a redeploy.
 *
 * A failure is logged and never stops the app from starting.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma";
import { fileHash, importCustomers } from "../lib/records-import";

type Item = [name: string, desc: string, price: number, duration: number, category: string];

/** The Length and Luxe price list. Durations are estimates; adjust in the app. */
const LENGTH_AND_LUXE: Item[] = [
  ["Partial Highlights", "Starting at $200", 200, 150, "Colour"],
  ["Full Head Highlights", "Starting at $350", 350, 210, "Colour"],
  ["Balayage", "Starting at $350", 350, 210, "Colour"],
  ["Partial Balayage", "Starting at $200", 200, 150, "Colour"],
  ["Color Glaze", "Blowout included", 90, 60, "Colour"],
  ["Single Process Color", "Blowout included", 90, 90, "Colour"],
  ["Air Touch", "Starting at $400", 400, 240, "Colour"],
  ["Partial Air Touch", "Starting at $200", 200, 180, "Colour"],
  ["Baby Lights", "Starting at $400", 400, 210, "Colour"],
  ["Haircut", "$100–150", 100, 60, "Cutting"],
  ["Blowout", "Starting at $50", 50, 45, "Styling"],
  ["Blowout + Style", "$65–80", 65, 60, "Styling"],
  ["Style", "Starting at $70", 70, 60, "Styling"],
  ["Deep Conditioning Treatment", "", 30, 20, "Treatment"],
  ["K18 Mask Treatment", "", 50, 20, "Treatment"],
  ["Hair Extensions Consultation", "Consultation required; price quoted after", 0, 30, "Extensions"],
];

type Migration = { id: string; run: () => Promise<string> };

async function migrations(): Promise<Migration[]> {
  return [
  {
    id: "2026-09-length-and-luxe-menu",
    async run() {
      const old = await prisma.service.findMany({ select: { id: true } });
      const oldIds = old.map((s) => s.id);
      // services on any appointment are hidden, not deleted, so past visits keep their names
      const used = new Set(
        (
          await prisma.appointment.findMany({
            where: { serviceIds: { hasSome: oldIds } },
            select: { serviceIds: true },
          })
        ).flatMap((a) => a.serviceIds)
      );
      const keep = oldIds.filter((id) => used.has(id));
      const drop = oldIds.filter((id) => !used.has(id));
      await prisma.$transaction([
        prisma.service.updateMany({ where: { id: { in: keep } }, data: { active: false } }),
        prisma.service.deleteMany({ where: { id: { in: drop } } }),
        prisma.service.createMany({
          data: LENGTH_AND_LUXE.map(([name, desc, price, duration, category]) => ({
            name, desc, price, duration, category, active: true,
          })),
        }),
      ]);
      return `menu replaced: ${LENGTH_AND_LUXE.length} added, ${drop.length} removed, ${keep.length} hidden (on past appointments)`;
    },
  },
  {
    // The client list exported from Square, checked in as data/clients.csv.
    // Keyed by the file's hash, so a newer export in the same place imports
    // again while the same file never runs twice.
    id: "clients-csv:" + (await hashOf("data/clients.csv")),
    async run() {
      const text = await fs.readFile(path.join(process.cwd(), "data", "clients.csv"), "utf8");
      const s = await importCustomers(text);
      const problems = s.problems.length ? ` · problems: ${s.problems.slice(0, 5).join("; ")}` : "";
      return `clients imported: ${s.added} added, ${s.updated} updated, ${s.skipped} skipped of ${s.total}${problems}`;
    },
  },
  ];
}

async function hashOf(rel: string): Promise<string> {
  try {
    return fileHash(await fs.readFile(path.join(process.cwd(), rel), "utf8")).slice(0, 16);
  } catch {
    return "missing";
  }
}

async function main() {
  for (const m of await migrations()) {
    if (m.id.endsWith(":missing")) continue; // nothing to import
    if (await prisma.dataMigration.findUnique({ where: { id: m.id } })) continue;
    try {
      const note = await m.run();
      await prisma.dataMigration.create({ data: { id: m.id } });
      console.log(`data migration ${m.id}: ${note}`);
    } catch (e) {
      console.error(`data migration ${m.id} failed:`, e);
    }
  }
}

main()
  .catch((e) => console.error("data migrations:", e))
  .finally(() => prisma.$disconnect());
