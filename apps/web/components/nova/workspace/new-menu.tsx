'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { Bookmark, CheckSquare, ChevronDown, NotebookPen, Plus, Timer } from 'lucide-react'
import { BUTTON_PRIMARY } from './ui'

// One way to start anything new from the page: each item is a flow that
// already exists. "Task" puts the keyboard in Today's task composer.
export function NewMenu({ onNewTask }: { onNewTask: () => void }) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const button = useRef<HTMLButtonElement>(null)
  const menu   = useRef<HTMLDivElement>(null)

  // Opened: the first item takes focus; a click elsewhere closes it.
  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const close = (refocus: boolean) => { setOpen(false); if (refocus) button.current?.focus() }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') { e.preventDefault(); close(true) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(at + 1) % items.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus() }
    else if (e.key === 'Tab') close(false)
  }

  const item = 'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-foreground/85 outline-none transition-colors hover:bg-white/6 focus-visible:bg-white/8'

  return (
    <div className="relative">
      <button ref={button} type="button" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        className={`${BUTTON_PRIMARY} h-9 px-3`}>
        <Plus aria-hidden className="size-4" /> New <ChevronDown aria-hidden className="size-3.5 opacity-70" />
      </button>
      {open && (
        <div ref={menu} id={menuId} role="menu" aria-label="New" onKeyDown={onKeyDown}
          className="absolute right-0 z-30 mt-2 w-56 rounded-xl border border-white/10 bg-card p-1.5 shadow-xl shadow-black/30">
          <button type="button" role="menuitem" className={item} onClick={() => { close(false); onNewTask() }}>
            <CheckSquare aria-hidden className="size-4 text-foreground/50" /> Task
          </button>
          <Link role="menuitem" href="/notes/new" className={item} onClick={() => close(false)}>
            <NotebookPen aria-hidden className="size-4 text-foreground/50" /> Note
          </Link>
          <Link role="menuitem" href="/saved" className={item} onClick={() => close(false)}>
            <Bookmark aria-hidden className="size-4 text-foreground/50" /> Saved link
          </Link>
          <Link role="menuitem" href="/focus" className={item} onClick={() => close(false)}>
            <Timer aria-hidden className="size-4 text-foreground/50" /> Focus session
          </Link>
        </div>
      )}
    </div>
  )
}
