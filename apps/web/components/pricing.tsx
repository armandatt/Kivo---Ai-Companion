"use client"

import { Button } from "@/components/ui/button"
import { AuthAwareLink } from "@/components/auth-aware-link"
import { Check } from "@phosphor-icons/react/dist/ssr"
import { Reveal } from "@/components/landing/frame"
import { PLANS, formatPrice, intervalLabel, type PlanDefinition } from "@repo/api/billing/plans"
import { DEFAULT_ALLOWANCES } from "@repo/api/billing/accounting/rules"

// The three plans, side by side, from the one plan list (packages/api billing
// plans), so this page cannot promise what checkout does not sell. A plan
// that is not enabled yet is shown as coming and has no button to buy it.
const CARDS: Array<{ plan: PlanDefinition; mark: string; highlighted: boolean; cta: string; href: string }> = [
  { plan: PLANS.free,         mark: "🥚", highlighted: false, cta: "Start free",              href: "/signup" },
  { plan: PLANS.plus_monthly, mark: "🐣", highlighted: false, cta: "Choose Plus",             href: "/signup?plan=plus_monthly" },
  { plan: PLANS.pro_monthly,  mark: "🐉", highlighted: true,  cta: "Choose Pro",              href: "/signup?plan=pro_monthly" },
]

