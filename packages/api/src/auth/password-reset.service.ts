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

  const resetUrl = await issueResetLink(deps, user.id, now);
  sendInBackground(deps, passwordResetEmail(user.email, user.name, resetUrl, RESET_TTL_MS / 60_000));
  return accepted;
}

// A new single-use link for the account; the ones before it stop working.
async function issueResetLink(deps: AuthDeps, userId: string, now: Date): Promise<string> {
  const token = generateToken();
  await deps.db.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({
      where: { userId, used: false },
      data: { used: true },
    });
    await tx.passwordResetToken.create({
      data: {
        token: hashToken(token),
        userId,
        expiresAt: new Date(now.getTime() + RESET_TTL_MS),
      },
    });
  });
  return `${deps.appUrl()}/reset-password?token=${token}`;
}

// ── Signed in: a reset link for the account's own address ─────────────────────
// Profile's "Reset password". The account is the session's, never an address
// the browser sends, so there is nothing to enumerate and the answer can be
// plain: no password to reset (a Google-only account), the hourly limit, or
// whether the email service accepted the message. Accepted is not delivered,
// and the page says so. The same throttle as the public request counts it.

export type OwnResetResult =
  | { ok: true; email: string; accepted: boolean }
  | { ok: false; reason: "no_account" | "no_password" | "limited"; google?: boolean; retryAfterSeconds?: number };

export async function requestOwnPasswordReset(userId: string, options: ResetOptions = {}): Promise<OwnResetResult> {
  const { deps = defaultAuthDeps, now = new Date() } = options;
  const user = await deps.db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, password: true, accounts: { where: { provider: "google" }, select: { provider: true } } },
  });
  if (!user) return { ok: false, reason: "no_account" };
  if (!user.password) return { ok: false, reason: "no_password", google: (user.accounts?.length ?? 0) > 0 };

  const limit = await consumeThrottle(deps.db, RESET_REQUESTS, user.email, now);
  if (!limit.allowed) return { ok: false, reason: "limited", retryAfterSeconds: limit.retryAfterSeconds };

  const resetUrl = await issueResetLink(deps, user.id, now);
  let accepted = false;
  try { accepted = await deps.sendEmail(passwordResetEmail(user.email, user.name, resetUrl, RESET_TTL_MS / 60_000)); }
  catch { console.error("[PASSWORD RESET] The email could not be sent."); }
  return { ok: true, email: user.email, accepted };
}

// The reply never waits for the email, and never says whether it went: that
// would tell a caller the address has an account. A failure is logged here
// (without the address or the link) so it can be found.
function sendInBackground(deps: AuthDeps, email: Parameters<AuthDeps["sendEmail"]>[0]) {
  void deps.sendEmail(email).then(
    (accepted) => { if (!accepted) console.error("[PASSWORD RESET] The email was not accepted by the provider."); },
    () => { console.error("[PASSWORD RESET] The email could not be sent."); },
  );
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
