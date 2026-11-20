// ─── The graph, painted on a canvas ──────────────────────────────────────────
// The Knowledge Map's lines and what moves along them, on Canvas 2D under (and,
// for the focus, over) the cards, which stay SVG for the pointer, the keyboard,
// screen readers and Nova's browser agent ([data-node-id]).
//
// Why: drawn as SVG, each line was up to five elements (about 2,500 at 500
// cards), every one of them laid out, painted and layerized again whenever the
// drawing changed, and up to 140 travelling signals animated stroke-dashoffset
// on the main thread forever, idle or not (about a third of the main thread
// and 1,000 raster tasks a second at 500 cards). Here a frame is a handful of
// stroke() calls: the lines are merged into one Path2D per look (colour,
// width, dash, opacity), built once per layout, and a canvas is painted only
// when the view moves, its scene changes or something on it is animating.
//
// The scene is plain data (map units, CSS colours) made by the map from its
// own state; colours are resolved by MapColors. A painter for MapCamera.

import type { View } from './overview'
import type { MapColors } from './map-colors'

// A line. width is in screen pixels when `screen` (as SVG's non-scaling-stroke), else map units.
export interface StrokePrim {
  d: string; color: string; hue: number | null; width: number; screen: boolean; alpha: number
  dash?: number[]; round?: boolean
  // Arriving: drawn along its length ('draw') or faded in ('fade'), from `delay` ms after the scene's start, over `dur`.
  arrive?: 'draw' | 'fade'; delay?: number; dur?: number
}
export interface DotPrim { x: number; y: number; r: number; color: string; hue: number | null; alpha: number; delay?: number; dur?: number }
// A soft light: a radial gradient in an ellipse (a subject's region).
export interface GlowPrim { cx: number; cy: number; rx: number; ry: number; color: string; hue: number | null; stops: Array<[number, number]>; fadeMs?: number }
// Something travelling along a line: a dash pattern (screen pixels) moving `travel` pixels every `period` ms.
export interface MoverPrim { d: string; color: string; hue: number | null; width: number; alpha: number; dash: number[]; period: number; travel: number; from: number; phase: number }
export interface Scene {
  glows?: GlowPrim[]; strokes?: StrokePrim[]; dots?: DotPrim[]; movers?: MoverPrim[]
  // performance.now() the arrivals' delays count from (0: they are times themselves).
  start?: number
  // Fade the whole scene (and its glows' fadeMs) in from this performance.now() (a new level).
  fadeFrom?: number
  fadeMs?: number
}

type Batch = { path: Path2D; color: string; width: number; screen: boolean; alpha: number; dash: number[] | null; round: boolean }
type Arriving = { path: Path2D; prim: StrokePrim; color: string; length: number }
type DotBatch = { path: Path2D; color: string; alpha: number }
type Mover = { path: Path2D; prim: MoverPrim; color: string }
type Glow = { prim: GlowPrim; gradient: CanvasGradient | null; color: string }

const MAX_DPR = 2
const pathCache = new Map<string, Path2D>()
// Path2D objects for path data, kept across scenes (a hover rebuilds the focus scene from the same lines).
function pathOf(d: string): Path2D {
  let p = pathCache.get(d)
  if (!p) { p = new Path2D(d); if (pathCache.size > 20000) pathCache.clear(); pathCache.set(d, p) }
  return p
}
// The length of a path, for drawing it along its length: the browser's own measure, else an upper bound.
let measurer: SVGPathElement | null = null
function lengthOf(d: string): number {
  try {
    measurer ??= document.createElementNS('http://www.w3.org/2000/svg', 'path')
    measurer.setAttribute('d', d)
    const l = measurer.getTotalLength()
    if (Number.isFinite(l) && l > 0) return l
  } catch { /* fall through */ }
  const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
  let len = 0
  for (let i = 2; i + 1 < nums.length; i += 2) len += Math.hypot(nums[i]! - nums[i - 2]!, nums[i + 1]! - nums[i - 1]!)
  return Math.max(1, len * 1.2)
}
const ease = (p: number) => 1 - (1 - p) ** 3

export class GraphCanvas {
  private ctx: CanvasRenderingContext2D | null
  private batches: Batch[] = []
  private arriving: Arriving[] = []
  private dots: DotBatch[] = []
  private arrivingDots: Array<{ prim: DotPrim; color: string }> = []
  private movers: Mover[] = []
  private glows: Glow[] = []
  private scene: Scene = {}
  private arrivalsEnd = 0
  private dirty = true
  private last: View | null = null
  private dpr = 1
  // Movers show while the map is in use, then fade and stop (an idle map paints nothing).
  private activeFrom = 0
  private activeUntil = -Infinity
  private moversShown = false
  private reduced = false

