import { ImageResponse } from 'next/og'
import { KIVO_INK, KIVO_IVORY, KIVO_TEAL, KIVO_TILE, KivoMarkShapes, KivoWordmark } from '@/components/brand/kivo-brand'

// The picture a shared link shows. Generated at build time from the same
// geometry as the logo, so it cannot drift from it.
export const alt = 'Kivo: plan your day, keep your notes connected and see your progress, with Nova'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// The landing page's near-black.
const INK = '#110F14'
const EMBER = '#E9A23B'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          backgroundColor: INK,
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(244,241,233,0.09) 1px, transparent 0)',
          backgroundSize: '28px 28px',
          color: KIVO_IVORY,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <svg width="72" height="72" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="8" fill={KIVO_TILE} />
            {/* Called, not rendered: the image renderer accepts only plain SVG elements in <svg>. */}
            {KivoMarkShapes({ ink: KIVO_INK })}
          </svg>
          <KivoWordmark height={50} style={{ color: KIVO_IVORY }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 40 }}>
          <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 760 }}>
            <div style={{ fontSize: 64, lineHeight: 1.05, letterSpacing: '-0.03em' }}>
              Your plan, your notes and your progress, connected.
            </div>
            <div style={{ marginTop: 26, fontSize: 28, lineHeight: 1.35, color: 'rgba(244,241,233,0.66)' }}>
              Kivo plans each day with you, links what you learn, and shows how you are changing. With Nova, your learning mentor.
            </div>
          </div>
          {/* Three notes and the links between them: the idea of the node in the mark. */}
          <svg width="220" height="190" viewBox="0 0 220 190">
            <line x1="40" y1="150" x2="120" y2="60" stroke="rgba(244,241,233,0.35)" strokeWidth="3" />
            <line x1="120" y1="60" x2="185" y2="140" stroke="rgba(244,241,233,0.35)" strokeWidth="3" />
            <line x1="40" y1="150" x2="185" y2="140" stroke="rgba(244,241,233,0.18)" strokeWidth="3" />
            <circle cx="120" cy="60" r="22" fill={KIVO_TEAL} />
            <circle cx="40" cy="150" r="15" fill={KIVO_IVORY} />
            <circle cx="185" cy="140" r="12" fill={EMBER} />
          </svg>
        </div>
      </div>
    ),
    size,
  )
}
