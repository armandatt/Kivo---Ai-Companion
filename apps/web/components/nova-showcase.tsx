'use client'

import { useState, useEffect, useRef } from 'react'

interface MessageItem {
  id: string
  text: string
  isUser: boolean
  delayMs: number
}

const TYPING_DURATION = 900
const ACCENT = '#00E5A0'

const MESSAGES: MessageItem[] = [
  { id: 'nova-1', text: "Operating Systems exam is in 12 days. Deadlocks is the topic you've touched least.", isUser: false, delayMs: 0 },
  { id: 'nova-2', text: '25 minutes on it now?', isUser: false, delayMs: 2200 },
  { id: 'user-1', text: 'Start', isUser: true, delayMs: 4000 },
  { id: 'nova-3', text: "Started. Deadlocks, 25 minutes. I'll stay quiet until you're done.", isUser: false, delayMs: 5600 },
  { id: 'user-2', text: 'Done, that went well', isUser: true, delayMs: 9200 },
  { id: 'nova-4', text: "Logged: 25 minutes on Deadlocks. That's 4 days in a row.", isUser: false, delayMs: 10800 },
]

// The side panel follows the conversation: these two messages move it on.
const STARTED_AT = 'nova-3'
const LOGGED_AT = 'nova-4'

type Phase = 'next' | 'focus' | 'done'

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const TODAY_INDEX = 3
const RING = 2 * Math.PI * 34

function TodayPanel({ phase }: { phase: Phase }) {
  const label = phase === 'next' ? 'Up next' : phase === 'focus' ? 'In focus' : 'Done today'
  return (
    <div className="nova-show-side">
      <p className="nova-show-eyebrow">Today</p>

      <div className="nova-show-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <svg width="80" height="80" viewBox="0 0 80 80" style={{ flexShrink: 0 }} aria-hidden="true">
            <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" />
            <circle
              cx="40" cy="40" r="34" fill="none" stroke={ACCENT} strokeWidth="5" strokeLinecap="round"
              strokeDasharray={RING}
              strokeDashoffset={phase === 'next' ? RING : 0}
              transform="rotate(-90 40 40)"
              style={{ transition: phase === 'focus' ? 'stroke-dashoffset 3.4s linear' : 'none' }}
            />
            <text x="40" y="45" textAnchor="middle" fontSize="15" fontWeight="700" fill="#e8eaf0">
              {phase === 'done' ? '✓' : '25m'}
            </text>
          </svg>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: ACCENT, margin: 0 }}>
              {label}
            </p>
            <p style={{ fontSize: '17px', fontWeight: 700, color: '#e8eaf0', margin: '4px 0 0', lineHeight: 1.2 }}>Deadlocks</p>
            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.45)', margin: '3px 0 0' }}>Operating Systems</p>
          </div>
        </div>
      </div>

      <div className="nova-show-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.45)', margin: 0 }}>This week</p>
          <p style={{ fontSize: '12px', fontWeight: 700, color: '#e8eaf0', margin: 0 }}>
            {phase === 'done' ? '4' : '3'} days in a row
          </p>
        </div>
        <div style={{ display: 'flex', gap: '6px', marginTop: '12px' }}>
          {WEEK.map((day, i) => {
            const studied = i < TODAY_INDEX || (i === TODAY_INDEX && phase === 'done')
            return (
              <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{
                  height: '26px', borderRadius: '8px',
                  background: studied ? `${ACCENT}cc` : 'rgba(255,255,255,0.05)',
                  border: i === TODAY_INDEX && !studied ? `1px dashed ${ACCENT}70` : '1px solid transparent',
                  transition: 'background 0.5s ease',
                }} />
                <p style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', margin: '5px 0 0' }}>{day}</p>
              </div>
            )
          })}
        </div>
      </div>

      <div className="nova-show-card nova-show-exam">
        <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.45)', margin: 0 }}>Operating Systems exam</p>
        <p style={{ fontSize: '12px', fontWeight: 700, color: '#e8eaf0', margin: 0 }}>12 days</p>
      </div>
    </div>
  )
}

