'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
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
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'light'
  } catch { return 'light' }
}

// Runs before the page paints, so a learner who chose light never sees a
// flash of dark. Kept as a string because it must run before React does.
// Light (warm paper) is the default for a device that has made no choice;
// a choice already made, dark included, is kept.
export const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem('${THEME_KEY}');var t=c==='light'||c==='dark'?c:c==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):'light';document.documentElement.dataset.kivoTheme=t}catch(e){document.documentElement.dataset.kivoTheme='light'}})()`

// One choice for the whole app (K-08): every picker (the sidebar's, Settings')
// reads the same store, so they never disagree; a change in another tab
// (the storage event) is followed here too, and applied to this page.
const CHANGED = 'kivo-theme-change'
function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === THEME_KEY || e.key === null) { document.documentElement.dataset.kivoTheme = resolve(stored()); onChange() } }
  window.addEventListener(CHANGED, onChange)
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(CHANGED, onChange); window.removeEventListener('storage', onStorage) }
}
let memory: ThemeChoice | null = null   // when storage is refused (private mode)
const current = (): ThemeChoice => memory ?? stored()

export function useKivoTheme() {
  // The server draws the default; the browser's stored choice replaces it on hydration.
  const choice = useSyncExternalStore(subscribe, current, () => 'light' as ThemeChoice)

  // The stored choice is put on the page whenever a picker mounts: the
  // layout's script runs only on a full load, not when arriving from another
  // part of the app by a client-side navigation (K-08: the theme changed on reload).
  useEffect(() => { document.documentElement.dataset.kivoTheme = resolve(current()) }, [])

  // Following the device: change when it does.
  useEffect(() => {
    if (choice !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => { document.documentElement.dataset.kivoTheme = resolve('system') }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [choice])

  const choose = useCallback((next: ThemeChoice) => {
    try { window.localStorage.setItem(THEME_KEY, next); memory = null } catch { memory = next /* private mode: the choice lasts for this visit */ }
    document.documentElement.dataset.kivoTheme = resolve(next)
    window.dispatchEvent(new Event(CHANGED))
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
          className={`inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${compact ? 'size-8' : 'h-9 px-3.5'} ${choice === id ? 'bg-white/10 text-foreground' : 'text-foreground/55 hover:text-foreground'}`}
        >
          <Icon className="size-4" />{!compact && label}
        </button>
      ))}
    </div>
  )
}
