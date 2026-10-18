"use client"

import type React from "react"

import { BentoCard } from "./bento-card"
import {
  CalendarCheck,
  Globe,
  ArrowsClockwise,
  Planet,
  Graph,
  ChartLineUp,
  Kanban,
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

// Every card describes something Kivo does today. No figures: nothing here is
// measured across users.
function Feature({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType
  title: string
  children: React.ReactNode
}) {
  return (
    <BentoCard className="flex flex-col h-full">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-baltic-sea-800)]">
        <Icon weight="duotone" className="h-5 w-5 text-[var(--color-keppel-400)]" />
      </div>
      <h3 className="mt-3 text-base font-semibold text-[var(--color-baltic-sea-100)]">{title}</h3>
      <p className="mt-1 text-sm text-[var(--color-baltic-sea-400)]">{children}</p>
    </BentoCard>
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
              What Kivo does for you
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
                <CalendarCheck weight="duotone" className="h-6 w-6 text-[var(--color-keppel-400)]" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-[var(--color-baltic-sea-100)]">A plan for today</h3>
              <p className="mt-2 text-sm text-[var(--color-baltic-sea-400)] flex-1">
                Nova works out today from your subjects, your dates, what is due for review and the time you have.
                Say you only have 30 minutes and the day refits. It never makes your day longer than you said, and
                when exam work will not fit, it says so.
              </p>
            </BentoCard>
          </AnimatedCard>

          {/* Top right wide */}
          <AnimatedCard delay={200} direction="up" className="min-h-[160px] md:min-h-0 md:col-span-5">
            <Feature icon={Globe} title="On the web and Telegram">
              One plan and one session, in two places. Start a session on the web and finish it from Telegram, and
              Nova can check in there at a time you choose.
            </Feature>
          </AnimatedCard>

          {/* Top far right */}
          <AnimatedCard delay={300} direction="right" className="min-h-[160px] md:min-h-0 md:col-span-3">
            <Feature icon={ArrowsClockwise} title="Reviews on time">
              Topics come back when their review is due, and sooner after a session that went badly.
            </Feature>
          </AnimatedCard>

          {/* Middle left */}
          <AnimatedCard delay={400} direction="left" className="min-h-[160px] md:min-h-0 md:col-span-3">
            <Feature icon={Kanban} title="Your own task board">
              Tasks with due days and priorities, on a board you can drag. Moving a card never changes your plan.
            </Feature>
          </AnimatedCard>

          {/* Middle wide */}
          <AnimatedCard delay={500} direction="up" className="min-h-[160px] md:min-h-0 md:col-span-5">
            <Feature icon={Graph} title="Notes that connect">
              Write notes, link them with [[double brackets]], and see your subjects, topics, notes and saved pages
              on one map. Only the links you made are drawn.
            </Feature>
          </AnimatedCard>

          {/* Bottom */}
          <AnimatedCard delay={600} direction="up" className="min-h-[160px] md:min-h-0 md:col-span-6">
            <Feature icon={ChartLineUp} title="Progress you can trust">
              Only timed sessions of ten minutes or more count. Progress shows what has moved, and says plainly what
              it does not know yet.
            </Feature>
          </AnimatedCard>

          <AnimatedCard delay={700} direction="up" className="min-h-[160px] md:min-h-0 md:col-span-6">
            <Feature icon={Planet} title="A world that grows as you study">
              Your creature goes up a level for every five days you study. A week away never brings fog.
            </Feature>
          </AnimatedCard>

        </div>
      </div>
    </section>
  )
}
