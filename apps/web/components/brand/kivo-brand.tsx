// ─── Kivo's identity ──────────────────────────────────────────────────────────
// The orbit mark and the "Kivo" wordmark, the same on the landing page, the
// sign-in pages and the app. The mark is a centre (the learner), two arcs of
// an orbit (what they are working through) and a small body on it (the next
// step): a white tile with dark ink, or the bare mark in the surrounding text
// colour.
//
// Every shape is a plain path, rect or circle (no clip paths, no ids), so any
// number of copies can share a page and the files in app/ (icon.svg) are the
// same geometry. The bare mark's ink follows currentColor.

import type { CSSProperties } from 'react'

export const KIVO_INK = '#0D1117'
export const KIVO_TILE = '#FFFFFF'
export const KIVO_IVORY = '#F4F1E9'
// The teal of the landing page's actions (keppel-400), for places that need a
// literal colour (the share image).
export const KIVO_TEAL = '#3FB6A8'
// Kept for callers that still name it; the identity no longer uses violet.
export const KIVO_IRIS = KIVO_TEAL

/** The mark's shapes on a 32-unit grid, centred in it. `node` colours the small body on the orbit. */
export function KivoMarkShapes({ ink = 'currentColor', node, nodeClassName }: { ink?: string; node?: string; nodeClassName?: string }) {
  return (
    <g>
      <circle cx="16" cy="16" r="4" fill={ink} />
      <path d="M16 7 A9 9 0 0 1 25 16" stroke={ink} strokeWidth="1.25" strokeLinecap="round" fill="none" opacity="0.5" />
      <path d="M16 25 A9 9 0 0 1 7 16" stroke={ink} strokeWidth="1.25" strokeLinecap="round" fill="none" opacity="0.25" />
      <circle cx="25" cy="16" r="1.5" fill={node ?? ink} opacity={node ? 1 : 0.7} className={nodeClassName} />
    </g>
  )
}

type MarkProps = {
  size?: number
  className?: string
  style?: CSSProperties
  /** Set when the mark is the only thing naming Kivo; otherwise it is decoration. */
  title?: string
}

/** The bare mark, in the surrounding text colour. */
export function KivoMark({ size = 24, className, style, title, nodeClassName }: MarkProps & { nodeClassName?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      style={style}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <KivoMarkShapes nodeClassName={nodeClassName} />
    </svg>
  )
}

/** The app icon: the mark in ink on a white tile. A faint edge keeps it apart from a light page. */
export function KivoTile({ size = 32, className, style, title }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      style={style}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <rect width="32" height="32" rx="8" fill={KIVO_TILE} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="#000000" strokeOpacity="0.08" />
      <KivoMarkShapes ink={KIVO_INK} />
    </svg>
  )
}

/** "Kivo" in the app's face. Height is the size of the type; the width follows the word. */
export function KivoWordmark({ height = 20, className, style, title = 'Kivo' }: { height?: number; node?: string } & Omit<MarkProps, 'size'>) {
  return (
    <span
      className={className}
      style={{ fontSize: height, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1, ...style }}
      aria-label={title === 'Kivo' ? undefined : title}
    >
      Kivo
    </span>
  )
}

/** The tile and the wordmark side by side: the name wherever there is room for it. */
export function KivoLockup({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span className={['inline-flex items-center gap-2.5', className].filter(Boolean).join(' ')}>
      <KivoTile size={size} />
      <KivoWordmark height={Math.round(size * 0.62)} />
    </span>
  )
}
