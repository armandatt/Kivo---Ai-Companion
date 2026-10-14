// ─── Links between notes ──────────────────────────────────────────────────────
// A learner links one note to another by writing its title in double square
// brackets: [[Deadlocks summary]], or [[Deadlocks summary|the summary]] to
// show other words. The link is the text they wrote. Nothing infers a link,
// nothing is stored besides the body, and removing the brackets removes it.
//
// Pure, character checks only, and no imports: the web app reads the same
// rules to draw a link, so the page and the server never disagree on one.

// Longest title a link may name: the same limit a note's title has.
export const NOTE_LINK_TITLE_MAX = 200;

export interface NoteLinkToken {
  kind:   "text" | "link";
  text:   string;          // what is shown
  // For a link: the title it names, as written (trimmed, single-spaced).
  target?: string;
}

// Trimmed, with each run of whitespace made one space.
function collapse(s: string): string {
  let out = "";
  let gap = false;
  for (const ch of s) {
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\u00a0") { gap = out.length > 0; continue; }
    if (gap) { out += " "; gap = false; }
    out += ch;
  }
  return out;
}

// How two titles are compared: trimmed, single-spaced, any case.
export const linkKey = (title: string): string => collapse(title).toLowerCase();

// The text of one line split into plain runs and links. A "[[" with no
// closing "]]" on the same line, an empty link, or one longer than a title can
// be is left as the text it is.
export function tokenizeLine(line: string): NoteLinkToken[] {
  const out: NoteLinkToken[] = [];
  let text = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] === "[" && line[i + 1] === "[") {
      const close = line.indexOf("]]", i + 2);
      if (close !== -1) {
        const inner = line.slice(i + 2, close);
        const bar = inner.indexOf("|");
        const target = collapse(bar === -1 ? inner : inner.slice(0, bar));
        const shown  = bar === -1 ? target : collapse(inner.slice(bar + 1)) || target;
        if (target && target.length <= NOTE_LINK_TITLE_MAX && !inner.includes("[[")) {
          if (text) { out.push({ kind: "text", text }); text = ""; }
          out.push({ kind: "link", text: shown, target });
          i = close + 2;
          continue;
        }
      }
    }
    text += line[i];
    i++;
  }
  if (text) out.push({ kind: "text", text });
  return out;
}

// Every title a body links to, once each, in the order first written. Links
// inside a fenced code block (``` lines) are code, not links.
export function linkedTitles(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let inCode = false;
  for (const line of body.split("\n")) {
    if (line.trimStart().startsWith("```")) { inCode = !inCode; continue; }
    if (inCode) continue;
    for (const t of tokenizeLine(line)) {
      if (t.kind !== "link" || !t.target) continue;
      const key = linkKey(t.target);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t.target);
    }
  }
  return out;
}

// Whether a body links to a title.
export const linksTo = (body: string, title: string): boolean =>
  linkedTitles(body).some(t => linkKey(t) === linkKey(title));

// The line around the first link to a title, for a backlink's preview.
export function linkContext(body: string, title: string, max = 160): string {
  const key = linkKey(title);
  for (const line of body.split("\n")) {
    if (tokenizeLine(line).some(t => t.kind === "link" && t.target && linkKey(t.target) === key)) {
      const flat = collapse(line);
      return flat.length <= max ? flat : `${flat.slice(0, max).trimEnd()}…`;
    }
  }
  return "";
}
