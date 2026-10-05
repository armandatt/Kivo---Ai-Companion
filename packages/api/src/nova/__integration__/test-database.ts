// Picks the database for an integration test. Import this before anything
// that imports the Prisma client.
//
// It refuses to run without NOVA_TEST_DATABASE_URL, and refuses a URL on the
// same host as the one in packages/db/.env. These tests write to a real
// database and must never reach the app's.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function configuredAppDatabaseUrls(): string[] {
  try {
    const env = readFileSync(resolve(here, "../../../../db/.env"), "utf8");
    return env.split(/\r?\n/).flatMap(line => {
      const m = line.match(/^\s*(?:DATABASE_URL|DIRECT_URL)\s*=\s*["']?([^"'\s]+)/);
      return m ? [m[1]!] : [];
    });
  } catch {
    return [];
  }
}

const TEST_URL = process.env.NOVA_TEST_DATABASE_URL;
if (!TEST_URL) {
  console.error(
    "Refusing to run: NOVA_TEST_DATABASE_URL is not set.\n" +
    "Point it at a disposable Postgres (a local instance or a throwaway Neon branch).",
  );
  process.exit(1);
}
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return u; } };
if (configuredAppDatabaseUrls().some(u => u === TEST_URL || hostOf(u) === hostOf(TEST_URL))) {
  console.error("Refusing to run: NOVA_TEST_DATABASE_URL points at the same host as packages/db/.env.");
  process.exit(1);
}
process.env.DATABASE_URL = TEST_URL;
process.env.DIRECT_URL   = TEST_URL;
