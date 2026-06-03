'use client'

import { useState } from 'react'
import TelegramConnectBanner from '@/components/dashboard/telegram-connect-banner'

// ─── Design tokens ────────────────────────────────────────────────────────────
const G1   = '#00F5A0'
const G2   = '#00C070'
const GL   = '#80ffd0'
const GD   = '#00a060'
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
    icon: '🏋️', title: 'Workout Logging',
    sub: 'Every rep, every set. Logged live in your Telegram chat.',
    accent: '#00e090', iconBg: 'rgba(0,220,140,0.12)',
    cmds: [
      { cmd: '/log',                          desc: 'Open a live session' },
      { cmd: 'chest today, 4x8 bench 80kg',  desc: 'Logs inline, no /log needed' },
      { cmd: 'add bench press 3x10 100kg',    desc: 'Adds a set mid-session' },
      { cmd: 'done',                          desc: 'Closes + saves session' },
      { cmd: 'cancel session',                desc: 'Discards without saving' },
    ],
  },
  {
    icon: '📊', title: 'Lift Tracking & PRs',
    sub: 'Your personal records and trends, always within reach.',
    accent: '#00d4b0', iconBg: 'rgba(0,200,160,0.12)',
    cmds: [
      { cmd: '/pr',              desc: 'All personal records' },
      { cmd: '/progress',        desc: 'Lift trends + volume charts' },
      { cmd: '/history',         desc: 'Past sessions' },
      { cmd: "how's my squat?",  desc: 'Specific lift trend' },
      { cmd: 'am I progressing', desc: 'Overall analysis' },
    ],
  },
]

const ROW2: Card[] = [
  {
    icon: '🗓️', title: 'Smart Scheduling',
    sub: "Rex checks in on your terms. Tell him when — he'll be there.",
    accent: '#00e090', iconBg: 'rgba(0,220,140,0.12)',
    cmds: [
      { cmd: 'ping me at 6am',      desc: 'One-time morning check-in' },
      { cmd: 'every day at 9',       desc: 'Daily repeating reminder' },
      { cmd: 'check me in 30 min',  desc: 'Quick follow-up' },
      { cmd: 'breakfast time',       desc: 'Named time — Rex figures it out' },
      { cmd: 'stop check-ins',       desc: 'Cancel all scheduled pings' },
    ],
  },
  {
    icon: '⚖️', title: 'Body Tracking',
    sub: 'Bodyweight, BMI, measurements — trends Rex uses to coach you.',
    accent: '#00c8a0', iconBg: 'rgba(0,180,140,0.12)',
    cmds: [
      { cmd: 'weigh 82kg today',          desc: 'Logs bodyweight' },
      { cmd: "what's my weight trend?",   desc: 'Shows trend chart' },
      { cmd: 'BMI check',                  desc: 'Current BMI' },
      { cmd: 'chest 42in, arms 16in',      desc: 'Saves measurements' },
      { cmd: "how's my progress?",         desc: 'Full body overview' },
    ],
  },
]

const ROW3: Card[] = [
  {
    icon: '🔀', title: 'Training Split',
    sub: 'What you train and when.',
    accent: '#00e090', iconBg: 'rgba(0,220,140,0.12)',
    small: true,
    cmds: [
      { cmd: '/split',                   desc: 'Current split' },
      { cmd: 'push/pull/legs',           desc: 'Updates your split' },
      { cmd: 'what do I train tomorrow', desc: 'Next session' },
    ],
  },
  {
    icon: '📈', title: 'Progressive Overload',
    sub: "Rex tells you when to go heavier.",
    accent: '#00d4a0', iconBg: 'rgba(0,200,150,0.12)',
    small: true,
    cmds: [
      { cmd: '/overload',              desc: 'Full overload suggestions' },
      { cmd: 'bench is getting easy',  desc: 'New target set' },
      { cmd: 'I hit a PR today',        desc: 'PR recorded + celebrated' },
    ],
  },
  {
    icon: '🔥', title: 'Streaks & Consistency',
    sub: 'Show up. Rex counts it.',
    accent: '#00e090', iconBg: 'rgba(0,220,140,0.12)',
    small: true,
    cmds: [
      { cmd: '/streak',              desc: 'Current streak' },
      { cmd: 'how consistent am I',  desc: 'Week-over-week analysis' },
      { cmd: 'any PRs this week',    desc: "Week's highlights" },
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
        background:   CARD,
        border:       hov ? `0.5px solid ${card.accent}40` : '0.5px solid #1e1e1e',
        borderTop:    hov ? `1px solid ${card.accent}35` : '0.5px solid #1e1e1e',
        borderRadius: '14px',
        padding:      card.small ? '20px' : '24px',
        boxShadow:    hov ? `0 4px 24px ${card.accent}10` : 'none',
        transition:   'border 0.18s, box-shadow 0.18s',
      }}
    >
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {card.cmds.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <code style={{
              fontFamily: 'monospace', fontSize: '11px',
              color: G1, background: '#0d1f17',
              border: `0.5px solid ${G1}25`,
              padding: '2px 8px', borderRadius: '5px',
              flexShrink: 0, maxWidth: '200px',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: '11px', fontWeight: 700, letterSpacing: '.18em',
      textTransform: 'uppercase', color: GD, margin: '0 0 24px',
    }}>
      {children}
    </p>
  )
}

