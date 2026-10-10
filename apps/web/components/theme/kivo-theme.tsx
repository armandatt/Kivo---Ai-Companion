'use client'

import { useCallback, useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

// The app's theme: light, dark, or whatever the device is set to. The choice
// is kept on this device (localStorage), and what it resolves to is written
// on <html data-kivo-theme>, which the styles in globals.css read.

export type ThemeChoice = 'light' | 'dark' | 'system'
export const THEME_KEY = 'kivo-theme'

const resolve = (choice: ThemeChoice): 'light' | 'dark' =>
  choice === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : choice

function stored(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(THEME_KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'dark'
  } catch { return 'dark' }
}

// Runs before the page paints, so a learner who chose light never sees a
// flash of dark. Kept as a string because it must run before React does.
// Dark is what the app has always been, so it is the default for a device
// that has made no choice.
export const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem('${THEME_KEY}');var t=c==='light'||c==='dark'?c:c==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):'dark';document.documentElement.dataset.kivoTheme=t}catch(e){document.documentElement.dataset.kivoTheme='dark'}})()`

export function useKivoTheme() {
  const [choice, setChoice] = useState<ThemeChoice>('dark')

  useEffect(() => { setChoice(stored()) }, [])

  // Following the device: change when it does.
  useEffect(() => {
    if (choice !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => { document.documentElement.dataset.kivoTheme = resolve('system') }
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [choice])

  const choose = useCallback((next: ThemeChoice) => {
    setChoice(next)
    try { window.localStorage.setItem(THEME_KEY, next) } catch { /* private mode: the choice lasts for this visit */ }
    document.documentElement.dataset.kivoTheme = resolve(next)
  }, [])

  return { choice, choose }
}

const OPTIONS: Array<{ id: ThemeChoice; label: string; icon: typeof Sun }> = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'Match device', icon: Monitor },
]

// Three choices, and the one in force is marked. `compact` is the sidebar's
// icon-only version.
export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const { choice, choose } = useKivoTheme()
  return (
    <div role="radiogroup" aria-label="Theme" className={`inline-flex rounded-xl border border-white/10 bg-white/3 p-1 ${compact ? '' : 'flex-wrap'}`}>
      {OPTIONS.map(({ id, label, icon: Icon }) => (
        <button
          key={id} type="button" role="radio" aria-checked={choice === id} aria-label={compact ? label : undefined} title={compact ? label : undefined}
          onClick={() => choose(id)}
          className={`inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-keppel-400/60 ${compact ? 'size-8' : 'h-9 px-3.5'} ${choice === id ? 'bg-white/10 text-foreground' : 'text-foreground/55 hover:text-foreground'}`}
        >
          <Icon className="size-4" />{!compact && label}
        </button>
      ))}
    </div>
  )
}
