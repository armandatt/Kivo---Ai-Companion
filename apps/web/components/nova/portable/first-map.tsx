'use client'

// The Knowledge Map's empty state (28 Nov): shown by the map page itself
// (app/(dashboard)/map/page.tsx) every time it has no map to draw, decided by
// mapPageState from the server's answer, never by onboarding. Two ways in:
//   Import a Knowledge Map  a .kivo file; the same ImportSection, pipeline and
//                           job as /map/import; on success the page opens the
//                           imported map, on failure this stays with Try again
//   Build with Nova         the existing Build with Nova (/build)

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, FileUp, Sparkles } from 'lucide-react'
import { BUTTON_PRIMARY } from '@/components/nova/workspace/ui'
import { ImportSection } from './portable-maps'

export function FirstMapChoice() {
  const [importing, setImporting] = useState(false)
  return (
    <div className="mx-auto w-full max-w-5xl pb-16 pt-2" data-first-map>
      <header className="max-w-2xl">
        <h2 className="text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[2.1rem]">Your Knowledge Map starts here.</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-foreground/65">Bring an existing Knowledge Map into Kivo, or create something entirely new with Nova.</p>
      </header>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="first-import" className="flex flex-col rounded-3xl border border-border/80 bg-card/70 p-6 sm:p-7" data-first-import>
          <span aria-hidden className="grid size-11 place-items-center rounded-2xl bg-keppel-400/12 text-keppel-600 dark:text-keppel-300"><FileUp className="size-5" /></span>
          <h3 id="first-import" className="mt-4 text-lg font-semibold tracking-tight">Import a Knowledge Map</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground/65">Already have a Knowledge Map? Import your existing .kivo package into your Kivo workspace.</p>
          {importing
            ? <div className="mt-2 -mx-2 sm:-mx-3"><ImportSection /></div>
            : <button type="button" onClick={() => setImporting(true)} className={`${BUTTON_PRIMARY} mt-5 self-start`} data-first-import-open>Import Knowledge Map <ArrowRight className="size-4" /></button>}
        </section>

        <section aria-labelledby="first-nova" className="flex flex-col rounded-3xl border border-nova/30 bg-nova/[0.06] p-6 sm:p-7" data-first-nova>
          <span aria-hidden className="grid size-11 place-items-center rounded-2xl bg-nova/15 text-nova-ink"><Sparkles className="size-5" /></span>
          <h3 id="first-nova" className="mt-4 text-lg font-semibold tracking-tight">Build with Nova</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground/65">Start from scratch. Let Nova help you create a personalized Knowledge Map based on your interests, goals and learning journey.</p>
          <Link href="/build" className={`${BUTTON_PRIMARY} mt-5 self-start`} data-first-nova-open>Build with Nova <ArrowRight className="size-4" /></Link>
        </section>
      </div>
    </div>
  )
}
