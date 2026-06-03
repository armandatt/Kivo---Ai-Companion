'use client'

import { useState } from 'react'
import TelegramConnectBanner from '@/components/dashboard/telegram-connect-banner'

// ─── Design tokens ────────────────────────────────────────────────────────────
const P1   = '#8855ff'
const P2   = '#5533cc'
const PL   = '#c4b0ff'
const PD   = '#6644cc'
const CARD = '#111111'

// ─── Feature card data ────────────────────────────────────────────────────────

type Cmd  = { cmd: string; desc: string }
type Card = {
  icon: string; title: string; sub: string
  accent: string; iconBg: string
  cmds: Cmd[]
  small?: boolean
}

const ROW1: Card[] = [
  {
    icon: '🎯', title: 'Focus Sessions',
    sub: 'Deep work, tracked. Every minute logged automatically.',
    accent: '#9b72ff', iconBg: 'rgba(136,85,255,0.15)',
    cmds: [
      { cmd: 'focus for 90 min',      desc: 'Custom duration timer' },
      { cmd: 'start a session',        desc: '25-minute default' },
      { cmd: 'quick 15 min sprint',    desc: 'Short burst mode' },
      { cmd: 'I need to study X',      desc: 'Nova sets the context' },
      { cmd: 'done for now',           desc: 'Ends session + logs it' },
    ],
  },
  {
    icon: '📅', title: 'Deadlines & Planning',
    sub: 'Tell Nova, it remembers. Countdown starts the moment you say it.',
    accent: '#7c67f5', iconBg: 'rgba(100,80,220,0.15)',
    cmds: [
      { cmd: 'exam Friday 3pm',         desc: 'Saved to deadline list' },
      { cmd: 'assignment due Mon',       desc: 'Tracked automatically' },
      { cmd: 'project presentation…',   desc: 'Countdown starts now' },
      { cmd: "what's on my plate",       desc: 'Full overview' },
      { cmd: 'push my deadline…',        desc: 'Adjusts nearest deadline' },
    ],
  },
]

const ROW2: Card[] = [
  {
    icon: '⚡', title: 'Accountability & Check-ins',
    sub: "Nova doesn't wait for you to show up. She comes to you.",
    accent: '#b06bff', iconBg: 'rgba(160,80,255,0.15)',
    cmds: [
      { cmd: 'hold me accountable',   desc: 'Daily check-in enabled' },
      { cmd: 'I keep procrastinating', desc: 'Intervention mode on' },
      { cmd: 'check in at 8pm',        desc: 'Scheduled nudge set' },
      { cmd: 'I studied for 2hrs',     desc: 'Manually logs session' },
      { cmd: 'skip today',             desc: 'Noted — asked why' },
    ],
  },
  {
    icon: '🗓️', title: 'Weekly Planning',
    sub: 'Tell Nova your week. She builds the schedule, you execute.',
    accent: '#6ea77a', iconBg: 'rgba(80,160,100,0.15)',
    cmds: [
      { cmd: 'plan my week',            desc: 'Nova asks, then builds' },
      { cmd: 'I have 3 exams this week', desc: 'Priority schedule made' },
      { cmd: 'what should I do today',  desc: "Today's plan from goals" },
      { cmd: 'I have 4hrs free',         desc: 'Optimal session split' },
      { cmd: 'rebuild this week',        desc: 'Resets plan from scratch' },
    ],
  },
]

