"use client"

import { useEffect, useRef, useState } from "react"

const TESTIMONIALS_ROW_1 = [
  {
    quote: "Rex remembered my squat PR from 3 weeks ago and called me out when I tried to go lighter. No app has ever done that.",
    author: "Arjun Mehta",
    role: "Gym streak",
    company: "47 days",
    avatar: "AM",
  },
  {
    quote: "Nova gave me a rest week before my board exams without me asking. It just noticed the pattern and backed off. I was shocked.",
    author: "Priya Nair",
    role: "Study streak",
    company: "31 days",
    avatar: "PN",
  },
  {
    quote: "I came back after 4 days just because I felt bad for Kira. My creature was dimming and I couldn't let that happen.",
    author: "Tom Okafor",
    role: "Consistency streak",
    company: "22 days",
    avatar: "TO",
  },
  {
    quote: "Vera asked me one question: 'You building something real or just playing startup?' I haven't missed a daily goal since.",
    author: "Sarah Lin",
    role: "Startup streak",
    company: "19 days",
    avatar: "SL",
  },
  {
    quote: "My Sunday aura card is the only productivity thing I actually look forward to every week. It feels personal.",
    author: "Marcus Webb",
    role: "Work streak",
    company: "55 days",
    avatar: "MW",
  },
]

const TESTIMONIALS_ROW_2 = [
  {
    quote: "I typed 'fine' and it knew I wasn't. Switched to soft mode instantly. That's when I stopped thinking of it as an app.",
    author: "Aisha Patel",
    role: "Life streak",
    company: "38 days",
    avatar: "AP",
  },
  {
    quote: "Zephyr hit Level 10 and I sent the card to my entire family group. Three of them asked what app it was.",
    author: "Ravi Sharma",
    role: "Gym streak",
    company: "63 days",
    avatar: "RS",
  },
  {
    quote: "It figured out I always slip on Thursdays because of a recurring meeting. I hadn't told anyone that. It just noticed.",
    author: "Elena Park",
    role: "Focus streak",
    company: "44 days",
    avatar: "EP",
  },
  {
    quote: "My coach Nova remembered my sister's exam stress three weeks after I mentioned it. That broke my brain a little.",
    author: "James Obi",
    role: "Study streak",
    company: "29 days",
    avatar: "JO",
  },
  {
    quote: "The streak shame is real but it never feels mean. When I broke 14 days it said 'tomorrow is day 1' and that was enough.",
    author: "Chloe Nguyen",
    role: "Habit streak",
    company: "18 days",
    avatar: "CN",
  },
]

function TestimonialCard({
  testimonial,
  onMouseEnter,
  onMouseLeave,
}: {
  testimonial: (typeof TESTIMONIALS_ROW_1)[0]
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="flex-shrink-0 w-[350px] md:w-[400px] rounded-2xl border border-[var(--color-baltic-sea-800)] bg-[var(--color-baltic-sea-950)] p-6 hover:border-[var(--color-keppel-800)] transition-colors duration-300"
      style={{ boxShadow: "var(--bento-shadow)" }}
    >
      <p className="text-[var(--color-baltic-sea-300)] leading-relaxed text-sm">{testimonial.quote}</p>
      <div className="mt-4 flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[var(--color-keppel-600)] to-[var(--color-keppel-800)] flex items-center justify-center text-xs font-bold text-[var(--color-keppel-100)]">
          {testimonial.avatar}
        </div>
        <div>
          <div className="font-medium text-[var(--color-baltic-sea-200)] text-sm">{testimonial.author}</div>
          <div className="text-xs text-[var(--color-baltic-sea-500)]">
            {testimonial.role} · <span className="text-[var(--color-keppel-500)]">{testimonial.company}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function MarqueeRow({
  testimonials,
  direction = "left",
  speed = 30,
}: {
  testimonials: typeof TESTIMONIALS_ROW_1
  direction?: "left" | "right"
  speed?: number
}) {
  const [isPaused, setIsPaused] = useState(false)
  const duplicated = [...testimonials, ...testimonials]

  return (
    <div className="relative flex overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-32 z-10 bg-gradient-to-r from-[var(--background)] to-transparent pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-32 z-10 bg-gradient-to-l from-[var(--background)] to-transparent pointer-events-none" />
      <div
        className="flex gap-6 py-4"
        style={{
          animation: `scroll-${direction} ${speed}s linear infinite`,
          animationPlayState: isPaused ? "paused" : "running",
        }}
      >
        {duplicated.map((testimonial, i) => (
          <TestimonialCard
            key={`${testimonial.author}-${i}`}
            testimonial={testimonial}
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
          />
        ))}
      </div>
    </div>
  )
}

export function Testimonials() {
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
      ref={ref}
      className="py-24 border-t border-[var(--color-baltic-sea-900)] overflow-hidden"
      style={{ background: '#060810' }}
    >
      <div className="mx-auto max-w-[1400px] px-2.5 sm:px-6 lg:px-12">
        <div
          className={`text-center max-w-2xl mx-auto mb-12 transition-all duration-700 ${isVisible ? "opacity-100 translate-y-0 blur-0" : "opacity-0 translate-y-12 blur-sm"}`}
        >
          <span className="text-sm font-medium text-[var(--color-keppel-400)] uppercase tracking-wider">
            Real people. Real streaks.
          </span>
          <h2 className="mt-3 text-3xl font-bold text-[var(--color-baltic-sea-100)] md:text-4xl text-balance">
            What happens when your companion actually knows you
          </h2>
        </div>
      </div>

      <div
        className={`space-y-6 transition-all duration-1000 ${isVisible ? "opacity-100" : "opacity-0"}`}
        style={{ transitionDelay: "300ms" }}
      >
        <MarqueeRow testimonials={TESTIMONIALS_ROW_1} direction="left" speed={40} />
        <MarqueeRow testimonials={TESTIMONIALS_ROW_2} direction="right" speed={45} />
      </div>
    </section>
  )
}