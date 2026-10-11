// The key session JWTs are signed and checked with. Read when it is needed,
// not when a file loads. In production a missing JWT_SECRET is an error: with
// a known default anyone could sign a session for any account.
export function sessionSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is not set")
  }
  return new TextEncoder().encode(secret ?? "fallback-dev-secret-change-in-production")
}
