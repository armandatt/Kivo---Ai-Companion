// Bug batch 28 Nov, item 3: finished sessions the map cannot show on a topic
// (no topic, or a topic name that is none of the learner's topics), and the
// ones that can be filed SAFELY (exactly one topic of that name). Runs against
// DATABASE_URL. Only safe matches are written, and only with --apply.
//
//   npx tsx --tsconfig tsconfig.json scripts/auditSessionFiling.ts           report only (writes nothing)
//   npx tsx --tsconfig tsconfig.json scripts/auditSessionFiling.ts --apply   file the safe matches
//
// No schema change. Idempotent.

import { auditSessionFiling } from "../packages/api/src/nova/persistence/session-filing-audit";
import { prisma } from "@repo/db/client";

async function main() {
  const apply = process.argv.includes("--apply");
  const r = await auditSessionFiling({ apply });
  const { rows, ...counts } = r;
  console.log(JSON.stringify({ mode: apply ? "applied" : "dry_run", ...counts, safe: rows.filter(x => x.match).map(x => ({ id: x.id, kind: x.kind, from: x.label ?? x.topicName, to: x.match })) }, null, 2));
}

main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
