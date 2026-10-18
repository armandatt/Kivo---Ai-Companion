"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { AuthAwareLink } from "@/components/auth-aware-link"
import { Check } from "@phosphor-icons/react/dist/ssr"

// What Kivo costs today: nothing. There is no payment or plan code, so this
// section names no price, tier or trial. Change it only when those exist.
const INCLUDED = [
  "Today's plan, the Planner and your task board",
  "Focus sessions, with reviews when they are due",
  "Notes, Knowledge and the Knowledge Map",
  "Progress and Learning DNA",
  "Nova on the web, and on Telegram if you connect it",
]

export function Pricing() {
  const [isVisible, setIsVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry && entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.1 },
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  return (
    <section
      id="pricing"
      ref={ref}
      className="py-24 border-t border-[var(--color-baltic-sea-900)] overflow-hidden"
      style={{ background: '#060810' }}
    >
      <div className="mx-auto max-w-[1400px] px-2.5 sm:px-6 lg:px-12">
        <div
          className={`mx-auto grid max-w-4xl gap-10 rounded-2xl border border-[var(--color-baltic-sea-800)] bg-[var(--color-baltic-sea-950)] p-8 transition-all duration-700 md:grid-cols-[1fr_1.1fr] lg:p-12 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
          }`}
          style={{ boxShadow: "var(--bento-shadow)" }}
        >
          <div>
            <span className="text-sm font-medium text-[var(--color-keppel-400)] uppercase tracking-wider">Pricing</span>
            <h2 className="mt-3 text-3xl font-bold text-[var(--color-baltic-sea-100)] md:text-4xl text-balance">
              Free to use
            </h2>
            <p className="mt-4 text-[var(--color-baltic-sea-400)]">
              Kivo has no paid plans today. There is nothing to upgrade and no card to enter.
            </p>
            <Button
              asChild
              className="mt-8 h-11 rounded-full bg-[var(--color-keppel-400)] px-6 font-semibold text-[var(--color-keppel-950)] hover:bg-[var(--color-keppel-300)]"
            >
              <AuthAwareLink>Start with Kivo</AuthAwareLink>
            </Button>
          </div>

          <div>
            <p className="text-sm font-medium text-[var(--color-baltic-sea-200)]">Everything in Kivo, including</p>
            <ul className="mt-4 space-y-3">
              {INCLUDED.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm">
                  <Check weight="bold" className="h-5 w-5 shrink-0 text-[var(--color-keppel-400)]" />
                  <span className="text-[var(--color-baltic-sea-300)]">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
