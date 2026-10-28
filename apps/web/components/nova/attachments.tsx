'use client'

// Files the learner gives Nova (Build with Nova's message box, Nova's editor
// starting a note): PDFs and PNG, JPEG or WebP images, chosen, dropped or
// pasted. Each is prepared in the browser (a big photo is made smaller, then
// encoded) and shows where it is: preparing, ready, or what went wrong, with
// Retry when trying again could help and Remove always. These checks only
// save a wasted upload; the server checks the bytes again and never trusts
// the type the browser gives.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, FileText, Loader2, RotateCcw, Upload as UploadIcon, X } from 'lucide-react'
import { FILE_TYPES, FILES_MAX, FILES_TOTAL_BYTES, encodeFile } from '@/components/nova/templates/templates-api'
import { SHRINK_OVER_BYTES, imagesOnClipboard, pastedName, shrunkSize } from '@/components/nova/builder/paste'
import { cn } from '@/lib/utils'

// A file ready to send, encoded for the request.
export type Upload = { name: string; data: string; size: number; type: string }

export type Attachment = {
  id: string; name: string; size: number; type: string; raw: File
  state: 'preparing' | 'ready' | 'error'
  data?: string; preview?: string; error?: string; retry?: boolean
}

export const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp'
export const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

// A PNG, JPEG or WebP larger than SHRINK_OVER_BYTES, scaled to fit and sent
// as a JPEG; anything else, or a browser that can't, as it is.
export async function shrinkImage(file: File): Promise<File> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size <= SHRINK_OVER_BYTES || typeof createImageBitmap !== 'function') return file
  try {
    const bitmap = await createImageBitmap(file)
    const size = shrunkSize(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = size.width; canvas.height = size.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, size.width, size.height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob || blob.size >= file.size) return file
    const base = file.name.includes('.') ? file.name.slice(0, file.name.lastIndexOf('.')) : file.name
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

let seq = 0
const typeWord = (t: string) => (t === 'application/pdf' ? 'PDF' : t.replace('image/', '').toUpperCase())

export function useAttachments() {
  const [items, setItems] = useState<Attachment[]>([])
  const live = useRef(items); live.current = items
  // Previews are the browser's own object URLs, let go with the item.
  useEffect(() => () => { for (const a of live.current) if (a.preview) URL.revokeObjectURL(a.preview) }, [])

  const prepare = useCallback(async (id: string, raw: File) => {
    try {
      const f = await shrinkImage(raw)
      const others = live.current.filter(a => a.id !== id && a.state !== 'error').reduce((n, a) => n + a.size, 0)
      if (others + f.size > FILES_TOTAL_BYTES) {
        setItems(list => list.map(a => (a.id === id ? { ...a, state: 'error', size: f.size, error: `Files can add up to ${FILES_TOTAL_BYTES / 1024 / 1024} MB with one message.` } : a)))
        return
      }
      const encoded = await encodeFile(f)
      setItems(list => list.map(a => (a.id === id ? { ...a, state: 'ready', name: f.name, size: f.size, type: f.type, data: encoded.data, error: undefined } : a)))
    } catch {
      setItems(list => list.map(a => (a.id === id ? { ...a, state: 'error', error: 'This file couldn’t be read.', retry: true } : a)))
    }
  }, [])

  const add = useCallback((list: FileList | File[]) => {
    const files = Array.from(list)
    const taken = live.current.filter(a => a.state !== 'error').length
    const made: Attachment[] = files.map((raw, i) => {
      const id = `att-${++seq}`
      const preview = raw.type.startsWith('image/') ? URL.createObjectURL(raw) : undefined
      const base = { id, name: raw.name, size: raw.size, type: raw.type, raw, preview }
      if (!FILE_TYPES.includes(raw.type)) return { ...base, state: 'error' as const, error: `${typeWord(raw.type) || 'This file'} can’t be read: a PDF, or a PNG, JPEG or WebP image.` }
      if (taken + i >= FILES_MAX) return { ...base, state: 'error' as const, error: `Up to ${FILES_MAX} files at a time.` }
      return { ...base, state: 'preparing' as const }
    })
    setItems(l => [...l, ...made])
    for (const a of made) if (a.state === 'preparing') void prepare(a.id, a.raw)
  }, [prepare])

  const remove = useCallback((id: string) => setItems(l => {
    const gone = l.find(a => a.id === id)
    if (gone?.preview) URL.revokeObjectURL(gone.preview)
    return l.filter(a => a.id !== id)
  }), [])
  const retry = useCallback((id: string) => {
    const a = live.current.find(x => x.id === id)
    if (!a) return
    setItems(l => l.map(x => (x.id === id ? { ...x, state: 'preparing', error: undefined } : x)))
    void prepare(id, a.raw)
  }, [prepare])
  // Taken out to send; put back as they were when the send didn't go.
  const take = useCallback(() => { const now = live.current; setItems([]); return now }, [])
  const restore = useCallback((back: Attachment[]) => setItems(back), [])
  const clear = useCallback(() => setItems(l => { for (const a of l) if (a.preview) URL.revokeObjectURL(a.preview); return [] }), [])

  // A screenshot pasted is attached; pasted text stays text.
  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const images = imagesOnClipboard(e.clipboardData.items)
    if (images.length === 0) return
    if (!e.clipboardData.getData('text/plain')) e.preventDefault()
    const names = live.current.map(a => a.name)
    add(images.map(img => { const name = pastedName(names, img.type); names.push(name); return new File([img], name, { type: img.type }) }))
  }, [add])

  const ready = items.filter(a => a.state === 'ready')
  return {
    items, add, remove, retry, take, restore, clear, onPaste,
    preparing: items.some(a => a.state === 'preparing'),
    blocked: items.some(a => a.state === 'error'),
    uploads: (): Upload[] => ready.map(a => ({ name: a.name, data: a.data!, size: a.size, type: a.type })),
  }
}

