'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check } from 'lucide-react'
import { SetupForm } from '@/components/nova/setup-form'

// Subjects, topics, exam dates and study routine, after the first setup: the
// same form, showing what is on record. Saving merges; nothing is removed.
export default function StudySetupPage() {
  const [saved, setSaved] = useState(0)

  return (
    <div className="mx-auto w-full max-w-3xl pb-20 pt-10 lg:pt-4">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm text-foreground/55 transition-colors hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Settings
      </Link>
      <header className="mt-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Subjects and study setup</h1>
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-foreground/55">
          What you are studying, what each subject covers, your exam dates and your usual day. Add to it here, or start from a template. What you have already studied is never changed by this page.
        </p>
      </header>

      {saved > 0 && (
        <p role="status" className="mt-6 flex items-center gap-2 rounded-xl border border-keppel-400/25 bg-keppel-400/8 px-4 py-3 text-sm text-foreground/85">
          <Check className="size-4 text-keppel-300" /> Saved. Your plan, tasks and Knowledge Map now include it.
          <Link href="/home" className="ml-auto font-medium text-keppel-300 hover:text-keppel-200">Go to Today</Link>
        </p>
      )}

      <section className="mt-6 rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9">
        {/* Remounted after a save, so the form shows what is now on record. */}
        <SetupForm key={saved} onSaved={() => { setSaved(n => n + 1); window.scrollTo({ top: 0 }) }} confirmLabel="Confirm and save" />
      </section>
    </div>
  )
}
