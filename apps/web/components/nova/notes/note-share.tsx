'use client'

// Sharing one note (docs/KIVO_NOTE_FORMAT.md): two choices, said plainly.
//   Download .kivo  the note itself, editable in Kivo: its text exactly, its
//                   images and files (packages/api/src/portable/note-package.ts)
//   Export PDF      to read or print anywhere: links stay clickable, files are
//                   listed, not inside (portable/note-pdf.ts)
// The server makes both from the saved note; this menu only asks and downloads.

import { useEffect, useRef, useState } from 'react'
import { Download, FileText, Loader2, Share2 } from 'lucide-react'
import { downloadName } from './note-share-data'

type Format = 'kivo' | 'pdf'

export function NoteShare({ noteId, title, unsaved }: { noteId: string; title: string; unsaved: boolean }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<Format | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  const make = async (format: Format) => {
    setBusy(format); setMessage(null)
    try {
      const res = await fetch('/api/nova/portable/notes/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noteId, format }) })
      if (!res.ok) {
        const b = await res.json().catch(() => null) as { message?: string } | null
        setMessage({ tone: 'error', text: b?.message ?? 'The file couldn’t be made. Try again.' }); return
      }
      const blob = await res.blob()
      const saved = downloadName(res.headers.get('content-disposition'), `${title || 'note'}.${format === 'pdf' ? 'pdf' : 'kivo'}`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = saved; a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 5000)
      setMessage({ tone: 'ok', text: format === 'pdf' ? `Downloaded ${saved}.` : `Downloaded ${saved}. Whoever opens it in Kivo gets their own editable copy.` })
    } catch {
      setMessage({ tone: 'error', text: 'Could not reach Kivo. Check your connection and try again.' })
    } finally { setBusy(null) }
  }

  const item = 'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/5 disabled:opacity-60'
  return (
    <div ref={box} className="relative" data-note-share>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu"
        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-white/6 hover:text-foreground" title="Share this note">
        <Share2 className="size-3.5" /> <span className="max-sm:sr-only">Share</span>
      </button>
      {open && (
        <div role="menu" aria-label="Share this note" className="absolute right-0 z-40 mt-1.5 w-[19rem] rounded-xl border border-white/10 bg-background p-1.5 shadow-float">
          <button type="button" role="menuitem" onClick={() => void make('kivo')} disabled={busy !== null} className={item} data-note-share-kivo>
            {busy === 'kivo' ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" /> : <Download className="mt-0.5 size-4 shrink-0 text-keppel-300" />}
            <span><span className="block text-sm font-medium text-foreground">Download .kivo</span><span className="block text-xs text-foreground/55">Editable in Kivo, with its images and files</span></span>
          </button>
          <button type="button" role="menuitem" onClick={() => void make('pdf')} disabled={busy !== null} className={item} data-note-share-pdf>
            {busy === 'pdf' ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" /> : <FileText className="mt-0.5 size-4 shrink-0 text-sky-300" />}
            <span><span className="block text-sm font-medium text-foreground">Export PDF</span><span className="block text-xs text-foreground/55">To read or print; attached files are listed, not included</span></span>
          </button>
          {unsaved && <p className="px-3 pb-1 pt-1.5 text-[11px] text-amber-200/90">Your latest edits are still saving; the file has the last saved version.</p>}
          {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`px-3 pb-1.5 pt-1 text-xs ${message.tone === 'error' ? 'text-amber-200' : 'text-keppel-300'}`} data-note-share-message>{message.text}</p>}
        </div>
      )}
    </div>
  )
}