const ROW3: Card[] = [
  {
    icon: '📈', title: 'Progress Tracking',
    sub: "See how far you've come.",
    accent: '#4db8a8', iconBg: 'rgba(60,160,140,0.15)',
    small: true,
    cmds: [
      { cmd: "how's my progress",  desc: 'Full summary' },
      { cmd: 'show my streak',     desc: 'Streak + history' },
      { cmd: 'weekly review',      desc: 'Deep dive into patterns' },
    ],
  },
  {
    icon: '🧠', title: 'Mood & Energy',
    sub: 'Nova picks up on how you\'re feeling.',
    accent: '#d4845a', iconBg: 'rgba(200,110,60,0.15)',
    small: true,
    cmds: [
      { cmd: "I'm exhausted",       desc: 'Adjusts intensity' },
      { cmd: 'feeling motivated',   desc: 'Loads harder tasks' },
      { cmd: 'not in the mood',     desc: 'Light accountability mode' },
    ],
  },
  {
    icon: '🔥', title: 'Streaks & Milestones',
    sub: 'Consistency, tracked.',
    accent: '#9b72ff', iconBg: 'rgba(136,85,255,0.15)',
    small: true,
    cmds: [
      { cmd: 'show my streak',    desc: 'Current + best' },
      { cmd: 'I checked in today', desc: 'Streak extended' },
      { cmd: 'any milestones',    desc: 'Recent achievements' },
    ],
  },
]

// ─── Feature card component ───────────────────────────────────────────────────

