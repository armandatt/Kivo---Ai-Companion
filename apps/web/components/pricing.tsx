"use client"

import { Button } from "@/components/ui/button"
import { AuthAwareLink } from "@/components/auth-aware-link"
import { Check, Lightning } from "@phosphor-icons/react/dist/ssr"
import { Reveal } from "@/components/landing/frame"
import { PLANS, formatPrice, intervalLabel, type PlanDefinition } from "@repo/api/billing/plans"

// The three plans, side by side, from the one plan list (packages/api billing
// plans), so this page cannot promise what checkout does not sell. A plan
// that is not enabled yet is shown as coming and has no button to buy it.
const CARDS: Array<{ plan: PlanDefinition; mark: string; highlighted: boolean; cta: string; href: string }> = [
  { plan: PLANS.free,        mark: "🥚", highlighted: false, cta: "Start free",              href: "/signup" },
  { plan: PLANS.pro_monthly, mark: "🐉", highlighted: true,  cta: "Start 7-day free trial",  href: "/signup?plan=pro_monthly" },
  { plan: PLANS.pro_annual,  mark: "🌍", highlighted: false, cta: "Not available yet",       href: "/signup?plan=pro_annual" },
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
            Start free. Add Pro when Nova is part of every day.
          </h2>
          <p className="mt-4 text-lg text-[var(--color-baltic-sea-400)]">
            Everything in Kivo is free, with a daily Nova allowance. Pro raises it.
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
              {highlighted && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-[var(--color-keppel-400)] text-[var(--color-keppel-950)] text-xs font-semibold rounded-full flex items-center gap-1"
                >
                  <Lightning weight="fill" className="h-3 w-3" />
                  Most popular
                </div>
              )}

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

        <p className="text-center text-sm text-[var(--color-baltic-sea-500)] mt-10">
          No card needed for the trial · Prices in US dollars · Your notes stay yours on every plan
        </p>
      </div>
    </section>
  )
}
