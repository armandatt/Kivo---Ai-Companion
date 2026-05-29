"use client"

import Link from "next/link"
import { useEffect, useState, type ReactNode } from "react"

type AuthAwareLinkProps = {
  children: ReactNode
  className?: string
  loggedOutHref?: string
}

export function AuthAwareLink({
  children,
  className,
  loggedOutHref = "/signup",
}: AuthAwareLinkProps) {
  const [href, setHref] = useState("/dashboard")

  useEffect(() => {
    fetch("/api/me")
      .then((res) => {
        if (res.ok) setHref("/dashboard")
        else setHref(loggedOutHref)
      })
      .catch(() => {})
  }, [loggedOutHref])

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}
