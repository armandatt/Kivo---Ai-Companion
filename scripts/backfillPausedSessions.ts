// Bug batch 28 Nov, item 1. Sessions closed as "abandoned" while paused get
// the time studied before the pause and become completed sessions, as the
// sweep now does for new ones (packages/api/src/nova/persistence/session-backfill.ts).
// Safe to run again: only rows still abandoned-while-paused are touched.
// Runs against DATABASE_URL.
//
//   npx tsx --tsconfig tsconfig.json scripts/backfillPausedSessions.ts           count only (writes nothing)
//   npx tsx --tsconfig tsconfig.json scripts/backfillPausedSessions.ts --apply   write
//
// No schema change. Deploy the API first, so new pauses are saved the same way.

import { backfillPausedAbandoned } from "../packages/api/src/nova/persistence/session-backfill";
import { prisma } from "@repo/db/client";

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await backfillPausedAbandoned({ apply });
  console.log(JSON.stringify({ mode: apply ? "applied" : "dry_run", ...result }, null, 2));
}

main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
