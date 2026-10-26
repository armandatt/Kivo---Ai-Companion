// ─── Reading a paper's markup into a note ─────────────────────────────────────
// Pure, no imports. What the sources Kivo imports from send is HTML or XML:
// arXiv's API answers in Atom, arXiv's HTML version of a paper is LaTeXML,
// Europe PMC's open-access full text is JATS, a publisher's page carries its
// citation_* meta tags. This reads them by characters (no regex, no parser
// dependency) into a small tree, and turns a paper's text into the note's
// Markdown, keeping what the note can show:
//   sections and subsections as ## / ### / #### headings (with their numbers);
//   paragraphs; lists; tables as Markdown tables; code as ``` blocks;
//   equations as LaTeX, $…$ inline and $$…$$ on lines of their own (with the
//   equation's number); figures by their captions ("Figure 2: …"; images are
//   not imported); references as a list.
// Footnote marks, page furniture and scripts are left out. The markup is
// untrusted text: nothing in it is run or followed, and it only ever becomes
// note text, which the reader draws as text.

export interface MarkupElement { tag: string; attrs: Record<string, string>; children: MarkupNode[] }
export type MarkupNode = MarkupElement | string;

const VOID = new Set(["br", "hr", "img", "meta", "link", "input", "col", "source", "wbr", "area", "base", "embed", "param", "track"]);
const RAW = new Set(["script", "style", "noscript", "template"]);
// An open <p> (or <li>, <tr>, <td>) ends where another of these starts.
const CLOSES_P = new Set(["p", "div", "ul", "ol", "table", "section", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "article"]);

const isSpace = (c: string | undefined) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const isNameStart = (c: string | undefined) => c !== undefined && (c.toLowerCase() !== c.toUpperCase() || c === "_");
// "arxiv:doi" → "doi", "jats:p" → "p", "mml:math" → "math".
const local = (name: string) => { const at = name.lastIndexOf(":"); return at === -1 ? name : name.slice(at + 1); };

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", times: "×", minus: "−", plusmn: "±", deg: "°", middot: "·", bull: "•", copy: "©", reg: "®",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", theta: "θ", omega: "ω",
  le: "≤", ge: "≥", ne: "≠", asymp: "≈", infin: "∞", rarr: "→", larr: "←", thinsp: " ", ensp: " ", emsp: " ", zwnj: "", zwj: "", shy: "",
};

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "&") { out += s[i]; continue; }
    const end = s.indexOf(";", i);
    if (end === -1 || end - i > 12) { out += "&"; continue; }
    const name = s.slice(i + 1, end);
    let ch: string | undefined;
    if (name.startsWith("#x") || name.startsWith("#X")) { const n = parseInt(name.slice(2), 16); ch = Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : undefined; }
    else if (name.startsWith("#")) { const n = parseInt(name.slice(1), 10); ch = Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : undefined; }
    else ch = NAMED[name] ?? NAMED[name.toLowerCase()];
    if (ch === undefined) { out += "&"; continue; }
    out += ch; i = end;
  }
  return out;
}

