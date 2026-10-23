/**
 * Entry point for a Railway cron service: `npm run cron`.
 * Runs the scheduler once and exits, printing a short summary.
 */
import { runAutomations } from "../lib/automation";
import { syncNow } from "../lib/google";
import { prisma } from "../lib/prisma";

async function main() {
  // Google first, so a booking made there this hour gets its confirmation now
  await syncNow()
    .then((r) => r !== "not connected" && console.log(`google: ${r}`))
    .catch((e) => console.error("google:", e instanceof Error ? e.message : e));
  const summary = await runAutomations();
  console.log(
    `cron: ${summary.sent} sent, ${summary.failed} failed, ${summary.skipped} skipped`
  );
  for (const d of summary.detail) {
    if (d.status === "failed") console.error(`  ${d.kind} ${d.channel} ${d.customer}: ${d.error}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
