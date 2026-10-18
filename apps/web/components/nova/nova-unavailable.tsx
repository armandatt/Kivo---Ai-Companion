'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { PageAction, PageFrame, PageNotice } from '@/components/dashboard/page-states'
import { BUTTON_QUIET } from '@/components/nova/workspace/ui'

// Shown to a Nova learner who opens a page that only exists for Rex. Nova has
// no version of it yet, and Rex's is about training, not study, so nothing of
// it is rendered.
export function NovaUnavailable({ pathname }: { pathname: string }) {
  const name  = pathname.split('/').filter(Boolean)[0] ?? ''
  const title = name ? name.charAt(0).toUpperCase() + name.slice(1) : 'This page'

  return (
    <PageFrame width="narrow">
      <div data-nova-unavailable={pathname}>
        <PageNotice
          eyebrow="Not part of Nova yet"
          title={<>{title} isn&apos;t available with Nova</>}
          action={<>
            <PageAction href="/home">Go to Today <ArrowRight aria-hidden className="size-4" /></PageAction>
            <Link href="/planner" className={`${BUTTON_QUIET} h-10 px-4 text-sm`}>Open Planner</Link>
          </>}
        >
          Nova doesn&apos;t have this page yet. What it knows about your learning is on Today and in the Planner.
        </PageNotice>
      </div>
    </PageFrame>
  )
}
