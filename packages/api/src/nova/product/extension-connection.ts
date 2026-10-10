// ─── Browser extension connection ─────────────────────────────────────────────
// How a browser extension comes to act for a learner, without the web
// session, the JWT secret or a password ever reaching it.
//
//   1. The signed-in web app asks for a pairing code (createPairingCode).
//      The code is shown once, lasts ten minutes and works once.
//   2. The learner types it into the extension, which redeems it
//      (redeemPairingCode) for a credential of its own.
//   3. That credential opens the extension routes only. It is not a web
//      session: it cannot read notes, change settings or delete an account.
//   4. It stops working when the learner disconnects (from the extension or
//      the web app) or after thirty days without use.
//
// The table holds SHA-256 hashes only. The code direction is deliberate: a
// code made by the signed-in learner and typed into their own extension
// cannot hand an account to someone else's browser.
//
// The only code that reads or writes NovaExtensionConnection.

import { createHash, randomBytes, randomInt } from "node:crypto";
import { prisma } from "@repo/db/client";
import type { ExtensionConnectionView } from "./learning-events.types";

export const PAIRING_CODE_MINUTES = 10;
export const TOKEN_IDLE_DAYS      = 30;
export const MAX_CONNECTIONS      = 5;
export const TOKEN_PREFIX         = "nvx_";
const LABEL_MAX                   = 60;
const LAST_USED_WRITE_EVERY_MS    = 60 * 60 * 1000;
const DAY_MS                      = 86_400_000;

// No 0/O, 1/I/L or U: nothing to misread when typing it across.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const CODE_LENGTH   = 10;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// "abcde-fghjk", " ABCDE FGHJK " and "ABCDEFGHJK" are the same code.
export function normalizePairingCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  const code = [...raw.toUpperCase()].filter(ch => CODE_ALPHABET.includes(ch)).join("");
  return code.length === CODE_LENGTH ? code : null;
}

export async function createPairingCode(userId: string, now = new Date()): Promise<{ code: string; expiresAt: Date }> {
  const code      = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_MINUTES * 60_000);
  await prisma.$transaction([
    // One live code per account: asking again withdraws the last one.
    prisma.novaExtensionConnection.deleteMany({ where: { userId, tokenHash: null } }),
    prisma.novaExtensionConnection.create({ data: { userId, codeHash: sha256(code), codeExpiresAt: expiresAt } }),
  ]);
  return { code: `${code.slice(0, 5)}-${code.slice(5)}`, expiresAt };
}

export async function redeemPairingCode(
  rawCode: unknown,
  rawLabel: unknown,
  now = new Date(),
): Promise<{ ok: true; token: string } | { ok: false }> {
  const code = normalizePairingCode(rawCode);
  if (!code) return { ok: false };

  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const label = typeof rawLabel === "string" ? rawLabel.trim().slice(0, LABEL_MAX) || null : null;

  // One statement decides it: the code must exist, be unexpired and unused.
  // Two redemptions of the same code cannot both match.
  const redeemed = await prisma.novaExtensionConnection.updateMany({
    where: { codeHash: sha256(code), codeExpiresAt: { gt: now }, tokenHash: null, revokedAt: null },
    data:  { tokenHash: sha256(token), codeHash: null, codeExpiresAt: null, connectedAt: now, lastUsedAt: now, label },
  });
  if (redeemed.count !== 1) return { ok: false };

  // The oldest connections beyond the limit are closed.
  const mine = await prisma.novaExtensionConnection.findFirst({ where: { tokenHash: sha256(token) }, select: { userId: true } });
  if (mine) {
    const extra = await prisma.novaExtensionConnection.findMany({
      where:   { userId: mine.userId, tokenHash: { not: null }, revokedAt: null },
      orderBy: { connectedAt: "desc" }, skip: MAX_CONNECTIONS, select: { id: true },
    });
    if (extra.length > 0) {
      await prisma.novaExtensionConnection.updateMany({ where: { id: { in: extra.map(e => e.id) } }, data: { revokedAt: now } });
    }
  }
  return { ok: true, token };
}

// Whose extension this is. null: no such credential, revoked, or unused for
// too long. The answer never says which.
export async function authenticateExtensionToken(
  token: unknown,
  now = new Date(),
): Promise<{ userId: string; connectionId: string; name: string | null } | null> {
  if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX) || token.length > 100) return null;
  const row = await prisma.novaExtensionConnection.findUnique({
    where:  { tokenHash: sha256(token) },
    select: { id: true, userId: true, revokedAt: true, lastUsedAt: true, connectedAt: true, user: { select: { name: true } } },
  });
  if (!row || row.revokedAt) return null;
  const lastUsed = row.lastUsedAt ?? row.connectedAt;
  if (!lastUsed || now.getTime() - lastUsed.getTime() > TOKEN_IDLE_DAYS * DAY_MS) return null;

  if (now.getTime() - lastUsed.getTime() > LAST_USED_WRITE_EVERY_MS) {
    await prisma.novaExtensionConnection.updateMany({ where: { id: row.id, revokedAt: null }, data: { lastUsedAt: now } }).catch(() => {});
  }
  return { userId: row.userId, connectionId: row.id, name: row.user.name };
}

// Disconnect. `userId` comes from the caller's own credential or session, so
// a connection id alone never closes someone else's connection.
export async function revokeExtensionConnection(userId: string, connectionId: string, now = new Date()): Promise<boolean> {
  const closed = await prisma.novaExtensionConnection.updateMany({
    where: { id: connectionId, userId, tokenHash: { not: null }, revokedAt: null },
    data:  { revokedAt: now },
  });
  return closed.count === 1;
}

export async function listExtensionConnections(userId: string, now = new Date()): Promise<ExtensionConnectionView[]> {
  const idleSince = new Date(now.getTime() - TOKEN_IDLE_DAYS * DAY_MS);
  const rows = await prisma.novaExtensionConnection.findMany({
    where:   { userId, tokenHash: { not: null }, revokedAt: null, lastUsedAt: { gte: idleSince } },
    orderBy: { connectedAt: "desc" },
    select:  { id: true, label: true, connectedAt: true, lastUsedAt: true },
  });
  return rows.map(r => ({
    id: r.id, label: r.label,
    connectedAt: (r.connectedAt ?? now).toISOString(),
    lastUsedAt:  r.lastUsedAt?.toISOString() ?? null,
  }));
}