export function NovaShowcase() {
  const sectionRef = useRef<HTMLElement>(null)
  const [inView, setInView] = useState(false)
  const [visible, setVisible] = useState<Set<string>>(new Set())
  const [typing, setTyping] = useState<Set<string>>(new Set())

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry && entry.isIntersecting) {
          setInView(true)
          observer.disconnect()
        }
      },
      { threshold: 0.25, rootMargin: '0px 0px -60px 0px' }
    )
    if (sectionRef.current) observer.observe(sectionRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!inView) return
    // With reduced motion the finished conversation is simply there.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(new Set(MESSAGES.map((m) => m.id)))
      return
    }
    const timers: ReturnType<typeof setTimeout>[] = []
    MESSAGES.forEach((msg) => {
      const at = msg.delayMs + 400
      if (!msg.isUser) {
        timers.push(setTimeout(() => setTyping((prev) => new Set(prev).add(msg.id)), at))
      }
      timers.push(setTimeout(() => {
        setTyping((prev) => { const s = new Set(prev); s.delete(msg.id); return s })
        setVisible((prev) => new Set(prev).add(msg.id))
      }, at + (msg.isUser ? 0 : TYPING_DURATION)))
    })
    return () => timers.forEach(clearTimeout)
  }, [inView])

  const phase: Phase = visible.has(LOGGED_AT) ? 'done' : visible.has(STARTED_AT) ? 'focus' : 'next'

  return (
    <>
      <style>{`
        @keyframes chatFadeUp {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .nova-show-frame {
          max-width: 920px; margin: 0 auto; padding: 10px; border-radius: 30px;
          background: linear-gradient(160deg, #161b26 0%, #0b0e15 100%);
          border: 1.5px solid ${ACCENT}38;
          box-shadow: 0 32px 80px rgba(0,0,0,0.65), 0 0 60px ${ACCENT}12, inset 0 1px 0 rgba(255,255,255,0.06);
        }
        .nova-show-screen {
          display: grid; grid-template-columns: minmax(0, 1fr) 300px;
          height: 500px; border-radius: 21px; overflow: hidden; background: #070a0f;
        }
        .nova-show-chat { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
        .nova-show-side {
          display: flex; flex-direction: column; gap: 12px; padding: 20px 18px;
          background: #0b0f17; border-left: 1px solid rgba(255,255,255,0.05);
        }
        .nova-show-eyebrow {
          font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;
          color: rgba(255,255,255,0.35); margin: 0 0 2px;
        }
        .nova-show-card {
          padding: 14px; border-radius: 16px; background: #121722;
          border: 1px solid rgba(255,255,255,0.06);
        }
        .nova-show-exam { display: flex; justify-content: space-between; align-items: center; }
        @media (max-width: 760px) {
          .nova-show-frame { padding: 7px; border-radius: 24px; }
          .nova-show-screen { grid-template-columns: minmax(0, 1fr); height: auto; border-radius: 18px; }
          .nova-show-chat { height: 520px; }
          .nova-show-side { border-left: none; border-top: 1px solid rgba(255,255,255,0.05); padding: 16px 14px; }
          .nova-show-exam { display: none; }
        }
      `}</style>

      <section ref={sectionRef} style={{ background: '#060810', padding: '72px 16px 96px' }}>
        <div style={{
          opacity: inView ? 1 : 0,
          transform: inView ? 'translateY(0)' : 'translateY(40px)',
          transition: 'opacity 0.7s ease, transform 0.7s ease',
        }}>
          {/* Heading */}
          <div style={{ textAlign: 'center', marginBottom: '44px' }}>
            <p style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '3px',
              textTransform: 'uppercase', color: ACCENT, marginBottom: '10px',
            }}>
              Your Study Companion
            </p>
            <h2 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.6rem)', fontWeight: 900, color: '#e8eaf0', margin: 0, lineHeight: 1.1 }}>
              Meet Nova
            </h2>
            <p style={{ fontSize: '15px', color: 'rgba(255,255,255,0.35)', maxWidth: '420px', margin: '10px auto 0' }}>
              It knows what to study next, and keeps the record while you do it.
            </p>
          </div>

          <div className="nova-show-frame">
            <div className="nova-show-screen">
              {/* Chat */}
              <div className="nova-show-chat">
                <div style={{
                  background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.05)',
                  padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0,
                }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
                    background: `${ACCENT}15`, border: `1.5px solid ${ACCENT}35`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px',
                  }}>
                    🌿
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '15px', fontWeight: 700, color: '#e8eaf0', margin: 0, lineHeight: 1.2 }}>Nova</p>
                    <p style={{ fontSize: '11px', color: ACCENT, margin: '2px 0 0' }}>always here</p>
                  </div>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: ACCENT, boxShadow: `0 0 6px ${ACCENT}` }} />
                </div>

                <div style={{
                  flex: 1, minHeight: 0, padding: '16px 20px 10px',
                  display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                  gap: '8px', overflow: 'hidden',
                }}>
                  {MESSAGES.map((msg) => (
                    <div key={msg.id}>
                      {typing.has(msg.id) && (
                        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                          <div style={{
                            padding: '11px 14px', borderRadius: '16px', borderBottomLeftRadius: '4px',
                            background: '#1a2030', border: '1px solid rgba(255,255,255,0.06)',
                          }}>
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', height: '10px' }}>
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
                      {visible.has(msg.id) && (
                        <div style={{
                          display: 'flex',
                          justifyContent: msg.isUser ? 'flex-end' : 'flex-start',
                          animation: 'chatFadeUp 0.25s ease-out forwards',
                        }}>
                          <div style={{
                            padding: '10px 14px', borderRadius: '16px', maxWidth: '80%',
                            fontSize: '14px', lineHeight: '1.45', fontWeight: 500,
                            ...(msg.isUser
                              ? { background: `${ACCENT}1e`, border: `1px solid ${ACCENT}32`, color: '#e0e2ec', borderBottomRightRadius: '4px' }
                              : { background: '#1a2030', border: '1px solid rgba(255,255,255,0.06)', color: '#b3b6c4', borderBottomLeftRadius: '4px' }),
                          }}>
                            {msg.text}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div style={{
                  background: '#0d1117', borderTop: '1px solid rgba(255,255,255,0.05)',
                  padding: '12px 20px 14px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0,
                }} aria-hidden="true">
                  <div style={{
                    flex: 1, padding: '10px 16px', borderRadius: '20px', fontSize: '13px',
                    color: 'rgba(255,255,255,0.22)', background: '#131923',
                    border: '1px solid rgba(255,255,255,0.05)',
                  }}>
                    Message
                  </div>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0, background: ACCENT,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="#000">
                      <path d="M3 12l18-9-9 18V13L3 12z" />
                    </svg>
                  </div>
                </div>
              </div>

              <TodayPanel phase={phase} />
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
