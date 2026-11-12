// Gives pages saved before the saved-pages library (12 Nov) their kind and
// duplicate key, worked out from each page's own address. Writes nothing
// else: no description, image or author is made up. Safe to run again: only
// rows still missing a value are touched. Runs against DATABASE_URL.
//
//   npx tsx --tsconfig tsconfig.json scripts/backfillSavedLibrary.ts           count only (writes nothing)
//   npx tsx --tsconfig tsconfig.json scripts/backfillSavedLibrary.ts --apply   write
//
// Run after `prisma db push` has added the columns. Rows are never deleted.

import { backfillLibrary } from "../packages/api/src/nova/product/learning-events";
import { prisma } from "@repo/db/client";

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await backfillLibrary({ apply });
  console.log(JSON.stringify({ mode: apply ? "applied" : "dry_run", ...result }));
}

main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
