'use client'

// A PDF beside a note, drawn by PDF.js inside Kivo instead of the browser's
// own viewer, so the reader has its own zoom (the page around it never
// scales), its own pages, and text that can be selected, highlighted, quoted
// into a note or captured as an image.
//
// The file is fetched by the browser from where it lives (the source must
// allow it: arXiv does); Kivo stores no copy and re-serves nothing. When the
// file can't be read this way, the caller falls back to the browser's viewer
// and says what is missing there.
//
// Pages are drawn when they come near the view and dropped when far, so a
// long paper stays light. While zooming, the drawn page is stretched at once
// and drawn again sharp a moment later; the text layer scales with it by one
// CSS variable, so selections and highlights stay on their words.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import {
  ArrowDownToLine, ChevronDown, ChevronUp, Copy, Crop, Expand, Highlighter, Image as ImageIcon, Loader2, Maximize, Minimize,
  Minus, NotebookPen, Plus, Shrink, Trash2, X,
} from 'lucide-react'
import {
  CSS_PER_POINT, captureScale, cleanPassage, clampZoom, fitZoom, inRect, pageAt, pageTops, rectsOnPage, stepZoom,
  type PageSize, type Rect,
} from './pdf-geometry'
import { clientKey } from './reader-send'

type Pdfjs = typeof import('pdfjs-dist')
let loading: Promise<Pdfjs> | null = null
function pdfjs(): Promise<Pdfjs> {
  loading ??= import('pdfjs-dist').then(m => {
    if (!m.GlobalWorkerOptions.workerPort) {
      m.GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' })
    }
    return m
  })
  return loading
}

export type Highlight = { id: string; page: number; rects: Rect[]; text: string; color: string; pending?: boolean }
export type Captured = { blob: Blob; url: string; page: number; width: number; height: number; region: boolean; key: string }
export type Taken = { kind: 'passage'; text: string; page: number } | { kind: 'image'; capture: Captured }

const HL: Record<string, string> = { yellow: 'rgba(250,204,21,0.38)', green: 'rgba(74,222,128,0.32)', blue: 'rgba(96,165,250,0.32)', pink: 'rgba(244,114,182,0.32)' }
const tool = 'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-white/6 hover:text-foreground disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-ring'

// ── One page ──────────────────────────────────────────────────────────────────