// The tree. html: HTML's own rules (void elements, script contents, a <p>
// closed by the next block); otherwise XML, where only what is written counts.
export function parseMarkup(src: string, html = true): MarkupElement {
  const root: MarkupElement = { tag: "#root", attrs: {}, children: [] };
  const stack: MarkupElement[] = [root];
  const top = () => stack[stack.length - 1]!;
  const n = src.length;
  let lowered: string | null = null;
  let i = 0;
  const text = (t: string) => { if (t) top().children.push(decodeEntities(t)); };
  const closeTo = (name: string) => {
    for (let k = stack.length - 1; k > 0; k--) if (stack[k]!.tag === name) { stack.length = k; return; }
  };
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt === -1) { text(src.slice(i)); break; }
    if (lt > i) text(src.slice(i, lt));
    if (src.startsWith("<!--", lt)) { const e = src.indexOf("-->", lt + 4); i = e === -1 ? n : e + 3; continue; }
    if (src.startsWith("<![CDATA[", lt)) { const e = src.indexOf("]]>", lt + 9); top().children.push(src.slice(lt + 9, e === -1 ? n : e)); i = e === -1 ? n : e + 3; continue; }
    if (src[lt + 1] === "!" || src[lt + 1] === "?") { const e = src.indexOf(">", lt); i = e === -1 ? n : e + 1; continue; }
    if (src[lt + 1] === "/") {
      const e = src.indexOf(">", lt);
      closeTo(local(src.slice(lt + 2, e === -1 ? n : e).trim().toLowerCase()));
      i = e === -1 ? n : e + 1;
      continue;
    }
    if (!isNameStart(src[lt + 1])) { text("<"); i = lt + 1; continue; }
    let j = lt + 1;
    while (j < n && !isSpace(src[j]) && src[j] !== ">" && src[j] !== "/") j++;
    const name = local(src.slice(lt + 1, j).toLowerCase());
    const attrs: Record<string, string> = {};
    let selfClose = false;
    while (j < n) {
      while (j < n && isSpace(src[j])) j++;
      if (src[j] === ">") { j++; break; }
      if (src[j] === "/") { selfClose = true; j++; continue; }
      let k = j;
      while (k < n && !isSpace(src[k]) && src[k] !== "=" && src[k] !== ">" && src[k] !== "/") k++;
      const attr = src.slice(j, k).toLowerCase();
      j = k;
      while (j < n && isSpace(src[j])) j++;
      let value = "";
      if (src[j] === "=") {
        j++;
        while (j < n && isSpace(src[j])) j++;
        const q = src[j];
        if (q === "\"" || q === "'") { const e = src.indexOf(q, j + 1); value = src.slice(j + 1, e === -1 ? n : e); j = e === -1 ? n : e + 1; }
        else { let e = j; while (e < n && !isSpace(src[e]) && src[e] !== ">") e++; value = src.slice(j, e); j = e; }
      }
      if (attr) attrs[local(attr)] = decodeEntities(value);
      else if (j < n && src[j] !== ">") j++;
      selfClose = false;
    }
    if (html) {
      const open = top().tag;
      if (open === "p" && CLOSES_P.has(name)) stack.pop();
      else if (name === "li" && open === "li") stack.pop();
      else if ((name === "td" || name === "th") && (open === "td" || open === "th")) stack.pop();
      else if (name === "tr" && (open === "td" || open === "th")) { stack.pop(); if (top().tag === "tr") stack.pop(); }
      else if (name === "tr" && open === "tr") stack.pop();
    }
    const el: MarkupElement = { tag: name, attrs, children: [] };
    top().children.push(el);
    i = j;
    if (html && RAW.has(name)) {
      lowered ??= src.toLowerCase();
      const close = lowered.indexOf(`</${name}`, j);
      const e = close === -1 ? n : src.indexOf(">", close);
      i = e === -1 ? n : e + 1;
      continue;
    }
    if (selfClose || (html && VOID.has(name))) continue;
    stack.push(el);
  }
  return root;
}

// ── Finding things ────────────────────────────────────────────────────────────

const isEl = (x: MarkupNode): x is MarkupElement => typeof x !== "string";
export const hasClass = (el: MarkupElement, c: string) => (el.attrs.class ?? "").split(" ").includes(c);

export function findAll(el: MarkupElement, pred: (e: MarkupElement) => boolean, out: MarkupElement[] = []): MarkupElement[] {
  for (const c of el.children) if (isEl(c)) { if (pred(c)) out.push(c); findAll(c, pred, out); }
  return out;
}
export function findFirst(el: MarkupElement, pred: (e: MarkupElement) => boolean): MarkupElement | null {
  for (const c of el.children) if (isEl(c)) { if (pred(c)) return c; const f = findFirst(c, pred); if (f) return f; }
  return null;
}
export const childrenNamed = (el: MarkupElement, tag: string) => el.children.filter((c): c is MarkupElement => isEl(c) && c.tag === tag);

// One line of words: runs of white space become one space.
export function squashSpace(s: string): string {
  let out = "", gap = false;
  for (const c of s) {
    if (isSpace(c) || c === " ") { gap = out.length > 0; continue; }
    if (gap) out += " ";
    out += c; gap = false;
  }
  return out;
}
export function rawText(node: MarkupNode): string {
  return typeof node === "string" ? node : node.children.map(rawText).join("");
}
export const textOf = (node: MarkupNode) => squashSpace(rawText(node));

// ── Atom (arXiv's API) ────────────────────────────────────────────────────────

export interface AtomEntry { id: string; title: string; summary: string; authors: string[]; published: string | null; updated: string | null; doi: string | null; journalRef: string | null; categories: string[]; pdf: string | null }

