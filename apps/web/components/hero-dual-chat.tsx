'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { AuthAwareLink } from "@/components/auth-aware-link"

interface Message {
  id: string
  text: string
  isUser: boolean
  delayMs: number
}

interface Companion {
  name: string
  emoji: string
  color: string
  messages: Message[]
}

const TYPING_DURATION = 700

const rexCompanion: Companion = {
  name: 'Rex',
  emoji: '💪',
  color: '#f97316',
  messages: [
    { id: 'rex-1', text: "Yo. 6:47am. Leg day doesn't cancel itself 🔥", isUser: false, delayMs: 400 },
    { id: 'rex-2', text: 'Last Tuesday you hit 80kg squats. Today we go 82.5kg 💪', isUser: false, delayMs: 1800 },
    { id: 'user-1', text: "I'm actually feeling it today", isUser: true, delayMs: 3200 },
    { id: 'rex-3', text: "That's the CNS adapting. That feeling IS the progress.", isUser: false, delayMs: 4400 },
    { id: 'user-2', text: 'Hit 82.5 for 3 sets 🔥', isUser: true, delayMs: 6000 },
    { id: 'rex-4', text: 'LETSSS GO. Streak: 12 days 🐉 Zephyr grew new wings.', isUser: false, delayMs: 7200 },
  ]
}

const novaCompanion: Companion = {
  name: 'Nova',
  emoji: '🌿',
  color: '#00E5A0',
  messages: [
    { id: 'nova-1', text: "Hey 🌿 You've got a 2pm deadline today.", isUser: false, delayMs: 0 },
    { id: 'nova-2', text: 'Want to start a 25-min focus session? Your tree is waiting 🌱', isUser: false, delayMs: 1400 },
    { id: 'user-3', text: 'Start focus', isUser: true, delayMs: 2600 },
    { id: 'nova-3', text: 'Forest session started 🌲 Phone down, world out.', isUser: false, delayMs: 3700 },
    { id: 'user-4', text: 'Done! That felt really good', isUser: true, delayMs: 5400 },
    { id: 'nova-4', text: "Your pine grew 3cm ✨ That's 4 sessions today. You're in the zone.", isUser: false, delayMs: 6600 },
  ]
}

// Rex last message appears at 7200 + 700 = 7900ms. Nova starts at 9500ms.
const NOVA_START_DELAY = 9500
const DIVIDER_APPEAR_DELAY = 9000

