'use client'

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { Bell, BellOff, Repeat, X } from 'lucide-react'
import {
  ALL_DAY_REMINDERS, EVENT_CATEGORIES, EVENT_CATEGORY_LABEL, EVENT_DESCRIPTION_MAX, EVENT_TITLE_MAX, REPEAT_LABEL, TIMED_REMINDERS,
  type CalendarDeadlineItem, type CalendarEventInput, type CalendarEventItem, type CalendarReminderChannel, type EventCategory,
  type NovaCalendarReady, type ReminderStatus, type RepeatFreq, type RepeatRule,
} from '@repo/api/nova/product/calendar.types'
import { DEADLINE_RULES, DEADLINE_TYPES, type DeadlineType } from '@repo/api/nova/product/deadline-types'
import { EXAMS_HREF } from '@repo/api/nova/product/exams.types'
import { trappedTabTarget } from '@/components/settings/dialog-focus'
import { BUTTON_PRIMARY } from '@/components/nova/workspace/ui'
import { cn } from '@/lib/utils'
import { addDays, dayTitle, daysBetween, timeLabel } from './calendar-grid'

const TAB_STOPS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
export const FIELD = 'h-10 w-full rounded-xl border border-white/10 bg-white/4 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-foreground/35 focus:border-action'
export const LABEL = 'mb-1.5 block text-xs font-medium text-foreground/60'

// A modal: focus goes in when it opens and back to what opened it when it
// closes; Escape closes it; Tab stays inside. A sheet from the bottom on a
// phone, a centred card on a wider screen.
export function Modal({ label, onClose, children, onSubmit }: {
  label: string; onClose: () => void; children: ReactNode; onSubmit?: (e: FormEvent) => void
}) {
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current
    first?.focus()
    return () => { opener?.focus?.() }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab' || !ref.current) return
      const stops = Array.from(ref.current.querySelectorAll<HTMLElement>(TAB_STOPS))
      const target = trappedTabTarget(stops, document.activeElement as HTMLElement | null, e.shiftKey, ref.current)
      if (target) { e.preventDefault(); target.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-6" role="presentation"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <form ref={ref} tabIndex={-1} onSubmit={e => { e.preventDefault(); onSubmit?.(e) }}
        role="dialog" aria-modal="true" aria-label={label}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/10 bg-card p-6 shadow-2xl focus:outline-none sm:rounded-3xl sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{label}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-foreground/55 transition-colors hover:bg-white/5 hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        {children}
      </form>
    </div>
  )
}

export function DialogButtons({ busy, saveLabel, onClose, left }: { busy: boolean; saveLabel: string; onClose: () => void; left?: ReactNode }) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
      {left ?? <span />}
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="inline-flex h-10 items-center rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/80 transition-colors hover:bg-white/5">Cancel</button>
        <button type="submit" disabled={busy} className={BUTTON_PRIMARY}>{busy ? 'Saving…' : saveLabel}</button>
      </div>
    </div>
  )
}

const REMINDER_STATUS: Record<ReminderStatus, string> = {
  scheduled:   'Reminder scheduled',
  sent:        'Reminder sent',
  failed:      "Reminder couldn't be delivered",
  missed:      'Reminder time passed before it could be sent',
  unavailable: 'Reminder not sent: nowhere to send it',
}

export function ReminderBadge({ status }: { status: ReminderStatus }) {
  const off = status === 'failed' || status === 'missed' || status === 'unavailable'
  const Icon = off ? BellOff : Bell
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', off ? 'text-amber-600 dark:text-amber-300' : 'text-foreground/60')}>
      <Icon aria-hidden className="size-3.5" />{REMINDER_STATUS[status]}
    </span>
  )
}

