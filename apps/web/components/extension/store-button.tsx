'use client'

// "Add Kivo to Chrome": the one install button, used on the Browser Extension
// page, the Guide and the landing page. It opens the Chrome Web Store listing
// (CHROME_STORE_URL, lib/extension-store.ts) in a new tab. While no listing
// address is set it is not a link: it says the store link is on its way, so
// nobody lands on a dead or wrong page.

import { useEffect } from 'react'
import { ExternalLink } from 'lucide-react'
import { CHROME_STORE_URL } from '@/lib/extension-store'
import { recordFunnel, type FunnelPlace } from '@/lib/extension-funnel'
import { cn } from '@/lib/utils'

let warned = false

export function StoreButton({ from, className, unsetClassName, label = 'Add Kivo to Chrome', url = CHROME_STORE_URL }: {
  from: FunnelPlace
  className: string
  unsetClassName?: string
  label?: string
  // For tests and previews; the page always uses the configured address.
  url?: string | null
}) {
  useEffect(() => {
    if (url || warned || process.env.NODE_ENV === 'production') return
    warned = true
    console.warn('[kivo] NEXT_PUBLIC_CHROME_STORE_URL is not set (or is not a Chrome Web Store listing address), so "Add Kivo to Chrome" shows the store link as coming soon.')
  }, [url])

  if (!url) {
    return (
      <span aria-disabled="true" className={cn('cursor-default select-none opacity-70', unsetClassName ?? className)} data-store-button="unset">
        Chrome Web Store link coming soon
      </span>
    )
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={() => recordFunnel('Extension store opened', from)}
      className={className} data-store-button="set">
      {label}
      <ExternalLink aria-hidden className="size-4 shrink-0" />
      <span className="sr-only"> (opens the Chrome Web Store in a new tab)</span>
    </a>
  )
}
