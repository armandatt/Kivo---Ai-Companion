// ─── Staging guard ────────────────────────────────────────────────────────────
// Every staging script goes through this before it touches anything. It
// refuses to run unless each target is provably not production:
//
//   database   its host is not any host named in packages/db/.env or
//              apps/api/.env (the production connection strings)
//   API        https, and its host is not the production API host
//   bot        getMe answers for the expected staging username, which is not
//              the production BOT_USERNAME, and its bot id is not the
//              production token's bot id
//   webhook    (live runs) the staging bot's webhook points at the staging API
//
// Secrets are read from the environment and never printed: `redact` is applied
// to everything a script writes. Production values are read only to compare
// against; they never leave this file.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// The production API host. It is public (the keep-awake workflow pings it).
const PRODUCTION_API_HOSTS = ["kivo-api-6jh4.onrender.com", ...(process.env.NOVA_PRODUCTION_API_HOSTS ?? "").split(",").map(h => h.trim()).filter(Boolean)];

export class GuardError extends Error {}

export interface StagingEnv {
  apiUrl:        string;   // https://<staging-api>
  databaseUrl:   string;   // the staging Neon pooled URL
  botToken:      string;   // the staging bot's token
  botUsername:   string;   // the staging bot's username, without @
  webhookSecret: string;   // the staging TELEGRAM_WEBHOOK_SECRET
  chatId:        string;   // the test learner's private chat with the staging bot
}

const NAMES: Record<keyof StagingEnv, string> = {
  apiUrl:        "STAGING_API_URL",
  databaseUrl:   "STAGING_DATABASE_URL",
  botToken:      "STAGING_TELEGRAM_BOT_TOKEN",
  botUsername:   "STAGING_BOT_USERNAME",
  webhookSecret: "STAGING_TELEGRAM_WEBHOOK_SECRET",
  chatId:        "STAGING_TEST_CHAT_ID",
};

export function loadStagingEnv<K extends keyof StagingEnv>(needed: K[]): Pick<StagingEnv, K> {
  const missing = needed.filter(k => !process.env[NAMES[k]]?.trim()).map(k => NAMES[k]);
  if (missing.length > 0) throw new GuardError(`missing: ${missing.join(", ")}`);
  const out = {} as Pick<StagingEnv, K>;
  for (const k of needed) (out as Record<string, string>)[k] = process.env[NAMES[k]]!.trim();
  secrets.push(...needed.filter(k => k === "botToken" || k === "webhookSecret" || k === "databaseUrl").map(k => (out as Record<string, string>)[k]!));
  return out;
}

// ── Redaction ─────────────────────────────────────────────────────────────────

const secrets: string[] = [];
export function redact(text: string): string {
  let out = text;
  for (const s of secrets) if (s.length >= 6) out = out.split(s).join("[redacted]");
  return out
    .replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, "bot[redacted]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, "[redacted-token]")
    .replace(/postgres(ql)?:\/\/[^\s"']+/g, "postgresql://[redacted]")
    .replace(/(AIza|sk-)[A-Za-z0-9_-]{10,}/g, "[redacted-key]");
}
export const log = (record: Record<string, unknown>) => console.log(redact(JSON.stringify({ ts: new Date().toISOString(), ...record })));

// ── Production, read only to compare against ─────────────────────────────────

function envFile(path: string): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    for (const line of readFileSync(resolve(ROOT, path), "utf8").split(/\r?\n/)) {
      const at = line.indexOf("=");
      if (at > 0 && !line.trimStart().startsWith("#")) out[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
    }
    return out;
  } catch { return {}; }
}
const hostOf = (url: string): string | null => { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } };
// Neon's pooled host is the direct host with "-pooler" in its first label.
const neonEndpoint = (host: string) => host.split(".")[0]!.replace(/-pooler$/, "");

function productionDatabaseHosts(): string[] {
  const urls = [envFile("packages/db/.env"), envFile("apps/api/.env"), envFile("packages/api/.env")]
    .flatMap(e => [e["DATABASE_URL"], e["DIRECT_URL"]]).filter((u): u is string => Boolean(u));
  return [...new Set(urls.map(hostOf).filter((h): h is string => h !== null))];
}

