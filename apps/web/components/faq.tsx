"use client"

import { useState } from "react"
import { Reveal } from "@/components/landing/frame"
import { CaretDown } from "@phosphor-icons/react/dist/ssr"

const FAQS = [
  {
    question: "What is Kio?",
    answer:
      "A learning workspace with an AI mentor, Nova. You build a structure for what you're learning (subjects and topics, nested as deep as you need), keep notes and research papers inside it, see it all on a Knowledge Map, and plan each day from it. Progress is measured from the focus sessions you actually finish.",
  },
  {
    question: "Does Nova decide what I study?",
    answer:
      "No. Nova asks questions, suggests and proposes. A plan for your day, a new workspace or a change to a note waits as a proposal until you apply it, and you can reorder, edit or discard it. What you approve is saved; nothing else is.",
  },
  {
    question: "Can I try it before signing up?",
    answer:
      "The previews on this page are samples that run in your browser: explore the map, step through Build with Nova, try the Tutor and Editor, and plan a sample day. They save nothing. To build your own, sign up; the Free plan needs no card.",
  },
  {
    question: "Which research papers can I import?",
    answer:
      "Links from arXiv, a DOI, Semantic Scholar, OpenReview, PubMed and PubMed Central, or a direct PDF link. Kio brings in the details and abstract, plus the full text where the source shares it openly (arXiv's HTML versions, Europe PMC's open-access set). It never fetches anything behind a sign-in or paywall; Nova can transcribe a PDF you point to or upload.",
  },
  {
    question: "Do I need to download an app?",
    answer:
      "No. Kio runs in your browser, on a computer, tablet or phone. If you use Telegram, connect it and Nova can start and log sessions there too; it's the same record either way.",
  },
  {
    question: "Does Kio cost anything?",
    answer:
      "There's a Free plan with everything in Kio and a daily Nova allowance. Pro gives Nova a much larger daily allowance and starts with seven days free, no card needed. Your notes, knowledge and history stay yours on every plan.",
  },
]

function FAQItem({
  question,
  answer,
  isOpen,
  onClick,
}: {
  question: string
  answer: string
  isOpen: boolean
  onClick: () => void
}) {
  return (
    <div className="border-b border-[var(--color-baltic-sea-800)]">
      <button onClick={onClick} aria-expanded={isOpen} className="w-full flex items-center justify-between py-5 text-left group">
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
  return (
    <section
      id="faq"
      className="scroll-mt-20 py-24 sm:py-32 border-t border-[var(--color-baltic-sea-900)] overflow-hidden"
      style={{ background: '#060810' }}
    >
      <div className="mx-auto max-w-[800px] px-2.5 sm:px-6 lg:px-12">
        <Reveal className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-sm font-medium text-[var(--color-keppel-400)] uppercase tracking-wider">FAQ</span>
          <h2 className="mt-3 text-3xl font-bold text-[var(--color-baltic-sea-100)] md:text-4xl">
            Common questions
          </h2>
        </Reveal>

        <Reveal>
          {FAQS.map((faq, i) => (
            <FAQItem
              key={faq.question}
              question={faq.question}
              answer={faq.answer}
              isOpen={openIndex === i}
              onClick={() => setOpenIndex(openIndex === i ? null : i)}
            />
          ))}
        </Reveal>
      </div>
    </section>
  )
}