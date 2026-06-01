'use client'

import { useState, useEffect, useRef } from 'react'

interface MessageItem {
  id: string
  text: string
  isUser: boolean
  delayMs: number
}

interface Companion {
  name: string
  emoji: string
  color: string
  messages: MessageItem[]
}

const TYPING_DURATION = 600

const companions: Record<string, Companion> = {
  rex: {
    name: 'Rex',
    emoji: '💪',
    color: '#f97316',
    messages: [
      { id: 'rex-1', text: "Yo. 6:47am. Leg day doesn't cancel itself 🔥", isUser: false, delayMs: 0 },
      { id: 'rex-2', text: 'Last Tuesday you hit 80kg squats. Today we go 82.5kg 💪', isUser: false, delayMs: 1200 },
      { id: 'user-1', text: "I'm actually feeling it today", isUser: true, delayMs: 2400 },
      { id: 'rex-3', text: "That's the CNS adapting. That feeling IS the progress.", isUser: false, delayMs: 3400 },
      { id: 'user-2', text: 'Hit 82.5 for 3 sets 🔥', isUser: true, delayMs: 5000 },
      { id: 'rex-4', text: 'LETSSS GO. Streak: 12 days 🐉 Zephyr grew new wings.', isUser: false, delayMs: 6200 },
    ],
  },
  nova: {
    name: 'Nova',
    emoji: '🌿',
    color: '#00E5A0',
    messages: [
      { id: 'nova-1', text: "Hey 🌿 You've got a 2pm deadline today.", isUser: false, delayMs: 0 },
      { id: 'nova-2', text: 'Want to start a 25-min focus session? Your tree is waiting 🌱', isUser: false, delayMs: 1400 },
      { id: 'user-3', text: 'Start focus', isUser: true, delayMs: 2600 },
      { id: 'nova-3', text: 'Forest session started 🌲 Phone down, world out.', isUser: false, delayMs: 3500 },
      { id: 'user-4', text: 'Done! That felt really good', isUser: true, delayMs: 5200 },
      { id: 'nova-4', text: "Your pine grew 3cm ✨ That's 4 sessions today. You're in the zone.", isUser: false, delayMs: 6400 },
    ],
  },
}

// iPhone 14 real dimensions: 390 × 844 logical pixels
// We render at 340px wide (scales up on large screens via max-w)
const PHONE_W = 340
const PHONE_H = Math.round(340 * (844 / 390)) // ≈ 735px

