// The tutor conversation beside a note, as the page keeps it: what the
// learner asked, what Nova answered, and the state of each exercise, quiz
// and walk-through. Pure, so it is tested (tutor-session.test.ts). The
// server keeps none of it: the page sends the last turns back with each
// request, and keeps the conversation in this tab's session storage so a
// reload or a visit to another note and back finds it as it was.
//
// What goes into a note from here is built by insertFor: always labelled as
// Nova's (a callout naming what it is), with Nova's own additions marked
// apart from what the note says, and citations turned into links to the
// note they name. The page shows it and asks before adding it.

import type { NoteAssistSource } from '@repo/api/nova/product/note-assist.types'
import type {
  TutorExercise, TutorMode, TutorReply, TutorResult, TutorSection, TutorTurn,
} from '@repo/api/nova/product/note-tutor.types'
import { TUTOR_HISTORY_MAX, TUTOR_TURN_MAX } from '@repo/api/nova/product/note-tutor.types'
import { resolveRef, type AdditionKind, type NoteRef, type PlacementHint } from '@repo/api/nova/product/note-outline'

// What the learner sends. passage: the text chosen in the note.
export interface TutorAsk {
  mode:      TutorMode
  message?:  string
  passage?:  string
  exercise?: TutorExercise
  answer?:   string
}

// The state of what a reply set the learner to do, kept with the reply.
export interface TutorWork {
  stepsShown?: number                       // steps revealed so far
  tries?:      Record<number, string>       // what they typed before a step
  answer?:     string                       // their answer to the exercise
  checked?:    boolean                      // the answer was sent to be checked
  hint?:       boolean
  shown?:      boolean                      // the expected answer is open
  picks?:      Record<number, number>       // quiz: question → choice
  flipped?:    Record<number, boolean>      // flashcards
  chosen?:     Record<number, boolean>      // brainstorm ideas to keep
}

export type TutorEntry =
  | { id: string; role: 'learner'; ask: TutorAsk; at: number }
  | { id: string; role: 'nova'; reply: TutorReply; work: TutorWork; at: number }
  | { id: string; role: 'error'; message: string; ask: TutorAsk; at: number }
  | { id: string; role: 'stopped'; ask: TutorAsk; at: number }

export const MODE_LABEL: Record<TutorMode, string> = {
  explain: 'Explain this', simpler: 'Explain it more simply', example: 'Give me an example', steps: 'Walk me through it',
  check: 'Find gaps in my understanding', practice: 'Give me a practice question', evaluate: 'Check my answer', quiz: 'Quiz me',
  brainstorm: 'Brainstorm ideas', flashcards: 'Make flashcards', summary: 'Summarise', compare: 'Compare two ideas',
  connect: 'Connect this to my other notes', organize: 'Organise this note',
}

// What the waiting line says Nova is doing. One request is in flight: it
// names what was asked, never a stage the page cannot see.
export const MODE_WORK: Record<TutorMode, string> = {
  explain: 'Working out an explanation', simpler: 'Finding a simpler way to say it', example: 'Building an example',
  steps: 'Preparing a walk-through', check: 'Preparing a question', practice: 'Preparing an exercise', evaluate: 'Checking your answer',
  quiz: 'Building a quiz', brainstorm: 'Brainstorming', flashcards: 'Making flashcards', summary: 'Summarising',
  compare: 'Comparing', connect: 'Looking through your notes', organize: 'Organising the note',
}

// What the learner's own bubble says.
export function askLine(ask: TutorAsk): string {
  if (ask.mode === 'evaluate') return ask.answer ?? MODE_LABEL.evaluate
  return ask.message?.trim() || MODE_LABEL[ask.mode]
}

const cut = (s: string) => (s.length > TUTOR_TURN_MAX ? `${s.slice(0, TUTOR_TURN_MAX - 1)}…` : s)

