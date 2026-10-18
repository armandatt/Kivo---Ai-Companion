'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check } from 'lucide-react'
import { SetupForm } from '@/components/nova/setup-form'
import { GoalsEditor } from '@/components/nova/goals-editor'
import { ExamsEditor } from '@/components/nova/exams-editor'
import { PageHeader } from '@/components/dashboard/page-states'

// Subjects, topics, exam dates and study routine, after the first setup: the
// same form, showing what is on record. Saving the form merges and removes
// nothing; an exam date is moved or removed in its own editor above it.
export default function StudySetupPage() {
  const [saved, setSaved] = useState(0)

  return (
    <div className="mx-auto w-full max-w-3xl pb-20 pt-10 lg:pt-4">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm text-foreground/55 transition-colors hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Settings
      </Link>
      <PageHeader
        className="mt-4"
        title={<>What you&apos;re learning</>}
        description="What you are learning, what each part covers, the dates that matter and your usual day. Add to it here, or start from a template. A date can be moved or removed; what you have already studied is never changed by this page."
      />

      {saved > 0 && (
        <p role="status" className="mt-6 flex items-center gap-2 rounded-xl border border-keppel-400/25 bg-keppel-400/8 px-4 py-3 text-sm text-foreground/85">
          <Check className="size-4 text-keppel-300" /> Saved. Your plan, tasks and Knowledge Map now include it.
          <Link href="/home" className="ml-auto font-medium text-keppel-300 hover:text-keppel-200">Go to Today</Link>
        </p>
      )}

      {/* Its own save: a goal is not part of the setup draft below. */}
      <div className="mt-6"><GoalsEditor /></div>

      {/* Its own save too: moving or removing a date is not part of the draft. Remounted after a setup save, which may have added one. */}
      <div className="mt-6"><ExamsEditor key={saved} /></div>

      <section className="mt-6 rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-9">
        {/* Remounted after a save, so the form shows what is now on record. */}
        <SetupForm key={saved} onSaved={() => { setSaved(n => n + 1); window.scrollTo({ top: 0 }) }} confirmLabel="Confirm and save" />
      </section>
    </div>
  )
}
