// ─── Fetching a paper: its details and the text that is openly available ─────
// Kio asks the sources' own APIs, never a scraper:
//   arXiv          export.arxiv.org's API (Atom) for the details; the paper's
//                  HTML version on arxiv.org/html for its text, when arXiv
//                  has one (most papers since late 2023, and many older ones)
//   DOI            Crossref's API (DataCite's for DOIs Crossref doesn't hold,
//                  such as Zenodo's); Europe PMC for an open-access full text
//   Semantic       its Graph API; a paper it knows on arXiv or in PubMed
//   Scholar        Central is read from there
//   OpenReview     its API (v2, then v1)
//   PubMed / PMC   Europe PMC's REST API, and its open-access full text (JATS)
//   another page   the page's own citation_* meta tags (what Google Scholar
//                  reads), then its DOI as above
//   a PDF          nothing is read from it here: it can be transcribed by Nova
//                  on the learner's request (paper-import.ts), like an uploaded
//                  PDF
// Nothing behind a paywall, a sign-in or a publisher's controls is fetched:
// a full text is taken only from arXiv, Europe PMC's open-access set, or a
// PDF the learner points at that answers without a sign-in.
//
// Every address is fetched by `safeGet`: https on port 443 only, the host's
// addresses looked up first and refused when any is private, loopback,
// link-local or otherwise not on the public internet (so a pasted link
// cannot reach Kio's own network), redirects followed by hand and each
// checked the same way, a size cap and a deadline. What comes back is
// untrusted text: it is only read as data and ends up as note text.

import { lookup } from "node:dns";
import { request } from "node:https";
import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import { abstractText, arxivHtmlBlocks, jatsBlocks, parseMarkup, readAtom, readMeta, squashSpace, textOf, type PaperBlock } from "./paper-markup";
import { arxivFromDoi, paperKey, readArxivId, readDoi, type PaperId, type PaperTextStatus } from "./paper-source";

export class FetchRefused extends Error {
  constructor(public reason: "blocked" | "too_large" | "timeout" | "network" | "redirects" | "bad_url", message: string) { super(message); }
}

export interface Fetched { status: number; type: string; body: Buffer; url: string; headers?: Record<string, string | string[] | undefined> }
// peek: answer as soon as the headers arrive, reading none of the body (a
// source's framing rules, source-frame.ts).
export interface GetOptions { accept?: string; maxBytes?: number; timeoutMs?: number; peek?: boolean }
export type Get = (url: string, options?: GetOptions) => Promise<Fetched>;

const UA = "KioNotes/1.0 (research paper import; +https://www.thekio.in)";
const DEFAULT_MAX = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT = 15_000;
const MAX_REDIRECTS = 4;

// ── Which addresses are on the public internet ───────────────────────────────

function v4Public(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(x => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [a, b, c] = p as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;          // carrier-grade NAT
  if (a === 169 && b === 254) return false;                    // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return v4Public(ip);
  if (kind !== 6) return false;
  const lower = ip.toLowerCase();
  // An IPv4 address written as IPv6 (::ffff:10.0.0.1, 64:ff9b::…) is that address.
  const lastColon = lower.lastIndexOf(":");
  const tail = lower.slice(lastColon + 1);
  if (tail.includes(".")) return v4Public(tail);
  if (lower === "::" || lower === "::1") return false;
  const first = lower.startsWith("::") ? 0 : parseInt(lower.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return false;               // unique local
  if ((first & 0xffc0) === 0xfe80) return false;               // link-local
  if ((first & 0xff00) === 0xff00) return false;               // multicast
  if (lower.startsWith("2001:db8:") || lower.startsWith("2001:0db8:")) return false;
  if (lower.startsWith("::ffff:") || lower.startsWith("64:ff9b:")) return false;
  return true;
}

// The host's addresses, each checked: one private address refuses the host.
// The connection then uses only the addresses checked here.
function checkedLookup(hostname: string, options: { all?: boolean; family?: number }, done: (...args: unknown[]) => void): void {
  lookup(hostname, { all: true }, (err, addresses) => {
    if (err) { done(err); return; }
    const list = addresses as Array<{ address: string; family: number }>;
    if (!list.length || list.some(a => !isPublicAddress(a.address))) { done(new FetchRefused("blocked", "That address isn't on the public internet.")); return; }
    if (options.all) done(null, list);
    else done(null, list[0]!.address, list[0]!.family);
  });
}

function once(url: URL, options: GetOptions): Promise<{ res: IncomingMessage; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const max = options.maxBytes ?? DEFAULT_MAX;
    const req = request({
      protocol: "https:", hostname: url.hostname, port: 443, path: `${url.pathname}${url.search}`, method: "GET",
      headers: { "user-agent": UA, accept: options.accept ?? "*/*", "accept-encoding": "identity" },
      lookup: checkedLookup as never,
    }, res => {
      if (options.peek) { resolve({ res, body: Buffer.alloc(0) }); req.destroy(); return; }
      const declared = Number(res.headers["content-length"] ?? "0");
      if (declared > max) { req.destroy(); reject(new FetchRefused("too_large", "That file is too large to import.")); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > max) { req.destroy(); reject(new FetchRefused("too_large", "That file is too large to import.")); return; }
        chunks.push(c);
      });
      res.on("end", () => resolve({ res, body: Buffer.concat(chunks) }));
      res.on("error", e => reject(new FetchRefused("network", e.message)));
    });
    req.setTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT, () => { req.destroy(); reject(new FetchRefused("timeout", "The source took too long to answer.")); });
    req.on("error", e => reject(e instanceof FetchRefused ? e : new FetchRefused("network", e.message)));
    req.end();
  });
}

