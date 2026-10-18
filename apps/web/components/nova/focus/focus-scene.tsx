'use client'

import { useEffect, useRef } from 'react'

// ─── Focus scenes ─────────────────────────────────────────────────────────────
// The backdrop of a focus session, drawn on a canvas in Kivo's colours:
// nothing is downloaded and nothing needs a licence. Each scene is a still
// base (a gradient) with slow life on top (ribbons, rain, stars, embers,
// fireflies). Drawing stops while the tab is hidden; with reduced motion the
// scene is drawn once and left still.

export type SceneId = 'aurora' | 'rain' | 'night' | 'embers' | 'forest'

export const SCENES: Array<{ id: SceneId; name: string; swatch: string }> = [
  { id: 'aurora', name: 'Aurora',    swatch: 'linear-gradient(135deg,#0b1a1f,#1d5f58 55%,#2a2350)' },
  { id: 'rain',   name: 'Rain',      swatch: 'linear-gradient(160deg,#0c1220,#1b2a3f 60%,#0a0f19)' },
  { id: 'night',  name: 'Night sky', swatch: 'linear-gradient(180deg,#05070f,#121a35 70%,#24305a)' },
  { id: 'embers', name: 'Embers',    swatch: 'linear-gradient(180deg,#120b0a,#2b130c 60%,#4a1f0f)' },
  { id: 'forest', name: 'Forest',    swatch: 'linear-gradient(180deg,#0a1410,#13261c 55%,#1f3a2a)' },
]

type P = { x: number; y: number; vx: number; vy: number; r: number; a: number; t: number }

