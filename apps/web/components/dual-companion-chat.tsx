'use client'

import { useState, useEffect } from 'react'

interface MessageItem {
  id: string
  text: string
  isUser: boolean
  delayMs: number
}

interface Companion {
  name: string
  emoji: string
  messages: MessageItem[]
}

const TYPING_DURATION = 600

const companions: Record<string, Companion> = {
  rex: {
    name: 'Rex',
    emoji: '💪',
    messages: [
      { id: 'rex-1', text: 'Yo. 6:47am. Leg day doesn\'t cancel itself 🔥', isUser: false, delayMs: 0 },
      { id: 'rex-2', text: 'Last Tuesday you hit 80kg squats. Today we go 82.5kg 💪', isUser: false, delayMs: 1200 },
      { id: 'user-1', text: 'I\'m actually feeling it today', isUser: true, delayMs: 2400 },
      { id: 'rex-3', text: 'That\'s the CNS adapting. That feeling IS the progress.', isUser: false, delayMs: 3400 },
      { id: 'user-2', text: 'Hit 82.5 for 3 sets 🔥', isUser: true, delayMs: 5000 },
      { id: 'rex-4', text: 'LETSSS GO. Streak: 12 days 🐉 Zephyr grew new wings.', isUser: false, delayMs: 6200 },
    ]
  },
  nova: {
    name: 'Nova',
    emoji: '🌿',
    messages: [
      { id: 'nova-1', text: 'Hey 🌿 You\'ve got a 2pm deadline today.', isUser: false, delayMs: 0 },
      { id: 'nova-2', text: 'Want to start a 25-min focus session? Your tree is waiting 🌱', isUser: false, delayMs: 1400 },
      { id: 'user-3', text: 'Start focus', isUser: true, delayMs: 2600 },
      { id: 'nova-3', text: 'Forest session started 🌲 Phone down, world out.', isUser: false, delayMs: 3500 },
      { id: 'user-4', text: 'Done! That felt really good', isUser: true, delayMs: 5200 },
      { id: 'nova-4', text: 'Your pine grew 3cm ✨ That\'s 4 sessions today. You\'re in the zone.', isUser: false, delayMs: 6400 },
    ]
  }
}

