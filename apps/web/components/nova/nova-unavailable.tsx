'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

// Shown to a Nova learner who opens a page that only exists for Rex. Nova has
// no version of it yet, and Rex's is about training, not study, so nothing of
// it is rendered.
export function NovaUnavailable({ pathname }: { pathname: string }) {
  const name  = pathname.split('/').filter(Boolean)[0] ?? ''
  const title = name ? name.charAt(0).toUpperCase() + name.slice(1) : 'This page'

  return (
    <div className="mx-auto w-full max-w-3xl pb-20 pt-10 lg:pt-4" data-nova-unavailable={pathname}>
      <section className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-foreground/40">Not part of Nova yet</p>
        <h1 className="mt-5 text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
          {title} isn&apos;t available with Nova
        </h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground/65">
          Nova doesn&apos;t have this page yet. What it knows about your learning is on Today and in the Planner.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Link href="/home" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-keppel-400 px-6 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300">
            Go to Today <ArrowRight className="size-4" />
          </Link>
          <Link href="/planner" className="inline-flex h-11 items-center justify-center rounded-xl border border-white/12 px-6 text-sm font-medium text-foreground/80 transition-colors hover:bg-white/5">
            Open Planner
          </Link>
        </div>
      </section>
    </div>
  )
}
