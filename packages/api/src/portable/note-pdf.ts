// ─── A note as a PDF: a rendition to read and print, not a copy to edit ──────
// Pure apart from reading the bundled fonts (no database, no network, no
// model). Draws a note's Markdown with the marks Kivo's own note view knows
// (components/nova/notes/note-blocks.ts): headings, paragraphs with bold,
// italic, code, highlights and links, bullet, numbered and checklist items
// (nested by indentation), quotes and callouts, code blocks, maths (as
// written: LaTeX source, never evaluated), tables, dividing lines and the
// note's own images (PNG and JPEG drawn; a WebP image is named instead).
// Web links stay clickable; [[note links]] are text (the other note is not
// in the PDF). Files kept with the note are listed at the end, by name and
// size, as "not inside this PDF". Every page carries the note's title, the
// page number and where it came from (Kivo, who exported it, when).
//
// Safe: only the note's text and its own image bytes are drawn. Nothing is
// fetched (an image address from elsewhere stays text), nothing is run, no
// HTML is read. A character the font can't draw is shown as a stand-in and
// the last page says so; the .kivo file keeps every character exactly.

import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { imageInfo } from "../nova/product/image-info";

// ── Reading the note into blocks (pure) ──

export type Inline =
  | { kind: "text" | "bold" | "italic" | "bolditalic" | "code" | "highlight" | "math"; text: string }
  | { kind: "link"; text: string; href: string };

export type PdfBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "para"; text: string }
  | { kind: "list"; items: Array<{ depth: number; marker: string; check: boolean | null; text: string }> }
  | { kind: "code"; text: string }
  | { kind: "math"; tex: string }
  | { kind: "image"; alt: string; id: string }
  | { kind: "file"; name: string; id: string }
  | { kind: "quote"; label: string | null; lines: string[] }
  | { kind: "rule" }
  | { kind: "table"; head: string[]; rows: string[][] };

const CALLOUT_LABEL: Record<string, string> = {
  note: "Note", info: "Note", todo: "Note", quote: "From the source", cite: "From the source", source: "Source", highlight: "From the source",
  idea: "Idea", tip: "Idea", hint: "Idea", important: "Important", insight: "Idea", question: "Question", faq: "Question", doubt: "Question",
  warning: "Watch out", caution: "Watch out", danger: "Watch out", error: "Watch out", mistake: "Watch out", summary: "Summary", abstract: "Summary",
  tldr: "Summary", recap: "Summary", example: "Example", definition: "Definition", def: "Definition", term: "Definition",
  takeaway: "Key takeaway", key: "Key takeaway", paper: "Research paper",
};

