// ─── Auth: codes and tokens ───────────────────────────────────────────────────
// Everything random here comes from node:crypto. Nothing in this file is ever
// logged, and only hashes are stored.

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";

export const OTP_LENGTH = 8;

/** An eight-digit code, uniformly distributed, leading zeros kept. */
export function generateOtp(): string {
  return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
}

export function isOtpShaped(code: unknown): code is string {
  return typeof code === "string" && new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code);
}

/**
 * The server secret (JWT_SECRET). In production a missing secret is an error,
 * never a default: a known secret would let anyone forge what it protects.
 */
export function serverSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is not set");
  }
  return "fallback-dev-secret-change-in-production";
}

// A short code has too few values for a plain hash to protect it, so it is
// keyed with the server secret and bound to the address it was sent to.
export function hashOtp(email: string, code: string): string {
  return createHmac("sha256", serverSecret()).update(`signup-otp:${email}:${code}`).digest("hex");
}

/** A 256-bit token, as 64 hex characters. Stored only as hashToken(). */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function isTokenShaped(token: unknown): token is string {
  return typeof token === "string" && /^[0-9a-f]{64}$/.test(token);
}

/** SHA-256 of a 256-bit random token, which needs no key or salt. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison of two strings. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** URL-safe random value for the OAuth state and nonce. */
export function randomUrlToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The key of a persisted limit: a hash, so the table holds no addresses. */
export function throttleKey(scope: string, subject: string): string {
  return createHash("sha256").update(`${scope}:${subject}`).digest("hex");
}

// What the web app sends with a forwarded auth request to show it is the web
// app. Derived from the secret both apps already share, so there is nothing
// extra to configure, and the secret itself never travels.
export function proxyProof(): string {
  return createHmac("sha256", serverSecret()).update("kivo-auth-proxy-v1").digest("hex");
}