export function readAtom(xml: string): AtomEntry[] {
  const root = parseMarkup(xml, false);
  return findAll(root, e => e.tag === "entry").map(e => {
    const one = (tag: string) => { const x = findFirst(e, c => c.tag === tag); return x ? textOf(x) : null; };
    const links = findAll(e, c => c.tag === "link");
    return {
      id: one("id") ?? "", title: one("title") ?? "", summary: one("summary") ?? "",
      authors: findAll(e, c => c.tag === "author").map(a => { const name = findFirst(a, c => c.tag === "name"); return name ? textOf(name) : ""; }).filter(Boolean),
      published: one("published"), updated: one("updated"), doi: one("doi"), journalRef: one("journal_ref"),
      categories: findAll(e, c => c.tag === "category").map(c => c.attrs.term ?? "").filter(Boolean),
      pdf: links.find(l => l.attrs.title === "pdf")?.attrs.href ?? null,
    };
  });
}

// ── A page's own description of the paper (citation_* meta tags) ──────────────

export function readMeta(html: string): Map<string, string[]> {
  const root = parseMarkup(html, true);
  const meta = new Map<string, string[]>();
  for (const m of findAll(root, e => e.tag === "meta")) {
    const name = (m.attrs.name ?? m.attrs.property ?? "").toLowerCase();
    const content = m.attrs.content;
    if (!name || content === undefined) continue;
    const v = squashSpace(content);
    if (!v) continue;
    meta.set(name, [...(meta.get(name) ?? []), v]);
  }
  return meta;
}

// ── A paper's text, as blocks, then Markdown ──────────────────────────────────

export type PaperBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "math"; tex: string; tag: string | null }
  | { kind: "code"; text: string }
  | { kind: "table"; caption: string | null; rows: string[][] }
  | { kind: "caption"; text: string }
  | { kind: "quote"; text: string };

// Text in a table cell, one line, no column marks.
const cell = (s: string) => squashSpace(s).split("|").join("∣");

function cleanTex(s: string): string {
  let t = squashSpace(s);
  // LaTeXML's alttext carries "\displaystyle" for display maths.
  if (t.startsWith("\\displaystyle")) t = t.slice("\\displaystyle".length).trim();
  return t.split("$").join("\\$");
}

interface InlineRules {
  skip:   (el: MarkupElement) => boolean;
  // TeX for a maths element, or null when it is not one.
  math:   (el: MarkupElement) => string | null;
}

function inlineText(node: MarkupNode, rules: InlineRules): string {
  if (typeof node === "string") return node;
  if (rules.skip(node)) return "";
  const tex = rules.math(node);
  if (tex !== null) return tex ? ` $${tex}$ ` : "";
  const inner = node.children.map(c => inlineText(c, rules)).join("");
  const t = node.tag;
  if (t === "br") return " ";
  const words = squashSpace(inner);
  if (!words) return inner.length ? " " : "";
  const pad = (s: string) => `${isSpace(inner[0]) ? " " : ""}${s}${isSpace(inner[inner.length - 1]) ? " " : ""}`;
  if (t === "em" || t === "i" || t === "italic") return pad(`*${words}*`);
  if (t === "strong" || t === "b" || t === "bold") return pad(`**${words}**`);
  if (t === "code" || t === "tt" || t === "monospace" || t === "kbd" || t === "samp") return pad(`\`${words.split("`").join("'")}\``);
  if (t === "sup") return words.length <= 6 ? `^${words}` : ` ^(${words})`;
  if (t === "sub") return words.length <= 6 ? `_${words}` : ` _(${words})`;
  return inner;
}

// A line of inline text. Maths is padded with spaces so it never runs into a
// word; the space it leaves before punctuation ("$x$ ,") is taken out again.
function inlineLine(nodes: MarkupNode[], rules: InlineRules): string {
  const t = squashSpace(nodes.map(n => inlineText(n, rules)).join(""));
  let out = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === " " && out.endsWith("$") && ",.;:)]".includes(t[i + 1] ?? "x")) continue;
    if (t[i] === " " && (out.endsWith("(") || out.endsWith("[")) && t[i + 1] === "$") continue;
    out += t[i];
  }
  return out;
}

