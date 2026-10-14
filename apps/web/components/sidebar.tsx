'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BarChart3, BookOpen, Bookmark, Waypoints, Calendar, Compass, Dna, Globe,
  Home, LogOut, Map, Settings, Target, Timer, TrendingUp, Zap, Menu, NotebookPen, X,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-react'
import { NOVA_ROUTES, type Companion } from '@repo/api/nova/product/companion'
import { cn } from '@/lib/utils'
import { ThemePicker } from '@/components/theme/kivo-theme'

interface SidebarProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  overlay?: boolean
  companion: Companion
}

const navItems = [
  { href: '/home', label: 'Home', icon: Home }, { href: '/planner', label: 'Planner', icon: Calendar },
  { href: '/coach', label: 'Coach', icon: Zap }, { href: '/journey', label: 'Journey', icon: Compass },
  { href: '/progress', label: 'Progress', icon: BarChart3 }, { href: '/goals', label: 'Goals', icon: Target },
  { href: '/creature', label: 'Creature', icon: Map }, { href: '/guide', label: 'Guide', icon: BookOpen },
]
const NOVA_ICONS: Record<string, typeof Home> = {
  '/home': Home, '/planner': Calendar, '/focus': Timer, '/knowledge': BookOpen, '/map': Waypoints,
  '/notes': NotebookPen, '/saved': Bookmark, '/progress': TrendingUp, '/learning-dna': Dna,
  '/creature': Map, '/guide': Compass,
}
const novaNavItems = NOVA_ROUTES.map(r => ({ href: r.path, label: r.label, icon: NOVA_ICONS[r.path] ?? Home }))

export function Sidebar({ open, onOpenChange, overlay = false, companion }: SidebarProps) {
  const pathname = usePathname()
  const isNova = companion === 'nova'
  const items = isNova ? novaNavItems : navItems
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const mobileMenuRef = useRef<HTMLButtonElement>(null)
  const lastPath = useRef(pathname)

  const closeMobile = () => setMobileOpen(false)
  useEffect(() => {
    if (lastPath.current !== pathname) { closeMobile(); lastPath.current = pathname }
  }, [pathname])
  useEffect(() => {
    if (!mobileOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { closeMobile(); mobileMenuRef.current?.focus() } }
    document.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', onKey) }
  }, [mobileOpen])

  const signOut = async () => {
    setSigningOut(true)
    try { await fetch('/api/logout', { method: 'POST' }) } finally { window.location.href = '/' }
  }
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)
  const close = () => { closeMobile(); if (overlay) onOpenChange(false) }

  return (
    <>
      <button ref={mobileMenuRef} type="button" onClick={() => setMobileOpen(true)} aria-expanded={mobileOpen} aria-controls="kivo-navigation-drawer" className="fixed left-4 top-4 z-50 inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-background/85 px-3 text-sm font-medium text-foreground shadow-lg backdrop-blur-md lg:hidden">
        <Menu className="size-4" /><span>Menu</span>
      </button>
      <div aria-hidden={!mobileOpen} onClick={close} className={cn('fixed inset-0 z-40 bg-black/55 transition-opacity lg:hidden', mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0')} />
      <aside id="kivo-navigation-drawer" aria-label="Main navigation" className={cn(
        'z-50 flex h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width,transform] duration-200',
        collapsed ? 'w-[72px]' : 'w-[248px]',
        overlay ? 'fixed left-0 top-0' : 'fixed left-0 top-0 lg:sticky',
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      )}>
        <div className={cn('flex h-[76px] items-center border-b border-sidebar-border px-4', collapsed ? 'justify-center' : 'justify-between')}>
          <Link href="/home" onClick={close} className={cn('flex items-center gap-3', collapsed && 'justify-center')} aria-label={`${isNova ? 'Nova' : 'Rex'} home`}>
            <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl text-lg font-semibold text-black', isNova ? 'bg-keppel-400' : 'bg-emerald-400')}>{isNova ? 'N' : 'R'}</span>
            {!collapsed && <span><strong className="block text-sm text-sidebar-foreground">{isNova ? 'Nova' : 'Rex'}</strong><span className="block text-xs text-sidebar-foreground/50">{isNova ? 'Learning mentor' : 'AI coach'}</span></span>}
          </Link>
          {!collapsed && <button type="button" onClick={() => setCollapsed(true)} className="hidden rounded-lg p-2 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground lg:block" aria-label="Collapse sidebar"><PanelLeftClose className="size-4" /></button>}
        </div>
        {collapsed && <button type="button" onClick={() => setCollapsed(false)} className="mx-auto mt-3 rounded-lg p-2 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label="Expand sidebar"><PanelLeftOpen className="size-4" /></button>}
        <nav className={cn('flex-1 overflow-y-auto py-5', collapsed ? 'px-2' : 'px-3')}>
          <p className={cn('mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/35', collapsed && 'sr-only')}>{isNova ? 'Workspace' : 'Coach'}</p>
          <ul className="space-y-1">
            {items.map(({ href, label, icon: Icon }) => {
              const active = isActive(href)
              return <li key={href}><Link href={href} onClick={close} title={collapsed ? label : undefined} aria-current={active ? 'page' : undefined} className={cn('group flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors', collapsed && 'justify-center px-0', active ? 'bg-keppel-400/15 font-medium text-keppel-200' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground')}><Icon className={cn('size-[18px] shrink-0', active && 'text-keppel-300')} /><span className={cn(collapsed && 'sr-only')}>{label}</span>{active && !collapsed && <span className="ml-auto size-1.5 rounded-full bg-keppel-300" />}</Link></li>
            })}
          </ul>
        </nav>
        <div className={cn('border-t border-sidebar-border py-3', collapsed ? 'px-2' : 'px-3')}>
          <Link href="/settings" onClick={close} title={collapsed ? 'Settings' : undefined} className={cn('flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground', collapsed && 'justify-center px-0')}><Settings className="size-[18px]" /><span className={cn(collapsed && 'sr-only')}>Settings</span></Link>
          {!collapsed && <><Link href="/" onClick={close} className="flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground"><Globe className="size-[18px]" /><span>Kivo home page</span></Link><div className="flex items-center justify-between px-3 py-2"><span className="text-xs text-sidebar-foreground/40">Theme</span><ThemePicker compact /></div></>
          }
          <button type="button" onClick={() => void signOut()} disabled={signingOut} title={collapsed ? 'Sign out' : undefined} className={cn('flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-sm text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-50', collapsed && 'justify-center px-0')}><LogOut className="size-[18px]" /><span className={cn(collapsed && 'sr-only')}>{signingOut ? 'Signing out…' : 'Sign out'}</span></button>
        </div>
      </aside>
    </>
  )
}
