'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'

// ── Data ──────────────────────────────────────────────────────────────────────

const COMMANDS = [
  { cmd: '/log',                 example: '/log',              desc: 'Start today\'s session. Rex prompts with your exercises, tracks sets/reps/weight as you go.' },
  { cmd: '/pr',                  example: '/pr',               desc: 'All personal records, sorted by exercise.' },
  { cmd: '/progress [exercise]', example: '/progress bench',  desc: 'Visual lift progression chart for any exercise across your last 8 sessions.' },
  { cmd: '/history [n]',         example: '/history 10',       desc: 'Last n sessions (default 5) — date, muscles, sets, duration.' },
  { cmd: '/overload',            example: '/overload',         desc: 'Tomorrow\'s targets based on last session data and progressive overload rules.' },
  { cmd: '/streak',              example: '/streak',           desc: 'Current training streak in days.' },
  { cmd: '/split',               example: '/split',            desc: 'Your active split, each day, and which session comes next (→).' },
]

const SETUP_COMMANDS = [
  { cmd: '/setup gym_time', example: '/setup gym_time 19:30',  desc: 'Update your gym time. Pre-session messages shift automatically. Accepts 7pm, 19:30, or 7.' },
  { cmd: '/setup goal',     example: '/setup goal fat_loss',   desc: 'Change your goal: fat_loss / muscle / recomp / performance.' },
  { cmd: '/setup weight',   example: '/setup weight 82',       desc: 'Update bodyweight in kg.' },
  { cmd: '/setup split',    example: '/setup split PPL',       desc: 'Reconfigure your training split. Options: PPL, upper_lower, full_body, bro_split.' },
]

const REMINDER_COMMANDS = [
  { cmd: '/reminders', example: '/reminders', desc: 'List all active reminders with their time, frequency, and index number.' },
  { cmd: '/cancel [n]', example: '/cancel 2', desc: 'Delete reminder #2 from the list.' },
]

const NL_FEATURES = [
  { trigger: 'Workout log',     example: 'bench 100kg 4×8, squat 120kg 3×5', desc: 'Log inline — no slash command. Rex parses exercises, weight, sets, and reps.' },
  { trigger: 'Skip day',        example: "can't train today",                 desc: 'Rex asks for a reason: skip / injury / sick / life. Each handled differently.' },
  { trigger: 'Gym time change', example: 'moving gym to 7am from tomorrow',   desc: 'Rex detects the new time, updates the DB, and confirms the pre-session shift time.' },
  { trigger: 'Set reminder',    example: 'remind me at 8am to eat protein',   desc: 'Creates a reminder. Rex asks: one-time, daily, or weekly if not specified.' },
  { trigger: 'Commitment',      example: "I'll bench 100kg by end of month",  desc: 'Stored as a deadline. Rex follows up at 30d, 14d, 7d, 3d, 2d, 1d milestones.' },
]

const AUTO_CRONS = [
  { name: 'Pre-session fire-up',      time: '30 min before gym',             desc: 'Last lifts + today\'s target weight. Includes stall fix or deload note if applicable.' },
  { name: 'Post-session log prompt',  time: 'Gym time + avg session length', desc: '"Done? Log what you hit." — fires once your typical session should be over.' },
  { name: 'Log follow-up',            time: '+90 min after prompt',          desc: '"Did today\'s session happen?" — one re-ask if nothing was logged.' },
  { name: 'Missed session chase',     time: '+3hrs, +5hrs after gym time',   desc: 'Two follow-ups if nothing logged. Writes struggle memory after 3 consecutive misses.' },
  { name: 'Daily check-in',           time: '9am every day',                 desc: 'LLM-generated. References your streak, goal, and today\'s plan. Never repeats.' },
  { name: 'Rest day morning',         time: '9am on rest days',              desc: 'Recovery reminder — protein, sleep, and what\'s coming next session.' },
  { name: 'Backdate prompt',          time: '9am after missed training day', desc: '"You didn\'t log yesterday. Did you train? I can backdate it."' },
  { name: 'Silence reactivation',     time: 'After 5 days quiet',           desc: 'Reactivates when you go quiet. Counter resets when you reply — works forever.' },
  { name: 'Weekly summary',           time: 'Sunday 8pm',                    desc: 'Cycle stats, best lift, one fix, and next cycle directive. LLM-generated.' },
  { name: 'Commitment follow-up',     time: '30d / 14d / 7d / 3d / 2d / 1d', desc: 'Six proactive check-ins across the full lifespan of any goal with a deadline.' },
]

