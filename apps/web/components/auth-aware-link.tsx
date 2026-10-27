"use client"

import Link from "next/link"
import { useEffect, useState, type ComponentPropsWithoutRef } from "react"

type AuthAwareLinkProps = Omit<ComponentPropsWithoutRef<typeof Link>, "href"> & {
  loggedOutHref?: string
  // Where a signed-in visitor goes instead (default: Today).
  loggedInHref?: string
}

// One sign-in check for the links rendered together (the landing page has
// several), asked again a few seconds later, so signing in or out and then
// coming back is seen.
let checked: { at: number; yes: Promise<boolean> } | null = null
const signedIn = () => {
  if (!checked || Date.now() - checked.at > 5_000) checked = { at: Date.now(), yes: fetch("/api/me").then((res) => res.ok, () => false) }
  return checked.yes
}

export function AuthAwareLink({
  children,
  loggedOutHref = "/signup",
  loggedInHref = "/home",
  ...props
}: AuthAwareLinkProps) {
  const [href, setHref] = useState(loggedOutHref)

  useEffect(() => {
    let live = true
    void signedIn().then((yes) => { if (live) setHref(yes ? loggedInHref : loggedOutHref) })
    return () => { live = false }
  }, [loggedOutHref, loggedInHref])

  return (
    <Link href={href} {...props}>
      {children}
    </Link>
  )
}
