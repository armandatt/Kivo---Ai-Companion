'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, Link2 } from 'lucide-react'
import type { LearningResource } from '@repo/api/nova/product/learning-events.types'
import { EVENT_TITLE_MAX } from '@repo/api/nova/product/learning-events.types'
import { LINK_PROBLEM_TEXT, checkLink, samePage, titleFromUrl } from '@repo/api/nova/product/resource-link'
import { parkDraft, type Capture } from './pending-capture'
import { saveLink } from './saved-api'
import type { NoteSubjectOption } from '@repo/api/nova/product/notes.types'
import { DestinationPicker } from '../notes/destination-picker'
import { NO_SUBJECT, destinationFor, destinationsOf, type Destination } from '../notes/note-destinations'
import { fetchNotes } from '../notes/notes-api'

const FIELD = 'mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-background px-3 text-sm text-foreground placeholder:text-foreground/30 disabled:opacity-50'
const LABEL = 'block text-xs font-medium text-foreground/60'

// One id per link being saved. Sent again on a retry, so the server answers
// a retry with what it already stored.
function newEventId(): string {
  try { return crypto.randomUUID() } catch { /* older browsers */ }
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`
}

type Draft = { eventId: string; url: string; domain: string; title: string; titleFrom: 'page' | 'address'; place: Destination; kept: { subjectId: string | null; topicName: string | null } }
type Done  = { title: string; already: boolean }

// Saving a link by hand: paste an address, look at what will be kept, and
// confirm. Nothing is saved until the learner presses Save, including for a
// page the bookmarklet brought (`capture`). Nova never opens the page, so a
// pasted link's title is read off its address and is theirs to correct.
export function SaveLink({ subjects, resources, capture, onSaved }: {
  subjects:  Array<{ id: string; name: string }>
  resources: LearningResource[]
  capture:   Capture | null
  onSaved:   () => void
}) {
  const id = useId()
  const [address, setAddress] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [draft, setDraft]     = useState<Draft | null>(null)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<{ text: string; signIn: boolean } | null>(null)
  const [done, setDone]       = useState<Done | null>(null)
  // The subjects with their topics, for the one destination picker (Notes' list).
  const [tree, setTree]       = useState<NoteSubjectOption[] | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const options: NoteSubjectOption[] = tree ?? subjects.map(s => ({ id: s.id, name: s.name, topics: [] }))
  const loadTree = async () => { const v = await fetchNotes(); if (v?.status === 'ready') { setTree(v.subjects); return v.subjects } return null }

  function review(raw: string, pageTitle: string | null) {
    const checked = checkLink(raw)
    if (!checked.ok) { setProblem(LINK_PROBLEM_TEXT[checked.problem]); return }
    const fromPage = (pageTitle ?? '').trim()
    // A page already saved opens with what is on record, so saving it again
    // changes only what the learner changes.
    const kept = resources.find(r => r.eventType === 'resource_saved' && samePage(r.url, checked.url)) ?? null
    setProblem(null); setError(null); setDone(null)
    setDraft({
      eventId: newEventId(), url: checked.url, domain: checked.domain,
      title: fromPage || kept?.title || titleFromUrl(checked.url), titleFrom: fromPage || kept ? 'page' : 'address',
      place: NO_SUBJECT, kept: { subjectId: kept?.subjectId ?? null, topicName: kept?.topicName ?? null },
    })
    void loadTree()
  }
  // Where a page already saved was filed: chosen to start with, once the topics are known.
  useEffect(() => {
    if (!draft || !tree || draft.place !== NO_SUBJECT || !draft.kept.subjectId) return
    const d = destinationFor(destinationsOf(tree), draft.kept.subjectId, draft.kept.topicName)
    if (d !== NO_SUBJECT) setDraft({ ...draft, place: d })
  }, [tree, draft])

  // A page the bookmarklet brought opens straight on its review.
  useEffect(() => {
    if (capture) review(capture.url, capture.title)
  }, [capture]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (draft) titleRef.current?.focus() }, [draft?.eventId]) // eslint-disable-line react-hooks/exhaustive-deps

  const already = draft ? resources.find(r => samePage(r.url, draft.url)) ?? null : null

  async function save() {
    if (!draft || saving) return
    setSaving(true); setError(null)
    const result = await saveLink({
      clientEventId: draft.eventId, url: draft.url, title: draft.title.trim(),
      subjectId: draft.place.subjectId, topicName: draft.place.subjectId ? draft.place.topicName : null,
    })
    setSaving(false)
    if (!result.success) {
      setError({ text: result.error === 'unauthenticated' ? 'You are signed out. Sign in, then save it again.' : result.message, signIn: result.error === 'unauthenticated' })
      return
    }
    setDone({ title: result.resource.title, already: result.action === 'already_saved' })
    setDraft(null); setAddress('')
    onSaved()
  }

  return (
    <section className={draft ? 'rounded-2xl border border-nova/25 bg-card/70 p-5 sm:p-6 motion-safe:animate-[subject-pop_180ms_ease-out]' : ''} data-section="save-link" data-state={draft ? 'review' : done ? 'done' : 'enter'}>
      {/* While a link is entered the field says what it is for; the heading
          shows once there is a link to review. */}
      <h2 className={draft ? 'flex items-center gap-2 text-base font-semibold text-foreground' : 'sr-only'}>
        <Link2 className="size-4 text-keppel-300" aria-hidden /> Check and save
      </h2>
      {draft && <p className="mt-1 text-sm text-foreground/55">Fix the title if you like and choose where it goes. Nothing is saved until you press Save.</p>}

      {!draft && (
        <form noValidate onSubmit={e => { e.preventDefault(); review(address, null) }}>
          <label htmlFor={`${id}-address`} className="sr-only">Page address</label>
          <div className="flex gap-2">
            <span className="relative min-w-0 flex-1">
            <Link2 aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground/40" />
            <input
              id={`${id}-address`} type="url" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false}
              value={address} onChange={e => { setAddress(e.target.value); setProblem(null) }}
              placeholder="Paste a link to save a page…" aria-invalid={problem !== null} aria-describedby={problem ? `${id}-problem` : undefined}
              className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] pl-9 pr-3 text-sm text-foreground placeholder:text-foreground/40 transition-colors hover:border-white/20 focus:border-nova/60 focus:outline-none"
              data-link-input
            />
            </span>
            <button type="submit" disabled={!address.trim()} className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-action px-4 text-sm font-semibold text-action-foreground transition-colors hover:bg-action-hover disabled:bg-white/[0.06] disabled:font-medium disabled:text-foreground/45" data-link-review>
              Save link
            </button>
          </div>
          {problem && <p id={`${id}-problem`} role="alert" className="mt-2 text-xs text-amber-300/90" data-link-problem>{problem}</p>}
          {done && (
            <p role="status" className="mt-3 flex items-start gap-2 text-sm text-foreground/75" data-link-done={done.already ? 'already' : 'saved'}>
              <Check className="mt-0.5 size-4 shrink-0 text-keppel-300" aria-hidden />
              {done.already
                ? <span>“{done.title}” was already saved, so you still have one copy, now with the title and place you just set.</span>
                : <span>Saved “{done.title}”. It’s at the top of your list.</span>}
            </p>
          )}
        </form>
      )}

      {draft && (
        <form className="mt-4 space-y-4" onSubmit={e => { e.preventDefault(); void save() }} data-link-form>
          <div>
            <p className={LABEL}>Address</p>
            <p className="mt-1.5 break-all rounded-xl border border-white/8 bg-white/3 px-3 py-2.5 text-sm text-foreground/80" data-link-address>{draft.url}</p>
            {already && (
              <p className="mt-2 text-xs leading-relaxed text-amber-300/90" data-link-already>
                You already saved this page as “{already.title}”. Saving again keeps one copy and updates it with what is below.
              </p>
            )}
          </div>

          <div>
            <label htmlFor={`${id}-title`} className={LABEL}>Title</label>
            <input id={`${id}-title`} ref={titleRef} value={draft.title} maxLength={EVENT_TITLE_MAX} onChange={e => setDraft({ ...draft, title: e.target.value })} className={FIELD} data-link-title />
            {draft.titleFrom === 'address' && (
              <p className="mt-1.5 text-xs leading-relaxed text-foreground/45">Kivo doesn’t open the page, so this title comes from the link. Change it to anything that helps you find it.</p>
            )}
          </div>

          <div data-link-place>
            <p className={LABEL}>Where it goes</p>
            <div className="mt-1.5">
              <DestinationPicker subjects={options} value={draft.place} onChange={place => setDraft({ ...draft, place })} onSubjectsChanged={loadTree} />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-amber-300/90" data-link-error>
              {error.text}{' '}
              {error.signIn && <Link href="/signin?from=/saved" onClick={() => parkDraft(draft.url, draft.title.trim())} className="font-medium underline underline-offset-4">Sign in</Link>}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={saving} className="inline-flex h-11 items-center justify-center rounded-xl bg-action px-5 text-sm font-semibold text-action-foreground transition-colors hover:bg-action-hover disabled:opacity-60" data-link-save>
              {saving ? 'Saving…' : error ? 'Try again' : already ? 'Update saved page' : 'Save to Kivo'}
            </button>
            <button type="button" disabled={saving} onClick={() => { setDraft(null); setError(null) }} className="inline-flex h-11 items-center justify-center rounded-xl border border-white/12 px-5 text-sm text-foreground/75 transition-colors hover:bg-white/5 disabled:opacity-60">
              Cancel
            </button>
            <p className="basis-full text-xs leading-relaxed text-foreground/45 sm:basis-auto sm:pl-2">Saving keeps the link. Studying it is a separate step.</p>
          </div>
        </form>
      )}
    </section>
  )
}