  constructor(private canvas: HTMLCanvasElement, private colors: MapColors, private size: () => { w: number; h: number }) {
    this.ctx = canvas.getContext('2d', { alpha: true })
  }

  setReduced(on: boolean) { if (this.reduced !== on) { this.reduced = on; this.dirty = true } }
  // Keeps the movers going for `ms` from now: faded in when they were at rest, faded out after.
  wake(ms: number, now = performance.now()) {
    if (now > this.activeUntil + MOVER_FADE) this.activeFrom = now
    this.activeUntil = Math.max(this.activeUntil, now + ms)
  }
  sleep() { this.activeUntil = -Infinity }
  // The colours changed (the theme): resolve them again.
  recolor() { this.compile(); this.dirty = true }

  setScene(scene: Scene) {
    this.scene = scene
    this.compile()
    this.dirty = true
  }

  private compile() {
    const s = this.scene, now = performance.now(), start = s.start ?? 0
    const keyed = new Map<string, Batch>()
    this.arriving = []
    this.arrivalsEnd = 0
    for (const p of s.strokes ?? []) {
      const color = this.colors.get(p.color, p.hue)
      const ends = p.arrive && !this.reduced ? start + (p.delay ?? 0) + (p.dur ?? 0) : 0
      if (ends > now) {
        this.arriving.push({ path: pathOf(p.d), prim: p, color, length: p.arrive === 'draw' ? lengthOf(p.d) : 0 })
        this.arrivalsEnd = Math.max(this.arrivalsEnd, ends)
        continue
      }
      const key = `${color}|${p.width}|${p.screen}|${p.alpha}|${p.dash?.join(',') ?? ''}|${p.round ? 1 : 0}`
      let b = keyed.get(key)
      if (!b) { b = { path: new Path2D(), color, width: p.width, screen: p.screen, alpha: p.alpha, dash: p.dash ?? null, round: !!p.round }; keyed.set(key, b) }
      b.path.addPath(pathOf(p.d))
    }
    this.batches = [...keyed.values()]
    const dotKeyed = new Map<string, DotBatch>()
    this.arrivingDots = []
    for (const p of s.dots ?? []) {
      const color = this.colors.get(p.color, p.hue)
      const ends = p.delay !== undefined && !this.reduced ? start + p.delay + (p.dur ?? 0) : 0
      if (ends > now) { this.arrivingDots.push({ prim: p, color }); this.arrivalsEnd = Math.max(this.arrivalsEnd, ends); continue }
      const key = `${color}|${p.alpha}`
      let b = dotKeyed.get(key)
      if (!b) { b = { path: new Path2D(), color, alpha: p.alpha }; dotKeyed.set(key, b) }
      b.path.moveTo(p.x + p.r, p.y)
      b.path.arc(p.x, p.y, p.r, 0, Math.PI * 2)
    }
    this.dots = [...dotKeyed.values()]
    this.movers = (s.movers ?? []).map(p => ({ path: pathOf(p.d), prim: p, color: this.colors.get(p.color, p.hue) }))
    const ctx = this.ctx
    this.glows = (s.glows ?? []).map(p => {
      const color = this.colors.get(p.color, p.hue)
      let gradient: CanvasGradient | null = null
      if (ctx) {
        gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
        for (const [at, a] of p.stops) gradient.addColorStop(at, withAlpha(color, a))
      }
      if (p.fadeMs && !this.reduced) this.arrivalsEnd = Math.max(this.arrivalsEnd, (s.fadeFrom ?? start) + p.fadeMs)
      return { prim: p, gradient, color }
    })
    if (s.fadeMs && !this.reduced) this.arrivalsEnd = Math.max(this.arrivalsEnd, (s.fadeFrom ?? start) + s.fadeMs)
  }