export const safeGet: Get = async (address, options = {}) => {
  let url: URL;
  try { url = new URL(address); } catch { throw new FetchRefused("bad_url", "That address couldn't be read."); }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password) throw new FetchRefused("blocked", "Kio fetches only public https:// addresses.");
    if (isIP(url.hostname.split("[").join("").split("]").join("")) && !isPublicAddress(url.hostname.split("[").join("").split("]").join(""))) throw new FetchRefused("blocked", "That address isn't on the public internet.");
    const { res, body } = await once(url, options);
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (status >= 300 && status < 400 && location) {
      try { url = new URL(location, url); } catch { throw new FetchRefused("bad_url", "The source redirected somewhere that couldn't be read."); }
      continue;
    }
    return { status, type: String(res.headers["content-type"] ?? "").toLowerCase(), body, url: url.toString(), headers: res.headers };
  }
  throw new FetchRefused("redirects", "The source redirected too many times.");
};

// ── What a source gives ───────────────────────────────────────────────────────

export interface PaperMeta {
  title:      string;
  authors:    string[];
  abstract:   string | null;
  published:  string | null;
  venue:      string | null;
  doi:        string | null;
  arxivId:    string | null;
  pmid:       string | null;
  pmcid:      string | null;
  openreviewId: string | null;
  s2Id:       string | null;
  sourceUrl:  string;
  pdfUrl:     string | null;
  keywords:   string[];
  // Where the details came from, for the learner ("arXiv's API").
  detailsFrom: string;
}

export interface PaperFound {
  meta:   PaperMeta;
  // The paper's text, as blocks, when an open full text was found.
  blocks: PaperBlock[] | null;
  status: PaperTextStatus;
  textFrom: string | null;
  // What was and wasn't imported, in the learner's words.
  notes:  string[];
  key:    string;
}

export class PaperNotFound extends Error {
  constructor(public reason: "not_found" | "unavailable" | "not_a_paper" | "busy", message: string) { super(message); }
}

const text = (b: Buffer) => b.toString("utf8");
const json = (f: Fetched): Record<string, unknown> | null => { try { return JSON.parse(text(f.body)) as Record<string, unknown>; } catch { return null; } };
// A field's words: entities decoded and any markup (<i>, <sub>) taken out.
const str = (v: unknown, max = 2_000) => (typeof v !== "string" ? "" : (v.includes("<") || v.includes("&") ? textOf(parseMarkup(v, true)) : squashSpace(v)).slice(0, max));
const day = (v: string | null | undefined) => (v && v.length >= 4 ? v.slice(0, 10) : null);

const emptyMeta = (sourceUrl: string, detailsFrom: string): PaperMeta => ({
  title: "", authors: [], abstract: null, published: null, venue: null, doi: null, arxivId: null, pmid: null, pmcid: null,
  openreviewId: null, s2Id: null, sourceUrl, pdfUrl: null, keywords: [], detailsFrom,
});

