'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { requestAccountDeletion } from './delete-account'
import { trappedTabTarget } from './dialog-focus'

// Deleting the account, from Settings. Nothing happens on opening the page or
// the dialog: the request is sent only by the dialog's own button, and only
// once the word has been typed. The request, and what counts as a confirmed
// deletion, are in delete-account.ts; this file shows what it answers.

const CONFIRM_WORD = 'DELETE'
const TAB_STOPS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function DeleteAccountSection() {
  const [open, setOpen]         = useState(false)
  const [typed, setTyped]       = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError]       = useState('')
  const dialogRef = useRef<HTMLFormElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)
  const openerRef = useRef<HTMLButtonElement>(null)

  const ready = typed === CONFIRM_WORD

  // Closing is refused while the request is out: its answer decides what the
  // learner is told, and it must have somewhere to land.
  const close = useCallback(() => {
    if (deleting) return
    setOpen(false); setTyped(''); setError('')
    openerRef.current?.focus()
  }, [deleting])

  // Focus goes to the field when the dialog opens. While the request is out
  // every control is disabled, so the dialog itself holds focus; if the
  // request is refused, focus goes back to the field.
  useEffect(() => {
    if (!open) return
    (deleting ? dialogRef.current : inputRef.current)?.focus()
  }, [open, deleting])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); return }
      if (e.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const stops  = Array.from(dialog.querySelectorAll<HTMLElement>(TAB_STOPS))
      const target = trappedTabTarget(stops, document.activeElement as HTMLElement | null, e.shiftKey, dialog)
      if (target) { e.preventDefault(); target.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  async function handleDeleteAccount(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || deleting) return
    setDeleting(true)
    setError('')
    // Nothing is said to be deleted, and the page is not left, until the
    // server has confirmed it.
    const outcome = await requestAccountDeletion()
    if (outcome.ok) {
      window.location.href = '/'
      return
    }
    setError(outcome.message)
    setDeleting(false)
  }

  return (
    <section aria-labelledby="delete-account-heading" className="rounded-3xl border border-white/8 bg-card/70 p-6 sm:p-8" data-section="delete-account">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="delete-account-heading" className="text-lg font-semibold tracking-tight text-foreground">Delete account</h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-foreground/65">
            Permanently deletes your account. This cannot be undone.
          </p>
        </div>
        <button
          ref={openerRef} type="button" onClick={() => setOpen(true)}
          className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl border border-red-400/35 px-5 text-sm font-medium text-red-300 transition-colors hover:bg-red-400/8"
          data-open-delete-account
        >
          Delete account
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
          <form
            onSubmit={handleDeleteAccount}
            ref={dialogRef} tabIndex={-1}
            role="dialog" aria-modal="true" aria-labelledby="delete-account-title" aria-describedby="delete-account-warning" aria-busy={deleting}
            className="w-full max-w-md rounded-t-3xl border border-white/10 bg-card p-6 shadow-2xl focus:outline-none sm:rounded-3xl sm:p-7"
          >
            <div className="flex items-center justify-between gap-4">
              <h3 id="delete-account-title" className="text-lg font-semibold tracking-tight text-foreground">Delete your account?</h3>
              <button type="button" onClick={close} disabled={deleting} aria-label="Close" className="rounded-lg p-1.5 text-foreground/50 transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-40">
                <X className="size-4" />
              </button>
            </div>
            <p id="delete-account-warning" className="mt-3 text-sm leading-relaxed text-foreground/65">
              Your account will be deleted for good, and you will be signed out. Your Nova study record, notes and conversation are deleted with it. A Telegram chat with Rex, or one that another account is also connected to, is not deleted. This cannot be undone.
            </p>

            <label htmlFor="delete-account-confirm" className="mt-5 block text-xs font-medium text-foreground/60">
              Type <span className="font-semibold text-foreground">{CONFIRM_WORD}</span> to confirm
            </label>
            <input
              ref={inputRef} id="delete-account-confirm" value={typed} onChange={e => setTyped(e.target.value)} disabled={deleting}
              autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-required="true"
              className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-transparent px-3.5 text-sm text-foreground placeholder:text-foreground/35 focus:border-red-400/60 focus:outline-none"
            />

            {error && <p role="alert" className="mt-3 text-sm leading-relaxed text-red-300">{error}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={close} disabled={deleting} className="inline-flex h-10 items-center rounded-xl border border-white/12 px-4 text-sm font-medium text-foreground/80 transition-colors hover:bg-white/5 disabled:opacity-40">
                Cancel
              </button>
              <button type="submit" disabled={!ready || deleting} className="inline-flex h-10 items-center gap-2 rounded-xl bg-red-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-red-400 disabled:opacity-40" data-confirm-delete-account>
                {deleting ? <><Loader2 className="size-4 animate-spin" /> Deleting…</> : 'Delete permanently'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}