function ChatPhone({ companion, active }: { companion: Companion; active: boolean }) {
  const [visibleMessages, setVisibleMessages] = useState<Set<string>>(new Set())
  const [typingIds, setTypingIds] = useState<Set<string>>(new Set())
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setVisibleMessages(new Set())
    setTypingIds(new Set())

    if (!active) return

    companion.messages.forEach((msg) => {
      if (!msg.isUser) {
        const t1 = setTimeout(
          () => setTypingIds((prev) => new Set(prev).add(msg.id)),
          msg.delayMs
        )
        timers.current.push(t1)
      }
      const t2 = setTimeout(
        () => {
          setTypingIds((prev) => { const s = new Set(prev); s.delete(msg.id); return s })
          setVisibleMessages((prev) => new Set(prev).add(msg.id))
        },
        msg.delayMs + (msg.isUser ? 0 : TYPING_DURATION)
      )
      timers.current.push(t2)
    })

    return () => timers.current.forEach(clearTimeout)
  }, [active, companion])

  const ac = companion.color

  return (
    // Outer wrapper: centres the phone, max width = phone width
    <div className="flex justify-center">
      <div
        style={{
          width: `${PHONE_W}px`,
          // Subtle halo when active
          filter: active ? `drop-shadow(0 0 32px ${ac}22)` : 'none',
          transition: 'filter 0.6s ease',
        }}
      >
        {/* ── iPhone shell ── */}
        <div
          style={{
            width: `${PHONE_W}px`,
            height: `${PHONE_H}px`,
            borderRadius: '44px',
            background: '#0d1117',
            border: `1.5px solid ${active ? `${ac}35` : 'rgba(255,255,255,0.09)'}`,
            boxShadow: active
              ? `0 32px 80px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06)`
              : '0 24px 60px rgba(0,0,0,0.5)',
            transition: 'border-color 0.5s ease, box-shadow 0.5s ease',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* ── Status bar (iOS style) ── */}
          <div
            style={{
              height: '50px',
              background: '#0a0e1a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 24px',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#e8eaf0', letterSpacing: '-0.3px' }}>9:41</span>
            {/* Dynamic island pill */}
            <div style={{
              width: '120px', height: '34px', borderRadius: '20px',
              background: '#000', position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '8px',
            }} />
            {/* Right icons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {/* Signal */}
              <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
                <rect x="0" y="7" width="3" height="5" rx="1" fill="rgba(255,255,255,0.9)" />
                <rect x="4.5" y="4.5" width="3" height="7.5" rx="1" fill="rgba(255,255,255,0.9)" />
                <rect x="9" y="2" width="3" height="10" rx="1" fill="rgba(255,255,255,0.9)" />
                <rect x="13.5" y="0" width="3" height="12" rx="1" fill="rgba(255,255,255,0.9)" />
              </svg>
              {/* WiFi */}
              <svg width="16" height="12" viewBox="0 0 16 12" fill="rgba(255,255,255,0.9)">
                <path d="M8 9.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/>
                <path d="M3.5 6.5C4.9 5.1 6.35 4.4 8 4.4s3.1.7 4.5 2.1l1.2-1.2C12.1 3.7 10.15 2.9 8 2.9S3.9 3.7 2.3 5.3l1.2 1.2z"/>
                <path d="M1 4C2.9 2.1 5.3 1 8 1s5.1 1.1 7 3l1.1-1.1C14.1.7 11.2-.4 8-.4S1.9.7 0 2.9L1 4z" opacity=".4"/>
              </svg>
              {/* Battery */}
              <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
                <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="rgba(255,255,255,0.35)" strokeWidth="1"/>
                <rect x="2" y="2" width="16" height="8" rx="2" fill="rgba(255,255,255,0.9)" />
                <path d="M23 4v4a2 2 0 0 0 0-4z" fill="rgba(255,255,255,0.4)"/>
              </svg>
            </div>
          </div>

          {/* ── Chat header ── */}
          <div
            style={{
              background: '#0a0e1a',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              padding: '10px 20px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              flexShrink: 0,
            }}
          >
            <div style={{
              width: '44px', height: '44px', borderRadius: '50%', flexShrink: 0,
              background: `${ac}18`, border: `2px solid ${ac}40`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px',
            }}>
              {companion.emoji}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '15px', fontWeight: 700, color: '#e8eaf0', margin: 0, lineHeight: 1.2 }}>
                {companion.name}
              </p>
              <p style={{ fontSize: '12px', color: ac, margin: 0, marginTop: '2px', lineHeight: 1 }}>
                always here
              </p>
            </div>
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
              background: active ? ac : 'rgba(255,255,255,0.15)',
              boxShadow: active ? `0 0 8px ${ac}` : 'none',
              transition: 'all 0.4s',
            }} />
          </div>

          {/* ── Messages (fills remaining height) ── */}
          <div
            style={{
              flex: 1,
              background: '#070a0f',
              padding: '16px 16px 8px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              gap: '8px',
              overflowY: 'hidden',
            }}
          >
            {companion.messages.map((msg) => {
              const visible = visibleMessages.has(msg.id)
              const typing = typingIds.has(msg.id)
              return (
                <div key={msg.id}>
                  {typing && !msg.isUser && (
                    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                      <div style={{
                        padding: '10px 14px', borderRadius: '18px', borderBottomLeftRadius: '4px',
                        background: '#1a2030', border: '1px solid rgba(255,255,255,0.06)',
                      }}>
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', height: '12px' }}>
                          {[0, 150, 300].map((d) => (
                            <div key={d} className="animate-bounce" style={{
                              width: '6px', height: '6px', borderRadius: '50%',
                              background: 'rgba(255,255,255,0.3)', animationDelay: `${d}ms`,
                            }} />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {visible && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: msg.isUser ? 'flex-end' : 'flex-start',
                        animation: 'chatFadeUp 0.28s ease-out forwards',
                      }}
                    >
                      <div style={{
                        padding: '10px 14px',
                        borderRadius: '18px',
                        maxWidth: '80%',
                        fontSize: '13px',
                        lineHeight: '1.5',
                        fontWeight: 500,
                        ...(msg.isUser
                          ? {
                              background: `${ac}20`,
                              border: `1px solid ${ac}38`,
                              color: '#e8eaf0',
                              borderBottomRightRadius: '4px',
                            }
                          : {
                              background: '#1a2030',
                              border: '1px solid rgba(255,255,255,0.06)',
                              color: '#b0b3c0',
                              borderBottomLeftRadius: '4px',
                            }),
                      }}>
                        {msg.text}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Input bar ── */}
          <div style={{
            background: '#0d1117',
            borderTop: '1px solid rgba(255,255,255,0.05)',
            padding: '12px 16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexShrink: 0,
          }}>
            <div style={{
              flex: 1, padding: '10px 16px', borderRadius: '22px', fontSize: '13px',
              color: 'rgba(255,255,255,0.2)', background: '#151c28',
              border: '1px solid rgba(255,255,255,0.05)',
            }}>
              Message
            </div>
            <button style={{
              width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
              background: active ? ac : 'rgba(255,255,255,0.08)',
              border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.4s',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill={active ? '#000' : 'rgba(255,255,255,0.3)'}>
                <path d="M3 12l18-9-9 18V13L3 12z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function DualCompanionChat() {
  const sectionRef = useRef<HTMLElement>(null)
  const [inView, setInView] = useState(false)
  const [rexActive, setRexActive] = useState(false)
  const [novaActive, setNovaActive] = useState(false)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          setTimeout(() => setRexActive(true), 400)
          setTimeout(() => setNovaActive(true), 700)
          observer.disconnect()
        }
      },
      // Trigger only when 40% of the section is visible AND the top of
      // the section has scrolled at least 80px above the bottom of the viewport,
      // so the animation never fires until the user has genuinely scrolled to it.
      { threshold: 0.4, rootMargin: '0px 0px -80px 0px' }
    )
    if (sectionRef.current) observer.observe(sectionRef.current)
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <style>{`
        @keyframes chatFadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <section
        ref={sectionRef}
        style={{
          background: '#060810',
          padding: '48px 16px 96px',
        }}
      >
        {/* Inner wrapper carries the scroll-triggered animation — section stays opaque so its background never bleeds */}
        <div
          style={{
            opacity: inView ? 1 : 0,
            transform: inView ? 'translateY(0) scale(1)' : 'translateY(48px) scale(0.98)',
            transition: 'opacity 0.75s cubic-bezier(0.22,1,0.36,1), transform 0.75s cubic-bezier(0.22,1,0.36,1)',
          }}
        >

        {/* Heading */}
        <div
          style={{
            textAlign: 'center',
            marginBottom: '56px',
          }}
        >
          <p style={{
            fontSize: '11px', fontWeight: 700, letterSpacing: '3px',
            textTransform: 'uppercase', color: '#00E5A0', marginBottom: '12px',
          }}>
            Your Companions
          </p>
          <h2 style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 900, color: '#e8eaf0', margin: 0, lineHeight: 1.1 }}>
            Meet Rex &amp; Nova
          </h2>
          <p style={{ marginTop: '12px', fontSize: '16px', color: 'rgba(255,255,255,0.38)', maxWidth: '440px', margin: '12px auto 0' }}>
            Real conversations. Real accountability.
          </p>
        </div>

        {/* Phones */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '40px',
          justifyContent: 'center',
          alignItems: 'flex-start',
        }}>
          {/* Rex */}
          <div style={{
            opacity: inView ? 1 : 0,
            transform: inView ? 'translateY(0) scale(1)' : 'translateY(56px) scale(0.96)',
            transition: 'opacity 0.7s cubic-bezier(0.22,1,0.36,1) 0.2s, transform 0.7s cubic-bezier(0.22,1,0.36,1) 0.2s',
          }}>
            <p style={{
              textAlign: 'center', marginBottom: '20px',
              fontSize: '11px', fontWeight: 700, letterSpacing: '2.5px',
              textTransform: 'uppercase', color: '#f97316',
            }}>
              Rex — Gym Coach
            </p>
            <ChatPhone companion={companions.rex} active={rexActive} />
          </div>

          {/* Nova */}
          <div style={{
            opacity: inView ? 1 : 0,
            transform: inView ? 'translateY(0) scale(1)' : 'translateY(56px) scale(0.96)',
            transition: 'opacity 0.7s cubic-bezier(0.22,1,0.36,1) 0.4s, transform 0.7s cubic-bezier(0.22,1,0.36,1) 0.4s',
          }}>
            <p style={{
              textAlign: 'center', marginBottom: '20px',
              fontSize: '11px', fontWeight: 700, letterSpacing: '2.5px',
              textTransform: 'uppercase', color: '#00E5A0',
            }}>
              Nova — Study Companion
            </p>
            <ChatPhone companion={companions.nova} active={novaActive} />
          </div>
        </div>

        </div>{/* end scroll-animation wrapper */}
      </section>
    </>
  )
}
