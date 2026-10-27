// ─── Auth: what the services depend on ────────────────────────────────────────
// The database slice, the password hasher and the mailer, declared here so the
// tests can pass fakes (the pattern personality.service.ts uses).

import bcrypt from "bcrypt";
import { prisma } from "@repo/db/client";
import { sendAuthEmail, type SendAuthEmail } from "./auth-email";

export interface AuthUserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  password: string | null;
  emailVerified: Date | null;
  userProfile?: { onboardingComplete: boolean } | null;
  accounts?: Array<{ provider: string }>;
}

export interface PendingSignupRow {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string;
  tokenHash: string;
  codeHash: string;
  codeExpiresAt: Date;
  attempts: number;
  termsVersion?: string | null;
  privacyVersion?: string | null;
  consentedAt?: Date | null;
  createdAt: Date;
}

export interface ResetTokenRow {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

export interface AccountRow {
  id: string;
  userId: string;
  provider: string;
  providerAccountId: string;
  user?: AuthUserRow;
}

export interface ThrottleRow {
  key: string;
  count: number;
  windowStart: Date;
  lastAt: Date;
}

type Args = Record<string, unknown>;
type Count = { count: number };

// The slice of Prisma the auth services use.
export interface AuthDb {
  user: {
    findUnique(args: Args): Promise<AuthUserRow | null>;
    create(args: Args): Promise<AuthUserRow>;
    update(args: Args): Promise<AuthUserRow>;
  };
  account: {
    findUnique(args: Args): Promise<AccountRow | null>;
    create(args: Args): Promise<AccountRow>;
  };
  pendingSignup: {
    findUnique(args: Args): Promise<PendingSignupRow | null>;
    create(args: Args): Promise<PendingSignupRow>;
    updateMany(args: Args): Promise<Count>;
    deleteMany(args: Args): Promise<Count>;
  };
  passwordResetToken: {
    findUnique(args: Args): Promise<ResetTokenRow | null>;
    create(args: Args): Promise<ResetTokenRow>;
    updateMany(args: Args): Promise<Count>;
  };
  legalConsent: {
    create(args: Args): Promise<unknown>;
  };
  authThrottle: {
    findUnique(args: Args): Promise<ThrottleRow | null>;
    create(args: Args): Promise<ThrottleRow>;
    updateMany(args: Args): Promise<Count>;
    deleteMany(args: Args): Promise<Count>;
  };
  $transaction<T>(fn: (tx: AuthDb) => Promise<T>): Promise<T>;
}

export interface AuthDeps {
  db: AuthDb;
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, hash: string): Promise<boolean>;
  sendEmail: SendAuthEmail;
  /** Public URL of the web app, for links in emails. */
  appUrl(): string;
}

const BCRYPT_COST = 10;

export const defaultAuthDeps: AuthDeps = {
  db: prisma as unknown as AuthDb,
  hashPassword: (password) => bcrypt.hash(password, BCRYPT_COST),
  verifyPassword: (password, hash) => bcrypt.compare(password, hash),
  sendEmail: sendAuthEmail,
  appUrl: publicAppUrl,
};

let warnedNoAppUrl = false;

/**
 * Where the web app is, for links in emails: NEXT_PUBLIC_APP_URL without a
 * trailing slash. In production a missing value is logged (once), because
 * every link in a code, reset or account email would point at localhost.
 */
export function publicAppUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured && process.env.NODE_ENV === "production" && !warnedNoAppUrl) {
    warnedNoAppUrl = true;
    console.error("[AUTH] NEXT_PUBLIC_APP_URL is not set; links in auth emails will point at localhost.");
  }
  return (configured || "http://localhost:3000").replace(/\/+$/, "");
}

/** The session fields every sign-in path returns. Never includes the hash. */
export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export function toSessionUser(user: AuthUserRow): SessionUser {
  return { id: user.id, email: user.email, name: user.name, image: user.image };
}

export type AuthFailure = {
  ok: false;
  status: number;
  error: string;
  retryAfterSeconds?: number;
};

export function fail(status: number, error: string, retryAfterSeconds?: number): AuthFailure {
  return retryAfterSeconds ? { ok: false, status, error, retryAfterSeconds } : { ok: false, status, error };
}
