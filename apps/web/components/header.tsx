"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ArrowRight, CaretDown, GearSix, Lightning, SignOut, SquaresFour } from "@phosphor-icons/react/dist/ssr"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { KivoLogo } from "@/components/KivoLogo"
import { KivoWordmark } from "@/components/brand/kivo-brand"

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
  // A name saved in capitals reads as shouting; the menu shows it in title case.
  const displayName = (user?.name ?? user?.email?.split("@")[0] ?? "").toLowerCase()

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
              <KivoWordmark height={22} className="block" />
            </span>
          </div>

          {/* Nav */}
          <nav
            className={`
              hidden lg:flex items-center gap-1 rounded-full border border-[var(--color-baltic-sea-800)]
              bg-[var(--color-baltic-sea-900)]/80 backdrop-blur-md px-2 py-1.5
              transition-all duration-500 ease-out
              ${scrolled ? "opacity-0 pointer-events-none" : "opacity-100"}
              absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2
            `}
          >
            {[["#workspace", "Product"], ["#how-it-works", "How it works"], ["#pricing", "Pricing"], ["#faq", "FAQ"]].map(([href, label]) => (
              <a key={href} href={href} className="px-4 py-1.5 text-sm text-[var(--color-baltic-sea-400)] rounded-full hover:bg-[var(--color-baltic-sea-800)] hover:text-[var(--color-baltic-sea-100)] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-keppel-400)]">
                {label}
              </a>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {user ? (
              // One capsule: the way back into the app, and the account behind the avatar.
              <div
                className={`
                  flex items-center gap-1 rounded-full border border-white/[0.08] bg-[var(--color-baltic-sea-900)]/70 p-1
                  shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_24px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md
                  transition-all duration-500
                  ${scrolled ? "opacity-0 pointer-events-none" : "opacity-100"}
                `}
              >
                <Link
                  href="/home"
                  className="group inline-flex h-9 items-center gap-2 rounded-full bg-[#00E5A0] pl-3.5 pr-4 text-sm font-semibold text-[#04140e] shadow-[0_0_0_1px_rgba(0,229,160,0.35),0_6px_20px_-6px_rgba(0,229,160,0.55)] transition-[background-color,box-shadow] hover:bg-[#33ebb3] hover:shadow-[0_0_0_1px_rgba(0,229,160,0.5),0_8px_28px_-6px_rgba(0,229,160,0.7)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5A0]"
                >
                  <SquaresFour weight="bold" className="h-4 w-4" />
                  Dashboard
                  <ArrowRight weight="bold" className="h-3.5 w-3.5 -ml-0.5 transition-transform group-hover:translate-x-0.5" />
                </Link>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label="Your account"
                    className="group flex h-9 items-center gap-1 rounded-full pl-1 pr-2 text-[var(--color-baltic-sea-400)] outline-none transition-colors hover:bg-white/[0.05] hover:text-[var(--color-baltic-sea-100)] focus-visible:ring-2 focus-visible:ring-[#00E5A0]/70 data-[state=open]:bg-white/[0.06]"
                  >
                    <span className="rounded-full bg-gradient-to-br from-[#00E5A0] via-[#00E5A0]/40 to-transparent p-px">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-baltic-sea-900)] text-[11px] font-semibold tracking-wide text-[#7ef5cf]">
                        {initials}
                      </span>
                    </span>
                    <CaretDown weight="bold" className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    sideOffset={10}
                    className="w-64 rounded-2xl border border-white/[0.08] bg-[#0b0f17]/95 p-1.5 text-[var(--color-baltic-sea-100)] shadow-[0_24px_48px_-16px_rgba(0,0,0,0.8)] backdrop-blur-xl"
                  >
                    <div className="flex items-center gap-3 px-2.5 py-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#00E5A0]/12 text-xs font-semibold text-[#7ef5cf] ring-1 ring-[#00E5A0]/30">
                        {initials}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium capitalize text-white">{displayName}</span>
                        <span className="block truncate text-xs text-[var(--color-baltic-sea-400)]">{user.email}</span>
                      </span>
                    </div>
                    <DropdownMenuSeparator className="my-1 bg-white/[0.06]" />
                    <DropdownMenuItem asChild className="cursor-pointer rounded-lg px-2.5 py-2 text-sm text-[var(--color-baltic-sea-200)] focus:bg-white/[0.06] focus:text-white">
                      <Link href="/home"><SquaresFour weight="bold" className="mr-2 h-4 w-4 text-[#7ef5cf]" />Dashboard</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="cursor-pointer rounded-lg px-2.5 py-2 text-sm text-[var(--color-baltic-sea-200)] focus:bg-white/[0.06] focus:text-white">
                      <Link href="/settings"><GearSix weight="bold" className="mr-2 h-4 w-4 text-[var(--color-baltic-sea-400)]" />Settings</Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="my-1 bg-white/[0.06]" />
                    <DropdownMenuItem
                      onSelect={(e) => { e.preventDefault(); handleLogout() }}
                      disabled={loggingOut}
                      className="cursor-pointer rounded-lg px-2.5 py-2 text-sm text-[var(--color-baltic-sea-200)] focus:bg-rose-500/10 focus:text-rose-300"
                    >
                      <SignOut weight="bold" className="mr-2 h-4 w-4" />
                      {loggingOut ? "Signing out…" : "Sign out"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              <>
                <a
                  href="/signin"
                  className={`
                    text-sm text-[var(--color-baltic-sea-400)] hover:text-[var(--color-baltic-sea-100)] transition-all duration-500
                    ${scrolled ? "opacity-0 pointer-events-none" : "opacity-100"}
                  `}
                >
                  Sign in
                </a>
                <Button
                  asChild
                  className={`
                    flex bg-[var(--color-keppel-400)] text-[var(--color-keppel-950)] hover:bg-[var(--color-keppel-300)]
                    rounded-full px-5 py-2.5 h-auto text-sm
                    transition-all duration-500
                    ${scrolled ? "opacity-0 pointer-events-none" : "opacity-100"}
                  `}
                >
                  <Link href="/signup">
                    <Lightning weight="fill" className="mr-1.5 h-4 w-4" />
                    Start with Kivo
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
          <Link
            href="/home"
            className="group inline-flex h-11 items-center gap-2 rounded-full bg-[#00E5A0] px-5 text-sm font-semibold text-[#04140e] shadow-[0_0_0_1px_rgba(0,229,160,0.35),0_10px_30px_-8px_rgba(0,229,160,0.6)] transition-colors hover:bg-[#33ebb3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5A0]"
          >
            <SquaresFour weight="bold" className="h-4 w-4" />
            Dashboard
            <ArrowRight weight="bold" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        ) : (
          <Button
            asChild
            className="bg-[var(--color-keppel-400)] text-[var(--color-keppel-950)] hover:bg-[var(--color-keppel-300)]
              rounded-full px-6 py-3 h-auto text-sm shadow-lg shadow-[var(--color-keppel-400)]/20"
          >
            <Link href="/signup">
              <Lightning weight="fill" className="mr-1.5 h-4 w-4" />
              Start with Kivo
            </Link>
          </Button>
        )}
      </div>
    </>
  )
}
