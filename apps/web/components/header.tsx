"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Lightning, SignOut, SquaresFour } from "@phosphor-icons/react/dist/ssr"
import { KivoLogo } from "@/components/KivoLogo"

export function Header() {
  const router = useRouter()
  const [scrolled, setScrolled] = useState(false)
  const [user, setUser] = useState<{ name?: string | null; email: string } | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > window.innerHeight * 0.5)
    }
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data?.user && setUser(data.user))
      .catch(() => {})
  }, [])

  const handleLogout = async () => {
    setLoggingOut(true)
    await fetch("/api/logout", { method: "POST" })
    setUser(null)
    router.push("/")
    router.refresh()
  }

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : user?.email?.[0]?.toUpperCase() ?? "?"

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50">
        <div className="mx-auto flex h-20 max-w-[1400px] items-center justify-between px-2.5 sm:px-6 lg:px-12">

          {/* Logo */}
          <div className="flex items-center gap-3">
            <KivoLogo size={38} />
            <span
              className={`
                text-xl font-semibold tracking-tight text-[var(--color-baltic-sea-50)]
                transition-all duration-500 overflow-hidden whitespace-nowrap
                ${scrolled ? "max-w-0 opacity-0" : "max-w-[100px] opacity-100"}
              `}
            >
              Kivo
            </span>
          </div>

          {/* Nav */}
          <nav
            className={`
              hidden md:flex items-center gap-1 rounded-full border border-[var(--color-baltic-sea-800)]
              bg-[var(--color-baltic-sea-900)]/80 backdrop-blur-md px-2 py-1.5
              transition-all duration-500 ease-out
              ${scrolled ? "opacity-0 pointer-events-none" : "opacity-100"}
              absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2
            `}
          >
            <a href="#product" className="px-4 py-1.5 text-sm text-[var(--color-baltic-sea-100)] rounded-full bg-[var(--color-baltic-sea-800)]">
              Product
            </a>
            <a href="#pricing" className="px-4 py-1.5 text-sm text-[var(--color-baltic-sea-400)] hover:text-[var(--color-baltic-sea-100)] transition-colors">
              Pricing
            </a>
            <a href="#" className="px-4 py-1.5 text-sm text-[var(--color-baltic-sea-400)] hover:text-[var(--color-baltic-sea-100)] transition-colors">
              How it works
            </a>
            <a href="#" className="px-4 py-1.5 text-sm text-[var(--color-baltic-sea-400)] hover:text-[var(--color-baltic-sea-100)] transition-colors">
              Blog
            </a>
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {user ? (
              <>
                {/* Dashboard button */}
                <Button
                  asChild
                  className={`
                    hidden md:flex items-center gap-1.5 rounded-full
                    px-4 py-2 h-auto text-sm font-semibold
                    transition-all duration-500
                    ${scrolled ? "opacity-0 pointer-events-none" : "opacity-100"}
                  `}
                  style={{
                    background: "rgba(0,229,160,0.1)",
                    border: "1px solid rgba(0,229,160,0.2)",
                    color: "#00E5A0",
                  }}
                >
                  <Link href="/dashboard">
                    <SquaresFour weight="bold" className="h-4 w-4" />
                    Dashboard
                  </Link>
                </Button>

                {/* Avatar */}
                <div
                  className={`
                    hidden md:flex items-center gap-2
                    transition-all duration-500
                    ${scrolled ? "opacity-0 pointer-events-none" : "opacity-100"}
                  `}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-keppel-400)]/40 bg-[var(--color-baltic-sea-800)] text-xs font-semibold text-[var(--color-keppel-400)]">
                    {initials}
                  </div>
                  <span className="text-sm text-[var(--color-baltic-sea-300)] max-w-[120px] truncate">
                    {user.name ?? user.email}
                  </span>
                </div>

                {/* Sign out button */}
                <Button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  variant="ghost"
                  className={`
                    hidden md:flex items-center gap-1.5 rounded-full border border-[var(--color-baltic-sea-700)]
                    px-4 py-2 h-auto text-sm text-[var(--color-baltic-sea-300)]
                    hover:border-[var(--color-baltic-sea-500)] hover:text-white hover:bg-[var(--color-baltic-sea-800)]
                    transition-all duration-500
                    ${scrolled ? "opacity-0 pointer-events-none" : "opacity-100"}
                  `}
                >
                  <SignOut weight="bold" className="h-4 w-4" />
                  {loggingOut ? "Signing out…" : "Sign out"}
                </Button>
              </>
            ) : (
              <>
                <a
                  href="/signin"
                  className={`
                    hidden text-sm text-[var(--color-baltic-sea-400)] hover:text-[var(--color-baltic-sea-100)] transition-all duration-500 md:block
                    ${scrolled ? "opacity-0 pointer-events-none" : "opacity-100"}
                  `}
                >
                  Sign in
                </a>
                <Button
                  asChild
                  className={`
                    hidden md:flex bg-[var(--color-keppel-400)] text-[var(--color-keppel-950)] hover:bg-[var(--color-keppel-300)]
                    rounded-full px-5 py-2.5 h-auto text-sm
                    transition-all duration-500
                    ${scrolled ? "opacity-0 pointer-events-none" : "opacity-100"}
                  `}
                >
                  <Link href="/signup">
                    <Lightning weight="fill" className="mr-1.5 h-4 w-4" />
                    Start free
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Floating CTA / Sign-out on scroll */}
      <div
        className={`
          fixed z-50 bottom-6 right-6 lg:right-12
          transition-all duration-500 ease-out
          ${scrolled ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"}
        `}
      >
        {user ? (
          <Button
            asChild
            className="rounded-full px-6 py-3 h-auto text-sm font-semibold shadow-lg"
            style={{
              background: "rgba(0,229,160,0.12)",
              border: "1px solid rgba(0,229,160,0.25)",
              color: "#00E5A0",
            }}
          >
            <Link href="/dashboard">
              <SquaresFour weight="bold" className="mr-1.5 h-4 w-4" />
              Dashboard
            </Link>
          </Button>
        ) : (
          <Button
            asChild
            className="bg-[var(--color-keppel-400)] text-[var(--color-keppel-950)] hover:bg-[var(--color-keppel-300)]
              rounded-full px-6 py-3 h-auto text-sm shadow-lg shadow-[var(--color-keppel-400)]/20"
          >
            <Link href="/signup">
              <Lightning weight="fill" className="mr-1.5 h-4 w-4" />
              Start free
            </Link>
          </Button>
        )}
      </div>
    </>
  )
}
