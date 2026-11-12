// ─── Colour in a note ─────────────────────────────────────────────────────────
// A small, fixed palette of meanings for text in a note, shared by the page
// that draws it (note-blocks.ts, note-body.tsx), the toolbar that writes it
// (note-format.ts) and Nova's editor, which must keep it (note-edit.ts).
// No imports, so the web app reads it directly.
//
// A note stays Markdown, readable as plain text anywhere:
//   [words]{.blue}       words in a colour
//   [words]{.hl-amber}   words highlighted in a colour
//   ==words==            a highlight (amber), as before
// The bracketed-span form is Pandoc's; any other class in it is left as
// written. The colours are roles, each with a reason to use it, so a note
// never turns into a rainbow; the shades live in globals.css (.ink-*, .hl-*)
// and follow the theme.

export const NOTE_COLORS = ["accent", "blue", "teal", "amber", "green", "red", "muted"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export const NOTE_COLOR_INFO: Record<NoteColor, { label: string; use: string }> = {
  accent: { label: "Accent", use: "Key terms" },
  blue:   { label: "Blue",   use: "Information and references" },
  teal:   { label: "Teal",   use: "Concepts and insights" },
  amber:  { label: "Amber",  use: "Important points" },
  green:  { label: "Green",  use: "Results and things that work" },
  red:    { label: "Red",    use: "Warnings and mistakes" },
  muted:  { label: "Muted",  use: "Asides and less important text" },
};

const isColor = (v: string): v is NoteColor => (NOTE_COLORS as readonly string[]).includes(v);

// A coloured span starting at `i` ("[" … "]{." name "}"), or null. The words
// are one line, hold no "[" or "]" of their own, and are not empty.
export function colorSpanAt(text: string, i: number): { words: string; color: NoteColor; highlight: boolean; end: number } | null {
  if (text[i] !== "[" || text[i + 1] === "[") return null;
  const close = text.indexOf("]", i + 1);
  if (close <= i + 1 || text.slice(i + 1, close).includes("[") || text.slice(i + 1, close).includes("\n")) return null;
  if (!text.startsWith("{.", close + 1)) return null;
  const shut = text.indexOf("}", close + 3);
  if (shut === -1) return null;
  const name = text.slice(close + 3, shut);
  const highlight = name.startsWith("hl-");
  const color = highlight ? name.slice(3) : name;
  if (!isColor(color)) return null;
  return { words: text.slice(i + 1, close), color, highlight, end: shut + 1 };
}

// How many colour and highlight marks a text holds. Nova's editor uses it to
// keep a rewrite from quietly dropping the learner's colouring. Pure.
export function formattingMarks(text: string): number {
  let n = 0;
  for (let i = text.indexOf("["); i !== -1; i = text.indexOf("[", i + 1)) if (colorSpanAt(text, i)) n++;
  for (let i = text.indexOf("=="); i !== -1; ) {
    const end = text.indexOf("==", i + 2);
    if (end === -1) break;
    if (end > i + 2) n++;
    i = text.indexOf("==", end + 2);
  }
  return n;
}
