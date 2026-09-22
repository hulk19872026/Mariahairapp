/**
 * Entry point for a Railway cron service: `npm run cron`.
 * Runs the scheduler once and exits, printing a short summary.
 */
import { runAutomations } from "../lib/automation";
import { prisma } from "../lib/prisma";

async function main() {
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