function ChatPane({
  companion,
  active,
  startOffset,
}: {
  companion: Companion
  active: boolean
  startOffset: number
}) {
  const [visibleMessages, setVisibleMessages] = useState<Set<string>>(new Set())
  const [typingId, setTypingId] = useState<string | null>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []

    if (!active) {
      setVisibleMessages(new Set())
      setTypingId(null)
      return
    }

    companion.messages.forEach((msg) => {
      if (!msg.isUser) {
        const t1 = setTimeout(
          () => setTypingId(msg.id),
          startOffset + msg.delayMs
        )
        timersRef.current.push(t1)
      }
      const t2 = setTimeout(
        () => {
          setTypingId(null)
          setVisibleMessages((prev) => new Set(prev).add(msg.id))
        },
        startOffset + msg.delayMs + (msg.isUser ? 0 : TYPING_DURATION)
      )
      timersRef.current.push(t2)
    })

    return () => timersRef.current.forEach(clearTimeout)
  }, [active, startOffset])

  const ac = companion.color

  return (
    <div className="flex flex-col flex-1 min-w-0">
      {/* Header */}
      <div
        className="flex items-center gap-2.5 px-4 py-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0"
          style={{ background: `${ac}20`, border: `1.5px solid ${ac}50` }}
        >
          {companion.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-slate-100 leading-none">{companion.name}</p>
          <p className="text-[10px] mt-0.5 leading-none" style={{ color: ac }}>always here</p>
        </div>
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: active ? ac : 'rgba(255,255,255,0.15)', boxShadow: active ? `0 0 6px ${ac}` : 'none', transition: 'all 0.4s' }}
        />
      </div>

      {/* Messages */}
      <div
        className="flex-1 flex flex-col justify-end gap-2 px-3 py-3 overflow-hidden"
        style={{ background: '#070a0f', minHeight: "420px" }}
      >
        {companion.messages.map((msg) => {
          const visible = visibleMessages.has(msg.id)
          const typing = typingId === msg.id
          return (
            <div key={msg.id}>
              {typing && (
                <div className="flex justify-start">
                  <div
                    className="px-3 py-2 rounded-2xl rounded-tl-sm"
                    style={{ background: '#1a2030', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <div className="flex gap-1 items-center h-3">
                      {[0, 150, 300].map((d) => (
                        <div
                          key={d}
                          className="w-1.5 h-1.5 rounded-full animate-bounce"
                          style={{ background: 'rgba(255,255,255,0.3)', animationDelay: `${d}ms` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {visible && (
                <div
                  className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'}`}
                  style={{ animation: 'fadeUp 0.25s ease-out forwards' }}
                >
                  <div
                    className="px-3 py-2 rounded-2xl text-[11px] leading-relaxed font-medium"
                    style={{
                      maxWidth: '88%',
                      ...(msg.isUser
                        ? { background: `${ac}18`, border: `1px solid ${ac}35`, color: '#e8eaf0', borderBottomRightRadius: '3px' }
                        : { background: '#1a2030', border: '1px solid rgba(255,255,255,0.06)', color: '#bbbdcc', borderBottomLeftRadius: '3px' }),
                    }}
                  >
                    {msg.text}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Input */}
      <div
        className="flex items-center gap-2 px-3 py-2.5"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: '#0d1117' }}
      >
        <div
          className="flex-1 px-3 py-1.5 rounded-full text-[11px] text-slate-600"
          style={{ background: '#151c28', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          Message
        </div>
        <button
          className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: active ? ac : 'rgba(255,255,255,0.1)', transition: 'background 0.4s' }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill={active ? '#000' : 'rgba(255,255,255,0.3)'}>
            <path d="M3 12l18-9-9 18V13L3 12z" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export function HeroDualChat() {
  const [rexActive, setRexActive] = useState(false)
  const [dividerVisible, setDividerVisible] = useState(false)
  const [novaActive, setNovaActive] = useState(false)

  useEffect(() => {
    // Rex starts immediately on mount
    const t0 = setTimeout(() => setRexActive(true), 300)
    // Divider line appears before Nova
    const t1 = setTimeout(() => setDividerVisible(true), DIVIDER_APPEAR_DELAY)
    // Nova activates
    const t2 = setTimeout(() => setNovaActive(true), NOVA_START_DELAY)
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2) }
  }, [])

  return (
    <>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes dividerGrow {
          from { opacity: 0; transform: scaleY(0); }
          to   { opacity: 1; transform: scaleY(1); }
        }
        .divider-line {
          transform-origin: top center;
          animation: dividerGrow 0.5s cubic-bezier(0.22,1,0.36,1) forwards;
        }
      `}</style>

      <section
        className="relative overflow-hidden px-4 py-20 md:py-36"
        style={{ background: '#060810' }}
      >
        {/* NO decorative rects — removed entirely to fix the ghost boxes */}
        <div
          className="absolute top-1/3 left-1/4 w-72 h-72 rounded-full blur-3xl pointer-events-none"
          style={{ background: 'radial-gradient(ellipse, rgba(255,107,53,0.04) 0%, transparent 70%)' }}
        />

        <div className="mx-auto max-w-7xl relative z-10">
          <div className="grid md:grid-cols-2 gap-12 lg:gap-16 items-center">

            {/* LEFT */}
            <div className="space-y-7">
              <div
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold"
                style={{ border: '1px solid rgba(0,229,160,0.2)', background: 'rgba(0,229,160,0.06)', color: '#00E5A0' }}
              >
                <span>🔥</span> 2,400 people on streak today
              </div>

              <h1 className="text-5xl md:text-6xl lg:text-7xl font-black tracking-tight leading-[1.05]">
                <span style={{ color: '#e8eaf0' }}>Meet the companion</span><br />
                <span style={{ color: '#00E5A0' }}>who never lets</span><br />
                <span style={{ color: '#e8eaf0' }}>you quit</span>
              </h1>

              <p className="text-lg text-slate-400 leading-relaxed max-w-md">
                "Your AI companion that grows with you — complete with a living creature. All inside WhatsApp and Telegram."
              </p>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button
                  asChild
                  size="lg"
                  className="font-bold text-slate-950 hover:scale-[1.02] transition-transform"
                  style={{ background: '#00E5A0', boxShadow: '0 0 24px rgba(0,229,160,0.25)' }}
                >
                  <AuthAwareLink>Start on Telegram →</AuthAwareLink>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="font-semibold"
                  style={{ borderColor: 'rgba(255,255,255,0.12)', color: '#e8eaf0', background: 'rgba(255,255,255,0.03)' }}
                >
                  <AuthAwareLink>Start on WhatsApp</AuthAwareLink>
                </Button>
              </div>

              <div className="flex gap-6 pt-1 text-sm text-slate-500">
                {['No app to download', 'Free to start'].map((t) => (
                  <div key={t} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#00E5A0' }} />
                    {t}
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT — single screen, two panes */}
            <div className="flex items-center justify-center">
              <div
                className="w-full rounded-[20px] overflow-hidden"
                style={{
                  maxWidth: "580px",
                  background: '#0d1117',
                  border: '1px solid rgba(255,255,255,0.08)',
                  boxShadow: '0 32px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)',
                }}
              >
                {/* Shared status bar */}
                <div
                  className="flex justify-between items-center px-5 py-2.5"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <span className="text-[11px] font-semibold text-slate-300">9:41</span>
                  <span className="text-[10px] text-slate-500 font-medium tracking-wide">2 conversations</span>
                  <svg width="14" height="9" viewBox="0 0 14 9" fill="none">
                    <rect x="0" y="3.5" width="2.2" height="5.5" rx="0.7" fill="rgba(255,255,255,0.35)" />
                    <rect x="3.5" y="2" width="2.2" height="7" rx="0.7" fill="rgba(255,255,255,0.55)" />
                    <rect x="7" y="0.5" width="2.2" height="8.5" rx="0.7" fill="rgba(255,255,255,0.8)" />
                    <rect x="11" y="1" width="1.8" height="7" rx="0.4" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.7" />
                    <rect x="11.4" y="2.8" width="0.9" height="3.4" rx="0.3" fill="rgba(255,255,255,0.35)" />
                  </svg>
                </div>

                {/* Two panes */}
                <div className="flex" style={{ minHeight: "560px" }}>
                  {/* Rex pane */}
                  <ChatPane
                    companion={rexCompanion}
                    active={rexActive}
                    startOffset={0}
                  />

                  
                  <div
                    className="flex-shrink-0 self-stretch flex flex-col items-center"
                    style={{ width: '20px', padding: '12px 0' }}
                  >
                    <div
                      style={{
                        width: '1px',
                        flex: 1,
                        background: dividerVisible
                          ? 'linear-gradient(to bottom, transparent, rgba(0,229,160,0.5) 20%, rgba(0,229,160,0.5) 80%, transparent)'
                          : 'transparent',
                        transition: 'background 0.6s ease',
                      }}
                    />
                  </div>

                  {/* Nova pane — always in DOM but inactive until triggered */}
                  <ChatPane
                    companion={novaCompanion}
                    active={novaActive}
                    startOffset={0}
                  />
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>
    </>
  )
}
