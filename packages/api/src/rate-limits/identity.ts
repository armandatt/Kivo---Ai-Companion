// ─── Who is asking: subjects for rate limits ─────────────────────────────────
// A subject is a string `<kind>:<value>`; with the policy it makes the
// counter's key `rl.<policy>.<dimension>:<kind>:<value>` (store.ts). Kinds:
//   user:<id> / learner:<chat>  the account (billing's usageKey, the same on
//                               every surface: web, extension, Telegram, MCP)
//   cred:<hash>                 one bearer credential, before it is resolved
//   client:<id>                 an OAuth client or MCP grant
//   task:<id>                   one browser-agent task
//   ip:<hash>                   a client address, keyed (never stored raw)
//   global:all                  everyone
//
// The client address. Render serves the API through Cloudflare (checked
// 24 Nov 2026: `server: cloudflare`, `cf-ray` on every response), which sets
// CF-Connecting-IP itself and overwrites one sent by the client. Render passes
// a client's own X-Forwarded-For through, so that header is never read here.
// Requests that come through the web app (www.thekivo.in → Vercel → Render)
// arrive from Vercel's address; for those the web app's middleware sends the
// browser's address with the proof the auth proxy already uses (proxyProof,
// from JWT_SECRET), and only with a valid proof is it believed.
//
// Order: proof → CF-Connecting-IP (RATE_LIMITS_TRUSTED_IP_HEADER renames it,
// "none" turns it off) → unknown. All unknown callers share one subject per
// policy, so no header gets a caller a fresh allowance.

import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";
import { PROXY_CLIENT_IP_HEADER, PROXY_PROOF_HEADER } from "../auth/proxy-headers";
import { proxyProof, safeEqual, serverSecret } from "../auth/secrets";

export type IpSource = "proxy" | "edge" | "unknown";
export interface ClientAddress { subject: string; source: IpSource }

interface HeaderLike { get(name: string): string | null }

function trustedEdgeHeader(env: NodeJS.ProcessEnv): string | null {
  const v = (env.RATE_LIMITS_TRUSTED_IP_HEADER ?? "cf-connecting-ip").trim().toLowerCase();
  return v && v !== "none" ? v : null;
}

/** Normalised address, or null: IPv6 kept to its /64, since one host has a whole /64. */
export function normaliseIp(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v || v.length > 64) return null;
  const kind = isIP(v);
  if (kind === 4) return v;
  if (kind !== 6) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(v);
  if (mapped) return mapped[1]!;
  // Expand, then keep the first four groups.
  const [head, tail] = v.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const groups = tail !== undefined ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return `${groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

// Keyed so a leaked table names no addresses; truncated, since it only has to
// tell callers apart.
export function ipSubject(ip: string): string {
  return `ip:${createHmac("sha256", serverSecret()).update(`kivo-rate-limit-ip-v1|${ip}`).digest("hex").slice(0, 20)}`;
}

export const UNKNOWN_IP = "ip:unknown";

export function clientAddress(headers: HeaderLike, env: NodeJS.ProcessEnv = process.env): ClientAddress {
  const proof = headers.get(PROXY_PROOF_HEADER);
  if (proof && safeEqual(proof, proxyProof())) {
    const ip = normaliseIp(headers.get(PROXY_CLIENT_IP_HEADER));
    if (ip) return { subject: ipSubject(ip), source: "proxy" };
  }
  const edge = trustedEdgeHeader(env);
  if (edge) {
    const ip = normaliseIp(headers.get(edge));
    if (ip) return { subject: ipSubject(ip), source: "edge" };
  }
  return { subject: UNKNOWN_IP, source: "unknown" };
}

/** A bearer credential as a subject: hashed, never the token. */
export function credentialSubject(token: string): string {
  return `cred:${createHash("sha256").update(token).digest("hex").slice(0, 24)}`;
}

const SAFE = /^[A-Za-z0-9_.@:-]{1,200}$/;
/** Accepts only the shapes Kivo makes; anything else is rejected rather than used as a key. */
export function safeSubject(kind: "user" | "learner" | "client" | "task", value: string): string | null {
  if (typeof value !== "string" || !SAFE.test(value)) return null;
  return `${kind}:${value}`;
}

/** billing's usageKey (`user:<id>` / `learner:<chat>`) as a subject, checked. */
export function accountSubject(usageKey: string): string | null {
  const m = /^(user|learner):(.+)$/.exec(usageKey);
  return m ? safeSubject(m[1] as "user" | "learner", m[2]!) : null;
}
