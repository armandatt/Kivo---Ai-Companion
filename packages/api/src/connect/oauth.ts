// ─── Kivo Connect: clients, approvals and tokens ──────────────────────────────
// The only reader and writer of NovaConnectClient and NovaConnectGrant.
// Codes and tokens are random, shown once, and stored as SHA-256. Single use
// comes from guarded writes (updateMany on the hash and the row's state),
// never from reading first, as in the auth package.

import { prisma } from "@repo/db/client";
import {
  ACCESS_PREFIX, ACCESS_TOKEN_MINUTES, CLIENT_PREFIX, CLIENT_SECRET_PREFIX, CODE_MINUTES, CODE_PREFIX,
  REFRESH_PREFIX, REFRESH_TOKEN_DAYS, addMinutes, newSecret, pkceVerifies, sameSecret, sha256,
  type ClientRegistration, type Scope,
} from "./oauth-rules";

export interface RegisteredClient {
  client_id: string;
  client_secret?: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  grant_types: string[];
  response_types: string[];
}

export async function registerClient(reg: ClientRegistration, now = new Date()): Promise<RegisteredClient> {
  const clientId = newSecret(CLIENT_PREFIX).slice(0, 36);
  const secret = reg.tokenAuthMethod === "none" ? null : newSecret(CLIENT_SECRET_PREFIX);
  await prisma.novaConnectClient.create({
    data: { clientId, name: reg.name, redirectUris: reg.redirectUris, tokenAuthMethod: reg.tokenAuthMethod, secretHash: secret ? sha256(secret) : null, createdAt: now },
  });
  return {
    client_id: clientId, ...(secret ? { client_secret: secret } : {}),
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: reg.name, redirect_uris: reg.redirectUris, token_endpoint_auth_method: reg.tokenAuthMethod,
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
  };
}

export async function findClient(clientId: unknown): Promise<{ id: string; clientId: string; name: string; redirectUris: string[]; tokenAuthMethod: string; secretHash: string | null } | null> {
  if (typeof clientId !== "string" || clientId.length > 60) return null;
  return prisma.novaConnectClient.findUnique({ where: { clientId }, select: { id: true, clientId: true, name: true, redirectUris: true, tokenAuthMethod: true, secretHash: true } });
}

// A confidential client must prove its secret; a public one (PKCE only) has none.
export function clientAuthenticates(client: { tokenAuthMethod: string; secretHash: string | null }, secret: string | null): boolean {
  if (client.tokenAuthMethod === "none") return true;
  return !!secret && !!client.secretHash && sameSecret(sha256(secret), client.secretHash);
}

// The learner approved: a code bound to the client, the redirect address,
// the PKCE challenge, the scopes and the resource.
export async function issueCode(input: { userId: string; clientRowId: string; scopes: Scope[]; resource: string; redirectUri: string; codeChallenge: string }, now = new Date()): Promise<string> {
  const code = newSecret(CODE_PREFIX);
  await prisma.novaConnectGrant.create({
    data: {
      userId: input.userId, clientRowId: input.clientRowId, scopes: input.scopes, resource: input.resource,
      codeHash: sha256(code), codeChallenge: input.codeChallenge, redirectUri: input.redirectUri,
      codeExpiresAt: addMinutes(now, CODE_MINUTES), createdAt: now,
    },
  });
  return code;
}

export interface TokenSet { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string }
export type TokenError = { error: "invalid_grant" | "invalid_client" | "invalid_request"; error_description: string };

function freshTokens(now: Date) {
  const access = newSecret(ACCESS_PREFIX), refresh = newSecret(REFRESH_PREFIX);
  return {
    access, refresh,
    data: {
      accessHash: sha256(access), accessExpiresAt: addMinutes(now, ACCESS_TOKEN_MINUTES),
      refreshHash: sha256(refresh), refreshExpiresAt: addMinutes(now, REFRESH_TOKEN_DAYS * 24 * 60),
    },
  };
}

export async function exchangeCode(input: { clientRowId: string; code: unknown; redirectUri: unknown; verifier: unknown }, now = new Date()): Promise<TokenSet | TokenError> {
  if (typeof input.code !== "string" || !input.code.startsWith(CODE_PREFIX)) return { error: "invalid_grant", error_description: "That code is not valid." };
  const hash = sha256(input.code);
  const grant = await prisma.novaConnectGrant.findUnique({ where: { codeHash: hash }, select: { id: true, clientRowId: true, redirectUri: true, codeChallenge: true, codeExpiresAt: true, scopes: true, revokedAt: true } });
  if (!grant || grant.clientRowId !== input.clientRowId || grant.revokedAt || !grant.codeExpiresAt || grant.codeExpiresAt < now) return { error: "invalid_grant", error_description: "That code is not valid or has expired." };
  if (grant.redirectUri !== input.redirectUri) return { error: "invalid_grant", error_description: "redirect_uri does not match the one the code was issued for." };
  if (!grant.codeChallenge || !pkceVerifies(input.verifier, grant.codeChallenge)) return { error: "invalid_grant", error_description: "code_verifier does not match." };
  const t = freshTokens(now);
  // Single use: only the write that still finds the code takes it.
  const taken = await prisma.novaConnectGrant.updateMany({
    where: { id: grant.id, codeHash: hash, revokedAt: null },
    data:  { codeHash: null, codeChallenge: null, codeExpiresAt: null, ...t.data, lastUsedAt: now },
  });
  if (taken.count !== 1) return { error: "invalid_grant", error_description: "That code was already used." };
  return { access_token: t.access, token_type: "Bearer", expires_in: ACCESS_TOKEN_MINUTES * 60, refresh_token: t.refresh, scope: grant.scopes.join(" ") };
}

