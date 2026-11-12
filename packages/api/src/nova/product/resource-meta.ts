// ─── What a saved page is, and what it says about itself ─────────────────────
// Pure, shared by the server (learning-events.ts) and the web app. Three jobs:
//
//   readPageMeta   what the extension read from the page's public metadata
//                  tags (og:, meta, JSON-LD) when the learner saved it, checked
//                  and bounded. Never page text: the extension reads tags only,
//                  and the server never fetches a saved address.
//   classifyResource  the kind of resource, from signals that say so: the
//                  address's structure (a YouTube watch page, an arXiv or DOI
//                  identifier, a docs host), then the page's own declared type
//                  (schema.org @type, og:type). Never a word in the address
//                  ("…/tutorial-on-x" is not a tutorial). Unsure: "page".
//   dedupeKey      the address as compared for duplicates: tracking
//                  parameters and host spellings out, meaningful ones kept.
//
// Nothing here invents metadata: a field the page did not give is null.

import { identifyPaper } from "./paper-source";

export const RESOURCE_TYPES = ["article", "video", "paper", "documentation", "tutorial", "blog", "news", "page"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export const RESOURCE_TYPE_LABEL: Record<ResourceType, string> = {
  article: "Article", video: "Video", paper: "Research paper", documentation: "Documentation",
  tutorial: "Tutorial", blog: "Blog post", news: "News", page: "Web page",
};
export const READING_STATUSES = ["unread", "reading", "done"] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];
export const READING_STATUS_LABEL: Record<ReadingStatus, string> = { unread: "Unread", reading: "In progress", done: "Done" };

export const META_DESCRIPTION_MAX = 500;
export const META_AUTHOR_MAX = 200;
export const META_SITE_MAX = 120;
export const META_IMAGE_MAX = 1000;
export const TAGS_MAX = 12;
export const TAG_MAX = 40;
export const PERSONAL_NOTE_MAX = 2000;

// ── What the page said ───────────────────────────────────────────────────────

export interface PageMeta {
  description:     string | null;
  imageUrl:        string | null;
  author:          string | null;
  siteName:        string | null;
  publishedAt:     Date | null;
  durationSeconds: number | null;
  // The page's own declared kind: schema.org @type or og:type, lower case.
  declaredTypes:   string[];
  // The page carries scholarly citation tags (citation_title and kin).
  citation:        boolean;
}

export const NO_META: PageMeta = { description: null, imageUrl: null, author: null, siteName: null, publishedAt: null, durationSeconds: null, declaredTypes: [], citation: false };

const oneLine = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = [...v].map(ch => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").split(" ").filter(Boolean).join(" ");
  return t ? (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t) : null;
};

// An https image address with no login in it, or null. Shown with no referrer.
export function safeImageUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > META_IMAGE_MAX) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch { return null; }
}

// "PT1H2M10S" (ISO 8601, as YouTube and schema.org give it), or seconds. Pure.
export function durationOf(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) && raw > 0 && raw <= 86_400 * 2 ? raw : null;
  if (typeof raw !== "string" || raw.length > 40) return null;
  const s = raw.trim().toUpperCase();
  if (!s.startsWith("PT")) return null;
  let total = 0, num = "";
  for (const ch of s.slice(2)) {
    if (ch >= "0" && ch <= "9") { num += ch; continue; }
    const n = Number(num); num = "";
    if (!Number.isFinite(n)) return null;
    if (ch === "H") total += n * 3600; else if (ch === "M") total += n * 60; else if (ch === "S") total += n; else return null;
  }
  return total > 0 && total <= 86_400 * 2 && !num ? total : null;
}

// What the extension sent as `meta`, checked. Anything else is dropped, and
// a field that fails is null: a save never depends on metadata.
export function readPageMeta(raw: unknown, now: Date): PageMeta {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NO_META;
  const m = raw as Record<string, unknown>;
  let publishedAt: Date | null = null;
  if (typeof m.publishedAt === "string" && m.publishedAt.length <= 40) {
    const d = new Date(m.publishedAt);
    if (!Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 1900 && d.getTime() <= now.getTime() + 86_400_000) publishedAt = d;
  }
  const declaredTypes = Array.isArray(m.types)
    ? [...new Set(m.types.filter((t): t is string => typeof t === "string" && t.length <= 60).map(t => t.trim().toLowerCase()).filter(Boolean))].slice(0, 6)
    : [];
  return {
    description: oneLine(m.description, META_DESCRIPTION_MAX),
    imageUrl: safeImageUrl(m.imageUrl),
    author: oneLine(m.author, META_AUTHOR_MAX),
    siteName: oneLine(m.siteName, META_SITE_MAX),
    publishedAt,
    durationSeconds: durationOf(m.duration),
    declaredTypes,
    citation: m.citation === true,
  };
}

// ── What kind of resource ────────────────────────────────────────────────────

const hostOf = (u: URL) => { const h = u.hostname.toLowerCase(); return h.startsWith("www.") ? h.slice(4) : h; };

