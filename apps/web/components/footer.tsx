import { GithubLogo, TwitterLogo, InstagramLogo } from "@phosphor-icons/react/dist/ssr"
import { KivoLogo } from "@/components/KivoLogo"

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
              <span className="text-xl font-semibold text-[var(--color-baltic-sea-300)]">Kivo</span>
            </div>
            <p className="mt-4 text-sm text-[var(--color-baltic-sea-500)]">
              Your AI companion that grows with you. Built for people who actually want to show up — every day.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <a href="#" className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-baltic-sea-800)] hover:border-[var(--color-keppel-700)] hover:bg-[var(--color-keppel-950)] transition-colors">
                <TwitterLogo weight="fill" className="h-4 w-4 text-[var(--color-baltic-sea-500)]" />
              </a>
              <a href="#" className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-baltic-sea-800)] hover:border-[var(--color-keppel-700)] hover:bg-[var(--color-keppel-950)] transition-colors">
                <InstagramLogo weight="fill" className="h-4 w-4 text-[var(--color-baltic-sea-500)]" />
              </a>
              <a href="#" className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-baltic-sea-800)] hover:border-[var(--color-keppel-700)] hover:bg-[var(--color-keppel-950)] transition-colors">
                <GithubLogo weight="fill" className="h-4 w-4 text-[var(--color-baltic-sea-500)]" />
              </a>
            </div>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:gap-16">
            <div>
              <h4 className="text-sm font-medium text-[var(--color-baltic-sea-200)]">Product</h4>
              <ul className="mt-4 space-y-3">
                {["Features", "Pricing", "Changelog"].map((item) => (
                  <li key={item}>
                    <a href="#" className="text-sm text-[var(--color-baltic-sea-500)] hover:text-[var(--color-keppel-400)] transition-colors">{item}</a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-medium text-[var(--color-baltic-sea-200)]">Companions</h4>
              <ul className="mt-4 space-y-3">
                {["Coach Rex", "Study Nova", "Grind Vera"].map((item) => (
                  <li key={item}>
                    <a href="#" className="text-sm text-[var(--color-baltic-sea-500)] hover:text-[var(--color-keppel-400)] transition-colors">{item}</a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-medium text-[var(--color-baltic-sea-200)]">Company</h4>
              <ul className="mt-4 space-y-3">
                {["About", "Blog", "Careers"].map((item) => (
                  <li key={item}>
                    <a href="#" className="text-sm text-[var(--color-baltic-sea-500)] hover:text-[var(--color-keppel-400)] transition-colors">{item}</a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-medium text-[var(--color-baltic-sea-200)]">Legal</h4>
              <ul className="mt-4 space-y-3">
                {["Privacy", "Terms", "Security"].map((item) => (
                  <li key={item}>
                    <a href="#" className="text-sm text-[var(--color-baltic-sea-500)] hover:text-[var(--color-keppel-400)] transition-colors">{item}</a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-[var(--color-baltic-sea-900)] flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-xs text-[var(--color-baltic-sea-600)]">© 2025 Kivo. All rights reserved.</span>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[var(--color-keppel-400)] animate-pulse" />
            <span className="text-xs text-[var(--color-baltic-sea-500)]">🔥 2,847 active streaks right now</span>
          </div>
        </div>
      </div>
    </footer>
  )
}