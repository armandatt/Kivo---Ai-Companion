// Where people install Kivo's browser extension. The one place the Chrome
// Web Store address lives: every install button, help line and onboarding
// step reads CHROME_STORE_URL from here.
//
// The listing is LISTING below (live and checked 12 Nov 2026: "Nova",
// version 1.2.0). NEXT_PUBLIC_CHROME_STORE_URL (read at build time) replaces
// it if set. Either way only a real listing address is accepted:
//   https://chromewebstore.google.com/detail/<name>/<32-letter extension id>
// Anything else (unset, a typo, a search page, a dev address) is null, and the
// buttons say the store link is on its way instead of sending people to a
// dead or wrong page. The extension is listed under the name "Nova".

const STORE_HOST = 'chromewebstore.google.com'

// A Chrome extension id: 32 letters, a to p.
const isExtensionId = (s: string) => s.length === 32 && [...s].every(c => c >= 'a' && c <= 'p')

// The listing address, tidied (no query, fragment or trailing slash), or null. Pure.
export function chromeStoreUrl(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 300) return null
  let u: URL
  try { u = new URL(raw.trim()) } catch { return null }
  if (u.protocol !== 'https:' || u.hostname !== STORE_HOST || u.username || u.password || u.port) return null
  const parts = u.pathname.split('/').filter(Boolean)
  // /detail/<id> or /detail/<name>/<id>
  if (parts[0] !== 'detail' || parts.length < 2 || parts.length > 3) return null
  const id = parts[parts.length - 1]!
  if (!isExtensionId(id)) return null
  return `https://${STORE_HOST}/${parts.join('/')}`
}

export const LISTING = 'https://chromewebstore.google.com/detail/nova/eddopegjkjiadejiocfbhoecjlbfcjba'

export const CHROME_STORE_URL: string | null = chromeStoreUrl(process.env.NEXT_PUBLIC_CHROME_STORE_URL) ?? chromeStoreUrl(LISTING)

// What the store lists the extension as, so people recognise it there.
export const STORE_LISTING_NAME = 'Nova'
