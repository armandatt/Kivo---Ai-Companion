// The Notes workspace's keyboard shortcuts: one list, read by the handler
// (notes-commands.tsx) and by the ? panel, so what is shown is what works.
// Pure: tested in notes-shortcuts.test.ts.
//
// The modifier is the platform's own: ⌘ on a Mac, Ctrl elsewhere. Ctrl on a
// Mac is left alone, because there Ctrl+P and Ctrl+K are text-field commands
// (line up, delete to end of line) people use while typing.
//
// ⌘P / Ctrl+P is the browser's Print. It is taken only on the Notes pages,
// where it opens Import research paper; every other page keeps Print, and the
// browser's menu prints here too. ⌘F / Ctrl+F stays the browser's find, and
// ⌘B / ⌘I stay with the editor, which already binds them.

export type NotesAction = 'import' | 'palette' | 'help'

export interface KeyLike { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; isComposing?: boolean; repeat?: boolean }

// Whether the focus is somewhere the learner types.
export const isTypingTarget = (t: { tagName?: string; isContentEditable?: boolean } | null) =>
  !!t && (t.isContentEditable === true || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')

export function isMacPlatform(platform: string): boolean {
  const p = platform.toLowerCase()
  return p.includes('mac') || p.includes('iphone') || p.includes('ipad')
}

// What a key press does on Notes, or null: it is left to the page.
export function notesShortcut(e: KeyLike, mac: boolean, typing: boolean): NotesAction | null {
  if (e.isComposing || e.repeat) return null
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  const key = e.key.toLowerCase()
  if (mod && !e.altKey && !e.shiftKey && key === 'p') return 'import'
  if (mod && !e.altKey && !e.shiftKey && key === 'k') return 'palette'
  // ? opens the list of shortcuts, never while typing (it is a character).
  if (!typing && e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) return 'help'
  return null
}

export const modLabel = (mac: boolean) => (mac ? '⌘' : 'Ctrl+')

// The ? panel. `where` says when each applies.
export function shortcutList(mac: boolean): Array<{ keys: string; action: string; where: string }> {
  const m = modLabel(mac)
  return [
    { keys: `${m}P`, action: 'Import a research paper', where: 'Notes' },
    { keys: `${m}K`, action: 'Commands and search: notes, subjects, Nova', where: 'Notes' },
    { keys: '?', action: 'This list of shortcuts', where: 'Notes, when not typing' },
    { keys: 'E', action: 'Edit the note you are reading', where: 'A note' },
    { keys: `${m}S`, action: 'Save now (notes also save as you pause)', where: 'Editing' },
    { keys: `${m}B`, action: 'Bold', where: 'Editing' },
    { keys: `${m}I`, action: 'Italic', where: 'Editing' },
    { keys: `${m}${mac ? '⇧' : 'Shift+'}E`, action: 'Highlight', where: 'Editing' },
    { keys: 'Enter', action: 'Send to Nova (Shift+Enter for a new line)', where: 'Nova’s panel' },
    { keys: 'Esc', action: 'Close the dialog or panel; stop Nova', where: 'Anywhere' },
    { keys: `${m}F`, action: 'Find on the page (the browser’s own)', where: 'Anywhere' },
  ]
}