function HowStep({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div style={{
      background: CARD, border: '0.5px solid #1e1e1e', borderRadius: '14px', padding: '24px 20px',
    }}>
      <p style={{
        fontSize: '36px', fontWeight: 800, color: G1,
        opacity: 0.18, margin: '0 0 12px', lineHeight: 1,
      }}>
        {n}
      </p>
      <p style={{ fontSize: '14px', fontWeight: 700, color: '#fff', margin: '0 0 6px' }}>{title}</p>
      <p style={{ fontSize: '12px', color: '#555', margin: 0, lineHeight: 1.5 }}>{desc}</p>
    </div>
  )
}

export default function RexIntro({ userName }: { userName?: string | null }) {
  return (
    <div style={{ maxWidth: '1100px' }}>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', padding: '48px 0 40px', position: 'relative', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `radial-gradient(ellipse 60% 55% at 50% 40%, ${G1}0e 0%, transparent 70%)`,
        }} />

        <p style={{
          fontSize: '11px', fontWeight: 700, letterSpacing: '.22em',
          textTransform: 'uppercase', color: GL, margin: '0 0 18px', opacity: 0.7,
        }}>
          YOUR COMPANION{userName ? `, ${userName.split(' ')[0].toUpperCase()}` : ''}
        </p>

        <h1 style={{
          fontSize: 'clamp(64px, 12vw, 130px)',
          fontWeight: 800, margin: '0 0 20px', lineHeight: 1, letterSpacing: '-4px',
          background: `linear-gradient(135deg, #ffffff 10%, ${GL} 40%, ${G1} 70%, ${G2} 100%)`,
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          filter: `drop-shadow(0 0 40px ${G1}30)`,
        }}>
          REX
        </h1>

        <p style={{ fontSize: '18px', color: '#aaa', margin: '0 0 10px', fontWeight: 400 }}>
          No excuses. Just results.
        </p>
        <p style={{ fontSize: '14px', color: '#444', margin: '0 auto', maxWidth: '440px', lineHeight: 1.7 }}>
          Your gym coach on Telegram — tracks every rep, calls out every skip, pushes you to hit PRs.
        </p>

        <div style={{
          margin: '36px auto 0', width: '120px', height: '1px',
          background: `linear-gradient(90deg, transparent, ${G1}60, transparent)`,
        }} />
      </div>

      {/* ── How it works ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: '48px' }}>
        <SectionLabel>How it works</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          <HowStep n="01" title="Start with /log"      desc="Open a session, tell Rex what you're training. Or just describe it." />
          <HowStep n="02" title="Rex logs it"          desc="Every set, rep, weight captured live. No spreadsheets." />
          <HowStep n="03" title="He flags everything"  desc="Misses, regressions, plateaus — Rex calls them all out." />
          <HowStep n="04" title="Dashboard reflects it" desc="PRs, volume, streak — updated every session." />
        </div>
      </div>

      {/* ── Feature cards ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: '48px' }}>
        <SectionLabel>Everything you can do</SectionLabel>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '12px' }}>
          {ROW1.map(c => <FeatureCard key={c.title} card={c} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '12px' }}>
          {ROW2.map(c => <FeatureCard key={c.title} card={c} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          {ROW3.map(c => <FeatureCard key={c.title} card={c} />)}
        </div>
      </div>

      {/* ── Rex's character ───────────────────────────────────────────── */}
      <div style={{ marginBottom: '32px' }}>
        <SectionLabel>Rex's character</SectionLabel>
        <div style={{
          background: CARD, border: '0.5px solid #1e1e1e',
          borderLeft: `3px solid ${G1}`,
          borderRadius: '14px', padding: '28px 32px',
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '32px',
        }}>
          {[
            { trait: '✦ Blunt, not cruel',      desc: 'Tells you hard truths directly. No sugarcoating, no cruelty.' },
            { trait: '✦ Obsessed with data',    desc: 'Logs everything, references it. Gut feelings are for other coaches.' },
            { trait: '✦ Zero tolerance',        desc: 'No tolerance for excuses. Always has a solution waiting.' },
          ].map(({ trait, desc }) => (
            <div key={trait}>
              <p style={{ fontSize: '13px', fontWeight: 700, color: GL, margin: '0 0 6px' }}>{trait}</p>
              <p style={{ fontSize: '12px', color: '#555', margin: 0, lineHeight: 1.6 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── CTA bar ───────────────────────────────────────────────────── */}
      <div style={{
        background: CARD, border: `0.5px solid ${G1}30`,
        borderRadius: '14px', padding: '28px 32px',
        backgroundImage: `linear-gradient(135deg, ${G1}05 0%, transparent 60%)`,
        marginBottom: '40px',
      }}>
        <p style={{ fontSize: '16px', fontWeight: 700, color: '#fff', margin: '0 0 6px' }}>
          Rex is waiting on Telegram
        </p>
        <p style={{ fontSize: '13px', color: '#555', margin: '0 0 20px', maxWidth: '460px', lineHeight: 1.5 }}>
          Connect once. Rex handles sessions, check-ins, and PR tracking — all in your Telegram chat.
        </p>
        <TelegramConnectBanner />
      </div>

    </div>
  )
}
