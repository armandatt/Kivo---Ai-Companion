'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ─── Feature data ──────────────────────────────────────────────────────────────

const REX_FEATURES = [
  {
    icon: '⚡',
    title: 'Power Commands',
    subtitle: 'Send these in Telegram',
    items: [
      { cmd: '/log',      desc: 'Open a live workout session' },
      { cmd: '/streak',   desc: 'Your gym streak' },
      { cmd: '/split',    desc: 'Current training split' },
      { cmd: '/progress', desc: 'Lift PRs & volume trends' },
      { cmd: '/history',  desc: 'Past sessions' },
      { cmd: '/pr',       desc: 'Personal records' },
      { cmd: '/overload', desc: 'Overload suggestions' },
    ],
  },
  {
    icon: '💬',
    title: 'Just Talk',
    subtitle: 'Natural language, no commands',
    items: [
      { cmd: '"did chest today, 4x8 bench at 80kg"', desc: 'Logs the session' },
      { cmd: '"skipping legs this week"',             desc: 'Rex flags the miss' },
      { cmd: '"how\'s my squat looking?"',            desc: 'Pulls your trend' },
      { cmd: '"what should I train tomorrow?"',       desc: 'Next session advice' },
      { cmd: '"feeling sore from yesterday"',         desc: 'Adjusts your plan' },
    ],
  },
  {
    icon: '🗓️',
    title: 'Smart Scheduling',
    subtitle: 'Rex checks in on your terms',
    wide: true,
    items: [
      { cmd: '"remind me at 6am to eat protein before gym"', desc: 'Context-aware daily reminder' },
      { cmd: '"update me at breakfast with today\'s plan"',  desc: 'Named time — Rex figures it out' },
      { cmd: '"check me in 30 minutes"',                     desc: 'Quick follow-up' },
      { cmd: '/reminders',                                   desc: 'List all active reminders' },
      { cmd: '/cancel [number]',                             desc: 'Remove a reminder by its number' },
    ],
  },
  {
    icon: '📊',
    title: 'Auto-Tracked on Dashboard',
    subtitle: 'Everything that matters, without manual entry',
    wide: true,
    items: [
      { cmd: 'Bodyweight & BMI',              desc: 'Logged through conversation' },
      { cmd: 'Volume per muscle group',       desc: 'Computed from /log sessions' },
      { cmd: 'Progressive overload flags',    desc: 'Rex tells you when to go heavier' },
      { cmd: 'Session consistency score',     desc: 'Streak & missed sessions' },
      { cmd: 'Lift PRs',                      desc: 'New PRs surface automatically' },
    ],
  },
]

