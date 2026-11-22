// Which database will `prisma db push` reach, and what does it hold? Read-only.
//
//   node scripts/db-target-check.mjs                     uses packages/db/.env (what Prisma uses there)
//   node scripts/db-target-check.mjs path/to/.env
//
// Prints only non-secret facts: the Neon endpoint id (shortened), pooled or
// direct, the region, the database, Neon's timeline (branch) and tenant
// (project) ids, whether the usage-accounting objects exist, the billing
// counts, and when the deployed API last wrote here. Never a password or a
// connection string. Every query runs in a read-only session.
//
// Before a production push: compare the endpoint id with the one in Render's
// DATABASE_URL (Render → Environment; read the host only) and the timeline
// with the production branch in the Neon console. They must match.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { Client } = require(resolve(here, "../node_modules/pg"));

const envFile = process.argv[2] ?? resolve(here, "../packages/db/.env");
const text = readFileSync(envFile, "utf8");
const pick = k => process.env[k] ?? (text.match(new RegExp(`^${k}=["']?([^"'\\n]+)`, "m")) || [])[1];
// Prisma's own rule (packages/db/prisma.config.ts): DIRECT_URL, else DATABASE_URL.
const which = pick("DIRECT_URL") ? "DIRECT_URL" : "DATABASE_URL";
const raw = pick(which);
if (!raw) { console.error(`No DIRECT_URL or DATABASE_URL in ${envFile}`); process.exit(1); }
const u = new URL(raw);
const endpoint = (u.hostname.match(/ep-[a-z0-9-]+?(?=-pooler|\.)/) || [u.hostname.split(".")[0]])[0];
const out = { envFile, variable: which, endpoint: endpoint.slice(0, 16) + "…", pooled: u.hostname.includes("-pooler"), region: u.hostname.split(".")[1] ?? "?", database: u.pathname.slice(1) };

const c = new Client({ connectionString: raw, options: "-c default_transaction_read_only=on" });
await c.connect();
const q = async sql => { await c.query("BEGIN READ ONLY"); try { return (await c.query(sql)).rows[0]; } finally { await c.query("COMMIT"); } };
Object.assign(out, await q(`SELECT current_database() AS "databaseReported", current_setting('neon.timeline_id', true) AS timeline, current_setting('neon.tenant_id', true) AS tenant`));
Object.assign(out, await q(`SELECT to_regclass('"UsageBalance"') IS NOT NULL AS "UsageBalance", to_regclass('"UsageReservation"') IS NOT NULL AS "UsageReservation",
  to_regclass('"UsageLedger"') IS NOT NULL AS "UsageLedger", to_regclass('"RateLimitWindow"') IS NOT NULL AS "RateLimitWindow",
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'UsageReservation' AND column_name = 'steps') AS "UsageReservation.steps"`));
Object.assign(out, await q(`SELECT (SELECT count(*)::int FROM "BillingSubscription") AS subscriptions, (SELECT count(*)::int FROM "BillingTrial" WHERE "endsAt" > now()) AS "activeTrials",
  (SELECT count(*)::int FROM "User") AS users, (SELECT max("lastUsedAt")::text FROM "NovaConnectGrant") AS "lastMcpUseUtc", (now() AT TIME ZONE 'utc')::text AS "nowUtc"`));
await c.end();
for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(24)} ${v}`);