// What the reminder picker says about where reminders go. Never promises a
// delivery the server will not make.
export function channelNote(channel: CalendarReminderChannel): string {
  if (channel.channel === 'telegram') return 'Sent to you on Telegram.'
  if (channel.reason === 'blocked') return "Telegram isn't delivering Nova's messages to you. Open the chat with Nova and send any message, then reminders will go out."
  return 'Reminders are sent on Telegram. Connect Telegram from Today to receive them; until then a reminder is saved but not sent.'
}

const pad = (n: number) => String(n).padStart(2, '0')

// Weekdays as the server numbers them (0 = Sunday), shown Monday first.
const WEEKDAY_CHOICES: ReadonlyArray<{ day: number; short: string; long: string }> = [
  { day: 1, short: 'M', long: 'Monday' }, { day: 2, short: 'T', long: 'Tuesday' }, { day: 3, short: 'W', long: 'Wednesday' },
  { day: 4, short: 'T', long: 'Thursday' }, { day: 5, short: 'F', long: 'Friday' }, { day: 6, short: 'S', long: 'Saturday' },
  { day: 0, short: 'S', long: 'Sunday' },
]
const weekdayOfDay = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay()
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`

// "Every Wednesday", "Every day until 30 November", in words.
export function repeatSummary(rule: RepeatRule, startDay: string): string {
  const base = rule.freq === 'daily' ? 'Every day'
    : rule.freq === 'monthly' ? `Every month on the ${ordinal(Number(startDay.slice(8)))}`
    : `Every ${(rule.days.length > 0 ? rule.days : [weekdayOfDay(startDay)])
        .map(d => WEEKDAY_CHOICES.find(c => c.day === d)!).sort((a, b) => WEEKDAY_CHOICES.indexOf(a) - WEEKDAY_CHOICES.indexOf(b))
        .map(c => c.long).join(', ')}`
  return rule.until ? `${base} until ${dayTitle(rule.until)}` : base
}

// Create or edit one event. Nothing is saved until Save; the server checks
// the whole event and works out the moments and the reminder time.
export function EventEditor({ event, initial, view, onSave, onDelete, onDeleteOccurrence, onClose, error }: {
  event:     CalendarEventItem | null
  initial?:  Partial<CalendarEventInput>
  view:      NovaCalendarReady
  onSave:    (input: CalendarEventInput) => Promise<boolean>
  // Deletes the event: every occurrence of a repeating one.
  onDelete?: () => Promise<boolean>
  // Removes only the occurrence that was opened.
  onDeleteOccurrence?: () => Promise<boolean>
  onClose:   () => void
  error:     string | null
}) {
  // A repeating event is edited as its series: from its first day.
  const seriesStart = event?.repeat ? event.seriesStartDay ?? event.startDay : event?.startDay
  const seriesEnd = event && seriesStart ? addDays(seriesStart, daysBetween(event.startDay, event.endDay)) : null
  // The next whole hour in the learner's zone, which is the zone the times are given in.
  const nowHour = Number(timeLabel(new Date().toISOString(), event?.timezone ?? view.timezone).slice(0, 2))
  const [title, setTitle] = useState(event?.title ?? initial?.title ?? '')
  const [category, setCategory] = useState<EventCategory>(event?.category ?? initial?.category ?? 'other')
  const [allDay, setAllDay] = useState(event?.allDay ?? initial?.allDay ?? false)
  const [startDay, setStartDay] = useState(seriesStart ?? initial?.startDay ?? view.today)
  const [endDay, setEndDay] = useState(event && seriesEnd && seriesEnd !== seriesStart ? seriesEnd : '')
  const [repeat, setRepeat] = useState<RepeatFreq | ''>(event?.repeat?.freq ?? '')
  const [repeatDays, setRepeatDays] = useState<number[]>(event?.repeat?.freq === 'weekly' ? event.repeat.days : [])
  const [repeatUntil, setRepeatUntil] = useState(event?.repeat?.until ?? '')
  const [startTime, setStartTime] = useState(event?.startTime ?? initial?.startTime ?? `${pad(Math.min(22, nowHour + 1))}:00`)
  const [endTime, setEndTime] = useState(event?.endTime ?? initial?.endTime ?? `${pad(Math.min(23, nowHour + 2))}:00`)
  const [reminder, setReminder] = useState<string>(event?.reminderMinutes != null ? String(event.reminderMinutes) : initial?.reminderMinutes != null ? String(initial.reminderMinutes) : '')
  const [taskId, setTaskId] = useState(event?.task?.id ?? initial?.taskId ?? '')
  const [subjectId, setSubjectId] = useState(event?.subject?.id ?? initial?.subjectId ?? '')
  const [description, setDescription] = useState(event?.description ?? '')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const timezone = event?.timezone ?? view.timezone
  const choices = allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS
  // A reminder chosen for a timed event may not exist for an all-day one.
  useEffect(() => {
    if (reminder && !choices.some(c => String(c.minutes) === reminder)) setReminder('')
  }, [allDay]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    const ok = await onSave({
      title, category, allDay, startDay, endDay: endDay || null,
      startTime: allDay ? null : startTime, endTime: allDay ? null : (endTime || null),
      timezone, reminderMinutes: reminder === '' ? null : Number(reminder),
      taskId: taskId || null, subjectId: subjectId || null, description: description.trim() || null,
      repeat: repeat === '' ? null : {
        freq: repeat,
        days: repeat === 'weekly' ? (repeatDays.length > 0 ? repeatDays : [weekdayOfDay(startDay)]) : undefined,
        until: repeatUntil || null,
      },
    })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal label={event ? 'Edit event' : 'New event'} onClose={onClose} onSubmit={() => void save()}>
      <div className="mt-5 space-y-4">
        <div>
          <label htmlFor="ev-title" className={LABEL}>Title</label>
          <input id="ev-title" data-autofocus value={title} onChange={e => setTitle(e.target.value)} maxLength={EVENT_TITLE_MAX} placeholder="e.g. Physics lab" className={FIELD} required />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
          <div>
            <label htmlFor="ev-kind" className={LABEL}>Kind</label>
            <select id="ev-kind" value={category} onChange={e => setCategory(e.target.value as EventCategory)} className={FIELD}>
              {EVENT_CATEGORIES.map(c => <option key={c} value={c}>{EVENT_CATEGORY_LABEL[c]}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-foreground/80">
            <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} className="size-4 accent-[var(--action)]" />
            All day
          </label>
          <div>
            <label htmlFor="ev-start-day" className={LABEL}>{allDay ? 'First day' : 'Day'}</label>
            <input id="ev-start-day" type="date" value={startDay} onChange={e => setStartDay(e.target.value)} className={FIELD} required />
          </div>
          {allDay ? (
            <div>
              <label htmlFor="ev-end-day" className={LABEL}>Last day <span className="text-subtle">(optional)</span></label>
              <input id="ev-end-day" type="date" value={endDay} min={startDay} onChange={e => setEndDay(e.target.value)} className={FIELD} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="ev-start" className={LABEL}>Starts</label>
                <input id="ev-start" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className={cn(FIELD, 'px-2.5')} required />
              </div>
              <div>
                <label htmlFor="ev-end" className={LABEL}>Ends</label>
                <input id="ev-end" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className={cn(FIELD, 'px-2.5')} />
              </div>
            </div>
          )}
        </div>
        {!allDay && <p className="-mt-2 text-xs text-subtle">Times are in {timezone.replace('_', ' ')}.</p>}

        <div>
          <label htmlFor="ev-repeat" className={LABEL}>Repeat</label>
          <select id="ev-repeat" value={repeat} onChange={e => {
            const next = e.target.value as RepeatFreq | ''
            setRepeat(next)
            if (next === 'weekly' && repeatDays.length === 0) setRepeatDays([weekdayOfDay(startDay)])
          }} className={FIELD}>
            <option value="">Does not repeat</option>
            {(Object.keys(REPEAT_LABEL) as RepeatFreq[]).map(f => <option key={f} value={f}>{REPEAT_LABEL[f]}</option>)}
          </select>
          {repeat === 'weekly' && (
            <div role="group" aria-label="Repeats on" className="mt-2 flex flex-wrap gap-1.5">
              {WEEKDAY_CHOICES.map(c => {
                const on = repeatDays.includes(c.day)
                return (
                  <button key={c.day} type="button" aria-pressed={on} aria-label={c.long} title={c.long}
                    onClick={() => setRepeatDays(days => on ? (days.length > 1 ? days.filter(d => d !== c.day) : days) : [...days, c.day])}
                    className={cn('size-9 rounded-full border text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                      on ? 'border-action bg-action text-action-foreground' : 'border-white/12 text-foreground/70 hover:border-white/30')}>
                    {c.short}
                  </button>
                )
              })}
            </div>
          )}
          {repeat !== '' && (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label htmlFor="ev-until" className={LABEL}>Until <span className="text-subtle">(optional)</span></label>
                <input id="ev-until" type="date" value={repeatUntil} min={startDay} onChange={e => setRepeatUntil(e.target.value)} className={FIELD} />
              </div>
              <p className="self-end pb-2 text-xs text-foreground/60">
                <Repeat aria-hidden className="mr-1 inline size-3.5 align-[-2px]" />
                {repeatSummary({ freq: repeat, days: repeat === 'weekly' ? (repeatDays.length > 0 ? repeatDays : [weekdayOfDay(startDay)]) : [], until: repeatUntil || null }, startDay)}
              </p>
            </div>
          )}
          {event?.repeat && <p className="mt-1.5 text-xs text-subtle">Changes here apply to every date of this event.</p>}
        </div>

        <div>
          <label htmlFor="ev-reminder" className={LABEL}>Reminder</label>
          <select id="ev-reminder" value={reminder} onChange={e => setReminder(e.target.value)} className={FIELD}>
            <option value="">No reminder</option>
            {choices.map(c => <option key={c.minutes} value={String(c.minutes)}>{c.label}</option>)}
          </select>
          {reminder !== '' && <p className={cn('mt-1.5 text-xs', view.reminders.channel === 'telegram' ? 'text-subtle' : 'text-amber-600 dark:text-amber-300')}>{channelNote(view.reminders)}{repeat !== '' && view.reminders.channel === 'telegram' ? ' One before each date.' : ''}</p>}
          {event?.reminder && <p className="mt-1.5"><ReminderBadge status={event.reminder.status} /></p>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ev-task" className={LABEL}>For a task <span className="text-subtle">(optional)</span></label>
            <select id="ev-task" value={taskId} onChange={e => setTaskId(e.target.value)} className={FIELD}>
              <option value="">None</option>
              {event?.task && !view.openTasks.some(t => t.id === event.task!.id) && <option value={event.task.id}>{event.task.title}</option>}
              {view.openTasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ev-subject" className={LABEL}>Subject <span className="text-subtle">(optional)</span></label>
            <select id="ev-subject" value={subjectId} onChange={e => setSubjectId(e.target.value)} className={FIELD}>
              <option value="">None</option>
              {view.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="ev-notes" className={LABEL}>Notes <span className="text-subtle">(optional)</span></label>
          <textarea id="ev-notes" value={description} onChange={e => setDescription(e.target.value)} maxLength={EVENT_DESCRIPTION_MAX} rows={3}
            className={cn(FIELD, 'h-auto py-2')} />
        </div>
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-red-500">{error}</p>}

      <DialogButtons busy={busy} saveLabel={event ? 'Save' : 'Add event'} onClose={onClose} left={event && onDelete ? (
        confirming ? (
          event.repeat && onDeleteOccurrence ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="text-foreground/65">Delete:</span>
              <button type="button" onClick={async () => { if (await onDeleteOccurrence()) onClose() }} className="font-medium text-red-500 hover:text-red-400">Only {dayTitle(event.startDay)}</button>
              <button type="button" onClick={async () => { if (await onDelete()) onClose() }} className="font-medium text-red-500 hover:text-red-400">Every date</button>
              <button type="button" onClick={() => setConfirming(false)} className="text-foreground/60 hover:text-foreground">Keep</button>
            </span>
          ) : (
            <span className="flex items-center gap-2 text-sm">
              <span className="text-foreground/65">Delete this event?</span>
              <button type="button" onClick={async () => { if (await onDelete()) onClose() }} className="font-medium text-red-500 hover:text-red-400">Delete</button>
              <button type="button" onClick={() => setConfirming(false)} className="text-foreground/60 hover:text-foreground">Keep</button>
            </span>
          )
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="text-sm text-foreground/55 transition-colors hover:text-red-500">Delete</button>
        )
      ) : undefined} />
    </Modal>
  )
}

// A dated deadline: an exam, an assignment and the rest. It is saved as one
// of the learner's dates (the same record setup and Telegram add), so the
// Planner and Nova see it too.
export function DeadlineEditor({ day, view, onSave, onClose }: {
  day: string; view: NovaCalendarReady
  onSave: (input: { title: string; date: string; kind: DeadlineType; subjectName: string | null }) => Promise<string | null>
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(day < view.today ? view.today : day)
  const [kind, setKind] = useState<DeadlineType>('exam')
  const [subject, setSubject] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    if (busy) return
    setBusy(true); setError(null)
    const problem = await onSave({ title: title.trim() || `${subject || 'Untitled'} ${DEADLINE_RULES[kind].titleSuffix}`, date, kind, subjectName: subject || null })
    setBusy(false)
    if (problem) setError(problem); else onClose()
  }
  return (
    <Modal label="New deadline" onClose={onClose} onSubmit={() => void save()}>
      <p className="mt-2 text-sm text-foreground/65">Saved with your other dates, so Nova plans around it. Exams and certifications shape the days before them.</p>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="dl-title" className={LABEL}>Name</label>
          <input id="dl-title" data-autofocus value={title} onChange={e => setTitle(e.target.value)} maxLength={80} placeholder="e.g. OS midterm" className={FIELD} />
        </div>
        <div>
          <label htmlFor="dl-kind" className={LABEL}>Kind</label>
          <select id="dl-kind" value={kind} onChange={e => setKind(e.target.value as DeadlineType)} className={FIELD}>
            {DEADLINE_TYPES.map(t => <option key={t} value={t}>{DEADLINE_RULES[t].label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="dl-date" className={LABEL}>Day</label>
          <input id="dl-date" type="date" value={date} min={view.today} onChange={e => setDate(e.target.value)} className={FIELD} required />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="dl-subject" className={LABEL}>Subject <span className="text-subtle">(optional)</span></label>
          <select id="dl-subject" value={subject} onChange={e => setSubject(e.target.value)} className={FIELD}>
            <option value="">None</option>
            {view.subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-red-500">{error}</p>}
      <DialogButtons busy={busy} saveLabel="Add deadline" onClose={onClose} />
    </Modal>
  )
}

export function DeadlineDetail({ deadline, onClose }: { deadline: CalendarDeadlineItem; onClose: () => void }) {
  return (
    <Modal label={deadline.title} onClose={onClose}>
      <p className="mt-3 text-sm text-foreground/75">{deadline.kindLabel}{deadline.subjectName ? ` · ${deadline.subjectName}` : ''}</p>
      <p className="mt-1 text-sm text-foreground/65">{dayTitle(deadline.day)}</p>
      <p className="mt-4 text-sm text-foreground/65">Dates are moved, renamed or removed with your other dates, so every page and Nova stay in step.</p>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="inline-flex h-10 items-center rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/80 hover:bg-white/5">Close</button>
        <Link href={EXAMS_HREF} data-autofocus className={BUTTON_PRIMARY}>Change this date</Link>
      </div>
    </Modal>
  )
}
