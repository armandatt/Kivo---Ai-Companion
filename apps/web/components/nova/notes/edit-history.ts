// The editor's conversation, as the next request carries it (nova-editor.tsx).
// Pure, so it is tested without a page (edit-history.test.ts).

import type { EditKind, EditProposal, EditTurn } from '@repo/api/nova/product/note-edit.types'
import { EDIT_HISTORY_MAX, EDIT_TURN_TEXT_MAX } from '@repo/api/nova/product/note-edit.types'

export const EDIT_LABEL: Record<EditKind, string> = {
  structure: 'Improve the structure', rewrite: 'Rewrite more clearly', expand: 'Expand what’s thin', grammar: 'Fix grammar and wording',
  dedupe: 'Remove repetition', summary: 'Add a summary', takeaways: 'Add key takeaways', examples: 'Add examples',
  integrate: 'Work it into the note', custom: 'Edit',
}

export interface EditAsk {
  kind: EditKind; instruction?: string; passage?: string; material?: string; label?: string; answering?: string
  // Screenshots: stored on the note first (note-image-upload.ts), then named by
  // id, so a follow-up and a retry still have them. toStore lives until stored.
  images?: string[]; toStore?: Array<{ name: string; data: string; key: string }>; previews?: string[]
}

// applying: being applied and saved; applied: in the note and saved;
// unsaved: in the note on screen, but the save did not go through.
export type EditEntry =
  | { id: string; ask: EditAsk; state: 'proposed' | 'applying' | 'applied' | 'unsaved' | 'discarded' | 'conflict'; proposal: EditProposal; skip: string[]; note?: string }
  | { id: string; ask: EditAsk; state: 'error'; message: string }

// The conversation so far, for the next request: what was asked and what came
// of it, oldest first. The note itself is not sent: the server reads the
// saved note, which the page saves first (ensureSaved).
export function historyOf(entries: EditEntry[]): EditTurn[] {
  const cut = (t: string) => t.slice(0, EDIT_TURN_TEXT_MAX)
  return entries.slice(-EDIT_HISTORY_MAX).map((e): EditTurn => {
    const asked = cut(e.ask.label ?? e.ask.instruction ?? EDIT_LABEL[e.ask.kind])
    if (e.state === 'error') return { asked, outcome: 'failed' }
    const p = e.proposal
    if (!p.changes.length && p.question) return { asked, outcome: 'question', said: cut(p.question) }
    const outcome: EditTurn['outcome'] = e.state === 'applied' ? 'applied' : e.state === 'discarded' ? 'discarded' : e.state === 'conflict' ? 'failed' : 'proposed'
    return { asked, outcome, said: cut(p.summary) }
  })
}

// Nova's question the next message answers: the last entry's, if it asked one.
export function openQuestion(entries: EditEntry[]): string | null {
  const last = entries.at(-1)
  return last && last.state === 'proposed' && !last.proposal.changes.length && last.proposal.question ? last.proposal.question : null
}