export function Pricing() {
  return (
    <section
      id="pricing"
      className="scroll-mt-20 py-24 sm:py-32 border-t border-[var(--color-baltic-sea-900)] overflow-hidden"
      style={{ background: "#060810" }}
    >
      <div className="mx-auto max-w-[1400px] px-2.5 sm:px-6 lg:px-12">
        <Reveal className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-sm font-medium text-[var(--color-keppel-400)] uppercase tracking-wider">Pricing</span>
          <h2 className="mt-3 text-3xl font-bold text-[var(--color-baltic-sea-100)] md:text-4xl text-balance">
            Start free. Add Plus or Pro when Nova is part of every day.
          </h2>
          <p className="mt-4 text-lg text-[var(--color-baltic-sea-400)]">
            Your notes, maps and plans are free on every plan. Plus and Pro add more Nova, the browser agent and ChatGPT and Claude.
          </p>
        </Reveal>

        <Reveal className="grid md:grid-cols-3 gap-6 lg:gap-8 items-end">
          {CARDS.map(({ plan, mark, highlighted, cta, href }) => (
            <div
              key={plan.key}
              className={`relative rounded-2xl border transition-transform duration-300 ease-out hover:-translate-y-1 ${
                highlighted
                  ? "border-[var(--color-keppel-700)] bg-gradient-to-b from-[var(--color-keppel-950)] to-[var(--color-baltic-sea-950)] md:-translate-y-4"
                  : "border-[var(--color-baltic-sea-800)] bg-[var(--color-baltic-sea-950)]"
              } ${plan.enabled ? "" : "opacity-80"}`}
              style={{
                boxShadow: highlighted ? "0 0 60px -20px var(--color-keppel-700)" : "var(--bento-shadow)",
              }}
            >

              <div className="p-6 lg:p-8">
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-2xl" aria-hidden>{mark}</span>
                  <h3 className="text-lg font-semibold text-[var(--color-baltic-sea-100)]">{plan.name}</h3>
                  {!plan.enabled && (
                    <span className="ml-auto rounded-full border border-[var(--color-baltic-sea-700)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-baltic-sea-400)]">Coming soon</span>
                  )}
                </div>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-[var(--color-baltic-sea-100)]">{plan.enabled ? formatPrice(plan) : "Soon"}</span>
                  {plan.enabled && <span className="text-[var(--color-baltic-sea-500)]">{intervalLabel(plan)}</span>}
                </div>
                <p className="mt-2 text-sm text-[var(--color-baltic-sea-400)]">{plan.tagline}</p>

                {plan.enabled ? (
                  <Button
                    asChild
                    className={`w-full mt-6 rounded-full h-11 transition-all duration-300 ${
                      highlighted
                        ? "bg-[var(--color-keppel-400)] text-[var(--color-keppel-950)] hover:bg-[var(--color-keppel-300)] hover:shadow-[0_0_20px_-5px_var(--color-keppel-400)]"
                        : "bg-[var(--color-baltic-sea-800)] text-[var(--color-baltic-sea-200)] hover:bg-[var(--color-baltic-sea-700)]"
                    }`}
                  >
                    {/* Signed in, the plan's button goes to the account's billing page. */}
                    <AuthAwareLink loggedOutHref={href} loggedInHref={plan.priceMinor === 0 ? "/home" : `/settings/billing?plan=${plan.key}`}>{cta}</AuthAwareLink>
                  </Button>
                ) : (
                  <Button disabled className="w-full mt-6 rounded-full h-11 bg-[var(--color-baltic-sea-900)] text-[var(--color-baltic-sea-500)]">
                    {cta}
                  </Button>
                )}

                <ul className="mt-8 space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-sm">
                      <Check
                        weight="bold"
                        className={`h-5 w-5 shrink-0 ${highlighted ? "text-[var(--color-keppel-400)]" : "text-[var(--color-baltic-sea-500)]"}`}
                      />
                      <span className="text-[var(--color-baltic-sea-300)]">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </Reveal>

        <Compare />

        <p className="text-center text-sm text-[var(--color-baltic-sea-500)] mt-10">
          Free needs no card · Plus in Indian rupees, Pro in US dollars · Your notes stay yours on every plan
        </p>
      </div>
    </section>
  )
}

// The plans side by side, from the allowance table the accounting uses
// (billing/accounting/rules.ts), so the page and the limits cannot disagree.
// Fair use is written as fair use: no plan is unlimited.
const size = (b: number) => b >= 1_000_000_000 ? `${(b / 1_000_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })} GB` : `${Math.round(b / 1_000_000)} MB`
const T = DEFAULT_ALLOWANCES
const ROWS: Array<{ name: string; note?: string; free: string; plus: string; pro: string }> = [
  { name: "Nova credits a month", note: "A usual request is about one credit; bigger jobs use more", free: T.free.novaCredits.toLocaleString("en-US"), plus: T.plus.novaCredits.toLocaleString("en-US"), pro: T.pro.novaCredits.toLocaleString("en-US") },
  { name: "Browser-agent tasks a month", note: "One task however many steps it takes", free: String(T.free.browserTasks), plus: String(T.plus.browserTasks), pro: String(T.pro.browserTasks) },
  { name: "Images and attachments", free: size(T.free.storageBytes), plus: size(T.plus.storageBytes), pro: size(T.pro.storageBytes) },
  { name: "ChatGPT and Claude", note: "Fair use still limits very heavy or automated use", free: `${(T.free.mcpLifetime ?? 0).toLocaleString("en-US")} calls, then ${T.free.mcpReadOnly ?? 0} reads a month`, plus: "Fair use", pro: "Fair use" },
  { name: "Progress and Learning DNA", free: "Included in full", plus: "Included in full", pro: "Included in full" },
  { name: "Notes, Knowledge Maps, planner and focus", free: "Included", plus: "Included", pro: "Included" },
]

function Compare() {
  return (
    <div className="mt-14 overflow-x-auto rounded-2xl border border-[var(--color-baltic-sea-800)] bg-[var(--color-baltic-sea-950)]">
      <table className="w-full min-w-[560px] text-sm">
        <caption className="sr-only">What each plan includes</caption>
        <thead>
          <tr className="border-b border-[var(--color-baltic-sea-800)] text-left text-[var(--color-baltic-sea-400)]">
            <th scope="col" className="px-5 py-3 font-medium">Compare plans</th>
            <th scope="col" className="px-5 py-3 font-medium">Free</th>
            <th scope="col" className="px-5 py-3 font-medium">Plus{PLANS.plus_monthly.enabled ? "" : " · soon"}</th>
            <th scope="col" className="px-5 py-3 font-medium">Pro</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-baltic-sea-900)]">
          {ROWS.map(r => (
            <tr key={r.name}>
              <th scope="row" className="px-5 py-3 text-left font-normal text-[var(--color-baltic-sea-200)]">
                {r.name}
                {r.note && <span className="block text-xs text-[var(--color-baltic-sea-500)]">{r.note}</span>}
              </th>
              <td className="px-5 py-3 tabular-nums text-[var(--color-baltic-sea-300)]">{r.free}</td>
              <td className="px-5 py-3 tabular-nums text-[var(--color-baltic-sea-300)]">{r.plus}</td>
              <td className="px-5 py-3 tabular-nums text-[var(--color-baltic-sea-100)]">{r.pro}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
