// ─── Auth: which account a Google identity signs in to ────────────────────────
// This runs after the ID token's signature, issuer, audience and expiry have
// been verified (apps/api/lib/auth/google-oidc.ts). It decides, from verified
// claims only, whether that is an existing account, a new one, or neither.
//
// An account is recognised by Google's stable subject id first. A matching
// email string is never enough to link a Google identity to an existing
// account. It links only when both sides are proven:
//
//   • Google is authoritative for the address. Per Google's OpenID Connect
//     guidance that means email_verified is true and either the address is
//     @gmail.com or the token carries an hd claim (a Google Workspace
//     account, whose domain Google hosts). For any other address Google only
//     confirmed it once, when the Google account was made, and the mailbox may
//     have changed hands since.
//   • The Kivo account is proven its owner's: it has no password, or its own
//     email has been verified. An account with a password and an unverified
//     email could have been registered by someone who does not own the
//     address, so it is not linked: the owner resets the password first,
//     which proves ownership and verifies the email.
//
// When either side fails, nothing is linked and nothing about the existing
// account changes.

import { consentRecord, type LegalConsentInput } from "./legal";
import { defaultAuthDeps, toSessionUser, type AuthDeps, type SessionUser } from "./auth-deps";
import { isGmailAddress, normalizeEmail } from "./email-rules";
import { safeEqual } from "./secrets";

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  /** Google hosts this address: @gmail.com, or a Workspace domain (hd). */
  emailAuthoritative: boolean;
  name: string | null;
  picture: string | null;
}

export type GoogleClaimsResult =
  | { ok: true; identity: GoogleIdentity }
  | { ok: false; reason: "nonce_mismatch" | "missing_claims" };

/** Reads the claims this flow relies on out of an already-verified ID token. */
export function readGoogleClaims(
  payload: Record<string, unknown>,
  expectedNonce: string,
): GoogleClaimsResult {
  const nonce = typeof payload.nonce === "string" ? payload.nonce : "";
  if (!expectedNonce || !safeEqual(nonce, expectedNonce)) return { ok: false, reason: "nonce_mismatch" };

  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const email = normalizeEmail(payload.email);
  if (!sub || !email) return { ok: false, reason: "missing_claims" };

  const emailVerified = payload.email_verified === true;
  const hostedDomain = typeof payload.hd === "string" ? payload.hd.trim().toLowerCase() : "";
  // hd counts only when it is the domain of this very address.
  const workspace = hostedDomain.length > 0 && email.endsWith(`@${hostedDomain}`);

  return {
    ok: true,
    identity: {
      sub,
      email,
      emailVerified,
      emailAuthoritative: emailVerified && (isGmailAddress(email) || workspace),
      name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : null,
      picture: typeof payload.picture === "string" && payload.picture ? payload.picture : null,
    },
  };
}

export type GoogleSignInResult =
  | { ok: true; user: SessionUser; outcome: "existing" | "linked" | "created" }
  | { ok: false; reason: "email_unverified" | "email_not_authoritative" | "password_reset_required" | "consent_required" };

// consent: the agreement the sign-up page sent with this attempt
// (auth/legal.ts). Needed only to create an account; signing in to one that
// exists, or linking Google to it, asks for nothing new.
export async function resolveGoogleSignIn(
  identity: GoogleIdentity,
  options: { deps?: AuthDeps; now?: Date; consent?: LegalConsentInput | null } = {},
): Promise<GoogleSignInResult> {
  const { deps = defaultAuthDeps, now = new Date(), consent = null } = options;
  const select = { id: true, email: true, name: true, image: true, password: true, emailVerified: true };

  const account = await deps.db.account.findUnique({
    where: {
      provider_providerAccountId: { provider: "google", providerAccountId: identity.sub },
    },
    select: { id: true, userId: true, provider: true, providerAccountId: true, user: { select } },
  });

  if (account?.user) {
    let user = account.user;
    if (!user.image && identity.picture) {
      user = await deps.db.user.update({
        where: { id: user.id },
        data: { image: identity.picture },
        select,
      });
    }
    return { ok: true, user: toSessionUser(user), outcome: "existing" };
  }

  // Past this point the only link to an account is the email address.
  if (!identity.emailVerified) return { ok: false, reason: "email_unverified" };

  const existing = await deps.db.user.findUnique({ where: { email: identity.email }, select });

  if (existing) {
    if (!identity.emailAuthoritative) return { ok: false, reason: "email_not_authoritative" };
    if (existing.password && !existing.emailVerified) {
      return { ok: false, reason: "password_reset_required" };
    }

    const user = await deps.db.$transaction(async (tx) => {
      await tx.account.create({ data: googleAccount(existing.id, identity.sub) });
      return tx.user.update({
        where: { id: existing.id },
        data: {
          emailVerified: existing.emailVerified ?? now,
          image: existing.image ?? identity.picture,
          name: existing.name ?? identity.name,
        },
        select,
      });
    });
    return { ok: true, user: toSessionUser(user), outcome: "linked" };
  }

  if (!consent) return { ok: false, reason: "consent_required" };

  const user = await deps.db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: identity.email,
        name: identity.name,
        image: identity.picture,
        // Recorded as verified only when Google's word on the address is final.
        emailVerified: identity.emailAuthoritative ? now : null,
      },
      select,
    });
    await tx.account.create({ data: googleAccount(created.id, identity.sub) });
    await tx.legalConsent.create({ data: consentRecord(created.id, consent, now, "google_signup") });
    return created;
  });
  return { ok: true, user: toSessionUser(user), outcome: "created" };
}

// Only the link is stored. Google's access and refresh tokens are not kept:
// nothing in Kivo calls a Google API on the user's behalf.
function googleAccount(userId: string, sub: string) {
  return { userId, type: "oauth", provider: "google", providerAccountId: sub };
}
