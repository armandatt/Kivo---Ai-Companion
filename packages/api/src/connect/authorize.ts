// ─── Kivo Connect: one authorization request, checked ─────────────────────────
// The parameters an assistant sends to /connect/authorize (OAuth 2.1, PKCE).
// Until client_id and redirect_uri are known good, nothing is ever sent to the
// redirect address: the page shows the error itself. After that, errors go
// back to the client on its own redirect address, as OAuth requires.

import { findClient, issueCode } from "./oauth";
import { parseScopes, pkceChallengeOk, resourceOk, SCOPES, type Scope } from "./oauth-rules";

export interface AuthorizeParams {
  response_type?: unknown; client_id?: unknown; redirect_uri?: unknown; scope?: unknown;
  state?: unknown; code_challenge?: unknown; code_challenge_method?: unknown; resource?: unknown;
}

export type AuthorizeCheck =
  | { ok: true; client: { id: string; name: string }; redirectUri: string; scopes: Scope[]; state: string | null; codeChallenge: string; resource: string }
  | { ok: false; show: string }                                              // shown on the page, never redirected
  | { ok: false; redirect: string; error: string; description: string };     // sent back to the client

export function redirectWith(uri: string, params: Record<string, string | null>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  return u.toString();
}

// The longest `state` returned to a client.
export const STATE_MAX = 2_048;

export async function checkAuthorize(p: AuthorizeParams, mcpUrl: string, issuer: string): Promise<AuthorizeCheck> {
  const client = await findClient(p.client_id);
  if (!client) return { ok: false, show: "This assistant is not registered with Kivo. Start connecting again from the assistant." };
  if (typeof p.redirect_uri !== "string" || !client.redirectUris.includes(p.redirect_uri)) return { ok: false, show: "The address this assistant asked to return to is not one it registered. Nothing was shared." };
  // The client's own value, returned as given. OpenAI's is about 900 characters
  // (a signed relay token); one it cannot have back unchanged is refused here,
  // never silently dropped, or the client cannot match the reply (14 Nov).
  if (p.state !== undefined && p.state !== null && (typeof p.state !== "string" || p.state.length > STATE_MAX)) return { ok: false, show: "The assistant sent a sign-in request Kivo cannot answer (its state is too long). Nothing was shared." };
  const state = typeof p.state === "string" && p.state ? p.state : null;
  const back = (error: string, description: string): AuthorizeCheck => ({ ok: false, redirect: redirectWith(p.redirect_uri as string, { error, error_description: description, state, iss: issuer }), error, description });
  if (p.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported.");
  if (!pkceChallengeOk(p.code_challenge, p.code_challenge_method)) return back("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  if (!resourceOk(p.resource, mcpUrl)) return back("invalid_target", `The only resource is ${mcpUrl}.`);
  const scopes = parseScopes(p.scope);
  if (!scopes.ok) return back("invalid_scope", `Unknown scope: ${scopes.unknown.join(", ")}.`);
  return { ok: true, client: { id: client.id, name: client.name }, redirectUri: p.redirect_uri, scopes: scopes.scopes, state, codeChallenge: p.code_challenge as string, resource: mcpUrl };
}

export const scopeDescriptions = (scopes: Scope[]) => scopes.map(s => ({ scope: s, description: SCOPES[s] }));

// The learner's answer. approve: a code for the client; deny: access_denied.
export async function decide(userId: string, check: Extract<AuthorizeCheck, { ok: true }>, approve: boolean, issuer: string): Promise<string> {
  if (!approve) return redirectWith(check.redirectUri, { error: "access_denied", error_description: "The learner did not allow access.", state: check.state, iss: issuer });
  const code = await issueCode({ userId, clientRowId: check.client.id, scopes: check.scopes, resource: check.resource, redirectUri: check.redirectUri, codeChallenge: check.codeChallenge });
  return redirectWith(check.redirectUri, { code, state: check.state, iss: issuer });
}