export function blocksToMarkdown(blocks: PaperBlock[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind === "heading") out.push(`${"#".repeat(Math.min(Math.max(b.level, 2), 4))} ${b.text}`);
    else if (b.kind === "para") out.push(b.text);
    else if (b.kind === "caption") out.push(`*${b.text.split("*").join("")}*`);
    else if (b.kind === "quote") out.push(`> ${b.text}`);
    else if (b.kind === "list") out.push(b.items.map((it, i) => `${b.ordered ? `${i + 1}.` : "-"} ${it}`).join("\n"));
    else if (b.kind === "math") out.push(`$$\n${b.tex}\n$$${b.tag ? ` ${b.tag}` : ""}`);
    else if (b.kind === "code") out.push(`\`\`\`\n${b.text.split("```").join("ʼʼʼ")}\n\`\`\``);
    else if (b.kind === "table") {
      const rows = b.rows.filter(r => r.some(Boolean));
      if (!rows.length) continue;
      const width = Math.max(...rows.map(r => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
      out.push([b.caption ? `*${b.caption.split("*").join("")}*\n` : "", line(rows[0]!), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n").trim());
    }
  }
  return out.join("\n\n");
}

// Inline runs gathered into paragraphs, block children handled by `block`.
function walk(el: MarkupElement, isBlock: (e: MarkupElement) => boolean, block: (e: MarkupElement, out: PaperBlock[]) => void, rules: InlineRules, out: PaperBlock[]): void {
  let run: MarkupNode[] = [];
  const flush = () => {
    const text = inlineLine(run, rules);
    // A run of spacing (or a lone mark) is not a paragraph.
    if ([...text].some(c => c.toLowerCase() !== c.toUpperCase() || isDigit(c))) out.push({ kind: "para", text });
    run = [];
  };
  for (const c of el.children) {
    if (typeof c !== "string" && rules.skip(c)) continue;
    if (typeof c !== "string" && isBlock(c)) { flush(); block(c, out); }
    else run.push(c);
  }
  flush();
}

// ── arXiv's HTML version (LaTeXML) ────────────────────────────────────────────

const LTX_SKIP = ["ltx_page_header", "ltx_page_footer", "ltx_authors", "ltx_title_document", "ltx_abstract", "ltx_TOC", "ltx_note_outer", "ltx_note_mark",
  "ltx_ERROR", "ltx_dates", "ltx_page_navbar", "ltx_role_affiliation", "ltx_keywords", "ltx_classification", "ltx_acknowledgements_off"];
const HTML_SKIP_TAGS = new Set(["script", "style", "nav", "button", "svg", "img", "picture", "form", "input", "noscript", "header", "footer", "aside", "annotation", "annotation-xml"]);
const HTML_BLOCK = new Set(["section", "article", "div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "figure", "pre", "blockquote", "dl", "hr", "main", "body", "html"]);

const ltxRules: InlineRules = {
  skip: el => HTML_SKIP_TAGS.has(el.tag) || LTX_SKIP.some(c => hasClass(el, c)),
  math: el => (el.tag === "math" ? cleanTex(el.attrs.alttext ?? textOf(el)) : null),
};

function htmlTable(el: MarkupElement, caption: string | null, rules: InlineRules): PaperBlock {
  const rows = findAll(el, e => e.tag === "tr").map(tr => tr.children.filter((c): c is MarkupElement => isEl(c) && (c.tag === "td" || c.tag === "th")).map(td => cell(inlineLine(td.children, rules))));
  return { kind: "table", caption, rows };
}

function ltxBlock(el: MarkupElement, out: PaperBlock[]): void {
  const t = el.tag;
  if (t === "h1" || t === "h2" || t === "h3" || t === "h4" || t === "h5" || t === "h6") {
    const text = inlineLine(el.children, ltxRules);
    if (!text) return;
    const level = Number(t[1]);
    if (level >= 5) out.push({ kind: "para", text: `**${text.split("*").join("")}**` });
    else out.push({ kind: "heading", level: Math.max(2, level), text });
    return;
  }
  if (t === "hr") return;
  if (t === "table" && (hasClass(el, "ltx_equation") || hasClass(el, "ltx_equationgroup") || hasClass(el, "ltx_eqn_table"))) {
    const tex = findAll(el, e => e.tag === "math").map(m => cleanTex(m.attrs.alttext ?? textOf(m))).filter(Boolean);
    const tag = findFirst(el, e => hasClass(e, "ltx_tag_equation"));
    if (tex.length) out.push({ kind: "math", tex: tex.join(" \\\\ "), tag: tag ? textOf(tag) : null });
    return;
  }
  if (t === "math") { const tex = cleanTex(el.attrs.alttext ?? textOf(el)); if (tex) out.push({ kind: "math", tex, tag: null }); return; }
  if (t === "figure") {
    const cap = findFirst(el, e => e.tag === "figcaption");
    const caption = cap ? inlineLine(cap.children, ltxRules) : null;
    const table = findFirst(el, e => e.tag === "table" && !hasClass(e, "ltx_equation"));
    if (hasClass(el, "ltx_table") && table) out.push(htmlTable(table, caption, ltxRules));
    else if (caption) out.push({ kind: "caption", text: caption });
    return;
  }
  if (t === "table") { out.push(htmlTable(el, null, ltxRules)); return; }
  if (t === "ul" || t === "ol") {
    if (hasClass(el, "ltx_biblist")) {
      const items = childrenNamed(el, "li").map(li => inlineLine(li.children, ltxRules)).filter(Boolean);
      if (items.length) out.push({ kind: "list", ordered: false, items });
      return;
    }
    const items = childrenNamed(el, "li").map(li => {
      // A tag of LaTeXML's ("1.", "•") is the list's own mark.
      const kids = li.children.filter(c => typeof c === "string" || !hasClass(c, "ltx_tag_item"));
      return inlineLine(kids, ltxRules);
    }).filter(Boolean);
    if (items.length) out.push({ kind: "list", ordered: t === "ol", items });
    return;
  }
  if (t === "pre" || hasClass(el, "ltx_listing")) {
    const lines = findAll(el, e => hasClass(e, "ltx_listingline"));
    const text = lines.length ? lines.map(l => rawText(l).trimEnd()).join("\n") : rawText(el).trimEnd();
    if (text.trim()) out.push({ kind: "code", text });
    return;
  }
  if (t === "blockquote") { const text = inlineLine(el.children, ltxRules); if (text) out.push({ kind: "quote", text }); return; }
  walk(el, e => HTML_BLOCK.has(e.tag) || (e.tag === "math" && e.attrs.display === "block") || hasClass(e, "ltx_listing"), ltxBlock, ltxRules, out);
}

// The paper's text from arXiv's HTML version, without its title, authors and
// abstract (the card and the abstract section hold those).
export function arxivHtmlBlocks(html: string): PaperBlock[] {
  const root = parseMarkup(html, true);
  const article = findFirst(root, e => e.tag === "article") ?? findFirst(root, e => e.tag === "body") ?? root;
  const out: PaperBlock[] = [];
  ltxBlock({ ...article, tag: "div" }, out);
  return out;
}

// ── JATS (Europe PMC's open-access full text; a Crossref abstract) ────────────

const JATS_SKIP = new Set(["fn-group", "fn", "permissions", "funding-group", "glossary", "notes", "front", "label", "object-id", "alt-text", "graphic", "media", "inline-graphic", "processing-meta"]);
const JATS_BLOCK = new Set(["sec", "p", "list", "disp-formula", "disp-formula-group", "fig", "table-wrap", "boxed-text", "disp-quote", "preformat", "code", "ref-list", "ack", "app", "app-group", "title", "def-list", "statement"]);

function jatsTex(el: MarkupElement): string | null {
  if (el.tag !== "inline-formula" && el.tag !== "disp-formula" && !(el.tag === "math")) return null;
  const tex = findFirst(el, e => e.tag === "tex-math");
  if (tex) {
    let t = rawText(tex);
    const begin = t.indexOf("\\begin{document}"), end = t.indexOf("\\end{document}");
    if (begin !== -1 && end > begin) t = t.slice(begin + 16, end);
    t = squashSpace(t);
    while (t.startsWith("$")) t = t.slice(1);
    while (t.endsWith("$")) t = t.slice(0, -1);
    return cleanTex(t);
  }
  const math = el.tag === "math" ? el : findFirst(el, e => e.tag === "math");
  return cleanTex(math?.attrs.alttext ?? textOf(math ?? el));
}

const jatsRules: InlineRules = {
  skip: el => JATS_SKIP.has(el.tag) || el.tag === "xref" && el.attrs["ref-type"] === "fn",
  math: el => (el.tag === "inline-formula" || el.tag === "math" ? jatsTex(el) : null),
};

function jatsBlock(el: MarkupElement, out: PaperBlock[], depth: number): void {
  const t = el.tag;
  const label = (e: MarkupElement) => { const l = childrenNamed(e, "label")[0]; return l ? textOf(l) : ""; };
  if (t === "sec" || t === "ack" || t === "app") {
    const title = childrenNamed(el, "title")[0];
    const words = [label(el), title ? inlineLine(title.children, jatsRules) : t === "ack" ? "Acknowledgements" : ""].filter(Boolean).join(" ");
    if (words) out.push({ kind: "heading", level: Math.min(depth + 1, 4), text: words });
    for (const c of el.children) {
      if (typeof c === "string") continue;
      if (c.tag === "title" || c.tag === "label") continue;
      jatsBlock(c, out, depth + 1);
    }
    return;
  }
  if (t === "title") { const text = inlineLine(el.children, jatsRules); if (text) out.push({ kind: "heading", level: Math.min(depth + 1, 4), text }); return; }
  if (t === "disp-formula" || t === "disp-formula-group") {
    for (const f of t === "disp-formula" ? [el] : findAll(el, e => e.tag === "disp-formula")) {
      const tex = jatsTex(f);
      if (tex) out.push({ kind: "math", tex, tag: label(f) || null });
    }
    return;
  }
  if (t === "fig") {
    const cap = findFirst(el, e => e.tag === "caption");
    const text = [label(el), cap ? inlineLine(cap.children, jatsRules) : ""].filter(Boolean).join(": ");
    if (text) out.push({ kind: "caption", text });
    return;
  }
  if (t === "table-wrap") {
    const cap = findFirst(el, e => e.tag === "caption");
    const caption = [label(el), cap ? inlineLine(cap.children, jatsRules) : ""].filter(Boolean).join(": ") || null;
    const table = findFirst(el, e => e.tag === "table");
    if (table) out.push(htmlTable(table, caption, jatsRules));
    else if (caption) out.push({ kind: "caption", text: caption });
    return;
  }
  if (t === "list") {
    const items = childrenNamed(el, "list-item").map(li => inlineLine(li.children.filter(c => typeof c === "string" || c.tag !== "label"), jatsRules)).filter(Boolean);
    if (items.length) out.push({ kind: "list", ordered: el.attrs["list-type"] === "order", items });
    return;
  }
  if (t === "preformat" || t === "code") { const text = rawText(el).trimEnd(); if (text.trim()) out.push({ kind: "code", text }); return; }
  if (t === "disp-quote") { const text = inlineLine(el.children, jatsRules); if (text) out.push({ kind: "quote", text }); return; }
  if (t === "ref-list") {
    const title = childrenNamed(el, "title")[0];
    out.push({ kind: "heading", level: 2, text: title ? textOf(title) : "References" });
    const items = findAll(el, e => e.tag === "ref").map(r => {
      const cite = findFirst(r, e => e.tag === "mixed-citation" || e.tag === "element-citation" || e.tag === "citation");
      const l = label(r);
      const words = textOf(cite ?? r);
      return words ? `${l ? `[${l.split("[").join("").split("]").join("")}] ` : ""}${words}` : "";
    }).filter(Boolean);
    if (items.length) out.push({ kind: "list", ordered: false, items });
    return;
  }
  walk(el, e => JATS_BLOCK.has(e.tag), (e, o) => jatsBlock(e, o, depth), jatsRules, out);
}

// A JATS article's body and references (its front matter is the card's).
export function jatsBlocks(xml: string): PaperBlock[] {
  const root = parseMarkup(xml, false);
  const out: PaperBlock[] = [];
  const body = findFirst(root, e => e.tag === "body");
  if (body) jatsBlock(body, out, 1);
  const back = findFirst(root, e => e.tag === "back");
  if (back) for (const c of back.children) if (typeof c !== "string" && (c.tag === "ref-list" || c.tag === "ack" || c.tag === "app-group")) jatsBlock(c, out, 1);
  return out;
}

// An abstract given as markup (Crossref's JATS, Europe PMC's HTML), as text.
export function abstractText(markup: string): string {
  const root = parseMarkup(markup, true);
  const out: PaperBlock[] = [];
  walk(root, e => e.tag === "p" || e.tag === "sec" || e.tag === "h4" || e.tag === "h3" || e.tag === "title" || e.tag === "div",
    (e, o) => {
      if (e.tag === "title" || e.tag === "h4" || e.tag === "h3") { const text = inlineLine(e.children, jatsRules); if (text && text.toLowerCase() !== "abstract") o.push({ kind: "para", text: `**${text.split("*").join("")}**` }); return; }
      walk(e, x => x.tag === "p" || x.tag === "sec" || x.tag === "title" || x.tag === "h4", (x, oo) => { const text = inlineLine(x.children, jatsRules); if (text && text.toLowerCase() !== "abstract") oo.push({ kind: "para", text: x.tag === "title" || x.tag === "h4" ? `**${text.split("*").join("")}**` : text }); }, jatsRules, o);
    }, jatsRules, out);
  return blocksToMarkdown(out);
}
