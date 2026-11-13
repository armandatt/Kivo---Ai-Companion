// ─── Kivo Connect: OAuth rules (pure, no database) ────────────────────────────
// What an assistant (ChatGPT, Claude, any MCP client) may ask for and how its
// requests are checked. OAuth 2.1 authorization code with PKCE (S256 only),
// exact redirect addresses, tokens named by prefix and stored as hashes.
// docs/integrations/KIVO_CONNECT_AUTHENTICATION.md.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SCOPES = {
  "profile:read":    "See your name and how your Kivo is set up",
  "workspace:read":  "See your workspaces, subjects and topics",
  "notes:read":      "Read and search your notes",
  "notes:write":     "Create, change, move and (with your approval) delete notes",
  "knowledge:read":  "Read your Knowledge Map",
  "knowledge:write": "Add subjects and topics, and connect items on your Knowledge Map",
} as const;
export type Scope = keyof typeof SCOPES;
export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

export const CODE_MINUTES          = 5;
export const ACCESS_TOKEN_MINUTES  = 60;
export const REFRESH_TOKEN_DAYS    = 30;
export const ACCESS_PREFIX         = "kca_";
export const REFRESH_PREFIX        = "kcr_";
export const CODE_PREFIX           = "kcc_";
export const CLIENT_PREFIX         = "kcl_";
export const CLIENT_SECRET_PREFIX  = "kcs_";
export const REDIRECT_URIS_MAX     = 10;
export const CLIENT_NAME_MAX       = 80;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newSecret = (prefix: string) => prefix + randomBytes(32).toString("base64url");

export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// "a b c" → known scopes, in a fixed order. An unknown scope is a refusal, not
// silently dropped, so the assistant learns it asked for something wrong.
// Nothing asked: every scope (the consent screen lists them).
export function parseScopes(raw: unknown): { ok: true; scopes: Scope[] } | { ok: false; unknown: string[] } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, scopes: [...ALL_SCOPES] };
  if (typeof raw !== "string") return { ok: false, unknown: [String(raw)] };
  const asked = [...new Set(raw.split(/\s+/).filter(Boolean))];
  const unknown = asked.filter(s => !(s in SCOPES));
  if (unknown.length) return { ok: false, unknown };
  return { ok: true, scopes: ALL_SCOPES.filter(s => asked.includes(s)) };
}

export const hasScopes = (granted: readonly string[], needed: readonly Scope[]) => needed.every(s => granted.includes(s));

// PKCE, S256 only (OAuth 2.1 drops "plain").
export function pkceChallengeOk(challenge: unknown, method: unknown): challenge is string {
  return method === "S256" && typeof challenge === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(challenge);
}
export function pkceVerifies(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  return sameSecret(createHash("sha256").update(verifier).digest("base64url"), challenge);
}

// A redirect address a client may register: https anywhere, or http only on
// the loopback host (a local tool such as MCP Inspector). No fragment, no
// credentials. Compared exactly, character for character, when used.
export function redirectUriOk(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 500) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");
}

export interface ClientRegistration {
  name: string;
  redirectUris: string[];
  tokenAuthMethod: "none" | "client_secret_post" | "client_secret_basic";
}

// RFC 7591 request → what is kept. Everything else in the request is ignored.
export function parseRegistration(raw: unknown): { ok: true; reg: ClientRegistration } | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata"; description: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "invalid_client_metadata", description: "Send the client's metadata as a JSON object." };
  const r = raw as Record<string, unknown>;
  const uris = r.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > REDIRECT_URIS_MAX) return { ok: false, error: "invalid_redirect_uri", description: `Give between 1 and ${REDIRECT_URIS_MAX} redirect_uris.` };
  if (!uris.every(redirectUriOk)) return { ok: false, error: "invalid_redirect_uri", description: "Each redirect_uri must be https (or http on localhost), without a fragment." };
  const method = r.token_endpoint_auth_method ?? "none";
  if (method !== "none" && method !== "client_secret_post" && method !== "client_secret_basic") return { ok: false, error: "invalid_client_metadata", description: "token_endpoint_auth_method must be none, client_secret_post or client_secret_basic." };
  const grants = r.grant_types;
  if (grants !== undefined && (!Array.isArray(grants) || grants.some(g => g !== "authorization_code" && g !== "refresh_token"))) return { ok: false, error: "invalid_client_metadata", description: "Only authorization_code and refresh_token are supported." };
  const types = r.response_types;
  if (types !== undefined && (!Array.isArray(types) || types.some(t => t !== "code"))) return { ok: false, error: "invalid_client_metadata", description: "Only the code response type is supported." };
  const name = typeof r.client_name === "string" && r.client_name.trim() ? r.client_name.trim().replace(/\s+/g, " ").slice(0, CLIENT_NAME_MAX) : "An AI assistant";
  return { ok: true, reg: { name, redirectUris: [...new Set(uris as string[])], tokenAuthMethod: method } };
}

// The MCP endpoint's address, which is also the token's audience. A client
// may name it in `resource` (RFC 8707); naming anything else is refused.
export function resourceOk(asked: unknown, mcpUrl: string): boolean {
  if (asked === undefined || asked === null || asked === "") return true;
  if (typeof asked !== "string") return false;
  return asked.replace(/\/+$/, "") === mcpUrl.replace(/\/+$/, "");
}

export function addMinutes(d: Date, m: number) { return new Date(d.getTime() + m * 60_000); }
