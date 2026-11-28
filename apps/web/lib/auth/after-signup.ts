// Where a new account goes once it has finished onboarding, when it arrived
// wanting somewhere (first-time map onboarding, 28 Nov): someone sent a .kivo
// opens /map/import signed out, is asked to sign in, creates an account
// instead, answers the quiz, and lands back on the import page, not in Build
// with Nova. Only an internal page path is kept (never a URL, never the API
// or the auth pages), in this tab's sessionStorage, so it survives the email
// code and the Google round trip in the same tab. Nothing secret is kept.

const KEY = 'kivo-after-signup'

/** An internal page path, or null. */
export function safeInternalPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string' || raw.length > 300) return null
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.includes('://')) return null
  if (/^\/(api|signin|signup|onboarding|forgot-password|reset-password)(\/|\?|$)/.test(raw)) return null
  return raw
}

export function rememberAfterSignup(raw: string | null | undefined): void {
  const path = safeInternalPath(raw)
  if (!path) return
  try { window.sessionStorage.setItem(KEY, path) } catch { /* storage unavailable */ }
}

/** The remembered destination, once (it is cleared as it is read). */
export function takeAfterSignup(): string | null {
  try {
    const v = safeInternalPath(window.sessionStorage.getItem(KEY))
    window.sessionStorage.removeItem(KEY)
    return v
  } catch { return null }
}

// A first-time account with no destination of its own starts here: import a
// map, or build one with Nova.
export const FIRST_MAP_PATH = '/map'