// What Nova said, as one line of text for the next request.
export function replyText(r: TutorReply): string {
  const parts: string[] = []
  for (const s of r.sections) parts.push(s.heading ? `${s.heading}: ${s.text}` : s.text)
  for (const s of r.steps) parts.push(`${s.title}: ${s.text}`)
  if (r.exercise) parts.push(`Exercise: ${r.exercise.question}`)
  if (r.verdict) parts.push(`Your answer was ${r.verdict.result}. ${r.verdict.feedback}`)
  if (r.quiz.length) parts.push(`Quiz: ${r.quiz.map(q => q.question).join(' / ')}`)
  if (r.ideas.length) parts.push(`Ideas: ${r.ideas.map(i => i.title).join(', ')}`)
  if (r.cards.length) parts.push(`${r.cards.length} flashcards`)
  if (r.organize?.title) parts.push(`Suggested title: ${r.organize.title}`)
  return parts.join('\n')
}

// The last turns, oldest first, for the request.
export function historyOf(entries: TutorEntry[]): TutorTurn[] {
  const turns: TutorTurn[] = []
  for (const e of entries) {
    if (e.role === 'learner') turns.push({ role: 'learner', text: cut(e.ask.passage ? `${askLine(e.ask)} (about: "${e.ask.passage.slice(0, 300)}")` : askLine(e.ask)) })
    else if (e.role === 'nova') { const t = replyText(e.reply); if (t) turns.push({ role: 'nova', text: cut(t) }) }
  }
  return turns.slice(-TUTOR_HISTORY_MAX)
}

export function resultsOf(entries: TutorEntry[]): TutorResult[] {
  return entries.flatMap(e => (e.role === 'nova' && e.reply.verdict ? [e.reply.verdict.result] : [])).slice(-5)
}

// The exercise still waiting for an answer, if there is one: the newest
// reply's, while it has not been checked.
export function openExercise(entries: TutorEntry[]): { entry: Extract<TutorEntry, { role: 'nova' }>; exercise: TutorExercise } | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!
    if (e.role !== 'nova') continue
    return e.reply.exercise && !e.work.checked ? { entry: e, exercise: e.reply.exercise } : null
  }
  return null
}

// The few things worth offering next, by what is on screen. Never a wall:
// at most four, and only the ones that follow from where the learner is.
export function nextActions(state: { passage: boolean; last: TutorReply | null; empty: boolean }): TutorMode[] {
  if (state.empty) return ['organize', 'brainstorm']
  const last = state.last
  if (!last) return state.passage ? ['explain', 'example', 'steps', 'check'] : ['explain', 'summary', 'quiz', 'brainstorm']
  switch (last.mode) {
    case 'explain': case 'compare': return ['simpler', 'example', 'check', 'practice']
    case 'simpler': return ['example', 'check', 'steps']
    case 'example': case 'steps': return ['practice', 'check', 'flashcards']
    case 'evaluate': return last.verdict?.result === 'correct' ? ['practice', 'quiz', 'flashcards'] : ['simpler', 'steps', 'practice']
    case 'quiz': return ['practice', 'flashcards', 'explain']
    case 'summary': return ['quiz', 'flashcards', 'explain']
    case 'organize': return ['summary', 'quiz', 'connect']
    case 'brainstorm': return ['organize', 'connect', 'explain']
    default: return state.passage ? ['explain', 'example', 'check'] : ['explain', 'quiz', 'brainstorm']
  }
}

// ── Into the note ─────────────────────────────────────────────────────────────

// [S1] is the note itself: dropped. Another note becomes a [[link]] to it;
// a saved page, its title in brackets.
export function citationsAsLinks(text: string, sources: NoteAssistSource[]): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '[' && text[i + 1] === 'S') {
      const close = text.indexOf(']', i)
      const src = close === -1 ? undefined : sources.find(s => s.id === text.slice(i + 1, close))
      if (src) {
        if (src.id !== 'S1') out += src.kind === 'note' ? `[[${src.title}]]` : `(${src.title})`
        i = close
        continue
      }
    }
    out += text[i]
  }
  return out.split('  ').join(' ').split(' .').join('.').split(' ,').join(',')
}

const quoted = (text: string) => text.split('\n').map(l => (l.trim() ? `> ${l}` : '>')).join('\n')
const callout = (type: string, title: string, body: string, folded = false) => `> [!${type}]${folded ? '-' : ''} ${title}\n${quoted(body)}`