function ChatPhone({ companion, isRex = true }: { companion: Companion, isRex?: boolean }) {
  const [visibleMessages, setVisibleMessages] = useState<Set<string>>(new Set())
  const [typingIds, setTypingIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setVisibleMessages(new Set())
    setTypingIds(new Set())

    let maxDelay = 0
    companion.messages.forEach(msg => {
      if (msg.delayMs > maxDelay) maxDelay = msg.delayMs
    })

    const lastMessageDuration = 1000 // Estimated duration for last message to appear
    const totalDuration = maxDelay + lastMessageDuration + 3000 // 3 second hold

    companion.messages.forEach(msg => {
      // Show typing indicator first
      const typingTimer = setTimeout(() => {
        setTypingIds(prev => new Set(prev).add(msg.id))
      }, msg.delayMs)

      // Replace typing with actual message
      const messageTimer = setTimeout(() => {
        setTypingIds(prev => {
          const newSet = new Set(prev)
          newSet.delete(msg.id)
          return newSet
        })
        setVisibleMessages(prev => new Set(prev).add(msg.id))
      }, msg.delayMs + TYPING_DURATION)

      return () => {
        clearTimeout(typingTimer)
        clearTimeout(messageTimer)
      }
    })

    // Fade out all messages
    const fadeOutTimer = setTimeout(() => {
      setVisibleMessages(new Set())
    }, totalDuration)

    // Restart animation
    const restartTimer = setTimeout(() => {
      setVisibleMessages(new Set())
      setTypingIds(new Set())
    }, totalDuration + 500)

    return () => {
      clearTimeout(fadeOutTimer)
      clearTimeout(restartTimer)
    }
  }, [companion])

  return (
    <div className="relative w-full max-w-sm mx-auto">
      {/* Glow effects */}
      <div className="absolute -inset-8 bg-gradient-to-b from-[rgba(255,107,53,0.15)] via-[rgba(255,107,53,0.05)] to-transparent blur-3xl rounded-4xl -z-10 animate-pulse" />
      <div className="absolute top-1/4 -right-20 w-72 h-72 rounded-full blur-3xl bg-[rgba(0,229,160,0.06)] -z-10" />

      {/* Phone Frame */}
      <div className="relative bg-gradient-to-br from-slate-900 to-slate-950 border-8 border-slate-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-sm" style={{
        boxShadow: '0 25px 60px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.05)'
      }}>
        {/* Status Bar */}
        <div className="bg-gradient-to-b from-slate-900 to-slate-950 px-4 py-2 flex justify-between items-center text-xs text-slate-400">
          <span className="font-semibold">9:41</span>
          <div className="flex gap-1">
            <div className="w-1.5 h-1.5 bg-slate-400 rounded-full" />
            <div className="w-1.5 h-1.5 bg-slate-400 rounded-full" />
            <div className="w-1.5 h-1.5 bg-slate-400 rounded-full" />
          </div>
        </div>

        {/* Chat Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 border-b border-slate-700/50 px-4 py-3 flex items-center gap-3">
          <div className="relative w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <span className="text-lg">{companion.emoji}</span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-100">{companion.name}</p>
            <p className="text-xs text-emerald-400/80">always here</p>
          </div>
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-lg shadow-emerald-400/50" />
        </div>

        {/* Chat Area */}
        <div className="bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 h-96 overflow-y-auto flex flex-col justify-end p-4 space-y-3">
          {companion.messages.map((message) => {
            const isVisible = visibleMessages.has(message.id)
            const isTyping = typingIds.has(message.id)

            return (
              <div key={message.id}>
                {/* Typing Indicator */}
                {isTyping && !message.isUser && (
                  <div className={`flex justify-start transition-all duration-300 ${isTyping ? 'opacity-100' : 'opacity-0'}`}>
                    <div className="bg-slate-800/80 border border-slate-700/50 rounded-lg rounded-tl-none px-4 py-2.5">
                      <div className="flex gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Actual Message */}
                {isVisible && (
                  <div
                    className={`flex ${message.isUser ? 'justify-end' : 'justify-start'} transition-all duration-300`}
                    style={{
                      opacity: isVisible ? 1 : 0,
                      transform: isVisible ? 'translateY(0)' : 'translateY(8px)',
                      animation: isVisible ? 'message-appear 0.3s ease-out forwards' : 'none'
                    }}
                  >
                    <div
                      className={`rounded-lg px-4 py-2.5 max-w-xs text-sm font-medium ${
                        message.isUser
                          ? 'bg-[rgba(0,229,160,0.15)] border border-[rgba(0,229,160,0.3)] text-slate-100 rounded-tr-none'
                          : 'bg-slate-800/80 border border-slate-700/50 text-slate-100 rounded-tl-none'
                      }`}
                    >
                      <p>{message.text}</p>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Input Bar */}
        <div className="bg-gradient-to-t from-slate-950 to-slate-900 border-t border-slate-700/50 px-4 py-3 flex items-center gap-2">
          <div className="flex-1 bg-slate-800/50 border border-slate-700/30 rounded-full px-4 py-2.5 backdrop-blur-sm">
            <p className="text-xs text-slate-400">Message</p>
          </div>
          <button className="text-emerald-400 hover:text-emerald-300 transition-colors duration-200 p-2 hover:bg-slate-800/50 rounded-full">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M16.6915026,12.4744748 L3.50612381,13.2599618 C3.19218622,13.2599618 3.03521743,13.4170592 3.03521743,13.5741566 L1.15159189,20.0151496 C0.8376543,20.8006365 0.99,21.89 1.77946707,22.52 C2.41,22.99 3.50612381,23.1 4.13399899,22.8429026 L21.714504,14.0454487 C22.6563168,13.5741566 23.1272231,12.6315722 22.9702544,11.6889879 L4.13399899,1.16151496 C3.34915502,0.9 2.40734225,0.9 1.77946707,1.4429026 C0.994623095,2.06451969 0.837654308,3.0131041 1.15159189,3.98466271 L3.03521743,10.4256557 C3.03521743,10.5827531 3.03521743,10.7398505 3.50612381,10.7398505 L16.6915026,11.5253375 C16.6915026,11.5253375 17.1624089,11.5253375 17.1624089,12.0000151 C17.1624089,12.4744748 16.6915026,12.4744748 16.6915026,12.4744748 Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

export function DualCompanionChat() {
  return (
    <section className="relative overflow-hidden px-4 py-20 md:py-32">
      {/* Background elements */}
      <div className="absolute inset-0 -z-50">
        <div className="absolute top-32 left-10 w-96 h-96 rounded-full blur-3xl bg-gradient-to-r from-[rgba(255,107,53,0.08)] to-transparent" />
        <div className="absolute bottom-20 right-10 w-96 h-96 rounded-full blur-3xl bg-gradient-to-b from-[rgba(0,229,160,0.06)] to-transparent" />
      </div>

      <div className="mx-auto max-w-7xl relative z-10">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-5xl md:text-6xl font-black tracking-tight text-balance">
            <span className="text-slate-100">Meet your companions</span>
            <br />
            <span className="bg-gradient-to-r from-emerald-400 to-emerald-300 bg-clip-text text-transparent">in real-time</span>
          </h2>
          <p className="text-lg text-slate-400 text-balance max-w-2xl mx-auto">
            Watch how Rex pushes your limits and Nova keeps you focused. Real conversations, real accountability.
          </p>
        </div>

        {/* Mobile: Stack vertically (Rex first, then Nova) */}
        {/* Desktop: Side by side */}
        <div className="grid md:grid-cols-2 gap-8 lg:gap-12">
          <div>
            <h3 className="text-center mb-6 text-xl font-bold text-slate-100">Rex — Gym Coach</h3>
            <ChatPhone companion={companions.rex} isRex={true} />
          </div>
          <div>
            <h3 className="text-center mb-6 text-xl font-bold text-slate-100">Nova — Study Companion</h3>
            <ChatPhone companion={companions.nova} isRex={false} />
          </div>
        </div>
      </div>
    </section>
  )
}