function statusOf(meta: PaperMeta, blocks: PaperBlock[] | null): PaperTextStatus {
  if (blocks && blocks.length) return "full";
  return meta.abstract ? "abstract" : "details";
}

// ── arXiv ────────────────────────────────────────────────────────────────────

async function arxivMeta(id: string, get: Get): Promise<PaperMeta> {
  const res = await get(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`, { accept: "application/atom+xml", maxBytes: 1024 * 1024 });
  if (res.status !== 200) throw new PaperNotFound("unavailable", "arXiv didn't answer. Try again in a moment.");
  const entry = readAtom(text(res.body)).find(e => e.id.includes("arxiv.org/abs/"));
  if (!entry || !entry.title) throw new PaperNotFound("not_found", `arXiv has no paper ${id}. Check the link.`);
  const meta = emptyMeta(`https://arxiv.org/abs/${id}`, "arXiv's API");
  meta.title = entry.title; meta.authors = entry.authors; meta.abstract = entry.summary || null;
  meta.published = day(entry.published); meta.venue = entry.journalRef; meta.doi = entry.doi;
  meta.arxivId = id; meta.pdfUrl = `https://arxiv.org/pdf/${id}`; meta.keywords = entry.categories.slice(0, 8);
  return meta;
}

async function arxivText(id: string, get: Get): Promise<PaperBlock[] | null> {
  const res = await get(`https://arxiv.org/html/${id}`, { accept: "text/html", maxBytes: 12 * 1024 * 1024, timeoutMs: 25_000 });
  if (res.status !== 200 || !res.type.includes("html")) return null;
  const blocks = arxivHtmlBlocks(text(res.body));
  // A page with no section text (an error page, a stub) is no text.
  return blocks.filter(b => b.kind === "para").length >= 3 ? blocks : null;
}

async function fromArxiv(id: string, get: Get, notes: string[]): Promise<PaperFound> {
  const meta = await arxivMeta(id, get);
  let blocks: PaperBlock[] | null = null;
  try { blocks = await arxivText(id, get); } catch { blocks = null; }
  if (blocks) notes.push("The text is arXiv's HTML version of the paper, converted from its LaTeX. Figures are kept as their captions; images aren't imported.");
  else notes.push("arXiv has no HTML version of this paper, so only its details and abstract were imported. Its PDF can be transcribed by Nova.");
  return { meta, blocks, status: statusOf(meta, blocks), textFrom: blocks ? "arXiv's HTML version" : null, notes, key: paperKey({ arxivId: id, url: meta.sourceUrl }) };
}

// ── Europe PMC (PubMed, PubMed Central, open-access full text) ───────────────

async function epmcSearch(query: string, get: Get): Promise<Record<string, unknown> | null> {
  const res = await get(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&resultType=core&format=json&pageSize=1`, { accept: "application/json", maxBytes: 2 * 1024 * 1024 });
  if (res.status !== 200) throw new PaperNotFound("unavailable", "Europe PMC didn't answer. Try again in a moment.");
  const list = (json(res)?.resultList as { result?: unknown[] } | undefined)?.result;
  return Array.isArray(list) && list[0] && typeof list[0] === "object" ? list[0] as Record<string, unknown> : null;
}

function epmcMeta(r: Record<string, unknown>): PaperMeta {
  const pmid = str(r.pmid) || null, pmcid = str(r.pmcid) || null;
  const meta = emptyMeta(pmcid ? `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/` : pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : "", "Europe PMC");
  meta.title = str(r.title, 400);
  const authors = (r.authorList as { author?: Array<Record<string, unknown>> } | undefined)?.author;
  meta.authors = Array.isArray(authors) ? authors.map(a => str(a.fullName) || [str(a.firstName), str(a.lastName)].filter(Boolean).join(" ")).filter(Boolean) : str(r.authorString).split(", ").filter(Boolean);
  const abs = typeof r.abstractText === "string" ? abstractText(r.abstractText) : "";
  meta.abstract = abs || null;
  meta.published = day(str(r.firstPublicationDate) || str(r.pubYear));
  const journal = (r.journalInfo as { journal?: { title?: unknown } } | undefined)?.journal?.title;
  meta.venue = str(journal) || str(r.bookOrReportDetails) || null;
  meta.doi = str(r.doi) || null; meta.pmid = pmid; meta.pmcid = pmcid;
  const kw = (r.keywordList as { keyword?: unknown[] } | undefined)?.keyword;
  meta.keywords = Array.isArray(kw) ? kw.map(k => str(k, 80)).filter(Boolean).slice(0, 8) : [];
  return meta;
}

async function epmcFullText(pmcid: string, get: Get): Promise<PaperBlock[] | null> {
  const res = await get(`https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(pmcid)}/fullTextXML`, { accept: "application/xml", maxBytes: 12 * 1024 * 1024, timeoutMs: 25_000 });
  if (res.status !== 200) return null;
  const blocks = jatsBlocks(text(res.body));
  return blocks.filter(b => b.kind === "para").length >= 3 ? blocks : null;
}

async function fromEuropePmc(query: string, get: Get, notes: string[], missing: string): Promise<PaperFound> {
  const r = await epmcSearch(query, get);
  if (!r) throw new PaperNotFound("not_found", missing);
  const meta = epmcMeta(r);
  let blocks: PaperBlock[] | null = null;
  if (meta.pmcid && r.isOpenAccess === "Y") { try { blocks = await epmcFullText(meta.pmcid, get); } catch { blocks = null; } }
  if (blocks) notes.push("The text is the open-access full text from Europe PMC. Figures are kept as their captions; images aren't imported.");
  else notes.push(meta.pmcid ? "This article's full text isn't in the open-access set Kio can import, so only its details and abstract were imported." : "PubMed holds this article's details and abstract, not its text. If you have access to the PDF, you can upload it.");
  return { meta, blocks, status: statusOf(meta, blocks), textFrom: blocks ? "Europe PMC's open-access full text" : null, notes, key: paperKey({ ...meta, url: meta.sourceUrl }) };
}

// ── DOIs: Crossref, else DataCite ────────────────────────────────────────────

async function crossref(doi: string, get: Get): Promise<PaperMeta | null> {
  const res = await get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { accept: "application/json", maxBytes: 2 * 1024 * 1024 });
  if (res.status === 404) return null;
  if (res.status !== 200) throw new PaperNotFound("unavailable", "Crossref didn't answer. Try again in a moment.");
  const m = json(res)?.message as Record<string, unknown> | undefined;
  if (!m) return null;
  const meta = emptyMeta(`https://doi.org/${doi}`, "Crossref");
  const first = (v: unknown) => (Array.isArray(v) ? str(v[0], 400) : str(v, 400));
  meta.title = [first(m.title), first(m.subtitle)].filter(Boolean).join(": ");
  const authors = Array.isArray(m.author) ? m.author as Array<Record<string, unknown>> : [];
  meta.authors = authors.map(a => [str(a.given), str(a.family)].filter(Boolean).join(" ") || str(a.name)).filter(Boolean);
  meta.abstract = typeof m.abstract === "string" ? abstractText(m.abstract) || null : null;
  const parts = ((m.issued ?? m.published ?? m["published-print"] ?? m["published-online"]) as { "date-parts"?: number[][] } | undefined)?.["date-parts"]?.[0];
  meta.published = parts && parts[0] ? [parts[0], parts[1], parts[2]].filter(x => x !== undefined).map((x, i) => (i ? String(x).padStart(2, "0") : String(x))).join("-") : null;
  meta.venue = first(m["container-title"]) || first(m.publisher) || null;
  meta.doi = doi;
  meta.keywords = Array.isArray(m.subject) ? (m.subject as unknown[]).map(s => str(s, 80)).filter(Boolean).slice(0, 8) : [];
  return meta.title ? meta : null;
}

async function datacite(doi: string, get: Get): Promise<PaperMeta | null> {
  const res = await get(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`, { accept: "application/vnd.api+json", maxBytes: 2 * 1024 * 1024 });
  if (res.status !== 200) return null;
  const a = ((json(res)?.data as { attributes?: Record<string, unknown> } | undefined)?.attributes) ?? null;
  if (!a) return null;
  const meta = emptyMeta(`https://doi.org/${doi}`, "DataCite");
  meta.title = str((a.titles as Array<{ title?: unknown }> | undefined)?.[0]?.title, 400);
  meta.authors = ((a.creators as Array<Record<string, unknown>> | undefined) ?? []).map(c => str(c.name) || [str(c.givenName), str(c.familyName)].filter(Boolean).join(" ")).filter(Boolean);
  const desc = (a.descriptions as Array<{ description?: unknown; descriptionType?: unknown }> | undefined)?.find(d => d.descriptionType === "Abstract");
  meta.abstract = desc && typeof desc.description === "string" ? abstractText(desc.description) || null : null;
  meta.published = a.publicationYear ? String(a.publicationYear) : null;
  meta.venue = str(a.publisher, 200) || null;
  meta.doi = doi;
  meta.keywords = ((a.subjects as Array<{ subject?: unknown }> | undefined) ?? []).map(s => str(s.subject, 80)).filter(Boolean).slice(0, 8);
  return meta.title ? meta : null;
}

async function fromDoi(doi: string, get: Get, notes: string[]): Promise<PaperFound> {
  const ax = arxivFromDoi(doi);
  if (ax) return fromArxiv(ax, get, notes);
  const meta = (await crossref(doi, get)) ?? (await datacite(doi, get));
  if (!meta) throw new PaperNotFound("not_found", "No paper was found for that DOI. Check it, or paste the paper's page.");
  // An open-access full text, if Europe PMC has the article.
  let blocks: PaperBlock[] | null = null;
  try {
    const r = await epmcSearch(`DOI:"${doi}"`, get);
    if (r) {
      const pmc = epmcMeta(r);
      meta.pmid = pmc.pmid; meta.pmcid = pmc.pmcid;
      meta.abstract ??= pmc.abstract;
      if (pmc.pmcid && r.isOpenAccess === "Y") blocks = await epmcFullText(pmc.pmcid, get);
    }
  } catch { /* Europe PMC is a bonus here: the details stand without it */ }
  if (blocks) notes.push("The text is the open-access full text from Europe PMC. Figures are kept as their captions; images aren't imported.");
  else notes.push("The publisher's full text isn't openly available to Kio, so only the paper's details" + (meta.abstract ? " and abstract were" : " were") + " imported. If you have access to the PDF, you can upload it.");
  return { meta, blocks, status: statusOf(meta, blocks), textFrom: blocks ? "Europe PMC's open-access full text" : null, notes, key: paperKey({ ...meta, url: meta.sourceUrl }) };
}

// ── Semantic Scholar ─────────────────────────────────────────────────────────

async function fromSemanticScholar(id: string, get: Get, notes: string[]): Promise<PaperFound> {
  const fields = "title,authors,abstract,year,venue,externalIds,openAccessPdf,publicationDate,fieldsOfStudy,url";
  const res = await get(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(id)}?fields=${fields}`, { accept: "application/json", maxBytes: 1024 * 1024 });
  if (res.status === 429) throw new PaperNotFound("busy", "Semantic Scholar is busy right now. Try again in a minute, or paste the paper's arXiv or DOI link.");
  if (res.status === 404) throw new PaperNotFound("not_found", "Semantic Scholar has no paper at that link.");
  if (res.status !== 200) throw new PaperNotFound("unavailable", "Semantic Scholar didn't answer. Try again in a moment.");
  const p = json(res) ?? {};
  const ext = (p.externalIds ?? {}) as Record<string, unknown>;
  const arxiv = typeof ext.ArXiv === "string" ? readArxivId(ext.ArXiv)?.id ?? null : null;
  const pmcRaw = ext.PubMedCentral !== undefined ? String(ext.PubMedCentral) : null;
  if (arxiv) return fromArxiv(arxiv, get, notes);
  if (pmcRaw) return fromEuropePmc(`PMCID:PMC${pmcRaw.toUpperCase().startsWith("PMC") ? pmcRaw.slice(3) : pmcRaw}`, get, notes, "That article wasn't found.");
  const meta = emptyMeta(str(p.url) || `https://www.semanticscholar.org/paper/${id}`, "Semantic Scholar");
  meta.title = str(p.title, 400);
  meta.authors = Array.isArray(p.authors) ? (p.authors as Array<{ name?: unknown }>).map(a => str(a.name)).filter(Boolean) : [];
  meta.abstract = str(p.abstract, 6_000) || null;
  meta.published = day(str(p.publicationDate)) ?? (p.year ? String(p.year) : null);
  meta.venue = str(p.venue, 200) || null;
  meta.doi = typeof ext.DOI === "string" ? readDoi(ext.DOI) : null;
  meta.pmid = ext.PubMed !== undefined ? String(ext.PubMed) : null;
  meta.s2Id = id;
  const pdf = (p.openAccessPdf as { url?: unknown } | null | undefined)?.url;
  meta.pdfUrl = typeof pdf === "string" && pdf.startsWith("https://") ? pdf : null;
  meta.keywords = Array.isArray(p.fieldsOfStudy) ? (p.fieldsOfStudy as unknown[]).map(f => str(f, 80)).filter(Boolean) : [];
  if (!meta.title) throw new PaperNotFound("not_found", "Semantic Scholar has no paper at that link.");
  notes.push(meta.pdfUrl ? "Semantic Scholar gives this paper's details and an open-access PDF, not its text. The PDF can be transcribed by Nova." : "Semantic Scholar gives this paper's details, not its text.");
  return { meta, blocks: null, status: statusOf(meta, null), textFrom: null, notes, key: paperKey({ ...meta, url: meta.sourceUrl }) };
}

// ── OpenReview ───────────────────────────────────────────────────────────────

async function fromOpenReview(id: string, get: Get, notes: string[]): Promise<PaperFound> {
  let note: Record<string, unknown> | null = null;
  for (const api of ["https://api2.openreview.net", "https://api.openreview.net"]) {
    const res = await get(`${api}/notes?id=${encodeURIComponent(id)}`, { accept: "application/json", maxBytes: 1024 * 1024 });
    // OpenReview may ask for a browser check before its API answers. Kio
    // doesn't get round that: it says so.
    if (res.status === 403 || res.status === 429) throw new PaperNotFound("unavailable", "OpenReview asked for a browser check before it would answer, so Kio can't read this paper automatically. Paste its arXiv link if it has one, or download the PDF and upload it.");
    if (res.status !== 200) continue;
    const list = json(res)?.notes;
    if (Array.isArray(list) && list[0]) { note = list[0] as Record<string, unknown>; break; }
  }
  if (!note) throw new PaperNotFound("not_found", "OpenReview has no paper with that id, or it isn't public.");
  const c = (note.content ?? {}) as Record<string, unknown>;
  // v2 wraps every field as { value }; v1 gives it as it is.
  const field = (k: string): unknown => { const v = c[k]; return v && typeof v === "object" && !Array.isArray(v) && "value" in (v as object) ? (v as { value: unknown }).value : v; };
  const meta = emptyMeta(`https://openreview.net/forum?id=${encodeURIComponent(id)}`, "OpenReview");
  meta.title = str(field("title"), 400);
  const authors = field("authors");
  meta.authors = Array.isArray(authors) ? authors.map(a => str(a)).filter(Boolean) : [];
  meta.abstract = str(field("abstract"), 6_000) || null;
  const when = typeof note.pdate === "number" ? note.pdate : typeof note.cdate === "number" ? note.cdate : null;
  meta.published = when ? new Date(when).toISOString().slice(0, 10) : null;
  meta.venue = str(field("venue"), 200) || null;
  meta.openreviewId = id;
  const pdf = field("pdf");
  meta.pdfUrl = typeof pdf === "string" && pdf.startsWith("/pdf") ? `https://openreview.net${pdf}` : `https://openreview.net/pdf?id=${encodeURIComponent(id)}`;
  const kw = field("keywords");
  meta.keywords = Array.isArray(kw) ? kw.map(k => str(k, 80)).filter(Boolean).slice(0, 8) : [];
  if (!meta.title) throw new PaperNotFound("not_found", "OpenReview has no paper with that id, or it isn't public.");
  notes.push("OpenReview gives this paper's details and its PDF, not its text. The PDF can be transcribed by Nova.");
  return { meta, blocks: null, status: statusOf(meta, null), textFrom: null, notes, key: paperKey({ ...meta, url: meta.sourceUrl }) };
}

// ── A direct PDF, or another page ────────────────────────────────────────────

function fromPdf(url: string, notes: string[]): PaperFound {
  const meta = emptyMeta(url, "the address");
  let name = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "Paper";
  try { name = decodeURIComponent(name); } catch { /* as written */ }
  meta.title = name.toLowerCase().endsWith(".pdf") ? name.slice(0, -4) : name;
  meta.pdfUrl = url;
  notes.push("This is a PDF with no details Kio can look up. Nova can transcribe it (up to 20 pages and 3 MB); give it a proper title before importing.");
  return { meta, blocks: null, status: "details", textFrom: null, notes, key: paperKey({ url }) };
}

async function fromPage(url: string, get: Get, notes: string[]): Promise<PaperFound> {
  const res = await get(url, { accept: "text/html,application/xhtml+xml", maxBytes: 3 * 1024 * 1024 });
  if (res.type.includes("application/pdf")) return fromPdf(url, notes);
  if (res.status === 401 || res.status === 403) throw new PaperNotFound("unavailable", "That site doesn't let Kio read the page. Paste the paper's DOI, or its arXiv or PubMed link, instead.");
  if (res.status !== 200 || !res.type.includes("html")) throw new PaperNotFound("not_found", "That page couldn't be read.");
  const tags = readMeta(text(res.body));
  const one = (...names: string[]) => { for (const n of names) { const v = tags.get(n)?.[0]; if (v) return v; } return null; };
  const doi = readDoi(one("citation_doi", "dc.identifier", "prism.doi", "bepress_citation_doi") ?? "");
  const arxiv = readArxivId(one("citation_arxiv_id") ?? "")?.id ?? null;
  if (arxiv) return fromArxiv(arxiv, get, notes);
  const pagePdf = one("citation_pdf_url");
  if (doi) {
    const found = await fromDoi(doi, get, notes);
    found.meta.sourceUrl = url;
    if (!found.meta.pdfUrl && pagePdf?.startsWith("https://")) found.meta.pdfUrl = pagePdf;
    return found;
  }
  const title = one("citation_title", "dc.title");
  if (!title) throw new PaperNotFound("not_a_paper", "That page doesn't describe a paper Kio can read. Paste the paper's DOI, or its arXiv, PubMed or OpenReview link.");
  const meta = emptyMeta(url, "the page's own description");
  meta.title = title.slice(0, 400);
  meta.authors = (tags.get("citation_author") ?? tags.get("dc.creator") ?? []).slice(0, 60);
  meta.abstract = one("citation_abstract", "dc.description")?.slice(0, 6_000) ?? null;
  meta.published = day(one("citation_publication_date", "citation_date", "citation_online_date", "dc.date"));
  meta.venue = one("citation_journal_title", "citation_conference_title", "citation_publisher");
  meta.pdfUrl = pagePdf?.startsWith("https://") ? pagePdf : null;
  meta.keywords = (tags.get("citation_keywords") ?? []).slice(0, 8);
  notes.push("The details come from the page's own description of the paper; its text isn't openly available to Kio." + (meta.pdfUrl ? " The PDF it names can be transcribed by Nova if it opens without a sign-in." : ""));
  return { meta, blocks: null, status: statusOf(meta, null), textFrom: null, notes, key: paperKey({ url }) };
}

// The paper a link names, with what could be got of it.
export async function findPaper(id: PaperId, get: Get = safeGet): Promise<PaperFound> {
  const notes: string[] = [];
  switch (id.kind) {
    case "arxiv": return fromArxiv(id.id, get, notes);
    case "doi": return fromDoi(id.id, get, notes);
    case "semantic_scholar": return fromSemanticScholar(id.id, get, notes);
    case "openreview": return fromOpenReview(id.id, get, notes);
    case "pubmed": return fromEuropePmc(`EXT_ID:${id.id} AND SRC:MED`, get, notes, "PubMed has no article with that number.");
    case "pmc": return fromEuropePmc(`PMCID:${id.id}`, get, notes, "PubMed Central has no article with that number.");
    case "pdf": return fromPdf(id.url, notes);
    case "page": return fromPage(id.url, get, notes);
  }
}