// Files dragged anywhere over an area (the element given, or the nearest
// [data-drop-zone] above it) are taken, with an outline over that area.
export function useDropZone(anchor: React.RefObject<HTMLElement | null>, onFiles: (files: FileList) => void, enabled = true) {
  const [zone, setZone] = useState<HTMLElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const take = useRef(onFiles); take.current = onFiles
  useEffect(() => {
    const el = anchor.current?.closest<HTMLElement>('[data-drop-zone]') ?? anchor.current
    setZone(el ?? null)
    if (!el || !enabled) return
    let depth = 0
    const files = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    const enter = (e: DragEvent) => { if (files(e)) { depth++; setDragging(true) } }
    const over = (e: DragEvent) => { if (files(e)) { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy' } }
    const leave = (e: DragEvent) => { if (files(e) && --depth <= 0) { depth = 0; setDragging(false) } }
    const drop = (e: DragEvent) => { if (!files(e)) return; e.preventDefault(); depth = 0; setDragging(false); if (e.dataTransfer!.files.length) take.current(e.dataTransfer!.files) }
    el.addEventListener('dragenter', enter); el.addEventListener('dragover', over); el.addEventListener('dragleave', leave); el.addEventListener('drop', drop)
    return () => { el.removeEventListener('dragenter', enter); el.removeEventListener('dragover', over); el.removeEventListener('dragleave', leave); el.removeEventListener('drop', drop) }
  }, [anchor, enabled])
  const overlay = dragging && zone ? createPortal(
    <div className="pointer-events-none absolute inset-2 z-30 grid place-items-center rounded-2xl border-2 border-dashed border-action/70 bg-background/80 backdrop-blur-sm" aria-hidden data-drop-overlay>
      <span className="flex items-center gap-2 text-sm font-medium text-foreground"><UploadIcon className="size-4 text-action-ink" /> Drop a PDF or image to attach it</span>
    </div>, zone) : null
  return { dragging, overlay }
}

// What is attached, each with where it stands.
export function AttachmentTray({ items, onRemove, onRetry, className }: { items: Attachment[]; onRemove: (id: string) => void; onRetry: (id: string) => void; className?: string }) {
  if (!items.length) return null
  return (
    <ul className={cn('flex flex-wrap gap-1.5', className)} aria-label="Attached files" data-attachments>
      {items.map(a => (
        <li key={a.id} className={cn('flex max-w-full items-center gap-2 rounded-xl border py-1 pl-1 pr-1 text-xs',
          a.state === 'error' ? 'border-red-400/35 bg-red-400/[0.06]' : 'border-white/10 bg-white/[0.04]')}
          data-upload={a.name} data-upload-state={a.state}>
          <span className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/6">
            {a.preview
              // eslint-disable-next-line @next/next/no-img-element -- a local preview of the learner's own image, never fetched
              ? <img src={a.preview} alt="" className="size-full object-cover" data-preview />
              : <FileText aria-hidden className="size-4 text-action-ink" />}
            {a.state === 'preparing' && <span className="absolute inset-0 grid place-items-center bg-background/60"><Loader2 aria-hidden className="size-4 animate-spin" /></span>}
          </span>
          <span className="min-w-0">
            <span className="block max-w-44 truncate font-medium text-foreground/90">{a.name}</span>
            <span className={cn('flex items-center gap-1', a.state === 'error' ? 'text-red-300' : 'text-subtle')} role={a.state === 'error' ? 'alert' : undefined}>
              {a.state === 'error' ? <><AlertTriangle aria-hidden className="size-3 shrink-0" /><span className="max-w-56 truncate" title={a.error}>{a.error}</span></>
                : a.state === 'preparing' ? 'Preparing…' : `${typeWord(a.type)} · ${kb(a.size)}`}
            </span>
          </span>
          {a.state === 'error' && a.retry && (
            <button type="button" onClick={() => onRetry(a.id)} aria-label={`Try ${a.name} again`} title="Try again" className="grid size-6 place-items-center rounded text-foreground/70 hover:bg-white/8 hover:text-foreground"><RotateCcw aria-hidden className="size-3.5" /></button>
          )}
          <button type="button" onClick={() => onRemove(a.id)} aria-label={`Remove ${a.name}`} title="Remove" className="grid size-6 place-items-center rounded text-foreground/55 hover:bg-white/8 hover:text-foreground"><X aria-hidden className="size-3.5" /></button>
        </li>
      ))}
    </ul>
  )
}
