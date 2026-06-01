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

const TYPING_DURATION = 900

const companions: Record<string, Companion> = {
  rex: {
    name: 'Rex',
    emoji: '💪',
    color: '#f97316',
    messages: [
      { id: 'rex-1', text: "Yo. 6:47am. Leg day doesn't cancel itself 🔥", isUser: false, delayMs: 0 },
      { id: 'rex-2', text: 'Last Tuesday 80kg squats. Today we go 82.5kg 💪', isUser: false, delayMs: 2000 },
      { id: 'user-1', text: "I'm actually feeling it today", isUser: true, delayMs: 3800 },
      { id: 'rex-3', text: "That's the CNS adapting. That feeling IS the progress.", isUser: false, delayMs: 5400 },
      { id: 'user-2', text: 'Hit 82.5 for 3 sets 🔥', isUser: true, delayMs: 7800 },
      { id: 'rex-4', text: 'LETSSS GO. Streak: 12 days 🐉', isUser: false, delayMs: 9600 },
    ],
  },
  nova: {
    name: 'Nova',
    emoji: '🌿',
    color: '#00E5A0',
    messages: [
      { id: 'nova-1', text: "Hey 🌿 You've got a 2pm deadline today.", isUser: false, delayMs: 0 },
      { id: 'nova-2', text: 'Want to start a 25-min focus session? 🌱', isUser: false, delayMs: 2200 },
      { id: 'user-3', text: 'Start focus', isUser: true, delayMs: 4000 },
      { id: 'nova-3', text: 'Forest session started 🌲 Phone down, world out.', isUser: false, delayMs: 5600 },
      { id: 'user-4', text: 'Done! That felt really good', isUser: true, delayMs: 8200 },
      { id: 'nova-4', text: "Your pine grew 3cm ✨ 4 sessions today. Zone unlocked.", isUser: false, delayMs: 10000 },
    ],
  },
}

