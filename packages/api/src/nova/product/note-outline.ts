// ─── A note's structure: blocks, references, placement and edits ──────────────
// Pure, and no imports, so the notes page and the server share it.
//
// A note is one Markdown text (NovaNote.body, the only copy). Its structure
// is read from that text, the same way on both sides:
//
//   noteBlocks      the text as blocks (a heading, a paragraph, a list, a
//                   block of code, a quote or callout, a rule), each with its
//                   exact range in the text and the heading it sits under.
//                   Block ids ("b3") hold for one text only.
//   NoteRef         a reference to a block of a given text: its range, a
//                   fingerprint of its words and its heading. resolveRef finds
//                   it in the text as it is now: in place, moved (the same
//                   words elsewhere, once), or stale (changed or gone). A
//                   stale reference is never pointed at other text.
//   noteSections    each heading with what belongs to it.
//   placementFor    where an addition belongs (under the section it is about,
//                   after the passage chosen, a summary section…), with the
//                   other places to choose from; resolvePlacement finds that
//                   place again in the text as it is when it is applied.
//   applyEdits      changes to ranges of the text, each checked against the
//                   words it was proposed on; one that no longer matches is
//                   refused, never applied somewhere else.
//
// No regex: text is read by characters (SKILL.md; the no-regex guard).

export type BlockKind = "heading" | "para" | "list" | "code" | "quote" | "rule";

export interface NoteBlock {
  id:        string;
  kind:      BlockKind;
  // 1 to 6 for a heading, else 0.
  level:     number;
  // [start, end) in the text: the block's lines, without the line break after.
  start:     number;
  end:       number;
  text:      string;
  // The heading it sits under (for a heading, itself), as plain words, and its id.
  heading:   string | null;
  headingId: string | null;
}

export interface NoteRef {
  block:   string;
  start:   number;
  end:     number;
  hash:    string;
  heading: string | null;
  // Its first words, to show.
  excerpt: string;
}

// ── Reading a text ────────────────────────────────────────────────────────────

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

// "## Title" → 2. "#tag" is not a heading.
export function headingLevel(line: string): number {
  const t = line.trimStart();
  let n = 0;
  while (t[n] === "#") n++;
  return n >= 1 && n <= 6 && t[n] === " " ? n : 0;
}

function isListLine(line: string): boolean {
  const t = line.trimStart();
  if (t.startsWith("- ") || t.startsWith("* ") || t.startsWith("+ ")) return true;
  let d = 0;
  while (isDigit(t[d])) d++;
  return d > 0 && (t[d] === "." || t[d] === ")") && t[d + 1] === " ";
}
const isRule = (line: string) => { const t = line.trim(); return t.length >= 3 && ([...t].every(c => c === "-") || [...t].every(c => c === "*")); };
const isFence = (line: string) => line.trimStart().startsWith("```");
const isQuote = (line: string) => line.trimStart().startsWith(">");
const blank = (line: string) => line.trim() === "";

// A heading's words, without its marks.
export function plainHeading(line: string): string {
  let t = line.trimStart();
  while (t.startsWith("#")) t = t.slice(1);
  let out = "";
  for (const c of t.trim()) if (c !== "*" && c !== "=" && c !== "`" && c !== "_") out += c;
  return out.trim();
}