function sectionsText(sections: TutorSection[], sources: NoteAssistSource[]): string {
  return sections.map(s => {
    const text = citationsAsLinks(s.text, sources)
    const head = s.heading ? `**${s.heading}**\n` : ''
    return s.basis === 'nova' ? `${head}*Nova's own explanation, beyond your notes:* ${text}` : `${head}${text}`
  }).join('\n\n')
}

export type InsertPart = 'all' | 'ideas' | 'outline' | 'overview' | 'questions' | 'concepts' | 'tags' | 'section'

// What adding a reply (or one part of it) to the note adds. null: nothing
// of that part to add.
export function insertFor(r: TutorReply, work: TutorWork, part: InsertPart = 'all', index = 0): string | null {
  const src = r.sources
  const about = r.passage?.heading ? ` (${r.passage.heading})` : ''
  if (part === 'section') {
    const s = r.sections[index]
    return s ? callout(r.mode === 'summary' ? 'summary' : 'note', `Nova: ${s.heading ?? MODE_LABEL[r.mode].toLowerCase()}${about}`, sectionsText([s], src)) : null
  }
  if (r.organize && part !== 'all') {
    const o = r.organize
    if (part === 'outline') return o.outline ? callout('note', 'Organised version (Nova, from your text)', o.outline, true) : null
    if (part === 'overview') return o.overview ? callout('summary', 'Overview (Nova)', citationsAsLinks(o.overview, src)) : null
    if (part === 'questions') return o.questions.length ? callout('question', 'Questions to explore (Nova)', o.questions.map(q => `- ${q}`).join('\n')) : null
    if (part === 'concepts') return o.concepts.length ? `**Key concepts:** ${o.concepts.join(' · ')}` : null
    if (part === 'tags') return o.tags.length ? o.tags.map(t => `#${t}`).join(' ') : null
  }
  if (part === 'ideas') {
    const picked = r.ideas.filter((_, i) => work.chosen?.[i])
    const ideas = picked.length ? picked : r.ideas
    return ideas.length ? callout('idea', 'Ideas from brainstorming (Nova)', ideas.map(i => `- **${i.title}**${i.text ? `: ${citationsAsLinks(i.text, src)}` : ''}${i.basis === 'nova' ? ' *(Nova\'s suggestion)*' : ''}`).join('\n')) : null
  }

  const blocks: string[] = []
  if (r.sections.length) blocks.push(callout(r.mode === 'summary' ? 'summary' : r.mode === 'example' ? 'example' : 'note', `Nova: ${MODE_LABEL[r.mode].toLowerCase()}${about}`, sectionsText(r.sections, src)))
  if (r.steps.length) blocks.push(callout('example', `Worked through with Nova${about}`, r.steps.map((s, i) => `${i + 1}. **${s.title}**: ${citationsAsLinks(s.text, src)}`).join('\n')))
  if (r.quiz.length) blocks.push(callout('question', 'Practice questions (Nova)', r.quiz.map((q, i) => `${i + 1}. ${q.question}\n${q.choices.map((c, k) => `   - ${c}${k === q.answer ? ' ✓' : ''}`).join('\n')}${q.why ? `\n   *Why:* ${citationsAsLinks(q.why, src)}` : ''}`).join('\n'), true))
  if (r.exercise) blocks.push(callout('question', 'Practice question (Nova)', `${r.exercise.question}${r.exercise.choices.length ? `\n${r.exercise.choices.map(c => `- ${c}`).join('\n')}` : ''}${work.answer ? `\n\n*My answer:* ${work.answer}` : ''}\n\n*Expected:* ${r.exercise.answer}`, true))
  if (r.cards.length) blocks.push(callout('question', 'Flashcards (Nova)', r.cards.map(c => `- **${c.front}**: ${c.back}`).join('\n'), true))
  if (r.ideas.length) blocks.push(insertFor(r, work, 'ideas')!)
  if (r.organize) {
    for (const p of ['overview', 'concepts', 'questions', 'outline', 'tags'] as const) { const b = insertFor(r, work, p); if (b) blocks.push(b) }
  }
  return blocks.length ? blocks.join('\n\n') : null
}

