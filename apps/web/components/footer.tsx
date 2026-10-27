import { KioLogo } from "@/components/KioLogo"
import { KioWordmark } from "@/components/brand/kio-brand"

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
              <KioLogo size={38} />
              <KioWordmark height={22} className="text-[var(--color-baltic-sea-100)]" />
            </div>
            <p className="mt-4 text-sm text-[var(--color-baltic-sea-500)]">
              An AI-powered learning OS: plan it, map it, understand it and build on it, with Nova beside you.
            </p>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:gap-16">
            <div>
              <h4 className="text-sm font-medium text-[var(--color-baltic-sea-200)]">Product</h4>
              <ul className="mt-4 space-y-3">
                {[{ label: "Knowledge Map", href: "/#map" }, { label: "Build with Nova", href: "/#build" }, { label: "Notes", href: "/#notes" }, { label: "Today", href: "/#today" }, { label: "Pricing", href: "/#pricing" }].map((item) => (
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
          <span className="text-xs text-[var(--color-baltic-sea-600)]">© {new Date().getFullYear()} Kio. All rights reserved.</span>
        </div>
      </div>
    </footer>
  )
}