  // Paints the scene at `view`. True while something on it is still moving.
  paint = (view: View, time: number): boolean => {
    const ctx = this.ctx
    if (!ctx) return false
    const { w, h } = this.size()
    const dpr = Math.min(MAX_DPR, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
    const cw = Math.max(1, Math.round(w * dpr)), ch = Math.max(1, Math.round(h * dpr))
    if (this.canvas.width !== cw || this.canvas.height !== ch || dpr !== this.dpr) {
      this.canvas.width = cw; this.canvas.height = ch; this.dpr = dpr; this.dirty = true
    }
    const arriving = time < this.arrivalsEnd
    // Once every arrival is done, its lines join the merged paths (one rebuild).
    if (!arriving && (this.arriving.length || this.arrivingDots.length)) { this.compile(); this.dirty = true }
    const moversOn = this.movers.length > 0 && !this.reduced && time < this.activeUntil + MOVER_FADE
    const moved = !this.last || this.last.x !== view.x || this.last.y !== view.y || this.last.k !== view.k
    if (!moved && !this.dirty && !arriving && !moversOn && !this.moversShown) return false
    this.last = view
    this.dirty = false
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cw, ch)
    const k = view.k
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * view.x, dpr * view.y)
    const s = this.scene, start = s.start ?? 0
    const fadeFrom = s.fadeFrom ?? start
    const sceneAlpha = s.fadeMs && !this.reduced ? Math.min(1, Math.max(0, (time - fadeFrom) / s.fadeMs)) : 1
    ctx.lineJoin = 'round'
    // Regions' light first, then lines, then their ports.
    for (const g of this.glows) {
      if (!g.gradient) continue
      const a = g.prim.fadeMs && !this.reduced ? Math.min(1, Math.max(0, (time - fadeFrom) / g.prim.fadeMs)) : 1
      ctx.save()
      ctx.globalAlpha = a * sceneAlpha
      ctx.translate(g.prim.cx, g.prim.cy)
      ctx.scale(g.prim.rx, g.prim.ry)
      ctx.fillStyle = g.gradient
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }
    for (const b of this.batches) {
      ctx.globalAlpha = b.alpha * sceneAlpha
      ctx.strokeStyle = b.color
      ctx.lineWidth = b.screen ? b.width / k : b.width
      ctx.lineCap = b.round ? 'round' : 'butt'
      ctx.setLineDash(b.dash ? b.dash.map(x => x / k) : [])
      ctx.stroke(b.path)
    }
    for (const a of this.arriving) {
      const p = a.prim
      const at = Math.min(1, Math.max(0, (time - start - (p.delay ?? 0)) / Math.max(1, p.dur ?? 1)))
      if (at <= 0) continue
      const e = ease(at)
      ctx.strokeStyle = a.color
      ctx.lineWidth = p.screen ? p.width / k : p.width
      ctx.lineCap = p.round ? 'round' : 'butt'
      if (p.arrive === 'draw') {
        ctx.globalAlpha = p.alpha * sceneAlpha
        ctx.setLineDash([a.length * e, a.length + 1])
      } else {
        ctx.globalAlpha = p.alpha * e * sceneAlpha
        ctx.setLineDash(p.dash ? p.dash.map(x => x / k) : [])
      }
      ctx.stroke(a.path)
    }
    ctx.setLineDash([])
    for (const d of this.dots) {
      ctx.globalAlpha = d.alpha * sceneAlpha
      ctx.fillStyle = d.color
      ctx.fill(d.path)
    }
    for (const d of this.arrivingDots) {
      const p = d.prim
      const at = Math.min(1, Math.max(0, (time - start - (p.delay ?? 0)) / Math.max(1, p.dur ?? 1)))
      if (at <= 0) continue
      ctx.globalAlpha = p.alpha * ease(at) * sceneAlpha
      ctx.fillStyle = d.color
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
    }
    // What travels along the lines, fading in and out with the map's use.
    this.moversShown = false
    if (moversOn) {
      const fadeIn = Math.min(1, Math.max(0, (time - this.activeFrom) / MOVER_FADE))
      const fadeOut = Math.min(1, Math.max(0, (this.activeUntil + MOVER_FADE - time) / MOVER_FADE))
      const a = Math.min(fadeIn, fadeOut)
      ctx.lineCap = 'round'
      for (const m of this.movers) {
        const p = m.prim
        const cycle = (((time + p.phase) % p.period) + p.period) % p.period / p.period
        ctx.globalAlpha = p.alpha * a * sceneAlpha
        ctx.strokeStyle = m.color
        ctx.lineWidth = p.width / k
        ctx.setLineDash(p.dash.map(x => x / k))
        ctx.lineDashOffset = (p.from - p.travel * cycle) / k
        ctx.stroke(m.path)
      }
      ctx.lineDashOffset = 0
      ctx.setLineDash([])
      this.moversShown = a > 0.001
    }
    ctx.globalAlpha = 1
    return arriving || moversOn || this.moversShown
  }
  clear() {
    const ctx = this.ctx
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.last = null
  }
}

const MOVER_FADE = 700

// A resolved colour with its alpha multiplied (for gradient stops).
function withAlpha(color: string, a: number): string {
  // The browser's own syntax: oklch(L C H / A), color(srgb r g b / A), rgb(a)(…).
  const m = color.match(/^(\w+)\((.*)\)$/)
  if (!m) return color
  const [, fn, body] = m as unknown as [string, string, string]
  if (fn === 'rgb' || fn === 'rgba') {
    const parts = body.split(/[\s,/]+/).filter(Boolean)
    const base = parts.length >= 4 ? Number(parts[3]) : 1
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${base * a})`
  }
  const [main, alpha] = body.split('/')
  const base = alpha !== undefined ? Number(alpha.trim()) : 1
  return `${fn}(${main!.trim()} / ${(Number.isFinite(base) ? base : 1) * a})`
}