const NOVA_FEATURES = [
  {
    icon: '🎯',
    title: 'Focus Sessions',
    subtitle: 'Deep work, tracked',
    items: [
      { cmd: '"focus for 90 minutes"',       desc: 'Custom duration timer' },
      { cmd: '"start a session"',            desc: '25-minute default' },
      { cmd: '"quick 15 min sprint"',        desc: 'Short burst mode' },
      { cmd: '"I need to study algorithms"', desc: 'Nova sets the context' },
      { cmd: '"done for now"',               desc: 'Ends session + logs it' },
    ],
  },
  {
    icon: '📅',
    title: 'Deadlines & Planning',
    subtitle: 'Tell Nova, it remembers',
    items: [
      { cmd: '"exam Friday 3pm"',                   desc: 'Saved to your deadline list' },
      { cmd: '"assignment due next Monday"',         desc: 'Tracked automatically' },
      { cmd: '"project presentation in 2 weeks"',   desc: 'Countdown starts now' },
      { cmd: '"what\'s on my plate?"',              desc: 'Full overview' },
      { cmd: '"push my deadline by 2 hours"',       desc: 'Adjusts nearest deadline' },
    ],
  },
  {
    icon: '🗓️',
    title: 'Smart Scheduling',
    subtitle: 'Nova checks in on your terms',
    wide: true,
    items: [
      { cmd: '"remind me at 9pm to review my notes"',        desc: 'Context-aware evening reminder' },
      { cmd: '"update me at breakfast with today\'s plan"',  desc: 'Named time — Nova figures it out' },
      { cmd: '"check me in 30 minutes"',                     desc: 'Quick follow-up' },
      { cmd: '/reminders',                                   desc: 'List all active reminders' },
      { cmd: '/cancel [number]',                             desc: 'Remove a reminder by its number' },
    ],
  },
  {
    icon: '📈',
    title: 'Auto-Tracked on Dashboard',
    subtitle: 'Patterns Nova surfaces for you',
    wide: true,
    items: [
      { cmd: 'Streak',           desc: 'Days you showed up and checked in' },
      { cmd: 'Mood trend',       desc: 'Picked up from how you talk' },
      { cmd: 'Focus sessions',   desc: 'Duration + what you worked on' },
      { cmd: 'Weekly review',    desc: 'Ask "how was my week?" any time' },
      { cmd: 'Behaviour flags',  desc: 'Patterns Nova notices over time' },
    ],
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRexPersona(persona: string) {
  return persona.toLowerCase() === 'rex'
}

const ACCENT: Record<string, string> = {
  rex:  '#00F5A0',
  nova: '#7C3AED',
  zen:  '#6366F1',
}

const TAGLINES: Record<string, string> = {
  rex:  'No excuses. Just results.',
  nova: 'Steady. Structured. Always here.',
  zen:  'Slow down. Go further.',
}

const SUBTITLES: Record<string, string> = {
  rex:  'Your gym coach on Telegram — tracks every rep, calls out every skip.',
  nova: 'Your accountability companion on Telegram — keeps you focused, on track, on time.',
  zen:  'Your mindfulness companion on Telegram — keeps you grounded and consistent.',
}

// ─── Feature card ─────────────────────────────────────────────────────────────

function FeatureCard({
  icon, title, subtitle, items, accent, wide = false, delay,
}: {
  icon: string
  title: string
  subtitle: string
  items: { cmd: string; desc: string }[]
  accent: string
  wide?: boolean
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      style={{
        gridColumn:      wide ? '1 / -1' : undefined,
        background:      'rgba(255,255,255,0.03)',
        border:          `1px solid rgba(255,255,255,0.08)`,
        borderRadius:    '16px',
        padding:         '24px',
        backdropFilter:  'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      {/* Card header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
        <div style={{
          width: '40px', height: '40px',
          borderRadius: '10px',
          background: `${accent}18`,
          border: `1px solid ${accent}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '18px', flexShrink: 0,
        }}>
          {icon}
        </div>
        <div>
          <p style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#FFFFFF' }}>{title}</p>
          <p style={{ margin: 0, fontSize: '12px', color: '#666', marginTop: '2px' }}>{subtitle}</p>
        </div>
      </div>

      {/* Items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: wide ? '10px' : '8px' }}>
        {items.map((item, i) => (
          <div
            key={i}
            style={{
              display:       'flex',
              alignItems:    'flex-start',
              gap:           '10px',
              padding:       wide ? '8px 10px' : '0',
              borderRadius:  wide ? '8px' : '0',
              background:    wide ? 'rgba(255,255,255,0.02)' : 'transparent',
            }}
          >
            <code style={{
              fontSize:       '12px',
              fontFamily:     'monospace',
              color:          accent,
              background:     `${accent}12`,
              padding:        '2px 7px',
              borderRadius:   '5px',
              flexShrink:     0,
              maxWidth:       wide ? '260px' : '140px',
              whiteSpace:     'nowrap',
              overflow:       'hidden',
              textOverflow:   'ellipsis',
            }}>
              {item.cmd}
            </code>
            <span style={{ fontSize: '12px', color: '#888', lineHeight: 1.5 }}>
              {item.desc}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CompanionGuide({
  persona,
  onEnter,
  fullscreen = true,
  showHero = true,
  ctaLabel,
}: {
  persona: string
  onEnter?: () => void
  fullscreen?: boolean
  showHero?: boolean
  ctaLabel?: string
}) {
  const [phase, setPhase] = useState<'name' | 'features'>(() => (fullscreen && showHero) ? 'name' : 'features')
  const lp      = persona.toLowerCase()
  const accent  = ACCENT[lp] ?? '#7C3AED'
  const tagline = TAGLINES[lp] ?? 'Your companion is ready.'
  const sub     = SUBTITLES[lp] ?? ''
  const features = isRexPersona(persona) ? REX_FEATURES : NOVA_FEATURES

  useEffect(() => {
    if (!fullscreen || !showHero) return
    const t = setTimeout(() => setPhase('features'), 1600)
    return () => clearTimeout(t)
  }, [fullscreen, showHero])

  const content = (
    <div style={{
      minHeight:      '100%',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      padding:        fullscreen ? '0 20px 60px' : '0',
    }}>
      {/* ── Phase 1: Name ─────────────────────────────────────────────── */}
      {showHero && <div style={{
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        minHeight:      fullscreen ? '100vh' : 'auto',
        padding:        fullscreen ? '0' : '48px 0 32px',
        textAlign:      'center',
        position:       'relative',
        width:          '100%',
      }}>
        {/* Background glow */}
        <div style={{
          position:   'absolute',
          inset:      0,
          background: `radial-gradient(ellipse 50% 40% at 50% 50%, ${accent}10 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />

        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          style={{
            fontSize:      '11px',
            fontWeight:    700,
            letterSpacing: '4px',
            textTransform: 'uppercase',
            color:         accent,
            margin:        '0 0 20px',
            opacity:       0.8,
          }}
        >
          Your companion
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
          style={{
            fontSize:   'clamp(5rem, 18vw, 10rem)',
            fontWeight: 900,
            margin:     0,
            lineHeight: 1,
            letterSpacing: '0.05em',
            background: `linear-gradient(135deg, #FFFFFF 40%, ${accent} 100%)`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor:  'transparent',
            backgroundClip:       'text',
            filter:               `drop-shadow(0 0 40px ${accent}40)`,
          }}
        >
          {persona.toUpperCase()}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          style={{
            fontSize:   'clamp(1rem, 2.5vw, 1.3rem)',
            fontWeight: 500,
            color:      'rgba(255,255,255,0.55)',
            margin:     '20px 0 0',
            maxWidth:   '480px',
          }}
        >
          {tagline}
        </motion.p>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.9 }}
          style={{
            fontSize:  '14px',
            color:     'rgba(255,255,255,0.3)',
            margin:    '12px 0 0',
            maxWidth:  '440px',
            lineHeight: 1.6,
          }}
        >
          {sub}
        </motion.p>

        {/* Pulse line */}
        <motion.div
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ duration: 0.8, delay: 1.0 }}
          style={{
            marginTop:    '36px',
            width:        '60px',
            height:       '2px',
            background:   `linear-gradient(90deg, transparent, ${accent}, transparent)`,
            borderRadius: '2px',
          }}
        />

        {/* Scroll hint — only shown in features phase on fullscreen */}
        <AnimatePresence>
          {phase === 'features' && fullscreen && (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              style={{ fontSize: '12px', color: accent, marginTop: '28px', opacity: 0.7 }}
            >
              ↓ scroll to see everything
            </motion.p>
          )}
        </AnimatePresence>
      </div>}

      {/* ── Phase 2: Features ─────────────────────────────────────────── */}
      <AnimatePresence>
        {phase === 'features' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
            style={{ width: '100%', maxWidth: '880px' }}
          >
            {/* Section label */}
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              style={{
                fontSize:      '10px',
                fontWeight:    700,
                letterSpacing: '3px',
                textTransform: 'uppercase',
                color:         accent,
                textAlign:     'center',
                marginBottom:  '28px',
                opacity:       0.7,
              }}
            >
              Everything you can do
            </motion.p>

            {/* Feature grid */}
            <div style={{
              display:             'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap:                 '14px',
              marginBottom:        '40px',
            }}>
              {features.map((f, i) => (
                <FeatureCard
                  key={f.title}
                  {...f}
                  accent={accent}
                  delay={0.15 + i * 0.12}
                />
              ))}
            </div>

            {/* CTA */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.7 }}
              style={{ textAlign: 'center' }}
            >
              {onEnter ? (
                <button
                  onClick={onEnter}
                  style={{
                    fontSize:        '15px',
                    fontWeight:      700,
                    color:           '#0D0D0D',
                    background:      accent,
                    border:          'none',
                    borderRadius:    '100px',
                    padding:         '14px 40px',
                    cursor:          'pointer',
                    boxShadow:       `0 0 32px ${accent}50`,
                    transition:      'transform 0.2s, box-shadow 0.2s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.04)'
                    ;(e.currentTarget as HTMLButtonElement).style.boxShadow = `0 0 48px ${accent}70`
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
                    ;(e.currentTarget as HTMLButtonElement).style.boxShadow = `0 0 32px ${accent}50`
                  }}
                >
                  {ctaLabel ?? 'Enter Dashboard →'}
                </button>
              ) : (
                <a
                  href="/dashboard"
                  style={{
                    display:         'inline-block',
                    fontSize:        '15px',
                    fontWeight:      700,
                    color:           '#0D0D0D',
                    background:      accent,
                    textDecoration:  'none',
                    borderRadius:    '100px',
                    padding:         '14px 40px',
                    boxShadow:       `0 0 32px ${accent}50`,
                  }}
                >
                  {ctaLabel ?? 'Back to Dashboard →'}
                </a>
              )}
              {!ctaLabel && (
                <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.2)', marginTop: '14px' }}>
                  This guide lives at{' '}
                  <a href="/dashboard/guide" style={{ color: accent, textDecoration: 'none', opacity: 0.8 }}>
                    /dashboard/guide
                  </a>
                  {' '}— come back any time.
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  if (!fullscreen) return content

  return (
    <div style={{
      position:        'fixed',
      inset:           0,
      zIndex:          9998,
      background:      '#060810',
      overflowY:       'auto',
      overflowX:       'hidden',
    }}>
      {content}
    </div>
  )
}
