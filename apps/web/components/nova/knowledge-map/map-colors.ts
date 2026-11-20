// ─── The map's colours, for a canvas ─────────────────────────────────────────
// The map's colours are CSS: theme tokens (--map-line-strong, --action) and
// each subject's tone (.subject-tone with --sh, globals.css). A canvas cannot
// read var() or color-mix(), so each colour the canvas needs is resolved once
// by the browser itself, on a probe element inside the map (so the theme and
// the tone apply exactly as they do to the cards), and cached. The cache is
// emptied when the theme changes (any attribute of the html element: Kivo's
// theme is html[data-kivo-theme]), checked against a sentinel colour so an
// unrelated attribute change costs one style read and redraws nothing.

// Colours that differ between the themes: when these read differently, the theme changed.
const SENTINEL = 'color-mix(in srgb, var(--sc) 50%, var(--map-line-strong))'

export class MapColors {
  private cache = new Map<string, string>()
  private probe: HTMLElement | null = null
  private watcher: MutationObserver | null = null
  private listeners = new Set<() => void>()

  attach(host: HTMLElement | null) {
    this.probe?.remove()
    this.probe = null
    this.watcher?.disconnect()
    this.cache.clear()
    if (!host || typeof document === 'undefined') return
    const el = document.createElement('i')
    el.setAttribute('aria-hidden', 'true')
    el.className = 'subject-tone'
    el.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none'
    host.appendChild(el)
    this.probe = el
    this.sentinel = this.read(SENTINEL, null)
    this.watcher = new MutationObserver(() => {
      const now = this.read(SENTINEL, null)
      if (now === this.sentinel) return
      this.sentinel = now
      this.cache.clear()
      for (const f of this.listeners) f()
    })
    this.watcher.observe(document.documentElement, { attributes: true })
  }
  onChange(f: () => void) { this.listeners.add(f); return () => { this.listeners.delete(f) } }
  detach() { this.attach(null); this.listeners.clear() }

  // A CSS colour (var(), color-mix() and all) as the browser computes it, in a
  // subject's tone (its hue, or none: the neutral tone).
  get(css: string, hue: number | null = null): string {
    const key = `${hue ?? '-'}|${css}`
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit
    const out = this.read(css, hue)
    this.cache.set(key, out)
    return out
  }
  private sentinel = ''
  private read(css: string, hue: number | null): string {
    const el = this.probe
    if (!el) return 'transparent'
    if (hue === null) el.style.removeProperty('--sh'); else el.style.setProperty('--sh', String(hue))
    el.style.color = ''
    el.style.color = css
    return getComputedStyle(el).color || 'transparent'
  }
}
