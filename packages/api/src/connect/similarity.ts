// ─── Kivo Connect: how alike two pieces of knowledge are (pure) ───────────────
// Word overlap, not meaning. Kivo has no embeddings or full-text index, so
// this is keyword comparison and is reported as such ("basis": "keyword").
// It sorts what an assistant proposes to save against what the learner has:
//   exact_duplicate  the text is already in the note
//   same_concept     the same title, or titles sharing most of their words
//   related          some shared words in the title, or a fair share in the text
//   new              nothing on record is close
// The assistant decides what to do with "same_concept" (enrich the note) and
// "related" (link it); nothing is discarded because a concept already exists.

const STOP = new Set(("a an and are as at be by for from has have how i in is it its of on or that the this to was what when where which who why will with " +
  "you your we our they their them not no but if then than so do does did can could should would into about over under between using use used via vs").split(" "));

export function words(text: string): string[] {
  return (text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9][a-z0-9+#.-]*/g) ?? [])
    .map(w => w.replace(/[.-]+$/, ""))
    .filter(w => w.length > 1 && !STOP.has(w))
    .map(w => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

export const keyTerms = (text: string, max = 6): string[] => {
  const counts = new Map<string, number>();
  for (const w of words(text)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, max).map(([w]) => w);
};

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const x = new Set(a), y = new Set(b);
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

// Text compared for "already there": lines unified, spaces and case folded,
// Markdown emphasis and quote marks ignored.
export const flat = (s: string) => s.replace(/\r\n?/g, "\n").replace(/^>\s?/gm, "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

export type Overlap = "exact_duplicate" | "same_concept" | "related" | "new";

export interface Comparison { overlap: Overlap; titleScore: number; textScore: number }

export function compare(candidate: { title: string; body: string }, existing: { title: string; body: string }): Comparison {
  const titleScore = jaccard(words(candidate.title), words(existing.title));
  const textScore  = jaccard(words(candidate.body), words(existing.body));
  const body = flat(candidate.body);
  if (body.length >= 40 && flat(existing.body).includes(body)) return { overlap: "exact_duplicate", titleScore, textScore };
  if (flat(candidate.title) === flat(existing.title) || titleScore >= 0.6) return { overlap: "same_concept", titleScore, textScore };
  if (titleScore >= 0.25 || textScore >= 0.18) return { overlap: "related", titleScore, textScore };
  return { overlap: "new", titleScore, textScore };
}

const RANK: Record<Overlap, number> = { exact_duplicate: 3, same_concept: 2, related: 1, new: 0 };

// The closest of the learner's notes, and every related one (up to `max`).
export function closest<T extends { title: string; body: string }>(candidate: { title: string; body: string }, notes: T[], max = 5): Array<{ note: T } & Comparison> {
  return notes
    .map(note => ({ note, ...compare(candidate, note) }))
    .filter(c => c.overlap !== "new")
    .sort((a, b) => RANK[b.overlap] - RANK[a.overlap] || (b.titleScore + b.textScore) - (a.titleScore + a.textScore))
    .slice(0, max);
}

// A short stretch of text around the first matching word, for search results.
export function snippet(body: string, terms: string[], width = 220): string {
  const text = body.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) { const i = lower.indexOf(t.toLowerCase()); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return text.length <= width ? text : `${text.slice(0, width).trimEnd()}…`;
  const start = Math.max(0, at - Math.floor(width / 3));
  const out = text.slice(start, start + width).trim();
  return `${start > 0 ? "…" : ""}${out}${start + width < text.length ? "…" : ""}`;
}

// Search score: a title match counts more than one in the text.
export function searchScore(q: string, item: { title: string; text?: string }): number {
  const terms = words(q);
  if (terms.length === 0) return 0;
  const tw = new Set(words(item.title)), bw = new Set(words(item.text ?? ""));
  let s = 0;
  for (const t of terms) { if (tw.has(t)) s += 3; else if (item.title.toLowerCase().includes(t)) s += 2; if (bw.has(t)) s += 1; }
  if (item.title.toLowerCase().includes(q.trim().toLowerCase())) s += 3;
  return s / (terms.length * 7);
}