const SMART_SESSION = [
  { name: 'Progressive overload', desc: 'Rex tracks weight per exercise across sessions and flags increases, stalls, and regressions.' },
  { name: 'PR detection',         desc: 'Instant alert when a new personal record is set mid-session.' },
  { name: 'Stall intervention',   desc: 'Same weight 3 sessions in a row — Rex prescribes a deload reset: drop to 90%, run 4×6.' },
  { name: 'Deload week',          desc: 'Every 4 completed cycles, Rex tells you to run 60% weights, 2 sets max.' },
  { name: 'Muscle mismatch',      desc: 'Logging exercises that don\'t match today\'s planned group? Rex asks: Instead or Adding?' },
  { name: 'Duplicate session',    desc: 'Already logged today\'s muscles? Rex asks before creating a second session.' },
]

const SKIP_HANDLING = [
  { reason: 'skip',   desc: 'One grace per 7 days — streak resets on the second skip within that window.' },
  { reason: 'injury', desc: 'Rex logs the issue and asks what\'s affected. No streak penalty.' },
  { reason: 'sick',   desc: 'No streak penalty. Rex advises not training.' },
  { reason: 'life',   desc: 'Acknowledged. Rex confirms the next session target.' },
]

// ── Shared sub-components ────────────────────────────────────────────────────

function SectionHeader({ children }: { children: string }) {
  return (
    <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-foreground/30 border-b border-white/5 pb-3 mb-4">
      {children}
    </p>
  )
}

function Row({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex gap-4 py-3 border-b border-white/4 items-start last:border-0">
      <div className="w-44 shrink-0">{left}</div>
      <div className="flex-1">{right}</div>
    </div>
  )
}

function Mono({ children }: { children: string }) {
  return <span className="font-mono text-[13px] text-foreground/85 font-medium">{children}</span>
}

function Desc({ children }: { children: string }) {
  return <p className="text-[13px] text-foreground/45 leading-relaxed">{children}</p>
}

function Tag({ children, color = 'slate' }: { children: string; color?: 'green' | 'amber' | 'purple' | 'sky' | 'slate' }) {
  const colors = {
    green:  'text-emerald-400',
    amber:  'text-amber-400',
    purple: 'text-violet-400',
    sky:    'text-sky-400',
    slate:  'text-foreground/55',
  }
  return <span className={`text-[13px] font-semibold ${colors[color]}`}>{children}</span>
}

const sections = ['Commands', 'Natural Language', 'Auto-Scheduled', 'Smart Session', 'Skip Handling']

// ── Page ─────────────────────────────────────────────────────────────────────

