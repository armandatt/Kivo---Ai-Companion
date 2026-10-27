// ─── Can a source be shown inside Notes? ──────────────────────────────────────
// Notes shows a note's source (a paper's PDF, a page) in a pane beside the
// note, in a frame. Whether a frame works is the source's own decision: its
// X-Frame-Options and Content-Security-Policy frame-ancestors headers. A
// browser does not tell the page when a frame was refused (the frame just
// stays blank), so Kivo asks the source first, reading only its response
// headers, and the pane shows the frame or says plainly why it can't.
//
// Nothing is got around here: a source that refuses to be framed is opened in
// its own tab, never fetched and re-served by Kivo.
//
//   frameVerdict      pure: what the headers allow
//   checkSourceFrame  one header-only request through safeGet (https, public
//                     addresses only, redirects checked), then frameVerdict
//
// No regex: headers are read by splitting on their own separators.

import { FetchRefused, safeGet, type Get } from "./paper-fetch";

export type FrameVerdict =
  | "pdf"           // a PDF that may be framed: shown in the browser's own viewer
  | "page"          // a web page that may be framed
  | "blocked"       // the source does not allow other sites to frame it
  | "download"      // the source sends a file to save, not to show
  | "unreachable";  // Kivo couldn't ask (refused, timed out, an error status)

export interface FrameCheck { verdict: FrameVerdict; url: string; host: string }

type Headers = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(",") : v ?? "").trim().toLowerCase();

// The frame-ancestors sources of a Content-Security-Policy, or null when the
// policy has no such directive.
function frameAncestors(csp: string): string[] | null {
  for (const part of csp.split(",").join(";").split(";")) {
    const words = part.trim().split(" ").filter(Boolean);
    if (words[0] === "frame-ancestors") return words.slice(1);
  }
  return null;
}

function originAllowed(sources: string[], appOrigin: string): boolean {
  const app = appOrigin.toLowerCase();
  const appHost = app.split("://")[1] ?? app;
  return sources.some(s => s === "*" || s === app || s === appHost || (s === "https:" && app.startsWith("https://")));
}

export function frameVerdict(input: { status: number; headers: Headers; appOrigin: string }): FrameVerdict {
  if (input.status < 200 || input.status >= 400) return "unreachable";
  const h = input.headers;
  // frame-ancestors, when present, is what browsers obey; X-Frame-Options otherwise.
  const ancestors = frameAncestors(one(h["content-security-policy"]));
  if (ancestors) { if (!originAllowed(ancestors, input.appOrigin)) return "blocked"; }
  else {
    const xfo = one(h["x-frame-options"]);
    if (xfo === "deny" || xfo === "sameorigin" || xfo.startsWith("allow-from")) return "blocked";
  }
  if (one(h["content-disposition"]).startsWith("attachment")) return "download";
  const type = one(h["content-type"]).split(";")[0]!.trim();
  if (type === "application/pdf") return "pdf";
  if (type === "text/html" || type === "application/xhtml+xml") return "page";
  return "download";
}

export async function checkSourceFrame(address: string, appOrigin: string, get: Get = safeGet): Promise<FrameCheck> {
  let host = "";
  try { host = new URL(address).hostname; } catch { return { verdict: "unreachable", url: address, host }; }
  try {
    const res = await get(address, { peek: true, timeoutMs: 8_000, accept: "application/pdf,text/html;q=0.9,*/*;q=0.5" });
    return { verdict: frameVerdict({ status: res.status, headers: res.headers ?? { "content-type": res.type }, appOrigin }), url: res.url, host };
  } catch (e) {
    if (e instanceof FetchRefused || e instanceof Error) return { verdict: "unreachable", url: address, host };
    throw e;
  }
}
