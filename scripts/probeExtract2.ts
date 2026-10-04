import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
loadEnv({ path: resolve(process.cwd(), "packages/api/.env"), override: false });

import { extractRealityFacts } from "@repo/api/services/realityExtractor.service";

async function main() {
  const tests = [
    "My grandmother passed away last week. I haven't been able to do anything.",
    "I'm completely burned out. I haven't wanted to train in weeks.",
    "Travelling for work for the next 10 days. No gym access.",
  ];

  for (const text of tests) {
    const facts = await extractRealityFacts(text, true);
    console.log(`\nINPUT: "${text.slice(0, 60)}"`);
    console.log(`EXTRACTED (${facts.length}):`, JSON.stringify(facts, null, 2));
  }
}
main().catch(console.error);