const LIST_ITEM = /^(\s*)([-*+]|\d{1,4}[.)])\s+(.*)$/;
const tableCells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
const isDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function readBlocks(body: string): PdfBlock[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const out: PdfBlock[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ kind: "para", text: para.join(" ") }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    if (!t) { flush(); continue; }
    if (t.startsWith("```")) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trim().startsWith("```"); i++) code.push(lines[i]!);
      out.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (t === "$$" || t === "\\[") {
      flush();
      const close = t === "$$" ? "$$" : "\\]";
      const tex: string[] = [];
      for (i++; i < lines.length && lines[i]!.trim() !== close; i++) tex.push(lines[i]!);
      out.push({ kind: "math", tex: tex.join("\n").trim() });
      continue;
    }
    if (/^\$\$.+\$\$/.test(t)) { flush(); out.push({ kind: "math", tex: t.replace(/^\$\$/, "").replace(/\$\$.*$/, "").trim() }); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) { flush(); out.push({ kind: "heading", level: Math.min(3, h[1]!.length) as 1 | 2 | 3, text: h[2]!.trim() }); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flush(); out.push({ kind: "rule" }); continue; }
    const img = /^!\[([^\]]*)\]\(kivo-image:([A-Za-z0-9_-]{1,64})\)$/.exec(t);
    if (img) { flush(); out.push({ kind: "image", alt: img[1]!.trim(), id: img[2]! }); continue; }
    const file = /^\[([^\]\n]{1,200})\]\(kivo-file:([A-Za-z0-9_-]{1,64})\)$/.exec(t);
    if (file) { flush(); out.push({ kind: "file", name: file[1]!.trim(), id: file[2]! }); continue; }
    if (t.startsWith("|") && i + 1 < lines.length && isDivider(lines[i + 1]!)) {
      flush();
      const head = tableCells(t);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i]!.trim().startsWith("|"); i++) rows.push(tableCells(lines[i]!));
      i--;
      out.push({ kind: "table", head, rows });
      continue;
    }
    if (t.startsWith(">")) {
      flush();
      const quoted: string[] = [];
      for (; i < lines.length && lines[i]!.trim().startsWith(">"); i++) quoted.push(lines[i]!.trim().replace(/^>\s?/, ""));
      i--;
      let label: string | null = null;
      const c = /^\[!([A-Za-z]+)\][+-]?\s*(.*)$/.exec(quoted[0] ?? "");
      if (c) { label = [CALLOUT_LABEL[c[1]!.toLowerCase()] ?? "Note", c[2]!.trim()].filter(Boolean).join(": "); quoted.shift(); }
      out.push({ kind: "quote", label, lines: quoted });
      continue;
    }
    const li = LIST_ITEM.exec(line);
    if (li) {
      flush();
      const items: Array<{ depth: number; marker: string; check: boolean | null; text: string }> = [];
      for (; i < lines.length; i++) {
        const m = LIST_ITEM.exec(lines[i]!);
        if (!m) { if (lines[i]!.trim() && items.length && /^\s{2,}/.test(lines[i]!)) { items[items.length - 1]!.text += ` ${lines[i]!.trim()}`; continue; } break; }
        const depth = Math.min(5, Math.floor(m[1]!.replace(/\t/g, "  ").length / 2));
        const ck = /^\[([ xX])\]\s+(.*)$/.exec(m[3]!);
        items.push({ depth, marker: /\d/.test(m[2]!) ? m[2]!.replace(")", ".") : "•", check: ck ? ck[1] !== " " : null, text: ck ? ck[2]! : m[3]! });
      }
      i--;
      out.push({ kind: "list", items });
      continue;
    }
    para.push(t);
  }
  flush();
  return out;
}

// A line's marks, as runs. A link is shown as its words, and only a web
// address is ever a link; [[note links]] are their words; colours and tags
// are their words.
export function readInline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  const flush = () => { if (plain) { out.push({ kind: "text", text: plain }); plain = ""; } };
  const push = (r: Inline) => { flush(); out.push(r); };
  let i = 0;
  const paired = (mark: string) => {
    if (!text.startsWith(mark, i)) return -1;
    const from = i + mark.length;
    if (from >= text.length || text[from] === " ") return -1;
    const end = text.indexOf(mark, from);
    return end > from && text[end - 1] !== " " ? end : -1;
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "[" && text[i + 1] === "[") {
      const close = text.indexOf("]]", i + 2);
      if (close > i + 2) { const inner = text.slice(i + 2, close); const bar = inner.indexOf("|"); plain += bar === -1 ? inner : inner.slice(bar + 1) || inner.slice(0, bar); i = close + 2; continue; }
    }
    if (ch === "[") {
      const mid = text.indexOf("](", i + 1);
      const words = mid > i + 1 ? text.slice(i + 1, mid) : "";
      if (words && !words.includes("[")) {
        const end = text.indexOf(")", mid + 2);
        const href = end > mid + 2 ? text.slice(mid + 2, end).trim() : "";
        if (/^https?:\/\/\S+$/i.test(href)) { push({ kind: "link", text: words, href }); i = end + 1; continue; }
      }
      // [words]{.colour}: the words.
      const col = /^\[([^\]]+)\]\{\.[a-z-]+\}/.exec(text.slice(i));
      if (col) { plain += col[1]; i += col[0].length; continue; }
    }
    let end = paired("**");
    if (end !== -1) { const inner = text.slice(i + 2, end); push(inner.startsWith("*") && inner.endsWith("*") && inner.length > 2 ? { kind: "bolditalic", text: inner.slice(1, -1) } : { kind: "bold", text: inner }); i = end + 2; continue; }
    end = paired("==");
    if (end !== -1) { push({ kind: "highlight", text: text.slice(i + 2, end) }); i = end + 2; continue; }
    if (ch === "`") { const close = text.indexOf("`", i + 1); if (close > i + 1) { push({ kind: "code", text: text.slice(i + 1, close) }); i = close + 1; continue; } }
    if (ch === "$" && text[i + 1] !== "$") { const close = text.indexOf("$", i + 1); if (close > i + 1 && text[i + 1] !== " ") { push({ kind: "math", text: text.slice(i + 1, close) }); i = close + 1; continue; } }
    end = paired("*");
    if (end !== -1 && text[i + 1] !== "*") { push({ kind: "italic", text: text.slice(i + 1, end) }); i = end + 1; continue; }
    end = paired("_");
    if (end !== -1 && (i === 0 || /\s/.test(text[i - 1]!))) { push({ kind: "italic", text: text.slice(i + 1, end) }); i = end + 1; continue; }
    if (text.startsWith("http://", i) || text.startsWith("https://", i)) {
      let e = i; while (e < text.length && !/\s/.test(text[e]!)) e++;
      while (e > i && /[.,;:!?)\]]/.test(text[e - 1]!)) e--;
      const href = text.slice(i, e);
      push({ kind: "link", text: href.length > 60 ? `${href.slice(0, 59)}…` : href, href }); i = e; continue;
    }
    plain += ch; i++;
  }
  flush();
  return out;
}

