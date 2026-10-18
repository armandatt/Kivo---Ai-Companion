"use client"

import Link from "next/link"
import { useEffect, useState, type ComponentPropsWithoutRef } from "react"

type AuthAwareLinkProps = Omit<ComponentPropsWithoutRef<typeof Link>, "href"> & {
  loggedOutHref?: string
  // Where a signed-in visitor goes instead (default: Today).
  loggedInHref?: string
}

export function AuthAwareLink({
  children,
  loggedOutHref = "/signup",
  loggedInHref = "/home",
  ...props
}: AuthAwareLinkProps) {
  const [href, setHref] = useState(loggedOutHref)

  useEffect(() => {
    fetch("/api/me")
      .then((res) => {
        setHref(res.ok ? loggedInHref : loggedOutHref)
      })
      .catch(() => setHref(loggedOutHref))
  }, [loggedOutHref, loggedInHref])

  return (
    <Link href={href} {...props}>
      {children}
    </Link>
  )
}