// ── Where it goes in the note ─────────────────────────────────────────────────

// What a reply adds, by what was asked: so a summary goes where a summary
// belongs and an example beside what it illustrates (note-outline.ts placementFor).
export const ADDITION_KIND: Record<TutorMode, AdditionKind> = {
  explain: 'explanation', simpler: 'explanation', steps: 'explanation', compare: 'explanation', evaluate: 'explanation', check: 'explanation',
  example: 'example', practice: 'example',
  summary: 'summary', organize: 'summary',
  quiz: 'other', flashcards: 'other', brainstorm: 'other', connect: 'other',
}

// The heading of a new section made for what a reply adds.
const SECTION_TITLE: Partial<Record<TutorMode, string>> = { quiz: 'Practice questions', flashcards: 'Flashcards', brainstorm: 'Ideas', connect: 'Connections', organize: 'Organised version' }

// The passages a reply rests on, in order, each once.
export function refsOf(r: TutorReply, index: number | null = null): NoteRef[] {
  const out: NoteRef[] = []
  r.sections.forEach((s, i) => { if (index === null || i === index) for (const ref of s.refs ?? []) if (!out.some(x => x.hash === ref.hash)) out.push(ref) })
  return out
}

// Where an addition from this reply belongs in the note as it is now: the
// heading Nova suggested, the passage the learner chose, or the passages it
// rests on, in that order of weight (note-outline.ts decides among them).
export function placementHint(r: TutorReply, body: string, part: InsertPart = 'all', index = 0): PlacementHint {
  const chosen = r.passage?.ref ? resolveRef(body, r.passage.ref) : null
  const kind: AdditionKind = part === 'overview' ? 'summary' : part === 'ideas' || part === 'questions' || part === 'concepts' || part === 'tags' ? 'other' : r.mode === 'organize' && part === 'outline' ? 'other' : ADDITION_KIND[r.mode]
  return {
    kind,
    heading: r.place ?? null,
    passage: chosen && chosen.status !== 'stale' && kind !== 'summary' ? chosen.start : null,
    refs: refsOf(r, part === 'section' ? index : null),
    title: kind === 'other' ? SECTION_TITLE[r.mode] ?? 'From Nova' : r.mode === 'summary' ? 'Summary' : null,
  }
}

// Adds text to a note's text: at the end, or at a place in it (the editor's
// cursor), on a line of its own. Nothing in the note is changed.
export function placeInto(body: string, addition: string, at: number | null): string {
  if (at === null || at >= body.length) {
    const before = body.trimEnd()
    return before ? `${before}\n\n${addition}\n` : `${addition}\n`
  }
  const lineEnd = body.indexOf('\n', Math.max(0, at))
  const cut = lineEnd === -1 ? body.length : lineEnd
  let from = cut
  while (body[from] === '\n') from++
  const head = body.slice(0, cut).trimEnd(), tail = body.slice(from)
  return `${head}${head ? '\n\n' : ''}${addition}\n\n${tail}`
}

// ── Kept in this tab ──────────────────────────────────────────────────────────

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const KEY = (noteId: string) => `kivo-tutor:${noteId}`
const KEEP = 40

export function loadConversation(store: Store | null, noteId: string): TutorEntry[] {
  try {
    const raw = store?.getItem(KEY(noteId))
    const list = raw ? JSON.parse(raw) as unknown : []
    return Array.isArray(list) ? (list as TutorEntry[]).filter(e => e && typeof e.id === 'string' && ['learner', 'nova', 'error', 'stopped'].includes(e.role)) : []
  } catch { return [] }
}

export function saveConversation(store: Store | null, noteId: string, entries: TutorEntry[]): void {
  try {
    if (entries.length === 0) store?.removeItem(KEY(noteId))
    else store?.setItem(KEY(noteId), JSON.stringify(entries.slice(-KEEP)))
  } catch { /* storage full or refused: the conversation lasts as long as the page */ }
}
