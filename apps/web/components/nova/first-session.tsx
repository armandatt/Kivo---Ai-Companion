'use client'

import { useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'

type Props = {
  subjects: string[]
  onStart:  (topicName: string, subjectName: string) => void
  starting: boolean
  error:    string | null
}

// Before Nova has any topic on record there is nothing for it to recommend.
// This is how the first one gets there: the learner names what they are about
// to study and which of their subjects it belongs to, and starts the ordinary
// session. The session, and how they say it went, is the evidence. Nothing is
// chosen or stored here.
export function FirstSession({ subjects, onStart, starting, error }: Props) {
  const [topic, setTopic]     = useState('')
  const [subject, setSubject] = useState(subjects[0] ?? '')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const name = topic.trim()
    if (!name || !subject || starting) return
    onStart(name, subject)
  }

  if (subjects.length === 0) return null

  return (
    <form onSubmit={submit} className="mt-6 rounded-2xl border border-white/8 bg-white/3 p-4 sm:p-5">
      <p className="text-sm font-medium text-foreground">Start with what you are studying now</p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="first-topic">Topic</label>
        <input
          id="first-topic"
          value={topic}
          onChange={e => setTopic(e.target.value)}
          maxLength={120}
          placeholder="Topic, e.g. Deadlocks"
          className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-transparent px-3.5 text-sm text-foreground placeholder:text-foreground/35 focus:border-keppel-400/60 focus:outline-none"
        />
        <label className="sr-only" htmlFor="first-subject">Subject</label>
        <select
          id="first-subject"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          className="h-11 rounded-xl border border-white/10 bg-transparent px-3 text-sm text-foreground focus:border-keppel-400/60 focus:outline-none"
        >
          {subjects.map(s => <option key={s} value={s} className="bg-card text-foreground">{s}</option>)}
        </select>
        <button
          type="submit"
          disabled={starting || !topic.trim()}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-keppel-400 px-5 text-sm font-semibold text-keppel-950 transition-colors hover:bg-keppel-300 disabled:opacity-60"
        >
          {starting ? <><Loader2 className="size-4 animate-spin" /> Starting…</> : <>Start 25 min <ArrowRight className="size-4" /></>}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    </form>
  )
}
