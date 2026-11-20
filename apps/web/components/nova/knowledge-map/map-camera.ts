// ─── The Knowledge Map's camera ──────────────────────────────────────────────
// Where the view is (`now`) and the view the cards were last drawn at
// (`drawn`), kept apart. Moving the view never draws a card: the cards' layer
// is drawn in map units scaled by the zoom it was drawn at, and the camera
// moves it with one CSS transform (the compositor's work). The graph's canvas
// layers (map-canvas.ts) are painted at `now` on the same animation frame, so
// lines and cards move together. React draws the cards again only when a
// zoom comes to rest at a new scale (see knowledge-map.tsx), once per gesture.
//
// Measured before this (500 cards, CPU slowed 4x): a glide that changed the
// zoom by more than 1.9x redrew every card on every frame (77–88 ms frames),
// and each pan frame read the frame's size after writing a transform, which
// made the browser recalculate style for the whole drawing. Here the frame's
// size comes from a ResizeObserver and nothing is read while moving.
//
// While the view moves, the layers' transforms are written through a Web
// Animation held on each layer (its keyframes retargeted every frame), not
// through style: Chrome rebuilds its compositing layers for every style
// transform change (one re-layerization of every card per frame, about 26 ms
// a frame at 500 cards, CPU slowed 4x) but updates an animation's value on
// the compositor alone. When the view rests, settle() writes the final
// transform to style once and lets the animations go, so an idle map has
// nothing running.
//
// No React: one instance per map, made once, driven by refs.

import type { View } from './overview'

// How long a layer's animation could last: far longer than any gesture (settle() ends it).
const HOLD_MS = 600_000

export type Painter = (view: View, time: number) => boolean   // true: wants another frame

export class MapCamera {
  now: View = { x: 0, y: 0, k: 1 }
  drawn: View = { x: 0, y: 0, k: 1 }
  // The frame's size in CSS pixels, from a ResizeObserver (never read while moving).
  w = 0
  h = 0
  private layers = new Set<HTMLElement>()
  private anims = new Map<HTMLElement, Animation>()
  private written = new Map<HTMLElement, string>()
  private parallax: HTMLElement | null = null
  private painters = new Set<Painter>()
  private raf = 0
  private observer: ResizeObserver | null = null
  private sizeListeners = new Set<(w: number, h: number) => void>()

  // The frame whose size the camera follows.
  observe(el: HTMLElement | null) {
    this.observer?.disconnect()
    this.observer = null
    if (!el) return
    const read = (w: number, h: number) => {
      if (w === this.w && h === this.h) return
      this.w = w; this.h = h
      for (const f of this.sizeListeners) f(w, h)
      this.request()
    }
    read(el.clientWidth, el.clientHeight)
    if (typeof ResizeObserver === 'undefined') return
    this.observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect
      if (box) read(Math.round(box.width), Math.round(box.height))
    })
    this.observer.observe(el)
  }
  onResize(f: (w: number, h: number) => void) { this.sizeListeners.add(f); return () => { this.sizeListeners.delete(f) } }

  // A DOM layer drawn at `drawn` (in map units times drawn.k), moved by CSS.
  addLayer(el: HTMLElement | null) { if (el) { this.layers.add(el); this.place(el) } return () => { if (el) this.layers.delete(el) } }
  // The far plane of dots: it moves slower than the cards (within one dot's spacing).
  setParallax(el: HTMLElement | null) { this.parallax = el; if (el) this.place(el) }
  addPainter(p: Painter) { this.painters.add(p); this.request(); return () => { this.painters.delete(p) } }

  // Moves the view. Applied on the next animation frame, with the painters.
  set(v: View) {
    this.now = v
    this.request()
  }
  // React drew the cards at `v`: the layers' transform is put right at once
  // (in the same commit, so the picture never jumps), the painters next frame.
  setDrawn(v: View) {
    this.drawn = v
    for (const el of this.layers) { if (el.isConnected) this.place(el); else this.layers.delete(el) }
    if (this.parallax) this.place(this.parallax)
    this.request()
  }
  // A frame for the painters (an animation, a new scene).
  request() {
    if (this.raf || typeof window === 'undefined') return
    this.raf = window.requestAnimationFrame(this.flush)
  }
  // Applies a move at once, inside an animation frame already running (a glide's step), so it lands on this frame, not the next.
  flushNow(time: number) {
    if (this.raf) { window.cancelAnimationFrame(this.raf); this.raf = 0 }
    this.flush(time)
  }
  // The view rests: each layer's transform goes to style, its animation is let go.
  settle() {
    for (const [el, a] of this.anims) {
      const t = this.written.get(el)
      if (t !== undefined) el.style.transform = t
      a.cancel()
    }
    this.anims.clear()
  }
  dispose() {
    for (const a of this.anims.values()) a.cancel()
    this.anims.clear()
    if (this.raf) window.cancelAnimationFrame(this.raf)
    this.raf = 0
    this.observer?.disconnect()
    this.layers.clear(); this.painters.clear(); this.sizeListeners.clear()
  }

  // Screen point of a map point, at the view now.
  toScreen(p: { x: number; y: number }) { return { x: this.now.x + p.x * this.now.k, y: this.now.y + p.y * this.now.k } }

  private flush = (time: number) => {
    this.raf = 0
    for (const el of this.layers) { if (el.isConnected) this.place(el); else this.layers.delete(el) }
    if (this.parallax) this.place(this.parallax)
    let again = false
    for (const p of this.painters) if (p(this.now, time)) again = true
    if (again) this.request()
  }
  private place(el: HTMLElement) {
    const n = this.now, d = this.drawn
    // The far plane moves within one dot's spacing, so it never runs out. A
    // cards' layer holds the map scaled by d.k: it is put at n's origin and
    // scaled the rest of the way.
    const t = el === this.parallax
      ? `translate3d(${(n.x - d.x) * 0.35}px, ${(n.y - d.y) * 0.35}px, 0)`
      : `translate3d(${n.x}px, ${n.y}px, 0) scale(${n.k / d.k})`
    if (this.written.get(el) === t) return
    this.written.set(el, t)
    const a = this.anims.get(el)
    const frames = [{ transform: t }, { transform: t }]
    if (a) { (a.effect as KeyframeEffect | null)?.setKeyframes(frames); return }
    if (this.moving && typeof el.animate === 'function') {
      this.anims.set(el, el.animate(frames, { duration: HOLD_MS, fill: 'forwards' }))
      return
    }
    el.style.transform = t
  }
  // Set while the view moves (MapCamera.moving = true from the map), so moves go through animations.
  moving = false
}
