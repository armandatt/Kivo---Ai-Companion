// ─── Agreeing to the Terms and acknowledging the Privacy Policy ──────────────
// Pure, no imports: the sign-up page, the API and the legal pages share it.
//
// A new account needs the learner's explicit agreement, given at sign-up: an
// unchecked box on the page, and here, on the server, the exact versions they
// were shown. The email sign-up checks it when the attempt starts (and keeps it
// on the attempt), and records it when the account is created; Google sign-up
// carries it through the sign-in round trip and records it the same way. An
// existing account is never asked again by this code: agreeing to a later
// version is a separate decision.
//
// A version is the date of the text it names. Change the text, change the
// version, and the date the pages show changes with it.

export const TERMS_VERSION = "2026-10-27";
export const PRIVACY_VERSION = "2026-10-27";

export interface LegalConsentInput { terms: string; privacy: string }

export const LEGAL_REQUIRED_MESSAGE = "Agree to the Terms of Service and acknowledge the Privacy Policy to create your account.";
export const LEGAL_OUTDATED_MESSAGE = "The Terms or the Privacy Policy changed while you were signing up. Reload the page, read them, and agree again.";

export type LegalConsentCheck = { ok: true; consent: LegalConsentInput } | { ok: false; message: string };

// What the sign-up request said. Only the current versions, named exactly,
// count as agreement; anything else is no agreement.
export function checkLegalConsent(input: unknown): LegalConsentCheck {
  if (!input || typeof input !== "object") return { ok: false, message: LEGAL_REQUIRED_MESSAGE };
  const { terms, privacy } = input as { terms?: unknown; privacy?: unknown };
  if (typeof terms !== "string" || typeof privacy !== "string") return { ok: false, message: LEGAL_REQUIRED_MESSAGE };
  if (terms !== TERMS_VERSION || privacy !== PRIVACY_VERSION) return { ok: false, message: LEGAL_OUTDATED_MESSAGE };
  return { ok: true, consent: { terms, privacy } };
}

// The value Google sign-up carries in its state cookie: "<terms>|<privacy>".
export const consentToken = (c: LegalConsentInput) => `${c.terms}|${c.privacy}`;
export function consentFromToken(token: string | undefined | null): LegalConsentInput | null {
  if (!token) return null;
  const [terms, privacy] = token.split("|");
  const checked = checkLegalConsent({ terms, privacy });
  return checked.ok ? checked.consent : null;
}

// How a consent was given, for the record.
export type ConsentMethod = "email_signup" | "google_signup";

// The rows Kivo keeps: who, which versions, when, and how. Nothing about the
// device or the network.
export function consentRecord(userId: string, consent: LegalConsentInput, at: Date, method: ConsentMethod) {
  return { userId, termsVersion: consent.terms, privacyVersion: consent.privacy, acceptedAt: at, method };
}