export function assertStagingDatabase(url: string, name = "STAGING_DATABASE_URL"): void {
  const host = hostOf(url);
  if (!host) throw new GuardError(`${name} is not a URL`);
  const production = productionDatabaseHosts();
  if (production.length === 0) throw new GuardError("no production database host found to compare against (packages/db/.env); refusing to guess");
  if (production.some(p => p === host || neonEndpoint(p) === neonEndpoint(host))) {
    throw new GuardError(`${name} points at the production database host`);
  }
}

// The pooled and the direct URL must be the same Neon endpoint: prisma.config.ts
// prefers DIRECT_URL, so a direct URL from another project is where a push goes.
export function assertSameEndpoint(pooled: string, direct: string): void {
  const a = hostOf(pooled), b = hostOf(direct);
  if (!a || !b || neonEndpoint(a) !== neonEndpoint(b)) throw new GuardError("STAGING_DATABASE_URL and STAGING_DIRECT_URL are not the same database endpoint");
}

export function assertStagingApi(url: string): void {
  const parsed = (() => { try { return new URL(url); } catch { return null; } })();
  if (!parsed || parsed.protocol !== "https:") throw new GuardError("STAGING_API_URL must be an https URL");
  if (PRODUCTION_API_HOSTS.includes(parsed.hostname.toLowerCase())) throw new GuardError("STAGING_API_URL is the production API");
}

// The bot the token belongs to, checked against the expected staging name and
// against production. Read-only Bot API calls.
export async function assertStagingBot(token: string, expectedUsername: string, timeoutMs = 10_000): Promise<{ id: number; username: string }> {
  const me = await botCall(token, "getMe", {}, timeoutMs) as { id: number; username: string };
  const wanted = expectedUsername.replace(/^@/, "").toLowerCase();
  if (me.username.toLowerCase() !== wanted) throw new GuardError(`the token belongs to @${me.username}, not @${wanted}`);
  const prod = { ...envFile("packages/api/.env"), ...envFile("apps/api/.env") };
  const prodName = (prod["TELEGRAM_BOT_USERNAME"] ?? prod["BOT_USERNAME"] ?? "").replace(/^@/, "").toLowerCase();
  const prodToken = prod["TELEGRAM_BOT_TOKEN"] ?? prod["BOT_TOKEN"] ?? "";
  const prodId = prodToken.split(":")[0] ?? "";
  if (prodName && prodName === me.username.toLowerCase()) throw new GuardError("the staging bot is the production bot (same username)");
  if (prodId && prodId === String(me.id)) throw new GuardError("the staging bot is the production bot (same bot id)");
  if (!prodName && !prodId) throw new GuardError("no production bot identity found to compare against (apps/api/.env); refusing to guess");
  return me;
}

export async function assertWebhookTarget(token: string, apiUrl: string, timeoutMs = 10_000): Promise<void> {
  const info = await botCall(token, "getWebhookInfo", {}, timeoutMs) as { url?: string; last_error_message?: string };
  const want = `${apiUrl.replace(/\/$/, "")}/api/telegram`;
  if (info.url !== want) throw new GuardError(`the staging bot's webhook is "${info.url ?? ""}", not ${want}`);
}

export async function botCall(token: string, method: string, payload: Record<string, unknown>, timeoutMs = 10_000): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => ({})) as { ok?: boolean; result?: unknown; description?: string };
  if (!body.ok) throw new GuardError(`Bot API ${method} failed: ${redact(body.description ?? String(res.status))}`);
  return body.result;
}

// Prisma against the staging database only. DATABASE_URL is set before the
// client is loaded, so it cannot fall back to an .env file's production URL.
export async function stagingPrisma(databaseUrl: string) {
  assertStagingDatabase(databaseUrl);
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL   = databaseUrl;
  const { prisma } = await import("@repo/db/client");
  return prisma;
}

// The learner a live run may act on: seeded for staging and marked as such.
export const TEST_LEARNER_MARK = "Staging smoke test learner";
