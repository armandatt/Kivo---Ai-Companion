// Kivo's public links, in one place: the footer, the Kivo Connect guide and
// anything else that names a way to reach Kivo read them from here.
//
// Only real, verified addresses go here. A social account Kivo has not given
// yet stays `null` and is simply not shown; nothing is invented to fill a gap.

import { LEGAL_CONTACT } from '@/components/legal/to-confirm'

// The address Kivo already publishes in its Terms and Privacy Policy.
export const CONTACT_EMAIL = LEGAL_CONTACT

export type SocialKey = 'x' | 'linkedin' | 'instagram' | 'youtube' | 'github' | 'telegram'

export interface SocialLink { key: SocialKey; label: string; url: string | null }

// To add one: put its full https address here. Until then it is not shown.
//   x          Kivo's X (Twitter) profile
//   linkedin   Kivo's LinkedIn company page
//   instagram  Kivo's Instagram profile
//   youtube    Kivo's YouTube channel (e.g. for the product demo)
//   github     a public Kivo GitHub organisation, if there is one
//   telegram   a public Kivo channel or community (not Nova's bot)
export const SOCIAL_LINKS: SocialLink[] = [
  { key: 'x',         label: 'Kivo on X',         url: null },
  { key: 'linkedin',  label: 'Kivo on LinkedIn',  url: null },
  { key: 'instagram', label: 'Kivo on Instagram', url: null },
  { key: 'youtube',   label: 'Kivo on YouTube',   url: null },
  { key: 'github',    label: 'Kivo on GitHub',    url: null },
  { key: 'telegram',  label: 'Kivo on Telegram',  url: null },
]

// A link is shown only when it is a plain https address.
export function isSafeExternal(url: string | null | undefined): url is string {
  if (!url) return false
  try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password } catch { return false }
}

export const visibleSocialLinks = (links: SocialLink[] = SOCIAL_LINKS) => links.filter((l): l is SocialLink & { url: string } => isSafeExternal(l.url))

// Kivo's own pages that the footer's Connect column links to. (The Chrome
// Web Store listing is shown only through components/extension/store-button.tsx.)
export const PRODUCT_LINKS = {
  kivoConnect: '/integrations/kivo-connect',  // the public MCP setup guide
} as const