export default function GuidePage() {
  const [active, setActive] = useState('Commands')

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full max-w-4xl mx-auto px-6 pb-16"
    >
      {/* Header */}
      <div className="pt-8 pb-6">
        <p className="text-[10px] font-semibold tracking-[0.2em] uppercase text-foreground/30 mb-2">Rex / Feature Guide</p>
        <h1 className="text-3xl font-bold text-foreground">What Rex can do</h1>
        <p className="text-sm text-foreground/50 mt-1.5">
          Commands, natural language, and auto-scheduled messages — all in Telegram.
        </p>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 mb-8 flex-wrap">
        {sections.map(s => (
          <button
            key={s}
            onClick={() => setActive(s)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              active === s
                ? 'bg-white/10 text-foreground'
                : 'text-foreground/35 hover:text-foreground/60'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Commands */}
      {active === 'Commands' && (
        <div className="space-y-8">
          <div>
            <SectionHeader>Commands</SectionHeader>
            {COMMANDS.map(c => (
              <Row key={c.cmd}
                left={<div><Mono>{c.cmd}</Mono><p className="font-mono text-[11px] text-foreground/25 mt-0.5">{c.example}</p></div>}
                right={<Desc>{c.desc}</Desc>}
              />
            ))}
          </div>

          <div>
            <SectionHeader>Setup Commands</SectionHeader>
            {SETUP_COMMANDS.map(c => (
              <Row key={c.cmd}
                left={<div><Mono>{c.cmd}</Mono><p className="font-mono text-[11px] text-foreground/25 mt-0.5">{c.example}</p></div>}
                right={<Desc>{c.desc}</Desc>}
              />
            ))}
          </div>

          <div>
            <SectionHeader>Reminder Commands</SectionHeader>
            {REMINDER_COMMANDS.map(c => (
              <Row key={c.cmd}
                left={<div><Mono>{c.cmd}</Mono><p className="font-mono text-[11px] text-foreground/25 mt-0.5">{c.example}</p></div>}
                right={<Desc>{c.desc}</Desc>}
              />
            ))}
          </div>
        </div>
      )}

      {/* Natural Language */}
      {active === 'Natural Language' && (
        <div>
          <SectionHeader>Natural Language — No Commands Needed</SectionHeader>
          <p className="text-sm text-foreground/40 mb-5 leading-relaxed">
            Just talk to Rex like you'd text a trainer. These phrases are understood automatically.
          </p>
          {NL_FEATURES.map(f => (
            <Row key={f.trigger}
              left={<Tag color="purple">{f.trigger}</Tag>}
              right={
                <div>
                  <p className="font-mono text-[11px] text-foreground/30 mb-1.5">e.g. "{f.example}"</p>
                  <Desc>{f.desc}</Desc>
                </div>
              }
            />
          ))}
        </div>
      )}

      {/* Auto-Scheduled */}
      {active === 'Auto-Scheduled' && (
        <div>
          <SectionHeader>Auto-Scheduled Messages</SectionHeader>
          <p className="text-sm text-foreground/40 mb-5 leading-relaxed">
            These fire automatically. No input needed. Rex just shows up.
          </p>
          {AUTO_CRONS.map(c => (
            <Row key={c.name}
              left={
                <div>
                  <Tag color="green">{c.name}</Tag>
                  <p className="text-[11px] text-foreground/25 mt-1">{c.time}</p>
                </div>
              }
              right={<Desc>{c.desc}</Desc>}
            />
          ))}
        </div>
      )}

      {/* Smart Session */}
      {active === 'Smart Session' && (
        <div>
          <SectionHeader>Smart Session Features</SectionHeader>
          <p className="text-sm text-foreground/40 mb-5 leading-relaxed">
            Rex tracks every session detail and uses it to coach forward, not just record.
          </p>
          {SMART_SESSION.map(f => (
            <Row key={f.name}
              left={<Tag color="amber">{f.name}</Tag>}
              right={<Desc>{f.desc}</Desc>}
            />
          ))}
        </div>
      )}

      {/* Skip Handling */}
      {active === 'Skip Handling' && (
        <div>
          <SectionHeader>Skip & Injury Handling</SectionHeader>
          <p className="text-sm text-foreground/40 mb-5 leading-relaxed">
            Say "can't train today" — Rex asks for a reason. Each reason is handled differently.
          </p>
          {SKIP_HANDLING.map(s => (
            <Row key={s.reason}
              left={<Tag color="sky">{s.reason}</Tag>}
              right={<Desc>{s.desc}</Desc>}
            />
          ))}

          <div className="mt-8 p-4 rounded-xl border border-white/5 bg-white/2">
            <p className="text-xs font-semibold text-foreground/50 mb-2">Streak protection</p>
            <p className="text-sm text-foreground/40 leading-relaxed">
              Injury, sick, and life skips never affect your streak. One grace skip per 7 days is allowed — the second within a week resets the counter.
            </p>
          </div>
        </div>
      )}

      <div className="mt-12 pt-6 border-t border-white/5 text-xs text-foreground/20">
        Kivo · Rex Gym Coaching · All data belongs to the user
      </div>
    </motion.div>
  )
}
