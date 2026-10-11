// ─── Auth: forgotten password ─────────────────────────────────────────────────
// A reset is a link carrying a 256-bit token. Only the token's SHA-256 is
// stored, it expires after an hour, and it is consumed by a guarded update, so
// it works once even when two requests arrive together.
//
// The request never says whether an address has an account: the reply is the
// same in every case and anything account-specific is said by email. That
// includes an account that signs in with Google and has no password to reset.
// The email is sent without being awaited, so the reply does not wait on it.
//
// Completing a reset proves the address is the owner's, so it also marks the
// email verified and ends any pause on signing in to that address. Sessions
// are stateless JWTs with no revocation, so sessions issued before the reset
// stay valid until they expire.

import { defaultAuthDeps, fail, type AuthDeps, type AuthFailure } from "./auth-deps";
import { googleAccountEmail, passwordResetEmail } from "./auth-email";
import { normalizeEmail, passwordProblem } from "./email-rules";
import { LOGIN_ATTEMPTS } from "./login.service";
import { generateToken, hashToken, isTokenShaped } from "./secrets";
import { clearThrottle, consumeThrottle, type ThrottleRule } from "./throttle";

export const RESET_TTL_MS = 60 * 60 * 1000;
export const RESET_MAX_REQUESTS_PER_HOUR = 3;

export const RESET_REQUESTED_MESSAGE =
  "If an account with that email exists, we've sent instructions to it.";
export const RESET_REJECTED_MESSAGE = "This reset link is invalid or has expired.";

// Requests acted on for one address, whoever asks, counted in Postgres.
const RESET_REQUESTS: ThrottleRule = {
  scope: "reset-request",
  limit: RESET_MAX_REQUESTS_PER_HOUR,
  windowMs: 60 * 60 * 1000,
};

export interface ResetOptions {
  deps?: AuthDeps;
  now?: Date;
}

export type ResetRequestResult = { ok: true; message: string } | AuthFailure;

export async function requestPasswordReset(
  input: { email?: unknown },
  options: ResetOptions = {},
): Promise<ResetRequestResult> {
  const { deps = defaultAuthDeps, now = new Date() } = options;
  const accepted = { ok: true as const, message: RESET_REQUESTED_MESSAGE };

  const email = normalizeEmail(input.email);
  if (!email) return fail(400, "Enter a valid email address");

  // Over the limit: the same reply, and nothing is sent.
  if (!(await consumeThrottle(deps.db, RESET_REQUESTS, email, now)).allowed) return accepted;

  const user = await deps.db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      password: true,
      accounts: { where: { provider: "google" }, select: { provider: true } },
    },
  });
  if (!user) return accepted;

  if (!user.password) {
    if (user.accounts && user.accounts.length > 0) {
      sendInBackground(deps, googleAccountEmail(user.email, deps.appUrl()));
    }
    return accepted;
  }

  const token = generateToken();
  await deps.db.$transaction(async (tx) => {
    // A new link retires the ones before it.
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    });
    await tx.passwordResetToken.create({
      data: {
        token: hashToken(token),
        userId: user.id,
        expiresAt: new Date(now.getTime() + RESET_TTL_MS),
      },
    });
  });

  const resetUrl = `${deps.appUrl()}/reset-password?token=${token}`;
  sendInBackground(deps, passwordResetEmail(user.email, user.name, resetUrl, RESET_TTL_MS / 60_000));
  return accepted;
}

function sendInBackground(deps: AuthDeps, email: Parameters<AuthDeps["sendEmail"]>[0]) {
  void deps.sendEmail(email).catch(() => {
    console.error("[PASSWORD RESET] The email could not be sent.");
  });
}

export type ResetCompleteResult = { ok: true } | AuthFailure;

export async function completePasswordReset(
  input: { token?: unknown; password?: unknown },
  options: ResetOptions = {},
): Promise<ResetCompleteResult> {
  const { deps = defaultAuthDeps, now = new Date() } = options;
  const rejected = fail(400, RESET_REJECTED_MESSAGE);

  if (!input.token || !input.password) return fail(400, "Token and password are required");

  const problem = passwordProblem(input.password);
  if (problem) return fail(400, problem);

  if (!isTokenShaped(input.token)) return rejected;

  const row = await deps.db.passwordResetToken.findUnique({
    where: { token: hashToken(input.token) },
  });
  if (!row || row.used || row.expiresAt.getTime() <= now.getTime()) return rejected;

  const passwordHash = await deps.hashPassword(input.password as string);

  const done = await deps.db.$transaction(async (tx) => {
    const consumed = await tx.passwordResetToken.updateMany({
      where: { id: row.id, used: false, expiresAt: { gt: now } },
      data: { used: true },
    });
    if (consumed.count !== 1) return false;

    const user = await tx.user.findUnique({
      where: { id: row.userId },
      select: { id: true, email: true, emailVerified: true },
    });
    if (!user) return false;

    await tx.user.update({
      where: { id: user.id },
      data: { password: passwordHash, emailVerified: user.emailVerified ?? now },
    });
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    });
    return user.email;
  });
  if (!done) return rejected;

  // The owner is back in control: lift any pause on signing in.
  await clearThrottle(deps.db, LOGIN_ATTEMPTS, done);
  return { ok: true };
}
