'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BarChart3,
  Compass,
  Home,
  Map,
  Settings,
  Target,
  Zap,
  Menu,
  X,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useState } from 'react'

interface SidebarProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When true, sidebar always floats as an overlay (never inline-pushes content) */
  overlay?: boolean
}

const navItems = [
  { href: '/home', label: 'Home', icon: Home },
  { href: '/coach', label: 'Coach', icon: Zap },
  { href: '/journey', label: 'Journey', icon: Compass },
  { href: '/progress', label: 'Progress', icon: BarChart3 },
  { href: '/goals', label: 'Goals', icon: Target },
  { href: '/creature', label: 'Creature', icon: Map },
]

export function Sidebar({ open, onOpenChange, overlay = false }: SidebarProps) {
  const pathname = usePathname()
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [isLargeScreen, setIsLargeScreen] = useState(false)

  // Check screen size on client
  React.useEffect(() => {
    const checkScreen = () => {
      setIsLargeScreen(window.innerWidth >= 1024)
    }
    checkScreen()
    window.addEventListener('resize', checkScreen)
    return () => window.removeEventListener('resize', checkScreen)
  }, [])

  const isActive = (href: string) => pathname === href

  return (
    <>
      {/* Mobile Toggle */}
      <button
        onClick={() => setIsMobileOpen(!isMobileOpen)}
        className="fixed top-4 left-4 z-50 lg:hidden p-2 hover:bg-sidebar-accent rounded-lg transition-colors"
      >
        {isMobileOpen ? (
          <X className="w-6 h-6" />
        ) : (
          <Menu className="w-6 h-6" />
        )}
      </button>

      {/* Sidebar */}
      <motion.aside
        initial={{ x: -280 }}
        animate={{ x: (isMobileOpen || isLargeScreen) && open ? 0 : -280 }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
        className={`w-70 h-screen bg-sidebar border-r border-sidebar-border flex flex-col z-40 ${overlay ? 'fixed' : 'fixed lg:relative'}`}
      >
        {/* Logo Area */}
        <div className="p-6 border-b border-sidebar-border">
          <Link href="/home" className="flex items-center gap-3 group">
            <div className="relative">
              <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-green-600 rounded-lg flex items-center justify-center font-bold text-black text-lg">
                R
              </div>
              <div className="absolute inset-0 bg-green-400 rounded-lg blur opacity-50 group-hover:opacity-75 transition-opacity -z-10" />
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-sm leading-tight">Rex</span>
              <span className="text-xs text-sidebar-foreground/60">AI Coach</span>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)

            return (
              <motion.div
                key={item.href}
                whileHover={{ x: 4 }}
                whileTap={{ scale: 0.98 }}
              >
                <Link
                  href={item.href}
                  onClick={() => { setIsMobileOpen(false); if (overlay) onOpenChange(false) }}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200',
                    active
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-lg'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent'
                  )}
                >
                  {active && (
                    <motion.div
                      layoutId="sidebar-indicator"
                      className="absolute left-0 w-1 h-8 bg-green-400 rounded-r-lg"
                      transition={{ type: 'spring', stiffness: 380, damping: 40 }}
                    />
                  )}
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  <span className="font-medium text-sm">{item.label}</span>
                </Link>
              </motion.div>
            )
          })}
        </nav>

        {/* Settings */}
        <div className="p-4 border-t border-sidebar-border">
          <motion.div whileHover={{ x: 4 }} whileTap={{ scale: 0.98 }}>
            <Link
              href="/settings"
              onClick={() => { setIsMobileOpen(false); if (overlay) onOpenChange(false) }}
              className="flex items-center gap-3 px-4 py-3 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent transition-all duration-200"
            >
              <Settings className="w-5 h-5 flex-shrink-0" />
              <span className="font-medium text-sm">Settings</span>
            </Link>
          </motion.div>
        </div>
      </motion.aside>

      {/* Backdrop — mobile drawer, or desktop overlay mode (creature page) */}
      {(isMobileOpen || (overlay && open)) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => { setIsMobileOpen(false); if (overlay) onOpenChange(false) }}
          className="fixed inset-0 bg-black/50 z-30"
        />
      )}
    </>
  )
}