// Rotation: the refresh token is replaced with the access token. Using an old
// refresh token again (a leaked copy) revokes the whole grant.
export async function refreshTokens(input: { clientRowId: string; refreshToken: unknown; scope?: unknown }, now = new Date()): Promise<TokenSet | TokenError> {
  if (typeof input.refreshToken !== "string" || !input.refreshToken.startsWith(REFRESH_PREFIX)) return { error: "invalid_grant", error_description: "That refresh token is not valid." };
  const hash = sha256(input.refreshToken);
  const grant = await prisma.novaConnectGrant.findUnique({ where: { refreshHash: hash }, select: { id: true, clientRowId: true, refreshExpiresAt: true, revokedAt: true, scopes: true } });
  if (!grant) {
    // A refresh token already rotated away: a replayed or leaked copy. End the grant.
    const replayed = await prisma.novaConnectGrant.updateMany({ where: { previousRefreshHash: hash, clientRowId: input.clientRowId, revokedAt: null }, data: { revokedAt: now } });
    if (replayed.count) console.warn(JSON.stringify({ layer: "kivo_connect", event: "refresh_token_reused_grant_revoked" }));
    return { error: "invalid_grant", error_description: "That refresh token is not valid or has expired." };
  }
  if (!grant || grant.clientRowId !== input.clientRowId || grant.revokedAt || !grant.refreshExpiresAt || grant.refreshExpiresAt < now) return { error: "invalid_grant", error_description: "That refresh token is not valid or has expired." };
  // A narrower scope may be asked for; never a wider one.
  let scopes = grant.scopes;
  if (typeof input.scope === "string" && input.scope.trim()) {
    const asked = input.scope.split(/\s+/).filter(Boolean);
    if (asked.some(s => !grant.scopes.includes(s))) return { error: "invalid_grant", error_description: "A refresh cannot add scopes." };
    scopes = asked;
  }
  const t = freshTokens(now);
  const taken = await prisma.novaConnectGrant.updateMany({ where: { id: grant.id, refreshHash: hash, revokedAt: null }, data: { ...t.data, previousRefreshHash: hash, scopes, lastUsedAt: now } });
  if (taken.count !== 1) {
    await prisma.novaConnectGrant.updateMany({ where: { id: grant.id }, data: { revokedAt: now } });
    return { error: "invalid_grant", error_description: "That refresh token was already used." };
  }
  return { access_token: t.access, token_type: "Bearer", expires_in: ACCESS_TOKEN_MINUTES * 60, refresh_token: t.refresh, scope: scopes.join(" ") };
}

// RFC 7009: any token of the grant ends the grant. Always "ok": the answer
// never says whether a token existed.
export async function revokeToken(token: unknown, clientRowId: string, now = new Date()): Promise<void> {
  if (typeof token !== "string") return;
  const hash = sha256(token);
  await prisma.novaConnectGrant.updateMany({ where: { clientRowId, revokedAt: null, OR: [{ accessHash: hash }, { refreshHash: hash }] }, data: { revokedAt: now } });
}

export interface ConnectCaller { userId: string; grantId: string; scopes: string[]; clientName: string }

// An access token from the Authorization header → who and what. null: not a
// live token for this resource. The user comes from the grant only.
export async function authenticateAccessToken(token: string | null, resource: string, now = new Date()): Promise<ConnectCaller | null> {
  if (!token || !token.startsWith(ACCESS_PREFIX) || token.length > 200) return null;
  const grant = await prisma.novaConnectGrant.findUnique({
    where:  { accessHash: sha256(token) },
    select: { id: true, userId: true, scopes: true, resource: true, accessExpiresAt: true, revokedAt: true, lastUsedAt: true, client: { select: { name: true } } },
  });
  if (!grant || grant.revokedAt || !grant.accessExpiresAt || grant.accessExpiresAt < now) return null;
  if (grant.resource.replace(/\/+$/, "") !== resource.replace(/\/+$/, "")) return null;
  // Last used, at most once a minute per grant.
  if (!grant.lastUsedAt || now.getTime() - grant.lastUsedAt.getTime() > 60_000) {
    await prisma.novaConnectGrant.update({ where: { id: grant.id }, data: { lastUsedAt: now } }).catch(() => undefined);
  }
  return { userId: grant.userId, grantId: grant.id, scopes: grant.scopes, clientName: grant.client.name };
}

// The learner's own connected assistants, for Settings, and their revoke.
export async function listConnections(userId: string, now = new Date()) {
  const rows = await prisma.novaConnectGrant.findMany({
    where:   { userId, revokedAt: null, refreshExpiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select:  { id: true, scopes: true, createdAt: true, lastUsedAt: true, client: { select: { name: true } } },
  });
  return rows.map(r => ({ id: r.id, client: r.client.name, scopes: r.scopes, connectedAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt?.toISOString() ?? null }));
}

export async function revokeConnection(userId: string, grantId: string, now = new Date()): Promise<boolean> {
  if (typeof grantId !== "string" || grantId.length > 40) return false;
  return (await prisma.novaConnectGrant.updateMany({ where: { id: grantId, userId, revokedAt: null }, data: { revokedAt: now } })).count === 1;
}