// A YouTube video's id from any of its addresses, or null. Pure.
export function youtubeId(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = hostOf(u);
  const ok = (id: string | null | undefined) => (id && id.length >= 6 && id.length <= 20 && [...id].every(c => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "-") ? id : null);
  if (host === "youtu.be") return ok(u.pathname.split("/")[1]);
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (u.pathname === "/watch") return ok(u.searchParams.get("v"));
    const [, first, second] = u.pathname.split("/");
    if (first === "shorts" || first === "embed" || first === "live") return ok(second);
  }
  return null;
}

const VIDEO_HOSTS = new Set(["vimeo.com", "loom.com", "ted.com"]);
// Hosts that are documentation sites as a whole.
const DOCS_HOSTS = new Set(["developer.mozilla.org", "readthedocs.io", "learn.microsoft.com", "developer.apple.com", "devdocs.io", "pkg.go.dev", "docs.rs"]);

// schema.org and og:type names, to a kind. First that matches wins.
const DECLARED: Array<[string, ResourceType]> = [
  ["videoobject", "video"], ["video.movie", "video"], ["video.episode", "video"], ["video.other", "video"], ["video", "video"],
  ["scholarlyarticle", "paper"],
  ["newsarticle", "news"], ["reportagenewsarticle", "news"], ["analysisnewsarticle", "news"],
  ["howto", "tutorial"], ["course", "tutorial"],
  ["techarticle", "documentation"], ["apireference", "documentation"],
  ["blogposting", "blog"], ["socialmediaposting", "blog"],
  ["article", "article"],
];

export interface Classified { type: ResourceType; basis: "address" | "page" | "none" }

export function classifyResource(url: string, meta: PageMeta = NO_META): Classified {
  let u: URL;
  try { u = new URL(url); } catch { return { type: "page", basis: "none" }; }
  const host = hostOf(u);
  // The address's structure first: these are unambiguous.
  if (youtubeId(url) || (VIDEO_HOSTS.has(host) && u.pathname.split("/").filter(Boolean).length >= 1 && host !== "ted.com") || (host === "ted.com" && u.pathname.startsWith("/talks/"))) return { type: "video", basis: "address" };
  const paper = identifyPaper(url);
  if (paper.ok && paper.paper.kind !== "page" && paper.paper.kind !== "pdf") return { type: "paper", basis: "address" };
  if (DOCS_HOSTS.has(host) || [...DOCS_HOSTS].some(d => host.endsWith(`.${d}`)) || host.startsWith("docs.")) return { type: "documentation", basis: "address" };
  // Then what the page declares itself to be.
  if (meta.citation) return { type: "paper", basis: "page" };
  for (const [name, type] of DECLARED) if (meta.declaredTypes.includes(name)) return { type, basis: "page" };
  return { type: "page", basis: "none" };
}

// A picture for a resource with none: a YouTube video's own thumbnail, from its id.
export function fallbackImage(url: string): string | null {
  const id = youtubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

// ── Duplicates ───────────────────────────────────────────────────────────────

// Parameters that track where a click came from and never change the page.
const TRACKING = new Set(["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "igshid", "yclid", "_hsenc", "_hsmi", "mkt_tok", "ref_src", "ref_url", "spm", "vero_id"]);
const isTracking = (name: string) => name.startsWith("utm_") || TRACKING.has(name);

// The address as compared for duplicates. Lower-case host without "www.",
// no fragment, no tracking parameters, the rest sorted, no trailing slash;
// a YouTube video by its id (youtu.be, m., shorts and share links are one
// video; two videos never are). null: not an address.
export function dedupeKey(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const video = youtubeId(raw);
  if (video) return `youtube:${video}`;
  const kept = [...u.searchParams.entries()].filter(([k]) => !isTracking(k.toLowerCase())).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = kept.length ? `?${new URLSearchParams(kept).toString()}` : "";
  const path = u.pathname.length > 1 && u.pathname.endsWith("/") ? u.pathname.slice(0, -1) : u.pathname;
  return `${hostOf(u)}${path}${query}`.slice(0, 2048);
}

// ── Tags ─────────────────────────────────────────────────────────────────────

// A tag as kept: one line, single-spaced, no leading "#", at most TAG_MAX. Pure.
export function cleanTag(raw: unknown): string | null {
  const t = oneLine(raw, TAG_MAX + 1);
  if (!t) return null;
  const bare = t.startsWith("#") ? t.slice(1).trim() : t;
  return bare && bare.length <= TAG_MAX ? bare : null;
}
export const tagKey = (t: string) => t.toLowerCase();

// The tags asked for, each once (any case), spelled as the learner already
// spells it when they have it on another page, at most TAGS_MAX. Pure.
export function mergeTags(asked: unknown, known: string[]): string[] {
  const spelled = new Map(known.map(k => [tagKey(k), k]));
  const out: string[] = [];
  for (const raw of Array.isArray(asked) ? asked : []) {
    const t = cleanTag(raw);
    if (!t) continue;
    const kept = spelled.get(tagKey(t)) ?? t;
    if (!out.some(o => tagKey(o) === tagKey(kept))) out.push(kept);
    if (out.length >= TAGS_MAX) break;
  }
  return out;
}
