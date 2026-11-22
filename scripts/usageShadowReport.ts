// The usage-accounting shadow report (billing/accounting/report.ts): the old
// daily meter's counted requests beside the new Nova credits, browser tasks,
// MCP calls, Kivo-funded cost, what enforcement would have refused, open
// reservations, storage, and coverage of the usage events. It only reads
// (SELECT); accounts appear as opaque labels. Runs against DATABASE_URL; to
// make the session itself read-only, add `options=-c%20default_transaction_read_only%3Don`
// to the URL.
//
//   npx tsx --tsconfig tsconfig.json scripts/usageShadowReport.ts               the last 14 days
//   npx tsx --tsconfig tsconfig.json scripts/usageShadowReport.ts --days 30
//   npx tsx --tsconfig tsconfig.json scripts/usageShadowReport.ts --from 2026-11-23 --to 2026-12-07
//
// The Phase 2 gate (docs/USAGE_ACCOUNTING.md) reads it.

import { prisma } from "@repo/db/client";
import { shadowReport } from "../packages/api/src/billing/accounting/report";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const to = arg("--to") ? new Date(`${arg("--to")}T00:00:00Z`) : new Date();
  const days = Number(arg("--days") ?? 14);
  const from = arg("--from") ? new Date(`${arg("--from")}T00:00:00Z`) : new Date(to.getTime() - days * 86_400_000);
  const report = await shadowReport(from, to);
  console.log(JSON.stringify(report, null, 2));
}

main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
