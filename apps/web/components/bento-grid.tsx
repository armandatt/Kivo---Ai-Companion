"use client"

import type React from "react"

import { BentoCard } from "./bento-card"
import {
  Brain,
  Globe,
  Fire,
  Egg,
  ChartLineUp,
  ChatCircleText,
  ArrowsOutCardinal,
} from "@phosphor-icons/react/dist/ssr"
import { useEffect, useRef, useState } from "react"

function AnimatedCard({
  children,
  delay = 0,
  direction = "up",
  className = "",
}: {
  children: React.ReactNode
  delay?: number
  direction?: "up" | "left" | "right"
  className?: string
}) {
  const [isVisible, setIsVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry && entry.isIntersecting) {
          setTimeout(() => setIsVisible(true), delay)
          observer.disconnect()
        }
      },
      { threshold: 0.1 },
    )

    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [delay])

  const translateClass = {
    up: "translate-y-8",
    left: "translate-x-8",
    right: "-translate-x-8",
  }[direction]

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${className} ${
        isVisible ? "opacity-100 translate-x-0 translate-y-0" : `opacity-0 ${translateClass}`
      }`}
    >
      {children}
    </div>
  )
}

export function BentoGrid() {
  return (
    <section id="product" className="py-24" style={{ background: '#060810' }}>
      <div className="mx-auto max-w-[1400px] px-2.5 sm:px-6 lg:px-12">
        <AnimatedCard delay={0} direction="up">
          <div className="mb-16 max-w-2xl">
            <span className="text-sm font-medium text-[var(--color-keppel-400)] uppercase tracking-wider">
              Capabilities
            </span>
            <h2 className="mt-3 text-3xl font-bold text-[var(--color-baltic-sea-100)] md:text-4xl">
              Everything your companion does for you
            </h2>
            <p className="mt-4 text-lg text-[var(--color-baltic-sea-400)]">
              Built around how real people stay consistent — not how productivity apps think they should.
            </p>
          </div>
        </AnimatedCard>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-12 md:auto-rows-[180px]">

          {/* Primary — tall left card */}
          <AnimatedCard delay={100} direction="left" className="min-h-[280px] md:min-h-0 md:col-span-4 md:row-span-2">
            <BentoCard className="flex flex-col h-full">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-keppel-900)]">
                <Brain weight="duotone" className="h-6 w-6 text-[var(--color-keppel-400)]" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-[var(--color-baltic-sea-100)]">Long-term memory</h3>
              <p className="mt-2 text-sm text-[var(--color-baltic-sea-400)] flex-1">
                Your companion remembers everything — your PRs, your exam dates, your bad weeks. It references your history unprompted. Feels like talking to someone who actually knows you.
              </p>
              <div className="mt-auto pt-6 flex items-end gap-1">
                {[3, 5, 4, 7, 6, 8, 7, 9, 8, 10].map((val, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t bg-[var(--color-keppel-700)]"
                    style={{ height: `${val * 5}px` }}
                  />
                ))}
              </div>
              <p className="mt-2 text-xs text-[var(--color-baltic-sea-500)]">memory depth over 10 weeks</p>
            </BentoCard>
          </AnimatedCard>

          {/* Top right wide */}
          <AnimatedCard delay={200} direction="up" className="min-h-[160px] md:min-h-0 md:col-span-5">
            <BentoCard className="flex flex-col h-full">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-baltic-sea-800)]">
                <Globe weight="duotone" className="h-5 w-5 text-[var(--color-keppel-400)]" />
              </div>
              <h3 className="mt-3 text-base font-semibold text-[var(--color-baltic-sea-100)]">WhatsApp + Telegram</h3>
              <p className="mt-1 text-sm text-[var(--color-baltic-sea-400)]">
                No app to download. Your companion lives where you already are — messaging you first, every single day.
              </p>
            </BentoCard>
          </AnimatedCard>

          {/* Top far right — stat */}
          <AnimatedCard delay={300} direction="right" className="hidden md:block min-h-[160px] md:min-h-0 md:col-span-3">
            <BentoCard className="flex flex-col items-center justify-center text-center h-full">
              <div className="text-4xl font-bold text-[var(--color-keppel-400)]">84%</div>
              <div className="mt-1 text-sm text-[var(--color-baltic-sea-500)]">daily return rate</div>
            </BentoCard>
          </AnimatedCard>

          {/* Middle left */}
          <AnimatedCard delay={400} direction="left" className="min-h-[160px] md:min-h-0 md:col-span-3">
            <BentoCard className="flex flex-col h-full">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-baltic-sea-800)]">
                <Fire weight="duotone" className="h-5 w-5 text-[var(--color-keppel-400)]" />
              </div>
              <h3 className="mt-3 text-base font-semibold text-[var(--color-baltic-sea-100)]">Streak tracking</h3>
              <p className="mt-1 text-sm text-[var(--color-baltic-sea-400)]">
                Miss a day and your companion calls it out — honestly, not harshly. Hit 30 days and your world transforms.
              </p>
            </BentoCard>
          </AnimatedCard>

          {/* Middle wide — with badge */}
          <AnimatedCard delay={500} direction="up" className="min-h-[160px] md:min-h-0 md:col-span-5">
            <BentoCard className="flex flex-col h-full">
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-baltic-sea-800)]">
                  <Egg weight="duotone" className="h-5 w-5 text-[var(--color-keppel-400)]" />
                </div>
                <span className="text-xs font-medium text-[var(--color-keppel-400)] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--color-keppel-950)] border border-[var(--color-keppel-800)]">
                  Living
                </span>
              </div>
              <h3 className="mt-3 text-base font-semibold text-[var(--color-baltic-sea-100)]">
                A creature that evolves with you
              </h3>
              <p className="mt-1 text-sm text-[var(--color-baltic-sea-400)]">
                Hatches on day 3, grows with every check-in, dims when you disappear. It's not a gamification trick — it's a relationship.
              </p>
            </BentoCard>
          </AnimatedCard>

          {/* Bottom 3 equal */}
          <AnimatedCard delay={600} direction="up" className="min-h-[160px] md:min-h-0 md:col-span-4">
            <BentoCard className="flex flex-col h-full">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-baltic-sea-800)]">
                <ChartLineUp weight="duotone" className="h-5 w-5 text-[var(--color-keppel-400)]" />
              </div>
              <h3 className="mt-3 text-base font-semibold text-[var(--color-baltic-sea-100)]">
                Weekly intelligence report
              </h3>
              <p className="mt-1 text-sm text-[var(--color-baltic-sea-400)]">
                Every Sunday — a personalised AI breakdown of your week. Patterns, wins, what to fix next. Feels premium.
              </p>
            </BentoCard>
          </AnimatedCard>

          <AnimatedCard delay={700} direction="up" className="min-h-[160px] md:min-h-0 md:col-span-4">
            <BentoCard className="flex flex-col h-full">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-baltic-sea-800)]">
                <ChatCircleText weight="duotone" className="h-5 w-5 text-[var(--color-keppel-400)]" />
              </div>
              <h3 className="mt-3 text-base font-semibold text-[var(--color-baltic-sea-100)]">
                3 distinct personas
              </h3>
              <p className="mt-1 text-sm text-[var(--color-baltic-sea-400)]">
                Coach Rex, Study Nova, Grind Vera. Each has a locked voice, tone, and style. Yours is chosen by the quiz — not a settings menu.
              </p>
            </BentoCard>
          </AnimatedCard>

          <AnimatedCard delay={800} direction="up" className="min-h-[160px] md:min-h-0 md:col-span-4">
            <BentoCard className="flex flex-col h-full">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-baltic-sea-800)]">
                <ArrowsOutCardinal weight="duotone" className="h-5 w-5 text-[var(--color-keppel-400)]" />
              </div>
              <h3 className="mt-3 text-base font-semibold text-[var(--color-baltic-sea-100)]">Buddy challenges</h3>
              <p className="mt-1 text-sm text-[var(--color-baltic-sea-400)]">
                Invite a friend. Both companions compete on your behalf. "Your friend just hit session 4 — you're on 2. Everything okay?"
              </p>
            </BentoCard>
          </AnimatedCard>

        </div>
      </div>
    </section>
  )
}