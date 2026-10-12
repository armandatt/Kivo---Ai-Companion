// Asking the server to delete the signed-in account, and believing only what
// it answers. The page says nothing is deleted until this returns ok, and
// only then leaves the signed-in pages.

export type DeletionOutcome =
  | { ok: true }
  | { ok: false; reason: 'signed_out' | 'failed'; message: string }

const FAILED     = "Your account was not deleted. Nothing has been removed. Try again in a moment."
const SIGNED_OUT = "You've been signed out, so nothing was deleted. Sign in and try again."

export async function requestAccountDeletion(): Promise<DeletionOutcome> {
  let res: Response
  try {
    res = await fetch('/api/delete-account', { method: 'DELETE', cache: 'no-store' })
  } catch {
    return { ok: false, reason: 'failed', message: FAILED }
  }
  if (res.status === 401) return { ok: false, reason: 'signed_out', message: SIGNED_OUT }
  if (!res.ok) return { ok: false, reason: 'failed', message: FAILED }
  const body = await res.json().catch(() => null) as { ok?: unknown } | null
  // A 2xx that does not say so is not a confirmation.
  if (body?.ok !== true) return { ok: false, reason: 'failed', message: FAILED }

  // The server clears the session with its answer. This is the same thing
  // asked once more, for a browser that did not take that cookie change; the
  // account is gone either way, so its failing changes nothing.
  await fetch('/api/logout', { method: 'POST', cache: 'no-store' }).catch(() => null)
  return { ok: true }
}
