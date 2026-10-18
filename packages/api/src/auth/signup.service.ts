// ─── Auth: email signup with a verification code ──────────────────────────────
// A signup is two requests. The first stores a PendingSignup (the password
// already hashed, the code as a keyed hash), emails the code, and hands the
// browser that asked a random signup token. The second presents that token
// with the code, and only then is the User created. Until that moment no User
// row exists.
//
// The token is what makes an attempt belong to the browser that started it.
// Every start is its own row, reached only by its own token, so a second
// person starting a signup for the same address gets a separate attempt: they
// cannot change the first one's password, read it, resend for it or verify it,
// and a code sent for one attempt is useless with another's token.
//
// What a caller can learn: nothing about whether an address has an account.
// An address that already has one goes through the same steps (limit, hash,
// row, email, token) and the owner is told by email instead of being sent a
// code; the row it leaves can never be verified into an account.
//
// Guessing is bounded per attempt and per address. An attempt allows
// OTP_MAX_ATTEMPTS wrong codes in total, however many times the code is
// resent, and an address can be sent at most SIGNUP_SENDS_PER_DAY emails a day
// (counted in Postgres), which caps how many attempts can exist.

import {
  defaultAuthDeps,
  fail,
  toSessionUser,
  type AuthDeps,
  type AuthFailure,
  type SessionUser,
} from "./auth-deps";
import { existingAccountEmail, signupCodeEmail } from "./auth-email";
import { isValidSignupEmail, normalizeEmail, normalizeName, passwordProblem } from "./email-rules";
import type { RateLimitResult } from "./rate-limiter";
import { generateOtp, generateToken, hashOtp, hashToken, isOtpShaped, isTokenShaped, safeEqual } from "./secrets";
import { consumeThrottle, type ThrottleRule } from "./throttle";

const MINUTE = 60 * 1000;

export const OTP_TTL_MS = 10 * MINUTE;
/** How long a started signup can still be resent to and verified. */
export const SIGNUP_ATTEMPT_TTL_MS = 60 * MINUTE;
/** Wrong codes allowed over the whole life of one attempt, across resends. */
export const OTP_MAX_ATTEMPTS = 10;
export const OTP_RESEND_COOLDOWN_MS = MINUTE;
export const SIGNUP_SENDS_PER_HOUR = 5;
export const SIGNUP_SENDS_PER_DAY = 10;

// Emails sent to one address, whoever asks and whether or not it has an account.
const SEND_HOURLY: ThrottleRule = {
  scope: "signup-send-hour",
  limit: SIGNUP_SENDS_PER_HOUR,
  windowMs: 60 * MINUTE,
  cooldownMs: OTP_RESEND_COOLDOWN_MS,
};
const SEND_DAILY: ThrottleRule = {
  scope: "signup-send-day",
  limit: SIGNUP_SENDS_PER_DAY,
  windowMs: 24 * 60 * MINUTE,
};

export const INVALID_EMAIL_MESSAGE = "Enter a valid email address";
export const CODE_REJECTED_MESSAGE =
  "That code is invalid or has expired. Request a new one, or start again.";
const SEND_FAILED_MESSAGE = "We couldn't send the verification email. Please try again shortly.";
const SEND_LIMITED_MESSAGE = "Please wait before requesting another code.";

export interface SignupOptions {
  deps?: AuthDeps;
  now?: Date;
}

async function takeSend(deps: AuthDeps, email: string, now: Date): Promise<RateLimitResult> {
  const hourly = await consumeThrottle(deps.db, SEND_HOURLY, email, now);
  if (!hourly.allowed) return hourly;
  return consumeThrottle(deps.db, SEND_DAILY, email, now);
}

export type SignupStartResult = { ok: true; email: string; signupToken: string } | AuthFailure;

export async function startSignup(
  input: { email?: unknown; password?: unknown; name?: unknown },
  options: SignupOptions = {},
): Promise<SignupStartResult> {
  const { deps = defaultAuthDeps, now = new Date() } = options;

  // Any address that mail can be delivered to; the code proves it is theirs.
  const email = normalizeEmail(input.email);
  if (!email || !isValidSignupEmail(email)) return fail(400, INVALID_EMAIL_MESSAGE);

  const problem = passwordProblem(input.password);
  if (problem) return fail(400, problem);

  const limit = await takeSend(deps, email, now);
  if (!limit.allowed) return fail(429, SEND_LIMITED_MESSAGE, limit.retryAfterSeconds);

  const passwordHash = await deps.hashPassword(input.password as string);
  const existing = await deps.db.user.findUnique({ where: { email }, select: { id: true } });

  // Attempts past their life are of no use to anyone: drop them here.
  await deps.db.pendingSignup.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - SIGNUP_ATTEMPT_TTL_MS) } },
  });

  const signupToken = generateToken();
  const tokenHash = hashToken(signupToken);
  const code = generateOtp();
  await deps.db.pendingSignup.create({
    data: {
      email,
      name: normalizeName(input.name),
      passwordHash,
      tokenHash,
      codeHash: hashOtp(email, code),
      codeExpiresAt: new Date(now.getTime() + OTP_TTL_MS),
      createdAt: now,
    },
  });

  // An address with an account is told so; its code is sent to no one.
  const sent = await deps.sendEmail(
    existing
      ? existingAccountEmail(email, deps.appUrl())
      : signupCodeEmail(email, code, OTP_TTL_MS / MINUTE),
  );
  if (sent) return { ok: true, email, signupToken };

  // The browser is not given the token, so nobody could ever use this row.
  await deps.db.pendingSignup.deleteMany({ where: { tokenHash } }).catch(() => undefined);
  return fail(503, SEND_FAILED_MESSAGE);
}

