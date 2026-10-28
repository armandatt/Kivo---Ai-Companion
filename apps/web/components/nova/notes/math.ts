// LaTeX drawn for reading (KaTeX). Pure: the note's text is never changed, and
// what cannot be drawn says why and keeps its source. Safe by KaTeX's own
// rules: trust is off, so \href, \url, \includegraphics and \html… draw as
// text and nothing in a note can make a link, load a file or add markup.
// mhchem adds \ce and \pu (chemistry and units). Tested in note-blocks.test.ts.

import katex from 'katex'
import 'katex/contrib/mhchem'

export type Drawn = { ok: true; html: string } | { ok: false; error: string }

const cache = new Map<string, Drawn>()
const CACHE_MAX = 600

export function drawTex(tex: string, display: boolean): Drawn {
  const key = `${display ? 'd' : 'i'}${tex}`
  const known = cache.get(key)
  if (known) return known
  let out: Drawn
  if (!tex.trim()) out = { ok: false, error: 'The equation is empty.' }
  else {
    try {
      out = { ok: true, html: katex.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, strict: 'ignore', output: 'htmlAndMathml', maxSize: 40, maxExpand: 500 }) }
    } catch (err) {
      // "KaTeX parse error: Expected '}', got 'EOF' at end of input: \frac{a"
      const message = err instanceof Error ? err.message.replace(/^KaTeX parse error:\s*/, '') : 'It could not be read.'
      out = { ok: false, error: message.length > 160 ? `${message.slice(0, 157)}…` : message }
    }
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
  cache.set(key, out)
  return out
}