const PHONE_W = 268
const PHONE_H = 530

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
    <div
      style={{
        width: `${PHONE_W}px`,
        height: `${PHONE_H}px`,
        borderRadius: '36px',
        background: 'linear-gradient(160deg, #12161f 0%, #0a0d14 100%)',
        border: `1.5px solid ${active ? `${ac}40` : 'rgba(255,255,255,0.08)'}`,
        boxShadow: active
          ? `0 24px 64px rgba(0,0,0,0.65), 0 0 0 1px ${ac}15, inset 0 1px 0 rgba(255,255,255,0.05)`
          : '0 16px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)',
        transition: 'border-color 0.5s ease, box-shadow 0.5s ease',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        filter: active ? `drop-shadow(0 0 24px ${ac}18)` : 'none',
      }}
    >
      {/* Status bar */}
      <div style={{
        height: '42px', background: 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', flexShrink: 0, position: 'relative',
      }}>
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#e8eaf0', letterSpacing: '-0.3px' }}>9:41</span>
        <div style={{
          width: '96px', height: '26px', borderRadius: '16px',
          background: '#000', position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '6px',
        }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <svg width="14" height="10" viewBox="0 0 17 12" fill="none">
            <rect x="0" y="7" width="3" height="5" rx="1" fill="rgba(255,255,255,0.85)" />
            <rect x="4.5" y="4.5" width="3" height="7.5" rx="1" fill="rgba(255,255,255,0.85)" />
            <rect x="9" y="2" width="3" height="10" rx="1" fill="rgba(255,255,255,0.85)" />
            <rect x="13.5" y="0" width="3" height="12" rx="1" fill="rgba(255,255,255,0.85)" />
          </svg>
          <svg width="14" height="10" viewBox="0 0 16 12" fill="rgba(255,255,255,0.85)">
            <path d="M8 9.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/>
            <path d="M3.5 6.5C4.9 5.1 6.35 4.4 8 4.4s3.1.7 4.5 2.1l1.2-1.2C12.1 3.7 10.15 2.9 8 2.9S3.9 3.7 2.3 5.3l1.2 1.2z"/>
          </svg>
          <svg width="20" height="10" viewBox="0 0 25 12" fill="none">
            <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="rgba(255,255,255,0.3)" strokeWidth="1"/>
            <rect x="2" y="2" width="15" height="8" rx="2" fill="rgba(255,255,255,0.85)" />
            <path d="M23 4v4a2 2 0 0 0 0-4z" fill="rgba(255,255,255,0.35)"/>
          </svg>
        </div>
      </div>

      {/* Chat header */}
      <div style={{
        background: 'rgba(255,255,255,0.02)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        padding: '8px 16px 12px',
        display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0,
      }}>
        <div style={{
          width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
          background: `${ac}15`, border: `1.5px solid ${ac}35`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px',
        }}>
          {companion.emoji}
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#e8eaf0', margin: 0, lineHeight: 1.2 }}>
            {companion.name}
          </p>
          <p style={{ fontSize: '10px', color: ac, margin: 0, marginTop: '2px' }}>always here</p>
        </div>
        <div style={{
          width: '7px', height: '7px', borderRadius: '50%',
          background: active ? ac : 'rgba(255,255,255,0.12)',
          boxShadow: active ? `0 0 6px ${ac}` : 'none',
          transition: 'all 0.4s',
        }} />
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, background: '#070a0f',
        padding: '12px 12px 6px',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        gap: '6px', overflowY: 'hidden',
      }}>
        {companion.messages.map((msg) => {
          const visible = visibleMessages.has(msg.id)
          const typing = typingIds.has(msg.id)
          return (
            <div key={msg.id}>
              {typing && !msg.isUser && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{
                    padding: '8px 12px', borderRadius: '14px', borderBottomLeftRadius: '3px',
                    background: '#1a2030', border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div style={{ display: 'flex', gap: '3px', alignItems: 'center', height: '10px' }}>
                      {[0, 150, 300].map((d) => (
                        <div key={d} className="animate-bounce" style={{
                          width: '5px', height: '5px', borderRadius: '50%',
                          background: 'rgba(255,255,255,0.3)', animationDelay: `${d}ms`,
                        }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {visible && (
                <div style={{
                  display: 'flex',
                  justifyContent: msg.isUser ? 'flex-end' : 'flex-start',
                  animation: 'chatFadeUp 0.25s ease-out forwards',
                }}>
                  <div style={{
                    padding: '8px 11px', borderRadius: '14px', maxWidth: '82%',
                    fontSize: '11.5px', lineHeight: '1.45', fontWeight: 500,
                    ...(msg.isUser
                      ? { background: `${ac}1e`, border: `1px solid ${ac}32`, color: '#e0e2ec', borderBottomRightRadius: '3px' }
                      : { background: '#1a2030', border: '1px solid rgba(255,255,255,0.06)', color: '#9da0b0', borderBottomLeftRadius: '3px' }),
                  }}>
                    {msg.text}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Input bar */}
      <div style={{
        background: '#0d1117', borderTop: '1px solid rgba(255,255,255,0.05)',
        padding: '10px 12px 16px',
        display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
      }}>
        <div style={{
          flex: 1, padding: '8px 13px', borderRadius: '18px', fontSize: '11px',
          color: 'rgba(255,255,255,0.18)', background: '#131923',
          border: '1px solid rgba(255,255,255,0.05)',
        }}>
          Message
        </div>
        <button style={{
          width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
          background: active ? ac : 'rgba(255,255,255,0.07)',
          border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.4s',
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill={active ? '#000' : 'rgba(255,255,255,0.3)'}>
            <path d="M3 12l18-9-9 18V13L3 12z" />
          </svg>
        </button>
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
        if (entry && entry.isIntersecting) {
          setInView(true)
          setTimeout(() => setRexActive(true), 300)
          setTimeout(() => setNovaActive(true), 600)
          observer.disconnect()
        }
      },
      { threshold: 0.3, rootMargin: '0px 0px -60px 0px' }
    )
    if (sectionRef.current) observer.observe(sectionRef.current)
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <style>{`
        @keyframes chatFadeUp {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes phoneFloat {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-8px); }
        }
        @keyframes phoneFloatAlt {
          0%, 100% { transform: translateY(-5px); }
          50%       { transform: translateY(5px); }
        }
      `}</style>

      <section
        ref={sectionRef}
        style={{ background: '#060810', padding: '72px 24px 96px' }}
      >
        <div style={{
          opacity: inView ? 1 : 0,
          transform: inView ? 'translateY(0)' : 'translateY(40px)',
          transition: 'opacity 0.7s ease, transform 0.7s ease',
        }}>
          {/* Heading */}
          <div style={{ textAlign: 'center', marginBottom: '52px' }}>
            <p style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '3px',
              textTransform: 'uppercase', color: '#00E5A0', marginBottom: '10px',
            }}>
              Your Companions
            </p>
            <h2 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.6rem)', fontWeight: 900, color: '#e8eaf0', margin: 0, lineHeight: 1.1 }}>
              Meet Rex &amp; Nova
            </h2>
            <p style={{ marginTop: '10px', fontSize: '15px', color: 'rgba(255,255,255,0.35)', maxWidth: '380px', margin: '10px auto 0' }}>
              Real conversations. Real accountability.
            </p>
          </div>

          {/* Phones */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '88px',
            justifyContent: 'center', alignItems: 'center',
          }}>
            {/* Rex */}
            <div style={{
              opacity: inView ? 1 : 0,
              transform: inView ? 'translateY(0)' : 'translateY(40px)',
              transition: 'opacity 0.65s ease 0.15s, transform 0.65s ease 0.15s',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px',
            }}>
              <p style={{
                fontSize: '10px', fontWeight: 700, letterSpacing: '2.5px',
                textTransform: 'uppercase', color: '#f97316', margin: 0,
              }}>
                Rex — Gym Coach
              </p>
              <div style={{
                animation: inView ? 'phoneFloat 5s ease-in-out infinite' : 'none',
                rotate: '-2deg',
              }}>
                <ChatPhone companion={companions.rex} active={rexActive} />
              </div>
            </div>

            {/* Nova */}
            <div style={{
              opacity: inView ? 1 : 0,
              transform: inView ? 'translateY(0)' : 'translateY(40px)',
              transition: 'opacity 0.65s ease 0.3s, transform 0.65s ease 0.3s',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px',
            }}>
              <p style={{
                fontSize: '10px', fontWeight: 700, letterSpacing: '2.5px',
                textTransform: 'uppercase', color: '#00E5A0', margin: 0,
              }}>
                Nova — Study Companion
              </p>
              <div style={{
                animation: inView ? 'phoneFloatAlt 5.5s ease-in-out infinite' : 'none',
                rotate: '2deg',
              }}>
                <ChatPhone companion={companions.nova} active={novaActive} />
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
