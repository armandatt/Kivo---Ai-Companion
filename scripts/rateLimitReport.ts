// What the rate limits refused, would have refused (shadow), and who is near
// a limit now. Read only. Run against the database in DATABASE_URL:
//
//   npx tsx --tsconfig tsconfig.json scripts/rateLimitReport.ts --hours 24
//   npx tsx --tsconfig tsconfig.json scripts/rateLimitReport.ts --hours 72 --json
//
// Before turning a policy on (RATE_LIMITS_ENFORCE / RATE_LIMITS_MODE), its
// `would_refuse` count over a few days of real traffic should be near zero
// for ordinary accounts. See docs/RATE_LIMITS.md.

import { prisma } from "@repo/db/client";
import { rateLimitReport } from "../packages/api/src/rate-limits/report";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const hours = Number(arg("--hours") ?? 24);
  const r = await rateLimitReport(hours);
  if (process.argv.includes("--json")) { console.log(JSON.stringify(r, null, 2)); return; }
  console.log(`Rate limits, last ${hours} h\n`);
  console.log("Events (refused, would_refuse in shadow, faults, switches, saturation):");
  if (!r.events.length) console.log("  none");
  for (const e of r.events) console.log(`  ${e.event.padEnd(15)} ${e.policy.padEnd(26)} ${e.dimension.padEnd(12)} ${e.count}`);
  console.log("\nSubjects at 80% or more of a limit (counters are kept a day):");
  if (!r.hot.length) console.log("  none");
  for (const h of r.hot) console.log(`  ${h.policy.padEnd(26)} ${h.dimension.padEnd(7)} ${String(h.windowSeconds).padStart(6)}s  ${h.count}/${h.limit}  ${h.subject}`);
  console.log("\nConcurrency slots held now:");
  if (!r.slots.length) console.log("  none");
  for (const s of r.slots) console.log(`  ${s.policy.padEnd(26)} ${s.scope.padEnd(7)} ${s.held}/${s.limit ?? "?"}  ${s.subject}`);
}

main().catch(err => { console.error((err as Error).message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
