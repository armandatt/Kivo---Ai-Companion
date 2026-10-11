// ─── Auth: input rules ────────────────────────────────────────────────────────
// Pure, no imports: the web app uses these for the same checks the API makes.
//
// These are syntax rules only. They say an address is well formed, never that
// the person typing it owns it; ownership is what the emailed code proves.

export const MAX_EMAIL_LENGTH = 254;
export const MAX_NAME_LENGTH = 100;
export const PASSWORD_MIN_LENGTH = 8;
// bcrypt reads only the first 72 bytes of a password. A longer one is refused
// rather than silently truncated.
export const PASSWORD_MAX_BYTES = 72;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GMAIL_SHAPE = /^[a-z0-9](?:[a-z0-9.+_-]*[a-z0-9])?@gmail\.com$/;

/** Trimmed and lower-cased, or null when it is not an email address at all. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return null;
  return EMAIL_SHAPE.test(email) ? email : null;
}

/** True for a normalized address at gmail.com. Takes the output of normalizeEmail. */
export function isGmailAddress(email: string): boolean {
  return GMAIL_SHAPE.test(email) && !email.includes("..");
}

/** The reason a password is not acceptable, or null when it is. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return `Password must be at most ${PASSWORD_MAX_BYTES} characters`;
  }
  return null;
}

export function normalizeName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.trim().slice(0, MAX_NAME_LENGTH);
  return name.length > 0 ? name : null;
}
