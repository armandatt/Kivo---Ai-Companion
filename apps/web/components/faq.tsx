"use client"

import { useEffect, useRef, useState } from "react"
import { CaretDown } from "@phosphor-icons/react/dist/ssr"

const FAQS = [
  {
    question: "Do I need to download an app?",
    answer:
      "No. Your companion lives entirely inside WhatsApp and Telegram. You just scan a QR code or click a link and you're in. No app store, no installs, no friction. It works on any phone you already have.",
  },
  {
    question: "How does the creature actually work?",
    answer:
      "When you sign up, you receive an egg on day 1. Check in for 3 consecutive days and it hatches — you get to name it. From there, every daily check-in feeds your creature XP. Hit streaks and it evolves into new forms. Miss too many days and it visually dims. It's not just a progress bar — it's something you'll actually feel attached to.",
  },
  {
    question: "What are the 3 companions and how do I get assigned one?",
    answer:
      "You take a 5-question personality quiz in chat when you first sign up — it feels like a BuzzFeed test, not a form. Based on your answers you're assigned Coach Rex (gym and fitness), Study Nova (studying and focus), or Grind Vera (startup and work productivity). You can switch personas on the Pro plan.",
  },
  {
    question: "What does the companion actually remember?",
    answer:
      "Everything you tell it. Your PRs, your exam dates, your bad weeks, your goals. It stores your conversation history and references it unprompted — weeks later it might say 'last month you said this was your hardest goal, look at you now.' Free users get basic memory. Pro users get full long-term memory across all sessions.",
  },
  {
    question: "What's the difference between Free and Pro?",
    answer:
      "Free gives you one persona, daily check-ins on Telegram, one active goal, and your creature up to Level 3. Pro unlocks all personas, WhatsApp + Telegram, unlimited goals, full creature evolution beyond Level 3, weekly aura cards, buddy challenges, and the Sunday intelligence report. Most people hit the free limit within 2 weeks and upgrade to see their creature evolve.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes. No contracts, no cancellation fees. Cancel from the dashboard or just message your companion 'cancel my plan' and it'll handle it. Your creature and streak history are saved for 30 days after cancellation in case you come back.",
  },
]

function FAQItem({
  question,
  answer,
  isOpen,
  onClick,
  delay,
  isVisible,
}: {
  question: string
  answer: string
  isOpen: boolean
  onClick: () => void
  delay: number
  isVisible: boolean
}) {
  return (
    <div
      className={`border-b border-[var(--color-baltic-sea-800)] transition-all duration-500 ${
        isVisible ? "opacity-100 translate-x-0" : `opacity-0 ${delay % 2 === 0 ? "-translate-x-8" : "translate-x-8"}`
      }`}
      style={{ transitionDelay: `${delay * 75 + 200}ms` }}
    >
      <button onClick={onClick} className="w-full flex items-center justify-between py-5 text-left group">
        <span className="font-medium text-[var(--color-baltic-sea-200)] group-hover:text-[var(--color-keppel-400)] transition-colors">
          {question}
        </span>
        <CaretDown
          weight="bold"
          className={`h-5 w-5 flex-shrink-0 ml-4 text-[var(--color-baltic-sea-500)] group-hover:text-[var(--color-keppel-400)] transition-all duration-300 ${isOpen ? "rotate-180 text-[var(--color-keppel-400)]" : ""}`}
        />
      </button>
      <div
        className={`grid transition-all duration-300 ease-out ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden">
          <p className="pb-5 text-[var(--color-baltic-sea-400)] leading-relaxed">{answer}</p>
        </div>
      </div>
    </div>
  )
}

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)
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
      <div className="mx-auto max-w-[800px] px-2.5 sm:px-6 lg:px-12">
        <div
          className={`text-center max-w-2xl mx-auto mb-16 transition-all duration-700 ${isVisible ? "opacity-100 translate-y-0 blur-0" : "opacity-0 translate-y-12 blur-sm"}`}
        >
          <span className="text-sm font-medium text-[var(--color-keppel-400)] uppercase tracking-wider">FAQ</span>
          <h2 className="mt-3 text-3xl font-bold text-[var(--color-baltic-sea-100)] md:text-4xl">
            Things people actually ask
          </h2>
        </div>

        <div>
          {FAQS.map((faq, i) => (
            <FAQItem
              key={faq.question}
              question={faq.question}
              answer={faq.answer}
              isOpen={openIndex === i}
              onClick={() => setOpenIndex(openIndex === i ? null : i)}
              delay={i}
              isVisible={isVisible}
            />
          ))}
        </div>
      </div>
    </section>
  )
}