// ── Drawing ──

export interface PdfImage { id: string; mimeType: string; bytes: Uint8Array }
export interface PdfFile { id: string; fileName: string; bytes: number }
export interface NotePdfInput {
  title: string; body: string;
  subjectName: string | null; topicName: string | null;
  exportedBy: string | null; exportedAt: Date; updatedAt: Date | null;
  images: PdfImage[]; files: PdfFile[];
}
export interface NotePdfResult { bytes: Uint8Array; pages: number; imagesDrawn: number; imagesNamed: number; filesListed: number; substituted: number; links: number }

const FONT_FILES = { regular: "LiberationSans-Regular.ttf", bold: "LiberationSans-Bold.ttf", italic: "LiberationSans-Italic.ttf", bolditalic: "LiberationSans-BoldItalic.ttf" } as const;

// Where the bundled fonts are: beside this package (tests, scripts), or from
// the API app's directory (Render: apps/api), or from the repository root.
export function fontDir(): string | null {
  // Looked up at run time from the server's own checkout (Render runs from it), never traced into a bundle.
  const cwd = process.cwd();
  const candidates = [process.env.KIVO_FONTS_DIR, join(/*turbopackIgnore: true*/ cwd, "assets/fonts"), join(/*turbopackIgnore: true*/ cwd, "../../packages/api/assets/fonts"), join(/*turbopackIgnore: true*/ cwd, "packages/api/assets/fonts")].filter((p): p is string => Boolean(p));
  return candidates.find(d => existsSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ d, FONT_FILES.regular))) ?? null;
}

// Windows-1252, what the built-in PDF fonts can draw when the bundled ones are missing.
const WIN_ANSI_EXTRA = new Set([..."€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"].map(c => c.codePointAt(0)!));
const STAND_INS: Record<string, string> = { "₹": "Rs ", "✓": "v", "✔": "v", "✗": "x", "✘": "x", "☐": "[ ]", "☑": "[x]", "⭐": "*", "★": "*", "→": "->", "←": "<-", "⇒": "=>", "≈": "~", "≠": "!=", "≤": "<=", "≥": ">=" };

const mb = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;

