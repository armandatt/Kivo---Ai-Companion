import type { ReactNode } from 'react'
import Link from 'next/link'
import { KioMark, KioWordmark } from '@/components/brand/kio-brand'
import { TO_CONFIRM, type ToConfirm } from './to-confirm'

// The frame the Privacy Policy and the Terms share: Kio's mark, the title in
// the editorial serif, a draft notice while any fact is still to be supplied,
// and a contents list. Written against the theme tokens, so it works on ink
// and on paper.

// A fact the owner must supply before publication, marked so it cannot be
// mistaken for a statement.
export function Confirm({ id }: { id: ToConfirm }) {
  return (
    <span data-to-confirm={id} className="rounded border border-dashed border-amber-500/60 bg-amber-400/10 px-1.5 py-0.5 text-[0.95em] text-foreground">
      [To confirm: {TO_CONFIRM[id]}]
    </span>
  )
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-white/8 pt-8">
      <h2 id={`${id}-title`} className="text-xl font-semibold leading-tight tracking-[-0.01em] text-foreground">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-foreground/80 [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_a]:text-action-ink [&_a]:underline [&_a]:underline-offset-4">
        {children}
      </div>
    </section>
  )
}

// updated: the version's date (auth/legal.ts), the day this text last changed.
const longDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export function LegalPage({ title, summary, sections, updated, children }: {
  title: string; summary: ReactNode; sections: Array<{ id: string; title: string }>; updated: string; children: ReactNode
}) {
  return (
    <div className="kio-app min-h-screen bg-background text-foreground">
      <header className="border-b border-white/8">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" aria-label="Kio home">
            <KioMark size={26} className="text-foreground" />
            <KioWordmark height={18} className="text-foreground" />
          </Link>
          <nav aria-label="Legal" className="flex items-center gap-4 text-sm">
            <Link href="/privacy" className="text-foreground/70 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">Privacy</Link>
            <Link href="/terms" className="text-foreground/70 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">Terms</Link>
            <Link href="/home" className="rounded-lg border border-white/12 px-3 py-1.5 text-foreground/85 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-ring" data-legal-back>Back to Kio</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        <h1 className="text-[2.1rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[2.8rem]">{title}</h1>
        <p className="mt-3 text-sm text-subtle" data-legal-updated>Last updated: <time dateTime={updated}>{longDate(updated)}</time></p>
        <p className="mt-1 text-sm text-subtle">Takes effect: <Confirm id="effectiveDate" /></p>

        <div role="note" className="mt-6 rounded-xl border border-amber-500/40 bg-amber-400/8 p-4 text-sm leading-relaxed text-foreground/85">
          <strong className="font-semibold text-foreground">Draft.</strong> This page was written from how Kio works today and has not had legal review.
          It is not legal advice and does not by itself make Kio compliant with any law. Items marked “To confirm” must be supplied before it is published.
        </div>

        <div className="mt-8 text-[17px] leading-relaxed text-foreground/85">{summary}</div>

        <nav aria-label="On this page" className="mt-8 rounded-xl border border-white/8 bg-card/60 p-4">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">On this page</p>
          <ol className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
            {sections.map((s, i) => (
              <li key={s.id}><a href={`#${s.id}`} className="text-foreground/80 hover:text-foreground hover:underline">{i + 1}. {s.title}</a></li>
            ))}
          </ol>
        </nav>

        <div className="mt-10 space-y-10">{children}</div>
      </main>
    </div>
  )
}