export function noteBlocks(body: string): NoteBlock[] {
  const lines = body.split("\n");
  const starts: number[] = [];
  let at = 0;
  for (const l of lines) { starts.push(at); at += l.length + 1; }
  const blocks: NoteBlock[] = [];
  let heading: string | null = null, headingId: string | null = null;
  const push = (kind: BlockKind, from: number, to: number, level = 0) => {
    const start = starts[from]!, end = starts[to]! + lines[to]!.length;
    const id = `b${blocks.length + 1}`;
    if (kind === "heading") { heading = plainHeading(lines[from]!) || heading; headingId = id; }
    blocks.push({ id, kind, level, start, end, text: body.slice(start, end), heading, headingId });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (blank(line)) continue;
    if (isFence(line)) {
      let j = i + 1;
      while (j < lines.length && !isFence(lines[j]!)) j++;
      push("code", i, Math.min(j, lines.length - 1));
      i = j;
      continue;
    }
    const level = headingLevel(line);
    if (level) { push("heading", i, i, level); continue; }
    if (isRule(line)) { push("rule", i, i); continue; }
    if (isQuote(line)) {
      let j = i;
      while (j + 1 < lines.length && isQuote(lines[j + 1]!)) j++;
      push("quote", i, j);
      i = j;
      continue;
    }
    if (isListLine(line)) {
      // Items and the lines under them (indented, or wrapped), until a gap.
      let j = i;
      while (j + 1 < lines.length && !blank(lines[j + 1]!) && !headingLevel(lines[j + 1]!) && !isFence(lines[j + 1]!) && !isQuote(lines[j + 1]!)) j++;
      push("list", i, j);
      i = j;
      continue;
    }
    let j = i;
    while (j + 1 < lines.length && !blank(lines[j + 1]!) && !headingLevel(lines[j + 1]!) && !isFence(lines[j + 1]!) && !isQuote(lines[j + 1]!) && !isListLine(lines[j + 1]!)) j++;
    push("para", i, j);
    i = j;
  }
  return blocks;
}

// ── References ────────────────────────────────────────────────────────────────

// The words, in lower case with single spaces: what a fingerprint is of.
export function squash(text: string): string {
  let out = "", gap = false;
  for (const c of text.toLowerCase()) {
    if (c === " " || c === "\n" || c === "\t" || c === "\r") { gap = out.length > 0; continue; }
    if (gap) out += " ";
    out += c;
    gap = false;
  }
  return out;
}

// FNV-1a over the squashed words: the same words, the same fingerprint.
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (const c of squash(text)) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