export async function renderNotePdf(input: NotePdfInput): Promise<NotePdfResult> {
  const doc = new PDFDocument({ size: "A4", margins: { top: 64, bottom: 64, left: 60, right: 60 }, bufferPages: true, autoFirstPage: true,
    info: { Title: input.title, Author: input.exportedBy ?? "Kivo", Creator: "Kivo", Producer: "Kivo", CreationDate: input.exportedAt } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const ended = new Promise<void>(res => doc.on("end", () => res()));

  const dir = fontDir();
  const F = dir
    ? (() => { for (const [k, f] of Object.entries(FONT_FILES)) doc.registerFont(`kivo-${k}`, join(/*turbopackIgnore: true*/ dir, f)); return { regular: "kivo-regular", bold: "kivo-bold", italic: "kivo-italic", bolditalic: "kivo-bolditalic" }; })()
    : { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique", bolditalic: "Helvetica-BoldOblique" };
  const MONO = "Courier";
  // What the regular font can draw (the bundled font's own glyphs; else Windows-1252).
  doc.font(F.regular);
  const glyphs = (doc as unknown as { _font?: { font?: { hasGlyphForCodePoint?: (cp: number) => boolean } } })._font?.font;
  const drawable = (cp: number, mono: boolean) => cp < 0x20 ? false : mono || !glyphs?.hasGlyphForCodePoint ? cp <= 0xff || WIN_ANSI_EXTRA.has(cp) : glyphs.hasGlyphForCodePoint(cp);
  let substituted = 0;
  const clean = (s: string, mono = false) => {
    let out = "";
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      if (ch === "\t") { out += "  "; continue; }
      if (ch === "\n") { out += "\n"; continue; }
      if (drawable(cp, mono)) { out += ch; continue; }
      if (cp === 0xfe0f || cp === 0x200d) continue;          // emoji joiners
      out += STAND_INS[ch] ?? "?"; substituted++;
    }
    return out;
  };

  const ink = "#1f2328", soft = "#57606a", rule = "#d0d7de", accent = "#0b57d0";
  const width = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = () => doc.page.margins.left;
  const bottomRoom = () => doc.page.height - doc.page.margins.bottom - doc.y;
  const ensure = (h: number) => { if (bottomRoom() < h) doc.addPage(); };
  let links = 0;

  // A run of inline marks, wrapped as one paragraph.
  const runs = (text: string, opts: { size: number; x?: number; w?: number; color?: string; base?: "regular" | "italic" | "bold" } ) => {
    const rs = readInline(text);
    if (rs.length === 0) return;
    const x = opts.x ?? left(), w = opts.w ?? width();
    const baseFont = F[opts.base ?? "regular"];
    rs.forEach((r, k) => {
      const last = k === rs.length - 1;
      const font = r.kind === "bold" || r.kind === "highlight" ? F.bold : r.kind === "italic" ? F.italic : r.kind === "bolditalic" ? F.bolditalic : r.kind === "code" || r.kind === "math" ? MONO : baseFont;
      doc.font(font).fontSize(opts.size).fillColor(r.kind === "link" ? accent : opts.color ?? ink);
      const s = clean(r.text, font === MONO);
      const o: PDFKit.Mixins.TextOptions = { continued: !last, lineGap: 2.5, width: w, ...(r.kind === "link" ? { link: r.href, underline: true } : { link: null as unknown as string, underline: false }) };
      if (r.kind === "link") links++;
      if (k === 0) doc.text(s, x, doc.y, o); else doc.text(s, o);
    });
    doc.fillColor(ink);
  };

  // ── Title and where it came from ──
  doc.font(F.bold).fontSize(22).fillColor(ink).text(clean(input.title), { width: width() });
  const where = [input.subjectName, input.topicName].filter(Boolean).join(" › ");
  const meta = [where || null, `Exported from Kivo${input.exportedBy ? ` by ${input.exportedBy}` : ""} on ${input.exportedAt.toISOString().slice(0, 10)}`, input.updatedAt ? `last edited ${input.updatedAt.toISOString().slice(0, 10)}` : null].filter(Boolean).join("  ·  ");
  doc.moveDown(0.3).font(F.regular).fontSize(9.5).fillColor(soft).text(clean(meta), { width: width() });
  doc.moveDown(0.6).moveTo(left(), doc.y).lineTo(left() + width(), doc.y).lineWidth(0.6).strokeColor(rule).stroke();
  doc.moveDown(0.8).fillColor(ink);

  const images = new Map(input.images.map(i => [i.id, i]));
  const files = new Map(input.files.map(f => [f.id, f]));
  const listed: PdfFile[] = [];
  let imagesDrawn = 0, imagesNamed = 0;

  for (const b of readBlocks(input.body)) {
    switch (b.kind) {
      case "heading": {
        const size = b.level === 1 ? 17 : b.level === 2 ? 14.5 : 12.5;
        ensure(size * 3);
        doc.moveDown(b.level === 1 ? 0.7 : 0.5);
        runs(b.text, { size, base: "bold" });
        doc.moveDown(0.3);
        break;
      }
      case "para": ensure(30); runs(b.text, { size: 11 }); doc.moveDown(0.6); break;
      case "list": {
        for (const it of b.items) {
          ensure(22);
          const indent = 14 + it.depth * 16;
          const marker = it.check === null ? it.marker : it.check ? "[x]" : "[ ]";
          const y = doc.y;
          doc.font(it.check === null && it.marker === "•" ? F.bold : F.regular).fontSize(11).fillColor(soft).text(marker, left() + indent - 14, y, { width: 22, lineBreak: false });
          doc.y = y;
          runs(it.text, { size: 11, x: left() + indent + (it.check === null ? 2 : 10), w: width() - indent - (it.check === null ? 2 : 10), color: it.check ? soft : ink });
          doc.moveDown(0.25);
        }
        doc.moveDown(0.4);
        break;
      }
      case "code": {
        const text = clean(b.text, true);
        doc.font(MONO).fontSize(9);
        const h = doc.heightOfString(text || " ", { width: width() - 16, lineGap: 1.5 }) + 14;
        if (h < bottomRoom() || h > doc.page.height / 2) ensure(Math.min(h, 80)); else doc.addPage();
        const top = doc.y;
        const fits = Math.min(h, bottomRoom());
        doc.save().rect(left(), top, width(), fits).fill("#f6f8fa").restore();
        doc.fillColor(ink).text(text || " ", left() + 8, top + 7, { width: width() - 16, lineGap: 1.5 });
        doc.x = left(); doc.moveDown(0.8);
        break;
      }
      case "math": {
        ensure(30);
        doc.font(MONO).fontSize(10).fillColor(ink).text(clean(b.tex, true), left() + 24, doc.y, { width: width() - 48, align: "center" });
        doc.x = left(); doc.moveDown(0.6);
        break;
      }
      case "image": {
        const img = images.get(b.id);
        const info = img ? imageInfo(img.bytes) : null;
        if (img && info && (info.type === "image/png" || info.type === "image/jpeg")) {
          const maxW = width(), maxH = doc.page.height * 0.55;
          const scale = Math.min(1, maxW / info.width, maxH / info.height, 0.75);   // a 96-dpi capture shown near its own size
          const w = Math.max(24, info.width * scale), h = Math.max(24, info.height * scale);
          ensure(h + (b.alt ? 24 : 8));
          const x = left() + (width() - w) / 2;
          doc.image(Buffer.from(img.bytes), x, doc.y, { width: w, height: h });
          doc.y += h + 4;
          if (b.alt) doc.font(F.italic).fontSize(9).fillColor(soft).text(clean(b.alt), left(), doc.y, { width: width(), align: "center" });
          doc.fillColor(ink).moveDown(0.7);
          imagesDrawn++;
        } else {
          ensure(24);
          doc.font(F.italic).fontSize(10).fillColor(soft).text(clean(`[Image${b.alt ? `: ${b.alt}` : ""} — ${img ? "a WebP image, kept in the .kivo file" : "not available"}]`), left(), doc.y, { width: width() });
          doc.fillColor(ink).moveDown(0.6);
          imagesNamed++;
        }
        break;
      }
      case "file": {
        const f = files.get(b.id);
        ensure(22);
        doc.font(F.bold).fontSize(10.5).fillColor(ink).text(clean(`Attached file: ${f?.fileName ?? b.name}`), left(), doc.y, { width: width(), continued: true })
          .font(F.regular).fillColor(soft).text(clean(f ? `  (${mb(f.bytes)}, not inside this PDF; see the list at the end)` : "  (not available)"));
        doc.fillColor(ink).moveDown(0.6);
        if (f && !listed.includes(f)) listed.push(f);
        break;
      }
      case "quote": {
        ensure(30);
        const top = doc.y, x = left() + 14;
        if (b.label) { doc.font(F.bold).fontSize(10.5).fillColor(soft).text(clean(b.label), x, doc.y, { width: width() - 14 }); doc.moveDown(0.15); }
        for (const l of b.lines) { if (l.trim()) runs(l, { size: 10.5, x, w: width() - 14, color: "#3b434b" }); else doc.moveDown(0.4); }
        const bottom = doc.y;
        if (doc.y > top) doc.save().moveTo(left() + 3, top).lineTo(left() + 3, bottom).lineWidth(2.5).strokeColor(b.label ? accent : rule).stroke().restore();
        doc.x = left(); doc.moveDown(0.6);
        break;
      }
      case "rule": ensure(16); doc.moveDown(0.3).moveTo(left(), doc.y).lineTo(left() + width(), doc.y).lineWidth(0.6).strokeColor(rule).stroke(); doc.moveDown(0.6); break;
      case "table": {
        const cols = Math.max(b.head.length, ...b.rows.map(r => r.length), 1);
        const cw = width() / cols, pad = 4;
        const plain = (s: string) => clean(readInline(s).map(r => r.text).join(""));
        const rowHeight = (cells: string[], font: string) => { doc.font(font).fontSize(9.5); return Math.max(...Array.from({ length: cols }, (_, c) => doc.heightOfString(plain(cells[c] ?? "") || " ", { width: cw - pad * 2 }))) + pad * 2; };
        const drawRow = (cells: string[], font: string, shade: boolean) => {
          const h = rowHeight(cells, font);
          ensure(h + 2);
          const top = doc.y;
          if (shade) doc.save().rect(left(), top, width(), h).fill("#f6f8fa").restore();
          for (let c = 0; c < cols; c++) {
            doc.save().rect(left() + c * cw, top, cw, h).lineWidth(0.5).strokeColor(rule).stroke().restore();
            doc.font(font).fontSize(9.5).fillColor(ink).text(plain(cells[c] ?? ""), left() + c * cw + pad, top + pad, { width: cw - pad * 2 });
          }
          doc.x = left(); doc.y = top + h;
        };
        drawRow(b.head, F.bold, true);
        for (const r of b.rows) drawRow(r, F.regular, false);
        doc.moveDown(0.8);
        break;
      }
    }
  }

  // ── Files kept with the note, and anything not drawn ──
  for (const f of input.files) if (!listed.includes(f)) listed.push(f);
  if (listed.length || imagesNamed || substituted) {
    ensure(60);
    doc.moveDown(0.6).moveTo(left(), doc.y).lineTo(left() + width(), doc.y).lineWidth(0.6).strokeColor(rule).stroke().moveDown(0.6);
    if (listed.length) {
      doc.font(F.bold).fontSize(11.5).fillColor(ink).text("Files kept with this note (not inside this PDF)", left(), doc.y, { width: width() });
      doc.moveDown(0.3);
      for (const f of listed) { ensure(18); doc.font(F.regular).fontSize(10).fillColor(ink).text(clean(`•  ${f.fileName}  (${mb(f.bytes)})`), { width: width() }); }
      doc.moveDown(0.3).font(F.italic).fontSize(9).fillColor(soft).text("They travel in the note's .kivo file and open in Kivo.", { width: width() });
      doc.moveDown(0.5);
    }
    if (imagesNamed) doc.font(F.italic).fontSize(9).fillColor(soft).text(`${imagesNamed} image${imagesNamed === 1 ? " is" : "s are"} named but not drawn here; the .kivo file keeps ${imagesNamed === 1 ? "it" : "them"}.`, { width: width() });
    if (substituted) doc.font(F.italic).fontSize(9).fillColor(soft).text(`${substituted} character${substituted === 1 ? "" : "s"} this PDF's font can't draw ${substituted === 1 ? "is" : "are"} shown as a stand-in; the .kivo file keeps every character exactly.`, { width: width() });
  }

  // ── Every page: title, page number, where it came from ──
  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 40;
    doc.font(F.regular).fontSize(8).fillColor(soft);
    doc.text(clean(`${input.title.slice(0, 70)}  ·  Kivo  ·  ${input.exportedAt.toISOString().slice(0, 10)}`), left(), y, { width: width() * 0.75, lineBreak: false, link: null as unknown as string });
    doc.text(`Page ${p - range.start + 1} of ${range.count}`, left(), y, { width: width(), align: "right", lineBreak: false, link: null as unknown as string });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  await ended;
  const bytes = new Uint8Array(Buffer.concat(chunks));
  return { bytes, pages: range.count, imagesDrawn, imagesNamed, filesListed: listed.length, substituted, links };
}
