// The pure parts of sharing and importing one note (note-share.tsx,
// note-import.tsx), tested on their own (note-share-data.test.ts).

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

/** The name a download header gives (RFC 5987 first), or the fallback. */
export function downloadName(header: string | null, fallback: string): string {
  const cd = header ?? ''
  const exact = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1]
  if (exact) { try { return decodeURIComponent(exact) } catch { /* fall through */ } }
  return /filename="([^"]+)"/.exec(cd)?.[1] ?? fallback
}

/** The section added below an imported PDF when the learner chooses its text. */
export function extractedSection(text: string, pages: number, partial: boolean): string {
  const body = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return [
    '', '## Text from the PDF', '',
    `> [!warning] Read from the PDF automatically (${plural(pages, 'page')}${partial ? ', the first part only' : ''}). It can miss or misorder text, tables, formulas and images; the PDF above is the record.`,
    '', body, '',
  ].join('\n')
}
