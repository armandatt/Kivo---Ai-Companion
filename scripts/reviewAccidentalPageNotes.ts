// MCP-03: lists, for one learner, the notes an assistant made where they asked
// for Saved Pages, with the evidence and a recommendation for each.
// READ ONLY (packages/api/src/connect/accidental-notes.ts): nothing is written.
//
//   DATABASE_URL=<database to read> npx tsx --tsconfig tsconfig.json scripts/reviewAccidentalPageNotes.ts \
//     --email learner@example.com [--client chatgpt] [--since 2026-11-13]

import { prisma } from "@repo/db/client";
import { reviewAccidentalPageNotes } from "../packages/api/src/connect/accidental-notes";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const email = arg("email");
  if (!email) throw new Error("--email is required");
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) { console.log(JSON.stringify({ found: false, reason: "no account with that email" })); return; }
  const r = await reviewAccidentalPageNotes(user.id, { client: arg("client"), since: arg("since") ? new Date(arg("since")!) : undefined });
  const n = r.found ? r.candidates.length : 0;
  console.log(JSON.stringify({ ...r, identified: n === 4 ? "four candidates, as reported" : `${n} candidates (four were reported): review before acting` }, null, 2));
}

main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
