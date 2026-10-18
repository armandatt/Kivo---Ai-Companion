// ─── Kivo's identity ──────────────────────────────────────────────────────────
// The K monogram and the "kivo" wordmark, drawn from one set of strokes: a
// stem, 45° diagonals with angled ends, and a node (the violet dot) that sits
// on the arm's own line, the way a note sits at the end of a link. The i of
// the wordmark carries the same node.
//
// Every shape is a plain polygon, rect or circle (no clip paths, no ids), so
// any number of copies can share a page and the files in app/ (icon.svg) are
// the same geometry. The ink follows currentColor; the node is --kivo-node,
// iris by default.

import type { CSSProperties } from 'react'

export const KIVO_INK = '#0E1626'
export const KIVO_IVORY = '#F4F1E9'
export const KIVO_IRIS = '#6E5CFF'

const NODE = 'var(--kivo-node, #6E5CFF)'

/** The monogram's shapes on a 32-unit grid, centred in it. */
export function KivoMarkShapes({ ink = 'currentColor', node = NODE, nodeClassName }: { ink?: string; node?: string; nodeClassName?: string }) {
  return (
    <g transform="translate(-0.9 0.8)">
      <rect x="7.6" y="6.4" width="4.2" height="19.2" fill={ink} />
      <polygon points="7.644,18.644 17.244,9.044 20.356,12.156 10.756,21.756" fill={ink} />
      <polygon points="11.444,17.156 14.556,14.044 26.112,25.6 19.888,25.6" fill={ink} />
      <circle cx="21.8" cy="7.6" r="3.05" fill={node} className={nodeClassName} />
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

/** The bare monogram, in the surrounding text colour. */
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

/** The app icon: the monogram in ivory on an ink tile. Reads on any background. */
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
      <rect width="32" height="32" rx="7.5" fill={KIVO_INK} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7" fill="none" stroke="#FFFFFF" strokeOpacity="0.08" />
      <KivoMarkShapes ink={KIVO_IVORY} />
    </svg>
  )
}

/** "kivo", lower case, in the monogram's strokes. Height sets the size; width follows. */
export function KivoWordmark({ height = 20, className, style, title = 'Kivo', node = NODE }: { height?: number; node?: string } & Omit<MarkProps, 'size'>) {
  return (
    <svg
      height={height}
      width={(height * 47.5) / 22}
      viewBox="0 0 47.5 22"
      className={className}
      style={style}
      role="img"
      aria-label={title}
      focusable="false"
    >
      <g fill="currentColor">
        {/* k */}
        <rect x="0.5" y="1.5" width="3.3" height="19.5" />
        <polygon points="1.033,16.233 9.267,8 11.6,10.333 3.367,18.567" />
        <polygon points="3.633,16.967 5.967,14.633 12.334,21 7.666,21" />
        {/* i */}
        <rect x="15.2" y="8" width="3.3" height="13" />
        {/* v */}
        <polygon points="20.4,8 23.92,8 27.4,17.355 30.88,8 34.4,8 29.564,21 25.236,21" />
      </g>
      {/* o */}
      <circle cx="40.6" cy="14.5" r="4.85" fill="none" stroke="currentColor" strokeWidth="3.3" />
      {/* the node, as the i's dot */}
      <circle cx="16.85" cy="3.6" r="2.15" fill={node} />
    </svg>
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
