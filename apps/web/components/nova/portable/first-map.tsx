'use client'

// The first Knowledge Map (28 Nov): where a new account goes after
// onboarding when it has no map yet. Two ways in, nothing else:
//   Import a Knowledge Map  a .kivo someone sent; the same ImportSection, the
//                           same pipeline and job as /map/import, and the
//                           page opens the imported map when it is done
//   Build with Nova         the existing Build with Nova (/build)
// An account that already has a map is sent to it: this is a one-time
// choice, not a second Import page.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, FileUp, Loader2, Sparkles } from 'lucide-react'
import { BUTTON_PRIMARY } from '@/components/nova/workspace/ui'
import { ImportSection } from './portable-maps'

export function FirstMap() {
  const router = useRouter()
  const [hasMap, setHasMap] = useState<boolean | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    fetch('/api/nova/subjects', { cache: 'no-store' })
      .then(r => r.json())
      .then((b: { status?: string; subjects?: unknown[] }) => setHasMap((b.subjects?.length ?? 0) > 0))
      .catch(() => setHasMap(false))
  }, [])
  // One-time: someone with a map already has nothing to choose here.
  useEffect(() => { if (hasMap) router.replace('/map') }, [hasMap, router])

  if (hasMap !== false) return <div className="flex items-center gap-2 p-10 text-sm text-foreground/60"><Loader2 className="size-4 animate-spin" /> Opening…</div>

  return (
    <div className="mx-auto w-full max-w-5xl px-1 pb-20 pt-10 lg:pt-6" data-first-map>
      <header className="max-w-2xl">
        <h1 className="text-[2rem] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-[2.5rem]">Your Knowledge Map starts here.</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-foreground/65">Bring an existing Knowledge Map into Kivo, or create something entirely new with Nova.</p>
      </header>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="first-import" className="flex flex-col rounded-3xl border border-border/80 bg-card/70 p-6 sm:p-7" data-first-import>
          <span aria-hidden className="grid size-11 place-items-center rounded-2xl bg-keppel-400/12 text-keppel-600 dark:text-keppel-300"><FileUp className="size-5" /></span>
          <h2 id="first-import" className="mt-4 text-lg font-semibold tracking-tight">Import a Knowledge Map</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground/65">Have a Knowledge Map shared with you? Import it into your own Kivo workspace and start exploring. It becomes your own copy; nobody else’s progress comes with it.</p>
          {importing
            ? <div className="mt-2 -mx-2 sm:-mx-3"><ImportSection /></div>
            : <button type="button" onClick={() => setImporting(true)} className={`${BUTTON_PRIMARY} mt-5 self-start`} data-first-import-open>Choose a .kivo file <ArrowRight className="size-4" /></button>}
        </section>

        <section aria-labelledby="first-nova" className="flex flex-col rounded-3xl border border-nova/30 bg-nova/[0.06] p-6 sm:p-7" data-first-nova>
          <span aria-hidden className="grid size-11 place-items-center rounded-2xl bg-nova/15 text-nova-ink"><Sparkles className="size-5" /></span>
          <h2 id="first-nova" className="mt-4 text-lg font-semibold tracking-tight">Build with Nova</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground/65">Start from scratch. Let Nova help you create a personalized Knowledge Map based on your interests, goals and learning journey.</p>
          <Link href="/build" className={`${BUTTON_PRIMARY} mt-5 self-start`} data-first-nova-open>Build with Nova <ArrowRight className="size-4" /></Link>
        </section>
      </div>
    </div>
  )
}
