'use client'

import { useState } from 'react'

// A value to paste somewhere else (the MCP server address), with a Copy
// button. The text stays selectable, so it still works where the clipboard
// is blocked.
export function CopyField({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setState('copied') } catch { setState('failed') }
    window.setTimeout(() => setState('idle'), 2000)
  }
  return (
    <div className="rounded-xl border border-white/8 bg-card/60 p-3 text-sm">
      <p className="text-xs text-subtle">{label}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all break-all font-mono text-foreground">{value}</code>
        <button type="button" onClick={() => void copy()}
          className="shrink-0 rounded-lg border border-white/12 px-2.5 py-1 text-xs text-foreground/85 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-ring">
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : 'Copy'}
        </button>
      </div>
      <span role="status" className="sr-only">{state === 'copied' ? 'Copied to the clipboard' : ''}</span>
    </div>
  )
}