function FeatureCard({ card }: { card: Card }) {
  const [hov, setHov] = useState(false)

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background:    CARD,
        border:        hov ? `0.5px solid ${card.accent}40` : '0.5px solid #1e1e1e',
        borderTop:     hov ? `1px solid ${card.accent}35` : '0.5px solid #1e1e1e',
        borderRadius:  '14px',
        padding:       card.small ? '20px' : '24px',
        boxShadow:     hov ? `0 4px 24px ${card.accent}12` : 'none',
        transition:    'border 0.18s, box-shadow 0.18s',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '18px' }}>
        <div style={{
          width: '42px', height: '42px', borderRadius: '10px',
          background: card.iconBg,
          border: `0.5px solid ${card.accent}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '20px', flexShrink: 0,
        }}>
          {card.icon}
        </div>
        <div>
          <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#fff' }}>{card.title}</p>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#555', lineHeight: 1.4 }}>{card.sub}</p>
        </div>
      </div>

      {/* Commands */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {card.cmds.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <code style={{
              fontFamily:   'monospace',
              fontSize:     '11px',
              color:        '#a088ff',
              background:   '#161616',
              border:       '0.5px solid #2a1f44',
              padding:      '2px 8px',
              borderRadius: '5px',
              flexShrink:   0,
              maxWidth:     '180px',
              whiteSpace:   'nowrap',
              overflow:     'hidden',
              textOverflow: 'ellipsis',
            }}>
              {c.cmd}
            </code>
            <span style={{ fontSize: '12px', color: '#555' }}>{c.desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: '11px', fontWeight: 700, letterSpacing: '.18em',
      textTransform: 'uppercase', color: PD, margin: '0 0 24px',
    }}>
      {children}
    </p>
  )
}

// ─── How it works step ────────────────────────────────────────────────────────

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div style={{
      background: CARD, border: '0.5px solid #1e1e1e', borderRadius: '14px',
      padding: '24px 20px',
    }}>
      <p style={{
        fontSize: '36px', fontWeight: 800, color: P1,
        opacity: 0.18, margin: '0 0 12px', lineHeight: 1, fontVariantNumeric: 'tabular-nums',
      }}>
        {n}
      </p>
      <p style={{ fontSize: '14px', fontWeight: 700, color: '#fff', margin: '0 0 6px' }}>{title}</p>
      <p style={{ fontSize: '12px', color: '#555', margin: 0, lineHeight: 1.5 }}>{desc}</p>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function NovaIntro({ userName }: { userName?: string | null }) {
  return (
    <div style={{ maxWidth: '1100px' }}>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <div style={{
        textAlign: 'center', padding: '48px 0 40px',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Glow */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `radial-gradient(ellipse 60% 55% at 50% 40%, ${P1}12 0%, transparent 70%)`,
        }} />

        <p style={{
          fontSize: '11px', fontWeight: 700, letterSpacing: '.22em',
          textTransform: 'uppercase', color: PL, margin: '0 0 18px', opacity: 0.7,
        }}>
          YOUR COMPANION{userName ? `, ${userName.split(' ')[0].toUpperCase()}` : ''}
        </p>

        <h1 style={{
          fontSize: 'clamp(64px, 12vw, 130px)',
          fontWeight: 800, margin: '0 0 20px', lineHeight: 1,
          letterSpacing: '-4px',
          background: `linear-gradient(135deg, #ffffff 10%, ${PL} 40%, ${P1} 70%, ${P2} 100%)`,
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          filter: `drop-shadow(0 0 40px ${P1}30)`,
        }}>
          NOVA
        </h1>

        <p style={{ fontSize: '18px', color: '#aaa', margin: '0 0 10px', fontWeight: 400 }}>
          Steady. Structured. Always here.
        </p>
        <p style={{
          fontSize: '14px', color: '#444', margin: '0 auto',
          maxWidth: '440px', lineHeight: 1.7,
        }}>
          Your accountability companion on Telegram — keeps you focused, on track, on time.
        </p>

        {/* Divider */}
        <div style={{
          margin: '36px auto 0', width: '120px', height: '1px',
          background: `linear-gradient(90deg, transparent, ${P1}60, transparent)`,
        }} />
      </div>

      {/* ── How it works ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: '48px' }}>
        <SectionLabel>How it works</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          <Step n="01" title="Start a session"       desc="Tell Nova what you're working on. Any time, any day." />
          <Step n="02" title="Nova tracks it"         desc="Every session logged automatically. No manual entry." />
          <Step n="03" title="She calls you out"      desc="Miss a session? Nova notices. She'll ask why." />
          <Step n="04" title="Dashboard reflects it"  desc="Everything shows up here in real time. Streaks, focus, patterns." />
        </div>
      </div>

      {/* ── Feature cards ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: '48px' }}>
        <SectionLabel>Everything you can do</SectionLabel>

        {/* Row 1 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '12px' }}>
          {ROW1.map(c => <FeatureCard key={c.title} card={c} />)}
        </div>

        {/* Row 2 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '12px' }}>
          {ROW2.map(c => <FeatureCard key={c.title} card={c} />)}
        </div>

        {/* Row 3 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          {ROW3.map(c => <FeatureCard key={c.title} card={c} />)}
        </div>
      </div>

      {/* ── Nova's character ───────────────────────────────────────────── */}
      <div style={{ marginBottom: '32px' }}>
        <SectionLabel>Nova's character</SectionLabel>
        <div style={{
          background: CARD,
          border: '0.5px solid #1e1e1e',
          borderLeft: `3px solid ${P1}`,
          borderRadius: '14px',
          padding: '28px 32px',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '32px',
        }}>
          {[
            { trait: '✦ Structured, not rigid',  desc: 'Builds plans around real life, not ideal conditions.' },
            { trait: '✦ Direct, not harsh',       desc: 'Calls out avoidance — never lectures, never judges.' },
            { trait: '✦ Memory that matters',     desc: 'Remembers what you said you\'d do. Holds you to it.' },
          ].map(({ trait, desc }) => (
            <div key={trait}>
              <p style={{ fontSize: '13px', fontWeight: 700, color: PL, margin: '0 0 6px' }}>{trait}</p>
              <p style={{ fontSize: '12px', color: '#555', margin: 0, lineHeight: 1.6 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── CTA bar ────────────────────────────────────────────────────── */}
      <div style={{
        background: CARD,
        border: `0.5px solid ${P1}30`,
        borderRadius: '14px',
        padding: '28px 32px',
        backgroundImage: `linear-gradient(135deg, ${P1}06 0%, transparent 60%)`,
        marginBottom: '40px',
      }}>
        <p style={{ fontSize: '16px', fontWeight: 700, color: '#fff', margin: '0 0 6px' }}>
          Nova is waiting on Telegram
        </p>
        <p style={{ fontSize: '13px', color: '#555', margin: '0 0 20px', maxWidth: '460px', lineHeight: 1.5 }}>
          Connect once. Nova handles check-ins, sessions, deadlines — all in your Telegram chat.
        </p>
        <TelegramConnectBanner />
      </div>

    </div>
  )
}
