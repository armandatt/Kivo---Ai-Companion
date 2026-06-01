'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { AuthAwareLink } from "@/components/auth-aware-link"
import { SparklesCore } from "@/components/ui/sparkles"
import { SplineBot } from "@/components/spline-bot"
import { getCurrentQuote, type Quote } from "@/lib/quotes"

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
  const [quote, setQuote] = useState<Quote>(() => getCurrentQuote())
  const [quoteVisible, setQuoteVisible] = useState(true)

  // Rotate quote every 8 seconds with a fade transition
  useEffect(() => {
    const id = setInterval(() => {
      setQuoteVisible(false)
      setTimeout(() => {
        setQuote(getCurrentQuote())
        setQuoteVisible(true)
      }, 500)
    }, 8000)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      <style>{`
        @keyframes botFloat {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-10px); }
        }
        .quote-fade {
          transition: opacity 0.5s ease;
        }
      `}</style>

      <section
        className="relative px-4 py-16 md:py-24 overflow-hidden"
        style={{ background: '#060810' }}
      >
        {/* Sparkles background */}
        <SparklesCore
          id="hero-sparkles"
          background="transparent"
          particleColor="#00E5A0"
          particleDensity={30}
          minSize={0.3}
          maxSize={1.2}
          speed={1}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />

        <div className="mx-auto max-w-7xl relative z-10">
          <div className="grid md:grid-cols-2 gap-12 lg:gap-16 items-center">

            {/* LEFT: Heading + rotating quote + CTA */}
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

              {/* Rotating motivational quote */}
              <div
                className="quote-fade rounded-xl px-5 py-4"
                style={{
                  opacity: quoteVisible ? 1 : 0,
                  background: 'rgba(0,229,160,0.04)',
                  border: '1px solid rgba(0,229,160,0.12)',
                }}
              >
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: 'rgba(255,255,255,0.55)', fontStyle: 'italic' }}
                >
                  &ldquo;{quote.text}&rdquo;
                </p>
                <p
                  className="mt-1.5 text-xs tracking-widest uppercase"
                  style={{ color: 'rgba(0,229,160,0.45)' }}
                >
                  — {quote.author}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-1">
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

            {/* RIGHT: Floating robot */}
            <div
              className="relative flex items-center justify-center"
              style={{ minHeight: '520px' }}
            >
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  height: '520px',
                  animation: 'botFloat 7s ease-in-out infinite',
                }}
              >
                <SplineBot className="w-full h-full" />
              </div>
            </div>

          </div>
        </div>
      </section>
    </>
  )
}
