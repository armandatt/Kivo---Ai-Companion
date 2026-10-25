'use client'

// One conversation with Nova and its proposal, as the page holds it. The
// server's draft is the truth; the page keeps an editable copy of the plan
// and saves the learner's edits against the version they were made on.
//
//   - While a job runs (Nova reading or writing) the draft is polled for its
//     real stage. Nothing is shown as done before the server says so.
//   - An edit shows at once and is saved after a short pause. A newer
//     version from Nova never replaces edits that are not saved yet: the
//     page asks which to keep.
//   - Approval names the server's version, only once every edit is saved.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DraftView } from '@repo/api/nova/product/builder.types'
import type { WorkspacePlan } from '@repo/api/nova/product/workspace-plan'
import * as api from './builder-api'

const POLL_MS = 1200
const SAVE_AFTER_MS = 700

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function useDraft(draftId: string | null) {
  const [draft, setDraft] = useState<DraftView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [plan, setPlanState] = useState<WorkspacePlan | null>(null)
  const [save, setSave] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  // A newer version arrived while the learner had unsaved edits.
  const [conflict, setConflict] = useState<DraftView | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // Which action the error is about, so it shows beside that action only.
  const [errorOf, setErrorOf] = useState<null | 'send' | 'approve' | 'cancel' | 'retry' | 'delete' | 'keep'>(null)
  const [busy, setBusy] = useState<null | 'send' | 'approve' | 'cancel' | 'retry' | 'delete' | 'keep'>(null)
  // The newest version that arrived from the server while the page was
  // open, and the plan it replaced (null for a first proposal).
  const [arrival, setArrival] = useState<{ version: number; previous: WorkspacePlan | null; next: WorkspacePlan } | null>(null)

  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef<{ draft: DraftView | null; plan: WorkspacePlan | null }>({ draft: null, plan: null })
  latest.current = { draft, plan }
  const resumed = useRef<string | null>(null)

  // A draft from the server. Its plan replaces the page's copy only when the
  // learner has nothing unsaved; otherwise they choose.
  const adopt = useCallback((next: DraftView) => {
    const before = latest.current.draft
    setDraft(next)
    // A version that arrived while the page was open: the playground shows
    // what it changed. (Opening the page shows the plan as it is.)
    if (before && before.id === next.id && next.plan && next.version > before.version) setArrival({ version: next.version, previous: latest.current.plan, next: next.plan })
    if (!dirty.current) { setPlanState(next.plan); return }
    if (before && next.version > before.version) setConflict(next)
  }, [])

  const reload = useCallback(async () => {
    if (!draftId) return
    const res = await api.loadDraft(draftId)
    if (res.ok) { adopt(res.draft); setLoadError(null) }
    else if (!latest.current.draft) setLoadError(res.message)
  }, [draftId, adopt])

  useEffect(() => {
    setDraft(null); setPlanState(null); setLoadError(null); setConflict(null); setArrival(null); dirty.current = false
    if (draftId) void reload()
  }, [draftId, reload])

  // Poll while a job runs or a build is under way.
  const working = Boolean(draft && (draft.pending || draft.status === 'building'))
  useEffect(() => {
    if (!working) return
    const t = setTimeout(() => void reload(), POLL_MS)
    return () => clearTimeout(t)
  }, [working, draft, reload])

  // Another tab or device may have moved it on.
  useEffect(() => {
    const onFocus = () => { if (!dirty.current) void reload() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload])

  // A conversation begun in chat waits for Nova's first answer.
  useEffect(() => {
    if (!draft?.needsReply || resumed.current === draft.id) return
    resumed.current = draft.id
    void api.resumeDraft(draft.id).then(res => {
      if (res.ok) adopt(res.draft)
      else { setErrorOf('send'); setActionError(res.message); if (res.draft) adopt(res.draft) }
    })
  }, [draft, adopt])

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const { draft: d, plan: p } = latest.current
    if (!d || !p || !dirty.current) return
    setSave('saving')
    const sent = p
    const res = await api.saveDraftPlan(d.id, sent, d.version)
    if (res.ok) {
      setDraft(res.draft)
      setSaveError(null)
      setSave('saved')
      // The page keeps its own copy (the server's may trim a space the
      // learner is still typing past). Typed on while it saved: those edits
      // are still to save, on the new version.
      if (latest.current.plan === sent) dirty.current = false
      else timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS)
    } else if (res.error === 'stale' && res.draft) {
      setDraft(res.draft)
      setConflict(res.draft)
      setSave('error')
      setSaveError('Nova changed the proposal while you were editing.')
    } else {
      setSave('error')
      setSaveError(res.message)
    }
  }, [])

  const setPlan = useCallback((next: WorkspacePlan) => {
    dirty.current = true
    setPlanState(next)
    setSave('idle')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS)
  }, [flush])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // The conflict, resolved by the learner.
  const keepMine = useCallback(async () => {
    if (!conflict) return
    setDraft(conflict); setConflict(null)
    latest.current = { draft: conflict, plan: latest.current.plan }
    dirty.current = true
    await flush()
  }, [conflict, flush])
  const takeTheirs = useCallback(() => {
    if (!conflict) return
    dirty.current = false
    setDraft(conflict); setPlanState(conflict.plan); setConflict(null); setSave('idle'); setSaveError(null)
  }, [conflict])

  const run = useCallback(async (kind: 'send' | 'approve' | 'cancel' | 'retry' | 'delete' | 'keep', call: () => Promise<api.Failure | { ok: true; draft: DraftView }>) => {
    setBusy(kind); setActionError(null); setErrorOf(kind)
    const res = await call()
    setBusy(null)
    if (res.ok) { adopt(res.draft); return true }
    setActionError(res.message)
    if (res.draft) adopt(res.draft)
    return false
  }, [adopt])

  const send = useCallback(async (text: string, files: Array<{ name: string; data: string }> = []) => {
    if (!draftId) return false
    await flush()
    return run('send', () => api.sendMessage(draftId, text, files.map(f => ({ name: f.name, data: f.data }))))
  }, [draftId, flush, run])

  const approve = useCallback(async (opts: { addTo?: string; confirmAnother?: boolean } = {}) => {
    if (!draftId) return false
    await flush()
    const d = latest.current.draft
    if (!d || dirty.current) { setErrorOf('approve'); setActionError('Your edits are still saving. Try again in a moment.'); return false }
    return run('approve', () => api.approveDraft(draftId, { version: d.version, ...opts }))
  }, [draftId, flush, run])

  // Leave some of the proposed changes out; saved at once, on the version shown.
  const keepChanges = useCallback(async (keep: string[]) => {
    const d = latest.current.draft
    if (!d) return false
    setSave('saving')
    const res = await api.saveDraftChanges(d.id, keep, d.version)
    if (res.ok) { setDraft(res.draft); setSave('saved'); setSaveError(null); return true }
    setSave('error'); setSaveError(res.message)
    if (res.draft) setDraft(res.draft)
    return false
  }, [])

  const cancel = useCallback(() => (draftId ? run('cancel', () => api.cancelDraft(draftId)) : Promise.resolve(false)), [draftId, run])
  const retry = useCallback(() => (draftId ? run('retry', () => api.retryDraft(draftId)) : Promise.resolve(false)), [draftId, run])
  // A deletion is carried out only on the scope shown (its fingerprint).
  const confirmDeletion = useCallback(() => {
    const scope = latest.current.draft?.brief.deletion
    return draftId && scope ? run('delete', () => api.confirmDeletion(draftId, scope.fingerprint)) : Promise.resolve(false)
  }, [draftId, run])
  const keepResource = useCallback(() => (draftId ? run('keep', () => api.keepResource(draftId)) : Promise.resolve(false)), [draftId, run])

  return {
    draft, plan, setPlan, save, saveError, conflict, keepMine, takeTheirs, arrival,
    loadError, actionError, errorOf, clearActionError: () => setActionError(null), busy, working,
    reload, send, approve, cancel, retry, keepChanges, confirmDeletion, keepResource, unsaved: () => dirty.current,
  }
}

export type DraftState = ReturnType<typeof useDraft>