/** The caller's own attempt, or null: wrong token, another address, or past its life. */
async function ownAttempt(deps: AuthDeps, email: string, signupToken: string, now: Date) {
  const attempt = await deps.db.pendingSignup.findUnique({ where: { tokenHash: hashToken(signupToken) } });
  if (!attempt || !safeEqual(attempt.email, email)) return null;
  if (attempt.createdAt.getTime() + SIGNUP_ATTEMPT_TTL_MS <= now.getTime()) return null;
  return attempt;
}

export type SignupResendResult = { ok: true } | AuthFailure;

/**
 * A fresh code for the caller's own attempt. The old code stops working, and
 * the count of wrong tries carries over. Without the attempt's token this
 * sends nothing and uses up none of the address's sends.
 */
export async function resendSignupCode(
  input: { email?: unknown; signupToken?: unknown },
  options: SignupOptions = {},
): Promise<SignupResendResult> {
  const { deps = defaultAuthDeps, now = new Date() } = options;

  const email = normalizeEmail(input.email);
  if (!email) return fail(400, "Enter a valid email address");
  if (!isTokenShaped(input.signupToken)) return { ok: true };

  const attempt = await ownAttempt(deps, email, input.signupToken, now);
  if (!attempt || attempt.attempts >= OTP_MAX_ATTEMPTS) return { ok: true };

  const limit = await takeSend(deps, email, now);
  if (!limit.allowed) return fail(429, SEND_LIMITED_MESSAGE, limit.retryAfterSeconds);

  const existing = await deps.db.user.findUnique({ where: { email }, select: { id: true } });

  const code = generateOtp();
  const codeHash = hashOtp(email, code);
  await deps.db.pendingSignup.updateMany({
    where: { id: attempt.id },
    data: { codeHash, codeExpiresAt: new Date(now.getTime() + OTP_TTL_MS) },
  });

  const sent = await deps.sendEmail(
    existing
      ? existingAccountEmail(email, deps.appUrl())
      : signupCodeEmail(email, code, OTP_TTL_MS / MINUTE),
  );
  if (sent) return { ok: true };

  // The new code never reached anyone: put the one already sent back, so a
  // failed resend does not break a code that may still be on its way. Guarded
  // on the new code, so a resend that succeeded meanwhile is not undone.
  await deps.db.pendingSignup
    .updateMany({
      where: { id: attempt.id, codeHash },
      data: { codeHash: attempt.codeHash, codeExpiresAt: attempt.codeExpiresAt },
    })
    .catch(() => undefined);
  return fail(503, SEND_FAILED_MESSAGE);
}

export type SignupVerifyResult = { ok: true; user: SessionUser } | AuthFailure;

/**
 * Checks the code against the caller's own attempt and, when it is right,
 * creates the account. Every refusal (no such attempt, wrong token, wrong
 * code, expired, out of tries, already used) reads the same.
 */
export async function verifySignup(
  input: { email?: unknown; code?: unknown; signupToken?: unknown },
  options: SignupOptions = {},
): Promise<SignupVerifyResult> {
  const { deps = defaultAuthDeps, now = new Date() } = options;
  const rejected = fail(400, CODE_REJECTED_MESSAGE);

  const email = normalizeEmail(input.email);
  if (!email || !isOtpShaped(input.code) || !isTokenShaped(input.signupToken)) return rejected;

  const attempt = await ownAttempt(deps, email, input.signupToken, now);
  if (!attempt || attempt.codeExpiresAt.getTime() <= now.getTime()) return rejected;

  // Count the try before checking it, and only while tries remain.
  const counted = await deps.db.pendingSignup.updateMany({
    where: { id: attempt.id, attempts: { lt: OTP_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count !== 1) return rejected;

  if (!safeEqual(hashOtp(email, input.code), attempt.codeHash)) return rejected;

  try {
    const user = await deps.db.$transaction(async (tx) => {
      // Consuming the row is what makes the code single-use: of two requests
      // carrying the same right code, only one deletes it.
      const consumed = await tx.pendingSignup.deleteMany({
        where: { id: attempt.id, codeHash: attempt.codeHash },
      });
      if (consumed.count !== 1) throw new SignupConflict();

      return tx.user.create({
        data: {
          email,
          name: attempt.name,
          password: attempt.passwordHash,
          emailVerified: now,
        },
        select: { id: true, email: true, name: true, image: true },
      });
    });

    // The address has its account: every other attempt for it is now moot.
    // Done after the commit, not inside it: two attempts for one address
    // finishing together would otherwise each wait on a row the other holds.
    // If this fails the rows simply expire; none can become an account.
    await deps.db.pendingSignup.deleteMany({ where: { email } }).catch(() => undefined);

    return { ok: true, user: toSessionUser(user) };
  } catch (error) {
    // Already consumed, the address gained an account meanwhile (P2002), or
    // Postgres chose this transaction to lose a conflict (P2034).
    if (error instanceof SignupConflict || isUniqueViolation(error) || isWriteConflict(error)) return rejected;
    throw error;
  }
}

function isWriteConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2034";
}

class SignupConflict extends Error {}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}
