// One accent per subject, the same on every page: chosen from the subject's
// name (trimmed, any case), so Today, the Knowledge Space, its board and the
// task list agree without asking the server. Six hues, none of them amber or
// rose, which mean "due" and "late" here. The class names are written out in
// full so Tailwind keeps them. Light theme darkens the text tones in
// globals.css. Two subjects can share a hue; the name is always beside it.

export interface SubjectColor {
  dot:    string   // a small mark beside the name
  text:   string   // the subject's name or a label in its colour
  tint:   string   // a faint fill behind a subject's area
  border: string   // the edge of something that belongs to the subject
  bar:    string   // a solid fill
}

const PALETTE: SubjectColor[] = [
  { dot: 'bg-sky-400',     text: 'text-sky-300',     tint: 'bg-sky-400/8',     border: 'border-sky-400/35',     bar: 'bg-sky-400' },
  { dot: 'bg-violet-400',  text: 'text-violet-300',  tint: 'bg-violet-400/8',  border: 'border-violet-400/35',  bar: 'bg-violet-400' },
  { dot: 'bg-orange-400',  text: 'text-orange-300',  tint: 'bg-orange-400/8',  border: 'border-orange-400/35',  bar: 'bg-orange-400' },
  { dot: 'bg-emerald-400', text: 'text-emerald-300', tint: 'bg-emerald-400/8', border: 'border-emerald-400/35', bar: 'bg-emerald-400' },
  { dot: 'bg-indigo-400',  text: 'text-indigo-300',  tint: 'bg-indigo-400/8',  border: 'border-indigo-400/35',  bar: 'bg-indigo-400' },
  { dot: 'bg-pink-400',    text: 'text-pink-300',    tint: 'bg-pink-400/8',    border: 'border-pink-400/35',    bar: 'bg-pink-400' },
]

export function subjectColor(subjectName: string | null | undefined): SubjectColor {
  const key = (subjectName ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}
