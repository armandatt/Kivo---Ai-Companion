import { KivoLogo } from "@/components/KivoLogo"
import { KivoWordmark } from "@/components/brand/kivo-brand"
import { GithubLogo, InstagramLogo, LinkedinLogo, TelegramLogo, XLogo, YoutubeLogo } from "@phosphor-icons/react/dist/ssr"
import type { Icon } from "@phosphor-icons/react"
import { CONTACT_EMAIL, PRODUCT_LINKS, visibleSocialLinks, type SocialKey } from "@/lib/site-links"

// Kivo's social accounts and contact address come from lib/site-links.ts;
// one with no address yet is not shown.
const SOCIAL_ICONS: Record<SocialKey, Icon> = { x: XLogo, linkedin: LinkedinLogo, instagram: InstagramLogo, youtube: YoutubeLogo, github: GithubLogo, telegram: TelegramLogo }

export function Footer() {
  return (
    <footer
      className="border-t border-[var(--color-baltic-sea-900)] py-16"
      style={{ background: '#060810' }}
    >
      <div className="mx-auto max-w-[1400px] px-2.5 sm:px-6 lg:px-12">
        <div className="flex flex-col gap-12 lg:flex-row lg:justify-between">

          {/* Brand column */}
          <div className="lg:max-w-xs">
            <div className="flex items-center gap-3">
              <KivoLogo size={38} />
              <KivoWordmark height={22} className="text-[var(--color-baltic-sea-100)]" />
            </div>
            <p className="mt-4 text-sm text-[var(--color-baltic-sea-500)]">
              An AI-powered learning OS: plan it, map it, understand it and build on it, with Nova beside you.
            </p>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:gap-16">
            <div>
              <h4 className="text-sm font-medium text-[var(--color-baltic-sea-200)]">Product</h4>
              <ul className="mt-4 space-y-3">
                {[{ label: "Knowledge Map", href: "/#map" }, { label: "Build with Nova", href: "/#build" }, { label: "Notes", href: "/#notes" }, { label: "Today", href: "/#workspace" }, { label: "Pricing", href: "/#pricing" }].map((item) => (
                  <li key={item.href}>
                    <a href={item.href} className="text-sm text-[var(--color-baltic-sea-500)] hover:text-[var(--color-keppel-400)] transition-colors">{item.label}</a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-medium text-[var(--color-baltic-sea-200)]">Account</h4>
              <ul className="mt-4 space-y-3">
                {[{ label: "Sign up", href: "/signup" }, { label: "Sign in", href: "/signin" }].map((item) => (
                  <li key={item.href}>
                    <a href={item.href} className="text-sm text-[var(--color-baltic-sea-500)] hover:text-[var(--color-keppel-400)] transition-colors">{item.label}</a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-medium text-[var(--color-baltic-sea-200)]">Help</h4>
              <ul className="mt-4 space-y-3">
                <li>
                  <a href={`mailto:${CONTACT_EMAIL}`} className="text-sm text-[var(--color-baltic-sea-500)] hover:text-[var(--color-keppel-400)] transition-colors">Contact us</a>
                </li>
                <li>
                  <a href={PRODUCT_LINKS.kivoConnect} className="text-sm text-[var(--color-baltic-sea-500)] hover:text-[var(--color-keppel-400)] transition-colors">Connect Claude or ChatGPT</a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-medium text-[var(--color-baltic-sea-200)]">Legal</h4>
              <ul className="mt-4 space-y-3">
                {/* Full page loads, not client navigation: the legal pages set
                    the reader's theme before they paint. */}
                {[{ label: "Privacy", href: "/privacy" }, { label: "Terms", href: "/terms" }].map((item) => (
                  <li key={item.href}>
                    <a href={item.href} className="text-sm text-[var(--color-baltic-sea-500)] hover:text-[var(--color-keppel-400)] transition-colors">{item.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-[var(--color-baltic-sea-900)] flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-xs text-[var(--color-baltic-sea-600)]">© {new Date().getFullYear()} Kivo. All rights reserved.</span>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-xs text-[var(--color-baltic-sea-500)] hover:text-[var(--color-keppel-400)] transition-colors">{CONTACT_EMAIL}</a>
            {visibleSocialLinks().length > 0 && (
              <ul className="flex items-center gap-1" aria-label="Kivo on social media">
                {visibleSocialLinks().map(l => {
                  const Glyph = SOCIAL_ICONS[l.key]
                  return (
                    <li key={l.key}>
                      <a href={l.url} target="_blank" rel="noopener noreferrer" aria-label={l.label}
                        className="flex size-9 items-center justify-center rounded-lg text-[var(--color-baltic-sea-500)] transition-colors hover:bg-white/5 hover:text-[var(--color-keppel-400)] focus-visible:outline-2 focus-visible:outline-[var(--color-keppel-400)]">
                        <Glyph aria-hidden className="size-[18px]" />
                      </a>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </footer>
  )
}