function draw(ctx: CanvasRenderingContext2D, scene: SceneId, w: number, h: number, t: number, ps: P[]) {
  ctx.clearRect(0, 0, w, h)
  const g = (stops: Array<[number, string]>, x0 = 0, y0 = 0, x1 = 0, y1 = h) => {
    const lg = ctx.createLinearGradient(x0, y0, x1, y1)
    for (const [o, c] of stops) lg.addColorStop(o, c)
    return lg
  }

  if (scene === 'aurora') {
    ctx.fillStyle = g([[0, '#060b12'], [0.6, '#0a1519'], [1, '#0d1222']]); ctx.fillRect(0, 0, w, h)
    // Three ribbons of light, drifting.
    const ribbons: Array<[string, number, number]> = [['rgba(63,182,168,0.42)', 0.34, 0], ['rgba(120,140,255,0.26)', 0.44, 2], ['rgba(0,229,160,0.28)', 0.26, 4]]
    for (const [color, yr, phase] of ribbons) {
      ctx.beginPath()
      for (let x = 0; x <= w; x += 12) {
        const y = h * yr + Math.sin(x / (w / 3) + t * 0.00018 + phase) * h * 0.08 + Math.sin(x / (w / 7) + t * 0.0004 + phase) * h * 0.025
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.lineTo(w, 0); ctx.lineTo(0, 0); ctx.closePath()
      const fill = ctx.createLinearGradient(0, 0, 0, h * yr + h * 0.1)
      fill.addColorStop(0, 'rgba(0,0,0,0)'); fill.addColorStop(0.75, color); fill.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = fill; ctx.filter = 'blur(28px)'; ctx.fill(); ctx.filter = 'none'
    }
    for (const p of ps) { ctx.globalAlpha = p.a * (0.5 + 0.5 * Math.sin(t * 0.001 + p.t)); ctx.fillStyle = '#d9fff6'; ctx.fillRect(p.x * w, p.y * h * 0.7, p.r, p.r) }
    ctx.globalAlpha = 1
    // Distant hills.
    ctx.fillStyle = '#05080d'
    ctx.beginPath(); ctx.moveTo(0, h)
    for (let x = 0; x <= w; x += 20) ctx.lineTo(x, h * 0.82 - Math.sin(x / 180) * 24 - Math.sin(x / 67) * 10)
    ctx.lineTo(w, h); ctx.fill()
  }

  if (scene === 'rain') {
    ctx.fillStyle = g([[0, '#0a101c'], [0.65, '#132034'], [1, '#090d16']]); ctx.fillRect(0, 0, w, h)
    // City lights out of focus behind the glass.
    for (const p of ps.slice(0, 40)) {
      const rg = ctx.createRadialGradient(p.x * w, (0.55 + p.y * 0.4) * h, 0, p.x * w, (0.55 + p.y * 0.4) * h, p.r * 9)
      rg.addColorStop(0, p.t > 3 ? 'rgba(255,190,120,0.18)' : 'rgba(110,200,190,0.16)'); rg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(p.x * w, (0.55 + p.y * 0.4) * h, p.r * 9, 0, Math.PI * 2); ctx.fill()
    }
    ctx.strokeStyle = 'rgba(190,215,235,0.22)'; ctx.lineWidth = 1
    for (const p of ps) {
      p.y += p.vy; p.x += p.vx
      if (p.y > 1.05) { p.y = -0.05; p.x = Math.random() }
      ctx.beginPath(); ctx.moveTo(p.x * w, p.y * h); ctx.lineTo(p.x * w + p.vx * 900, p.y * h + 16 + p.r * 6); ctx.stroke()
    }
  }

  if (scene === 'night') {
    ctx.fillStyle = g([[0, '#03050c'], [0.7, '#0d1530'], [1, '#1c2750']]); ctx.fillRect(0, 0, w, h)
    for (const p of ps) {
      ctx.globalAlpha = p.a * (0.55 + 0.45 * Math.sin(t * 0.0015 * (1 + p.t / 6) + p.t))
      ctx.fillStyle = '#f0f3ff'; ctx.beginPath(); ctx.arc(p.x * w, p.y * h * 0.85, p.r * 0.7, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
    // Now and then, a shooting star.
    const cycle = (t % 11000) / 11000
    if (cycle < 0.08) {
      const k = cycle / 0.08, sx = w * (0.15 + 0.5 * ((Math.floor(t / 11000) * 0.37) % 1)), sy = h * 0.12
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(sx + k * 260, sy + k * 120); ctx.lineTo(sx + k * 260 - 70, sy + k * 120 - 32); ctx.stroke()
    }
    ctx.fillStyle = '#04060b'
    ctx.beginPath(); ctx.moveTo(0, h)
    for (let x = 0; x <= w; x += 16) ctx.lineTo(x, h * 0.86 - Math.abs(Math.sin(x / 140)) * 40 - Math.sin(x / 41) * 6)
    ctx.lineTo(w, h); ctx.fill()
  }

  if (scene === 'embers') {
    ctx.fillStyle = g([[0, '#0b0707'], [0.6, '#1e0e0a'], [1, '#3a170b']]); ctx.fillRect(0, 0, w, h)
    const glow = ctx.createRadialGradient(w / 2, h * 1.05, 0, w / 2, h * 1.05, h * 0.75)
    glow.addColorStop(0, `rgba(255,120,40,${0.32 + 0.05 * Math.sin(t * 0.003)})`); glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h)
    for (const p of ps) {
      p.y += p.vy; p.x += p.vx + Math.sin(t * 0.001 + p.t) * 0.0002
      if (p.y < -0.05) { p.y = 1.05; p.x = 0.3 + Math.random() * 0.4 }
      ctx.globalAlpha = Math.max(0, Math.min(1, p.y * 1.2)) * p.a
      ctx.fillStyle = p.t > 3 ? '#ffb15c' : '#ff7a2e'
      ctx.beginPath(); ctx.arc(p.x * w, p.y * h, p.r * 0.8, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  if (scene === 'forest') {
    ctx.fillStyle = g([[0, '#08120e'], [0.55, '#10221a'], [1, '#183326']]); ctx.fillRect(0, 0, w, h)
    const layers: Array<[string, number, number]> = [['#0e1d16', 0.62, 90], ['#0a1711', 0.74, 60], ['#06100b', 0.88, 40]]
    for (const [color, base, amp] of layers) {
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, h)
      for (let x = 0; x <= w; x += 10) {
        const tree = Math.abs(Math.sin(x / (amp / 2))) ** 6 * amp
        ctx.lineTo(x, h * base - tree - Math.sin(x / 230) * 18)
      }
      ctx.lineTo(w, h); ctx.fill()
    }
    for (const p of ps) {
      p.x += p.vx + Math.sin(t * 0.0007 + p.t) * 0.0003; p.y += p.vy + Math.cos(t * 0.0006 + p.t) * 0.0003
      if (p.x < 0) p.x = 1; if (p.x > 1) p.x = 0; if (p.y < 0.35) p.y = 0.95; if (p.y > 0.98) p.y = 0.4
      const on = 0.5 + 0.5 * Math.sin(t * 0.002 + p.t * 3)
      const rg = ctx.createRadialGradient(p.x * w, p.y * h, 0, p.x * w, p.y * h, 6)
      rg.addColorStop(0, `rgba(200,255,150,${0.75 * on * p.a})`); rg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(p.x * w, p.y * h, 6, 0, Math.PI * 2); ctx.fill()
    }
  }

  // A soft vignette so the timer always reads.
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75)
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = v; ctx.fillRect(0, 0, w, h)
}

function particles(scene: SceneId): P[] {
  const n = { aurora: 90, rain: 220, night: 180, embers: 70, forest: 45 }[scene]
  return Array.from({ length: n }, () => ({
    x: Math.random(), y: Math.random(),
    vx: scene === 'rain' ? -0.0004 : scene === 'embers' ? (Math.random() - 0.5) * 0.0004 : (Math.random() - 0.5) * 0.0004,
    vy: scene === 'rain' ? 0.008 + Math.random() * 0.008 : scene === 'embers' ? -(0.0008 + Math.random() * 0.0015) : (Math.random() - 0.5) * 0.0003,
    r: 0.6 + Math.random() * 2, a: 0.35 + Math.random() * 0.65, t: Math.random() * 6,
  }))
}

export function FocusScene({ scene }: { scene: SceneId }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const ps = particles(scene)
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0, w = 0, h = 0

    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const r = canvas.getBoundingClientRect()
      w = r.width; h = r.height
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (still) draw(ctx, scene, w, h, 0, ps)
    }
    size()
    const ro = new ResizeObserver(size); ro.observe(canvas)

    const frame = (t: number) => {
      if (!document.hidden) draw(ctx, scene, w, h, t, ps)
      raf = requestAnimationFrame(frame)
    }
    if (!still) raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [scene])

  return <canvas ref={ref} aria-hidden className="absolute inset-0 size-full" />
}