export function excerptOf(text: string, max = 90): string {
  // A quote's or callout's own words: without its > marks, its "[!type] Title"
  // line, and heading marks inside it.
  const lines = text.split("\n").map(l => { let t = l.trimStart(); while (t.startsWith(">")) t = t.slice(1).trimStart(); return t; })
    .filter(l => !l.startsWith("[!"))
    .map(l => (headingLevel(l) ? plainHeading(l) : l));
  let t = squash(lines.join(" "));
  if (t.startsWith("- ")) t = t.slice(2);
  let plain = "";
  for (const c of t) if (c !== "*" && c !== "=" && c !== "`") plain += c;
  t = plain;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function refOf(block: NoteBlock): NoteRef {
  return { block: block.id, start: block.start, end: block.end, hash: fingerprint(block.text), heading: block.heading, excerpt: excerptOf(block.text) };
}

export type Resolved = { status: "exact" | "moved"; start: number; end: number; block: NoteBlock } | { status: "stale" };

// Where a reference is in the text as it is now. Only the same words count:
// in its place, or, once and only once, somewhere else.
export function resolveRef(body: string, ref: Pick<NoteRef, "start" | "end" | "hash">, blocks: NoteBlock[] = noteBlocks(body)): Resolved {
  const here = blocks.find(b => b.start === ref.start && b.end === ref.end);
  if (here && fingerprint(here.text) === ref.hash) return { status: "exact", start: here.start, end: here.end, block: here };
  const same = blocks.filter(b => fingerprint(b.text) === ref.hash);
  return same.length === 1 ? { status: "moved", start: same[0]!.start, end: same[0]!.end, block: same[0]! } : { status: "stale" };
}

// The block a place in the text falls in (a passage the learner chose).
export function blockAt(blocks: NoteBlock[], offset: number): NoteBlock | null {
  return blocks.find(b => offset >= b.start && offset <= b.end) ?? blocks.find(b => b.start >= offset) ?? null;
}

// ── Sections ──────────────────────────────────────────────────────────────────

export interface NoteSection {
  id:       string;
  title:    string;
  level:    number;
  hash:     string;
  // The heading line, the end of its own text (before its first subheading),
  // and the end of the section with everything under it.
  start:    number;
  ownEnd:   number;
  end:      number;
  parent:   string | null;
}

export function noteSections(body: string, blocks: NoteBlock[] = noteBlocks(body)): NoteSection[] {
  const heads = blocks.filter(b => b.kind === "heading");
  return heads.map((h, i) => {
    const later = heads.slice(i + 1);
    const next = later.find(x => x.level <= h.level);
    const sub = later[0] && later[0].level > h.level ? later[0] : null;
    const lastIn = (limit: number) => {
      const inside = blocks.filter(b => b.start >= h.start && b.end <= limit);
      return inside.length ? inside[inside.length - 1]!.end : h.end;
    };
    const end = lastIn(next ? next.start - 1 : body.length);
    const ownEnd = sub ? lastIn(sub.start - 1) : end;
    const parent = [...heads.slice(0, i)].reverse().find(x => x.level < h.level) ?? null;
    return { id: h.id, title: plainHeading(h.text), level: h.level, hash: fingerprint(h.text), start: h.start, ownEnd, end, parent: parent?.id ?? null };
  });
}

// ── Where an addition goes ────────────────────────────────────────────────────

// What is being added, so the place fits it: an explanation of something in
// the note, an example of it, a summary of the whole note, a subsection, or
// something else.
export type AdditionKind = "explanation" | "example" | "summary" | "subsection" | "other";

export interface PlacementHint {
  kind:     AdditionKind;
  // A heading of the note it belongs under, by its words (said by the
  // learner, or suggested by Nova and found in the note).
  heading?: string | null;
  // The passages it rests on.
  refs?:    NoteRef[];
  // The passage the learner chose: where it starts in the text.
  passage?: number | null;
  // A title for a new section, when one is made.
  title?:   string | null;
}

// A place, described so it can be found again in a changed text:
//   section      at the end of a section's own text (before its subheadings)
//   sectionAll   at the end of a section with everything under it
//   after        right after a block
//   newSection   a new heading, after the section named (null: at the top)
//   end          at the end of the note
export interface Placement {
  how:      "section" | "sectionAll" | "after" | "newSection" | "end";
  // The heading (or block) it is anchored on: its fingerprint and words.
  anchor:   { hash: string; words: string } | null;
  // The new section's heading line, for newSection, and whether it goes at
  // the start of the anchor (after its own text: the note's one title) or
  // after all of it.
  heading:  string | null;
  first?:   boolean;
  label:    string;
}

const lower = (s: string) => squash(s);
const SUMMARY_WORDS = ["summary", "overview", "key takeaways", "takeaways", "tl;dr", "tldr", "recap", "in short"];
const EXAMPLE_WORDS = ["example", "examples", "worked example", "for example"];

const under = (s: NoteSection, all = false): Placement => ({ how: all ? "sectionAll" : "section", anchor: { hash: s.hash, words: s.title }, heading: null, label: `Add under: ${s.title}` });

export function placementFor(body: string, hint: PlacementHint): { best: Placement; clear: boolean; options: Placement[] } {
  const blocks = noteBlocks(body);
  const sections = noteSections(body, blocks);
  const end: Placement = { how: "end", anchor: null, heading: null, label: "At the end of the note" };
  const options = [...sections.slice(0, 16).map(s => under(s, hint.kind === "subsection")), end];
  const pick = (best: Placement, clear = true) => ({ best, clear, options: [best, ...options.filter(o => o.label !== best.label || o.how !== best.how)] });
  const sectionOf = (id: string | null) => sections.find(s => s.id === id) ?? null;
  const named = (words: string) => sections.find(s => lower(s.title) === lower(words)) ?? null;
  const exampleIn = (s: NoteSection) => sections.find(x => x.parent === s.id && EXAMPLE_WORDS.some(w => lower(x.title).includes(w))) ?? null;
  const fit = (s: NoteSection) => (hint.kind === "example" ? (exampleIn(s) ? under(exampleIn(s)!) : under(s)) : under(s, hint.kind === "subsection"));

  // 1. A heading they named (or Nova found) that is in the note.
  if (hint.heading) { const s = named(hint.heading); if (s) return pick(fit(s)); }
  // 2. The passage they chose: right after it, in its section.
  if (typeof hint.passage === "number") {
    const b = blockAt(blocks, hint.passage);
    if (b && b.kind !== "heading") return pick({ how: "after", anchor: { hash: fingerprint(b.text), words: excerptOf(b.text, 60) }, heading: null, label: b.heading ? `Insert after the passage you chose, in ${b.heading}` : "Insert after the passage you chose" });
    if (b && b.kind === "heading") { const s = sectionOf(b.id); if (s) return pick(fit(s)); }
  }
  // 3. A summary of the whole note: its summary or overview section, else a new one at the top.
  if (hint.kind === "summary") {
    const s = sections.find(x => SUMMARY_WORDS.some(w => lower(x.title) === w || lower(x.title).startsWith(`${w} `) || lower(x.title).endsWith(` ${w}`)));
    if (s) return pick(under(s));
    const top = sections[0] && sections[0].level === 1 && sections.filter(x => x.level === 1).length === 1 ? sections[0] : null;
    const level = top ? 2 : sections.length ? Math.max(1, Math.min(...sections.map(x => x.level))) : 2;
    return pick({ how: "newSection", anchor: top ? { hash: top.hash, words: top.title } : null, heading: `${"#".repeat(level)} ${hint.title?.trim() || "Summary"}`, first: Boolean(top), label: `New section: ${hint.title?.trim() || "Summary"}, ${top ? `at the start of ${top.title}` : "at the top"}` });
  }
  // 4. The passages it rests on: their section.
  for (const r of hint.refs ?? []) {
    const found = resolveRef(body, r, blocks);
    if (found.status === "stale") continue;
    const s = sectionOf(found.block.headingId);
    if (s) return pick(fit(s));
  }
  // 5. A note with no headings: the end is the only place there is.
  if (sections.length === 0) return pick(end);
  // 6. Nothing says where: a new section at the end, offered with the others to choose from.
  const title = hint.title?.trim() || "From Nova";
  const level = Math.max(1, Math.min(...sections.map(x => x.level)));
  const last = [...sections].reverse().find(x => x.level === level)!;
  return pick({ how: "newSection", anchor: { hash: last.hash, words: last.title }, heading: `${"#".repeat(level === 1 && sections.filter(x => x.level === 1).length === 1 ? 2 : level)} ${title}`, label: `New section: ${title}, at the end` }, false);
}

// The offset a placement stands for in the text as it is now. null: what it
// was anchored on is not there any more (changed or deleted).
export function resolvePlacement(body: string, p: Placement): number | null {
  if (p.how === "end") return body.length;
  const blocks = noteBlocks(body);
  if (p.how === "after") {
    const same = blocks.filter(b => fingerprint(b.text) === p.anchor?.hash);
    return same.length === 1 ? same[0]!.end : null;
  }
  const sections = noteSections(body, blocks);
  if (p.how === "newSection" && !p.anchor) {
    // At the top: before the first heading, or at the start.
    return sections.length ? sections[0]!.start : 0;
  }
  const same = sections.filter(s => s.hash === p.anchor!.hash);
  const s = same.length === 1 ? same[0]! : sections.filter(x => lower(x.title) === lower(p.anchor!.words)).length === 1 ? sections.find(x => lower(x.title) === lower(p.anchor!.words))! : null;
  if (!s) return null;
  if (p.how === "section") return s.ownEnd;
  if (p.how === "sectionAll") return s.end;
  // A new section: at the top of the note's one title (after its own text),
  // or after the section named.
  return p.first ? s.ownEnd : s.end;
}

// The addition, at that offset, on lines of its own; a new section gets its heading.
export function insertAt(body: string, at: number, markdown: string, heading: string | null = null): { body: string; start: number; end: number } {
  const addition = heading ? `${heading}\n\n${markdown.trim()}` : markdown.trim();
  const head = body.slice(0, at).trimEnd();
  let rest = body.slice(at);
  while (rest.startsWith("\n")) rest = rest.slice(1);
  const before = head ? `${head}\n\n` : "";
  const out = `${before}${addition}${rest ? `\n\n${rest}` : "\n"}`;
  return { body: out, start: before.length, end: before.length + addition.length };
}

// Whether the note already holds these words (an addition made twice).
export const alreadyIn = (body: string, markdown: string) => squash(markdown).length > 20 && squash(body).includes(squash(markdown));

// ── Edits ─────────────────────────────────────────────────────────────────────

// One change to the text, as proposed on a version of it: the range and the
// words there then (before), and what replaces them (after). An insertion
// has before "" and start = end; it is anchored on the block it follows
// (anchor, its fingerprint; null: the top of the note).
export interface EditChange {
  id:      string;
  op:      "replace" | "insert" | "delete";
  start:   number;
  end:     number;
  before:  string;
  after:   string;
  anchor:  string | null;
  // The section it is in, to say where it goes.
  section: string | null;
  why:     string | null;
}

// already: changes whose result is in the text already (an apply sent twice,
// or the learner made the change by hand): skipped, never made twice.
export type EditResult =
  | { ok: true; body: string; applied: string[]; already: string[] }
  | { ok: false; conflicts: string[] };

// Whether a change's result already stands in the text: its words are there
// (an insertion; a replacement whose new words are there once, with the old
// ones nowhere outside them, as when an expansion keeps the sentence it
// expands), or the words a deletion removes are not there any more.
export function isApplied(body: string, c: EditChange): boolean {
  if (c.op === "insert") return alreadyIn(body, c.after);
  const after = c.after.trim();
  const at = after ? body.indexOf(after) : -1;
  const once = at !== -1 && body.indexOf(after, at + 1) === -1;
  let i = c.before ? body.indexOf(c.before) : -1;
  if (i === -1) return c.op === "delete" || once;
  if (c.op === "delete" || !once) return false;
  for (; i !== -1; i = body.indexOf(c.before, i + 1)) if (i < at || i + c.before.length > at + after.length) return false;
  return true;
}

// The changes, each found again in the text as it is now: in place, or the
// same words found once elsewhere (an insertion: after the same block). If
// any cannot be found, nothing is applied and those are named.
// Where a change's words (or, for an insertion, the block it follows) are in
// the text as it is now. null: not there, or there more than once.
export function locateChange(body: string, c: EditChange, blocks: NoteBlock[] = noteBlocks(body)): { start: number; end: number } | null {
  if (c.op === "insert") {
    if (c.anchor === null) return { start: 0, end: 0 };
    const same = blocks.filter(b => fingerprint(b.text) === c.anchor);
    return same.length === 1 ? { start: same[0]!.end, end: same[0]!.end } : null;
  }
  if (body.slice(c.start, c.end) === c.before) return { start: c.start, end: c.end };
  const first = c.before ? body.indexOf(c.before) : -1;
  return first !== -1 && body.indexOf(c.before, first + 1) === -1 ? { start: first, end: first + c.before.length } : null;
}

export function applyEdits(body: string, changes: EditChange[]): EditResult {
  const blocks = noteBlocks(body);
  const placed: Array<{ c: EditChange; start: number; end: number }> = [];
  const conflicts: string[] = [], already: string[] = [];
  for (const c of changes) {
    if (isApplied(body, c)) { already.push(c.id); continue; }
    const at = locateChange(body, c, blocks);
    if (at) placed.push({ c, ...at });
    else conflicts.push(c.id);
  }
  if (conflicts.length) return { ok: false, conflicts };
  // Two changes on the same words cannot both be applied.
  const sorted = [...placed].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.start < sorted[i - 1]!.end) return { ok: false, conflicts: [sorted[i]!.c.id] };
  let out = body;
  for (const { c, start, end } of [...sorted].reverse()) {
    if (c.op === "insert") out = insertAt(out, start, c.after).body;
    else {
      const replacement = c.op === "delete" ? "" : c.after.trim();
      let head = out.slice(0, start), tail = out.slice(end);
      if (!replacement) { head = head.trimEnd(); while (tail.startsWith("\n")) tail = tail.slice(1); out = head && tail ? `${head}\n\n${tail}` : `${head}${tail}`; }
      else out = `${head}${replacement}${tail}`;
    }
  }
  return { ok: true, body: out, applied: placed.map(p => p.c.id), already };
}
