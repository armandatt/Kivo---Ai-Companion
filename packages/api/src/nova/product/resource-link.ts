// ─── A link the learner wants to keep ─────────────────────────────────────────
// What a web address has to be for Nova to keep it, and the small pieces the
// web app's "Save a link" box and the bookmarklet need around that. Pure
// functions: nothing here reaches the network or the database, so the web app
// runs the same check the server does before it asks to save anything.
// The server's answer (product/learning-events.ts) is still the one that counts.

import { EVENT_TITLE_MAX, EVENT_URL_MAX } from "./learning-events.types";

// Query parameters that carry credentials rather than say which page it is.
// They are dropped before the address is stored.
const CREDENTIAL_PARAMS = new Set([
  "token", "access_token", "id_token", "refresh_token", "auth", "authorization", "apikey", "api_key", "key",
  "password", "passwd", "pwd", "secret", "signature", "sig", "session", "sessionid", "session_id", "sid", "otp",
]);
const CREDENTIAL_PARAM_PREFIXES = ["x-amz-", "x-goog-"];

// A web page address, cleaned for keeping: http or https only, no login in
// it, no fragment, no credential parameters. null: not an address Nova keeps.
export function normalizeResourceUrl(raw: unknown): { url: string; domain: string } | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > EVENT_URL_MAX) return null;
  let parsed: URL;
  try { parsed = new URL(raw.trim()); } catch { return null; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;

  parsed.username = "";
  parsed.password = "";
  parsed.hash     = "";
  for (const name of [...parsed.searchParams.keys()]) {
    const lower = name.toLowerCase();
    if (CREDENTIAL_PARAMS.has(lower) || CREDENTIAL_PARAM_PREFIXES.some(p => lower.startsWith(p))) parsed.searchParams.delete(name);
  }
  const url = parsed.toString();
  if (url.length > EVENT_URL_MAX) return null;
  const host = parsed.hostname.toLowerCase();
  return { url, domain: host.startsWith("www.") ? host.slice(4) : host };
}

// ── What someone typed or pasted ──────────────────────────────────────────────

export type LinkProblem = "empty" | "too_long" | "unsupported_scheme" | "malformed";
export type LinkCheck   = { ok: true; url: string; domain: string } | { ok: false; problem: LinkProblem };

export const LINK_PROBLEM_TEXT: Record<LinkProblem, string> = {
  empty:              "Paste the address of a page.",
  too_long:           "That address is too long to keep.",
  unsupported_scheme: "Only ordinary web pages (http or https) can be saved.",
  malformed:          "That doesn't look like a web address. Check it and try again.",
};

// "scheme://…": letters, digits, + . - and then "://".
const SCHEME_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789+.-";
const hasScheme = (text: string) => {
  const at = text.indexOf("://");
  return at > 0 && [...text.slice(0, at).toLowerCase()].every(ch => SCHEME_CHARS.includes(ch));
};
// Schemes written without "//". A bare "example.com:8080" is not one of them.
const OTHER_SCHEMES = ["javascript:", "data:", "mailto:", "tel:", "sms:", "about:", "blob:", "file:", "view-source:"];

// Reads what was typed into the box. "example.com/page" is taken as https.
// The address that comes back is the one Nova would store.
export function checkLink(raw: string): LinkCheck {
  const text = (typeof raw === "string" ? raw : "").trim();
  if (!text) return { ok: false, problem: "empty" };
  if (text.length > EVENT_URL_MAX) return { ok: false, problem: "too_long" };

  const lower = text.toLowerCase();
  const web   = lower.startsWith("http://") || lower.startsWith("https://");
  if (!web && (hasScheme(text) || OTHER_SCHEMES.some(s => lower.startsWith(s)))) return { ok: false, problem: "unsupported_scheme" };
  if ([...text].some(ch => ch === " " || ch.charCodeAt(0) < 32)) return { ok: false, problem: "malformed" };

  const address = normalizeResourceUrl(web ? text : `https://${text}`);
  if (!address) return { ok: false, problem: "malformed" };
  // A typed name with no dot ("notes") is a word, not a site.
  if (!web && !address.domain.includes(".") && address.domain !== "localhost") return { ok: false, problem: "malformed" };
  return { ok: true, url: address.url, domain: address.domain };
}

// Whether two addresses are the same saved page.
export function samePage(a: string, b: string): boolean {
  const left = normalizeResourceUrl(a), right = normalizeResourceUrl(b);
  return left !== null && right !== null && left.url === right.url;
}

// ── A title when the page did not give one ────────────────────────────────────
// Nova never opens a saved page, so a pasted link has no title of its own.
// This reads one off the address for the learner to correct: the last part
// of the path as words, or the site's name when the path says nothing.

export function titleFromUrl(url: string): string {
  const address = normalizeResourceUrl(url);
  if (!address) return "";
  let last = "";
  try {
    const parts = new URL(address.url).pathname.split("/").filter(Boolean);
    last = decodeURIComponent(parts[parts.length - 1] ?? "");
  } catch { last = ""; }

  const dot = last.lastIndexOf(".");
  if (dot > 0 && last.length - dot <= 6) last = last.slice(0, dot);
  const words = [...last].map(ch => (ch === "-" || ch === "_" || ch === "+" ? " " : ch)).join("").split(" ").filter(Boolean).join(" ");
  const letters = [...words].filter(ch => ch.toLowerCase() !== ch.toUpperCase()).length;
  // An id or a number says nothing about the page.
  if (letters < 3 || letters * 2 < words.length) return address.domain;
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, EVENT_TITLE_MAX);
}

// ── The bookmarklet ───────────────────────────────────────────────────────────
// A bookmark that opens Kivo's Saved page with the current page's address and
// title, for the learner to review and confirm. It carries nothing about who
// they are: the page it opens uses their ordinary sign-in. The capture rides
// in the fragment, which browsers do not send to any server.

export const CAPTURE_PATH = "/saved";

export function captureFragment(url: string, title: string): string {
  return `#save=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;
}

// The reverse. null: no capture, or not one Nova could keep.
export function readCapture(fragment: string): { url: string; title: string } | null {
  const text = typeof fragment === "string" ? fragment : "";
  if (text.length > EVENT_URL_MAX * 4 + EVENT_TITLE_MAX * 12) return null;
  let params: URLSearchParams;
  try { params = new URLSearchParams(text.startsWith("#") ? text.slice(1) : text); } catch { return null; }
  const address = normalizeResourceUrl(params.get("save") ?? "");
  if (!address) return null;
  const title = [...(params.get("title") ?? "")].map(ch => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").split(" ").filter(Boolean).join(" ");
  return { url: address.url, title: title.slice(0, EVENT_TITLE_MAX) };
}

// The bookmark's address for a Kivo web app at `origin`. null: not an origin
// a bookmarklet should be made for.
export function bookmarkletCode(origin: string): string | null {
  let app: URL;
  try { app = new URL(origin); } catch { return null; }
  const local = app.hostname === "localhost" || app.hostname === "127.0.0.1";
  if (app.protocol !== "https:" && !(app.protocol === "http:" && local)) return null;
  // A host name is letters, digits, dots and hyphens. Anything else is not
  // an origin to write into a script.
  if (![...app.host].every(ch => "abcdefghijklmnopqrstuvwxyz0123456789.-:".includes(ch))) return null;
  const target = JSON.stringify(`${app.origin}${CAPTURE_PATH}#save=`);
  return `javascript:(function(){var u=${target}+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title);var w=window.open(u,'_blank');if(!w){location.href=u}})();`;
}
