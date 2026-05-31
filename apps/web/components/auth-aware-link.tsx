"use client"

import Link from "next/link"
import { useEffect, useState, type ComponentPropsWithoutRef } from "react"

type AuthAwareLinkProps = Omit<ComponentPropsWithoutRef<typeof Link>, "href"> & {
  loggedOutHref?: string
}

export function AuthAwareLink({
  children,
  loggedOutHref = "/signup",
  ...props
}: AuthAwareLinkProps) {
  const [href, setHref] = useState(loggedOutHref)

  useEffect(() => {
    fetch("/api/me")
      .then((res) => {
        setHref(res.ok ? "/dashboard" : loggedOutHref)
      })
      .catch(() => setHref(loggedOutHref))
  }, [loggedOutHref])

  return (
    <Link href={href} {...props}>
      {children}
    </Link>
  )
}