function Page({ doc, n, size, zoom, root, highlights, regionMode, onRegion, register }: {
  doc: PDFDocumentProxy; n: number; size: PageSize; zoom: number; root: HTMLElement | null
  highlights: Highlight[]; regionMode: boolean
  onRegion: (page: number, r: Rect) => void
  register: (n: number, el: HTMLDivElement | null) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const textBox = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [drawn, setDrawn] = useState(false)
  const [error, setError] = useState(false)
  const textMade = useRef(false)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

  useEffect(() => { register(n, box.current); return () => register(n, null) }, [n, register])
  useEffect(() => {
    const el = box.current
    if (!el || !root) return
    const io = new IntersectionObserver(([e]) => setNear(!!e?.isIntersecting), { root, rootMargin: '1400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [root])

  // Drawn sharp at this zoom and this screen's pixel density, a moment after
  // the zoom settles; until then the last drawing is stretched.
  useEffect(() => {
    if (!near) {
      // Far away: let the memory go. The text layer stays (it is light).
      const c = canvas.current
      if (c) { c.width = 0; c.height = 0 }
      setDrawn(false)
      return
    }
    let task: RenderTask | null = null
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const page = await doc.getPage(n)
        if (cancelled) return
        const dpr = Math.min(window.devicePixelRatio || 1, 3)
        const viewport = page.getViewport({ scale: zoom * CSS_PER_POINT * dpr })
        const off = document.createElement('canvas')
        off.width = Math.floor(viewport.width); off.height = Math.floor(viewport.height)
        task = page.render({ canvas: off, canvasContext: off.getContext('2d')!, viewport })
        await task.promise
        if (cancelled || !canvas.current) return
        const c = canvas.current
        c.width = off.width; c.height = off.height
        c.getContext('2d')?.drawImage(off, 0, 0)
        setDrawn(true); setError(false)
        if (!textMade.current && textBox.current) {
          textMade.current = true
          const { TextLayer } = await pdfjs()
          const layer = new TextLayer({ textContentSource: page.streamTextContent(), container: textBox.current, viewport: page.getViewport({ scale: 1 }) })
          await layer.render()
        }
      } catch (err) {
        if (!cancelled && (err as { name?: string })?.name !== 'RenderingCancelledException') setError(true)
      }
    }, drawn ? 140 : 0)
    return () => { cancelled = true; window.clearTimeout(timer); task?.cancel() }
    // drawn is read for the delay only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, zoom, doc, n])

  const w = size.w * CSS_PER_POINT * zoom, h = size.h * CSS_PER_POINT * zoom
  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const dragRect = drag && { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) }

  return (
    <div ref={box} data-page={n} className="pdf-page relative mx-auto bg-white shadow-[0_1px_3px_rgba(0,0,0,0.4),0_8px_24px_-12px_rgba(0,0,0,0.6)]"
      style={{ width: w, height: h, ['--total-scale-factor' as string]: zoom * CSS_PER_POINT, ['--scale-round-x' as string]: '1px', ['--scale-round-y' as string]: '1px' }}
      aria-label={`Page ${n}`} role="region">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden />
      {!drawn && !error && <div className="absolute inset-0 grid place-items-center text-xs text-neutral-400" aria-hidden>Page {n}</div>}
      {error && <div className="absolute inset-0 grid place-items-center px-6 text-center text-xs text-neutral-500">Page {n} couldn&apos;t be drawn.</div>}
      {/* Highlights: under the text, over the drawing. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {highlights.flatMap(hl => hl.rects.map((r, i) => (
          <span key={`${hl.id}-${i}`} className="absolute rounded-[2px] mix-blend-multiply" data-highlight={hl.id}
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, background: HL[hl.color] ?? HL.yellow, opacity: hl.pending ? 0.6 : 1 }} />
        )))}
      </div>
      <div ref={textBox} className="textLayer" data-text-layer={n} />
      {regionMode && (
        <div className="absolute inset-0 z-10 cursor-crosshair touch-none" data-region-layer
          onPointerDown={e => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); const p = at(e); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }) }}
          onPointerMove={e => { if (drag) { const p = at(e); setDrag(d => d && { ...d, x1: p.x, y1: p.y }) } }}
          onPointerUp={() => {
            if (dragRect && dragRect.w * w > 12 && dragRect.h * h > 12) onRegion(n, dragRect)
            setDrag(null)
          }}>
          {dragRect && <span className="absolute border-2 border-sky-500 bg-sky-400/15" style={{ left: `${dragRect.x * 100}%`, top: `${dragRect.y * 100}%`, width: `${dragRect.w * 100}%`, height: `${dragRect.h * 100}%` }} />}
        </div>
      )}
    </div>
  )
}

// ── Capturing ────────────────────────────────────────────────────────────────

// A page, or a region of it, drawn afresh for the capture (not the screen's
// pixels, so the zoom doesn't matter and nothing around the page is caught),
// as PNG, or WebP/JPEG when that would be too large to keep.
async function capture(doc: PDFDocumentProxy, n: number, region: Rect | null): Promise<Captured> {
  const page = await doc.getPage(n)
  const base = page.getViewport({ scale: 1 })
  const scale = captureScale({ w: base.width, h: base.height }, region)
  const viewport = page.getViewport({ scale })
  const full = document.createElement('canvas')
  full.width = Math.floor(viewport.width); full.height = Math.floor(viewport.height)
  await page.render({ canvas: full, canvasContext: full.getContext('2d')!, viewport }).promise
  let out = full
  if (region) {
    out = document.createElement('canvas')
    const sx = Math.floor(region.x * full.width), sy = Math.floor(region.y * full.height)
    out.width = Math.max(1, Math.floor(region.w * full.width)); out.height = Math.max(1, Math.floor(region.h * full.height))
    const g = out.getContext('2d')!
    g.fillStyle = '#fff'; g.fillRect(0, 0, out.width, out.height)
    g.drawImage(full, sx, sy, out.width, out.height, 0, 0, out.width, out.height)
  }
  const as = (type: string, q?: number) => new Promise<Blob | null>(res => out.toBlob(res, type, q))
  let blob = await as('image/png')
  if (!blob || blob.size > 2_300_000) blob = await as('image/webp', 0.92)
  if (!blob || blob.size > 2_300_000 || blob.type !== 'image/webp') blob = await as('image/jpeg', 0.9)
  if (!blob) throw new Error('capture')
  return { blob, url: URL.createObjectURL(blob), page: n, width: out.width, height: out.height, region: !!region, key: clientKey('cap') }
}

// ── The reader ───────────────────────────────────────────────────────────────

export function PdfReader({ url, docKey, onTake, onFail, toolbarStart }: {
  // Where the browser fetches it from, and the address highlights are kept under.
  url: string; docKey: string
  // A passage or a capture the learner wants in a note.
  onTake: (t: Taken) => void
  // The file couldn't be read here: the caller shows the browser's viewer.
  onFail: (why: string) => void
  toolbarStart?: React.ReactNode
}) {
  const shell = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [zoom, setZoom] = useState(1)
  const [mode, setMode] = useState<'width' | 'page' | 'custom'>('width')
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [full, setFull] = useState(false)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [hlError, setHlError] = useState<string | null>(null)
  const [sel, setSel] = useState<{ text: string; pages: Array<{ n: number; rects: Rect[] }>; x: number; y: number } | null>(null)
  const [picked, setPicked] = useState<{ hl: Highlight; x: number; y: number } | null>(null)
  const [regionMode, setRegionMode] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const pages = useRef(new Map<number, HTMLDivElement>())
  const register = useCallback((n: number, el: HTMLDivElement | null) => { if (el) pages.current.set(n, el); else pages.current.delete(n) }, [])

  // Open the document.
  useEffect(() => {
    let live = true
    let opened: PDFDocumentProxy | null = null
    void (async () => {
      try {
        const lib = await pdfjs()
        const task = lib.getDocument({ url, isEvalSupported: false, withCredentials: false })
        opened = await task.promise
        if (!live) { void opened.destroy(); return }
        const all: PageSize[] = []
        for (let i = 1; i <= opened.numPages; i++) {
          const v = (await opened.getPage(i)).getViewport({ scale: 1 })
          all.push({ w: v.width, h: v.height })
        }
        if (!live) return
        setSizes(all); setDoc(opened)
      } catch (err) {
        const name = (err as { name?: string })?.name
        if (live) onFail(name === 'PasswordException' ? 'This PDF is password-protected.' : name === 'InvalidPDFException' ? 'This file isn’t a PDF Kivo’s reader can open.' : 'The site doesn’t let Kivo’s reader load this file.')
      }
    })()
    return () => { live = false; void opened?.destroy() }
  }, [url, onFail])

  // The learner's highlights on this document.
  useEffect(() => {
    let live = true
    void fetch(`/api/nova/notes/highlights?url=${encodeURIComponent(docKey)}`).then(r => r.json()).then((d: { ok?: boolean; highlights?: Highlight[] }) => {
      if (live && d?.ok && d.highlights) setHighlights(d.highlights)
    }).catch(() => { if (live) setHlError('Your highlights couldn’t be loaded.') })
    return () => { live = false }
  }, [docKey])

  // Fit to the width or the page, and again when the reader is resized.
  useEffect(() => {
    const el = scroller.current
    if (!el || mode === 'custom' || !sizes.length) return
    const fit = () => setZoom(fitZoom(mode, sizes, { width: el.clientWidth, height: el.clientHeight }))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [mode, sizes])

  const tops = useMemo(() => pageTops(sizes, zoom), [sizes, zoom])
  // A zoom keeps the place being read: the same point of the same page stays put.
  const zoomTo = useCallback((next: number, fit: 'width' | 'page' | 'custom' = 'custom') => {
    const el = scroller.current
    const z = clampZoom(next)
    if (el && sizes.length) {
      const mid = el.scrollTop + el.clientHeight * 0.4
      const i = Math.max(0, pageAt(tops, el.scrollTop, el.clientHeight) - 1)
      const within = (mid - tops[i]!) / Math.max(1, sizes[i]!.h * CSS_PER_POINT * zoom)
      const after = pageTops(sizes, z)
      requestAnimationFrame(() => { el.scrollTop = after[i]! + within * sizes[i]!.h * CSS_PER_POINT * z - el.clientHeight * 0.4 })
    }
    setMode(fit); if (fit === 'custom') setZoom(z)
  }, [sizes, tops, zoom])

  // Pinching a trackpad or Ctrl/⌘ + wheel zooms the paper, not the page.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomTo(zoom * Math.exp(-e.deltaY * 0.01))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [zoom, zoomTo])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const n = pageAt(tops, el.scrollTop, el.clientHeight)
    if (n !== page) { setPage(n); setPageInput(String(n)) }
    setSel(null); setPicked(null)
  }
  const goTo = (n: number) => {
    const el = scroller.current
    const k = Math.min(Math.max(1, Math.round(n)), sizes.length)
    if (!el || !Number.isFinite(k)) return
    el.scrollTo({ top: tops[k - 1]! - 8 })
    setPage(k); setPageInput(String(k))
  }

  // Keys while the reader has focus: + − 0 zoom, ←/→ PageUp/PageDown pages.
  const onKey = (e: React.KeyboardEvent) => {
    const typing = e.target instanceof HTMLInputElement
    if (typing) return
    if ((e.key === '+' || e.key === '=') && !e.altKey) { e.preventDefault(); zoomTo(stepZoom(zoom, 1)) }
    else if (e.key === '-' && !e.altKey) { e.preventDefault(); zoomTo(stepZoom(zoom, -1)) }
    else if (e.key === '0' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); zoomTo(1) }
    else if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !e.shiftKey)) { e.preventDefault(); goTo(page + 1) }
    else if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !e.shiftKey)) { e.preventDefault(); goTo(page - 1) }
    else if (e.key === 'Escape') { if (regionMode) { setRegionMode(false); e.stopPropagation() } else if (sel) { window.getSelection()?.removeAllRanges(); setSel(null); e.stopPropagation() } }
  }

  // Full screen: the reader alone, its own controls still there.
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === shell.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void shell.current?.requestFullscreen?.().catch(() => setNote('Full screen isn’t available here.')) }

  // A selection in the text: its words and where it is on each page.
  useEffect(() => {
    let timer = 0
    const read = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const s = window.getSelection()
        const text = s?.toString() ?? ''
        const el = scroller.current
        if (!s || s.rangeCount === 0 || !text.trim() || !el || !el.contains(s.anchorNode) || !el.contains(s.focusNode)) { setSel(null); return }
        const range = s.getRangeAt(0)
        const client = [...range.getClientRects()].map(r => ({ left: r.left, top: r.top, width: r.width, height: r.height }))
        const byPage: Array<{ n: number; rects: Rect[] }> = []
        for (const [n, box] of pages.current) {
          const b = box.getBoundingClientRect()
          const mine = client.filter(r => r.top + r.height / 2 >= b.top && r.top + r.height / 2 <= b.bottom)
          const rects = rectsOnPage(mine, { left: b.left, top: b.top, width: b.width, height: b.height })
          if (rects.length) byPage.push({ n, rects })
        }
        byPage.sort((a, b) => a.n - b.n)
        if (!byPage.length) { setSel(null); return }
        const bound = range.getBoundingClientRect()
        const outer = el.getBoundingClientRect()
        setSel({ text: cleanPassage(text), pages: byPage, x: Math.min(Math.max(bound.left + bound.width / 2, outer.left + 150), outer.right - 150), y: Math.max(bound.top - 46, outer.top + 4) })
        setPicked(null)
      }, 120)
    }
    document.addEventListener('selectionchange', read)
    return () => { document.removeEventListener('selectionchange', read); window.clearTimeout(timer) }
  }, [])

  // A click on a highlight (with nothing selected) offers it back.
  const onClick = (e: React.MouseEvent) => {
    if (regionMode || window.getSelection()?.toString().trim()) return
    const box = (e.target as HTMLElement).closest('[data-page]') as HTMLElement | null
    if (!box) { setPicked(null); return }
    const n = Number(box.dataset.page), b = box.getBoundingClientRect()
    const p = { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height }
    const hl = highlights.find(h => h.page === n && !h.pending && h.rects.some(r => inRect(p, r)))
    setPicked(hl ? { hl, x: e.clientX, y: e.clientY - 46 } : null)
  }

  async function highlight() {
    if (!sel) return
    const made = sel.pages.map(p => ({ id: clientKey('hl'), page: p.n, rects: p.rects, text: sel.text, color: 'yellow', pending: true }))
    setHighlights(h => [...h, ...made]); window.getSelection()?.removeAllRanges(); setSel(null); setHlError(null)
    for (const m of made) {
      try {
        const res = await fetch('/api/nova/notes/highlights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docUrl: docKey, page: m.page, rects: m.rects, text: m.text, color: m.color, clientKey: m.id }) })
        const data = await res.json().catch(() => null) as { ok?: boolean; highlight?: Highlight; message?: string } | null
        if (!res.ok || !data?.ok || !data.highlight) throw new Error(data?.message ?? 'failed')
        setHighlights(h => h.map(x => (x.id === m.id ? data.highlight! : x)))
      } catch (err) {
        setHighlights(h => h.filter(x => x.id !== m.id))
        setHlError(`That highlight wasn’t saved${err instanceof Error && err.message !== 'failed' ? `: ${err.message}` : ''}. Select it and try again.`)
      }
    }
  }
  async function unhighlight(hl: Highlight) {
    setPicked(null)
    setHighlights(h => h.filter(x => x.id !== hl.id))
    try {
      const res = await fetch(`/api/nova/notes/highlights/${encodeURIComponent(hl.id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
    } catch {
      setHighlights(h => [...h, hl]); setHlError('That highlight wasn’t removed. Try again.')
    }
  }
  async function copy() {
    if (!sel) return
    try { await navigator.clipboard.writeText(sel.text); setNote('Copied.') } catch { setNote('Copying isn’t allowed here. Use ⌘C / Ctrl+C.') }
    setSel(null)
  }
  async function take(region: Rect | null, n = page) {
    if (!doc) return
    setRegionMode(false); setBusy(region ? 'Capturing the region…' : `Capturing page ${n}…`)
    try { onTake({ kind: 'image', capture: await capture(doc, n, region) }) }
    catch { setNote('That capture didn’t work. Try again.') }
    setBusy(null)
  }
  useEffect(() => { if (!note) return; const t = window.setTimeout(() => setNote(null), 3500); return () => window.clearTimeout(t) }, [note])

  const pct = `${Math.round(zoom * 100)}%`
  return (
    <div ref={shell} className="flex min-h-0 flex-1 flex-col bg-[#1b1f27]" data-pdf-reader onKeyDown={onKey}>
      <div className="flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-white/6 bg-background/80 px-2 text-xs" role="toolbar" aria-label="Reader" data-pdf-toolbar>
        {toolbarStart}
        <button type="button" className={tool} onClick={() => goTo(page - 1)} disabled={page <= 1} aria-label="Previous page" title="Previous page (←)"><ChevronUp className="size-4" /></button>
        <label className="flex shrink-0 items-center gap-1 whitespace-nowrap text-subtle">
          <span className="sr-only">Page</span>
          <input value={pageInput} inputMode="numeric" onChange={e => setPageInput(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter') goTo(Number(pageInput) || page) }} onBlur={() => setPageInput(String(page))}
            className="h-7 w-9 rounded-md border border-white/10 bg-transparent text-center tabular-nums text-foreground focus:border-sky-400/60 focus:outline-none" data-pdf-page-input aria-label="Page number" />
          <span className="tabular-nums" data-pdf-pages>/ {sizes.length || '…'}</span>
        </label>
        <button type="button" className={tool} onClick={() => goTo(page + 1)} disabled={page >= sizes.length} aria-label="Next page" title="Next page (→)"><ChevronDown className="size-4" /></button>
        <span className="mx-1 h-5 w-px shrink-0 bg-white/10" aria-hidden />
        <button type="button" className={tool} onClick={() => zoomTo(stepZoom(zoom, -1))} disabled={zoom <= 0.251} aria-label="Zoom out" title="Zoom out (−)"><Minus className="size-4" /></button>
        <button type="button" onClick={() => zoomTo(1)} className="h-7 min-w-12 shrink-0 rounded-md px-1.5 tabular-nums text-foreground/80 hover:bg-white/6" title="Reset to 100% (0)" aria-label={`Zoom ${pct}. Reset to 100%`} data-pdf-zoom>{pct}</button>
        <button type="button" className={tool} onClick={() => zoomTo(stepZoom(zoom, 1))} disabled={zoom >= 3.999} aria-label="Zoom in" title="Zoom in (+)"><Plus className="size-4" /></button>
        <button type="button" className={`${tool} ${mode === 'width' ? 'bg-white/8 text-foreground' : ''}`} onClick={() => zoomTo(zoom, 'width')} aria-pressed={mode === 'width'} aria-label="Fit to width" title="Fit to width" data-pdf-fit="width"><Expand className="size-3.5" /></button>
        <button type="button" className={`${tool} ${mode === 'page' ? 'bg-white/8 text-foreground' : ''}`} onClick={() => zoomTo(zoom, 'page')} aria-pressed={mode === 'page'} aria-label="Fit the page" title="Fit the whole page" data-pdf-fit="page"><Shrink className="size-3.5" /></button>
        <span className="mx-1 h-5 w-px shrink-0 bg-white/10" aria-hidden />
        <button type="button" className={tool} onClick={() => void take(null)} disabled={!doc || !!busy} aria-label={`Capture page ${page} into a note`} title="Capture this page into a note" data-pdf-capture-page><ImageIcon className="size-4" /></button>
        <button type="button" className={`${tool} ${regionMode ? 'bg-sky-400/15 text-sky-200' : ''}`} onClick={() => setRegionMode(m => !m)} disabled={!doc || !!busy} aria-pressed={regionMode} aria-label="Capture a region into a note" title="Capture a region: drag over a figure or an equation" data-pdf-capture-region><Crop className="size-4" /></button>
        <span className="flex-1" />
        <button type="button" className={tool} onClick={toggleFull} aria-label={full ? 'Leave full screen' : 'Read full screen'} title={full ? 'Leave full screen' : 'Full screen'} data-pdf-fullscreen>{full ? <Minimize className="size-3.5" /> : <Maximize className="size-3.5" />}</button>
      </div>

      {(regionMode || busy || hlError || note) && (
        <p className="flex shrink-0 items-center gap-2 border-b border-white/6 bg-sky-400/[0.06] px-3 py-1.5 text-[11px] text-foreground/75" role="status" data-pdf-status>
          {busy ? <><Loader2 aria-hidden className="size-3.5 animate-spin" /> {busy}</>
            : regionMode ? <>Drag over a figure, a table or an equation to capture it. Esc to stop.</>
            : hlError ? <span className="text-amber-200">{hlError}</span> : note}
          {regionMode && <button type="button" onClick={() => setRegionMode(false)} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 text-foreground/70 hover:text-foreground"><X className="size-3" /> Stop</button>}
        </p>
      )}

      <div ref={el => { scroller.current = el; if (el !== root) setRoot(el) }} tabIndex={0} onScroll={onScroll} onClick={onClick}
        className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sky-400/50"
        aria-label="The PDF. Select text to highlight it or add it to a note." data-pdf-scroll>
        {!doc ? (
          <div className="grid h-full place-items-center text-xs text-subtle" role="status" data-pdf-state="loading">
            <span className="inline-flex items-center gap-2"><Loader2 aria-hidden className="size-4 animate-spin" /> Opening the PDF…</span>
          </div>
        ) : (
          <div className="flex w-max min-w-full flex-col items-center gap-4 px-6 py-4" data-pdf-state="ready">
            {sizes.map((s, i) => (
              <Page key={i} doc={doc} n={i + 1} size={s} zoom={zoom} root={root} register={register} regionMode={regionMode}
                highlights={highlights.filter(h => h.page === i + 1)} onRegion={(n, r) => void take(r, n)} />
            ))}
          </div>
        )}
      </div>

      {sel && (
        <div role="toolbar" aria-label="Selected text" style={{ left: sel.x, top: sel.y }} onMouseDown={e => e.preventDefault()}
          className="fixed z-50 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-white/10 bg-background/95 p-1 text-xs shadow-float backdrop-blur" data-pdf-selection>
          <button type="button" onClick={() => void highlight()} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 font-medium text-foreground hover:bg-white/8" data-pdf-highlight><Highlighter className="size-3.5 text-yellow-300" /> Highlight</button>
          <button type="button" onClick={() => { onTake({ kind: 'passage', text: sel.text, page: sel.pages[0]!.n }); window.getSelection()?.removeAllRanges(); setSel(null) }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-action px-2.5 font-semibold text-action-foreground hover:bg-action-hover" data-pdf-add-note><NotebookPen className="size-3.5" /> Add to note</button>
          <button type="button" onClick={() => void copy()} className="inline-flex size-8 items-center justify-center rounded-lg text-foreground/70 hover:bg-white/8 hover:text-foreground" aria-label="Copy" title="Copy"><Copy className="size-3.5" /></button>
        </div>
      )}
      {picked && (
        <div role="toolbar" aria-label="Highlight" style={{ left: picked.x, top: picked.y }}
          className="fixed z-50 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-white/10 bg-background/95 p-1 text-xs shadow-float backdrop-blur" data-pdf-picked>
          <button type="button" onClick={() => { onTake({ kind: 'passage', text: picked.hl.text, page: picked.hl.page }); setPicked(null) }} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-foreground hover:bg-white/8"><ArrowDownToLine className="size-3.5" /> Add to note</button>
          <button type="button" onClick={() => void unhighlight(picked.hl)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-foreground/80 hover:bg-rose-500/10 hover:text-rose-300" data-pdf-unhighlight><Trash2 className="size-3.5" /> Remove highlight</button>
          <button type="button" onClick={() => setPicked(null)} className="inline-flex size-8 items-center justify-center rounded-lg text-foreground/60 hover:bg-white/8" aria-label="Close"><X className="size-3.5" /></button>
        </div>
      )}
    </div>
  )
}
