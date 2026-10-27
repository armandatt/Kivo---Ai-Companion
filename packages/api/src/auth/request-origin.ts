// ─── Auth: is this request from our own pages? ────────────────────────────────
// Pure, no imports: the web app's auth proxy and the API both use it.
//
// The auth endpoints change who is signed in and send email, so a page on
// another site must not be able to trigger them through a visitor's browser
// (a forged login, or a flood of codes to someone's inbox). Two checks, both
// on things a browser sets and a page cannot change:
//
//   • Content-Type must be application/json. An HTML form cannot send that,
//     and a cross-site fetch that tries is stopped by the browser first.
//   • Origin, when present, must be one of ours, and Sec-Fetch-Site, when
//     present, must not say the request came from another site. Browsers send
//     Origin on every cross-site POST.
//
// A request with neither header is not from a browser page (the web app's own
// server, a script, curl). Those carry no visitor's cookies, so there is
// nothing to forge, and they are let through to the ordinary limits.

export interface HeaderReader {
  get(name: string): string | null;
}

export interface OriginProblem {
  status: 403 | 415;
  error: string;
}

/** The origin (scheme://host[:port]) of a URL, or null when it is not one. */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function crossSiteProblem(headers: HeaderReader, allowedOrigins: Array<string | null>): OriginProblem | null {
  const contentType = (headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (contentType !== "application/json") {
    return { status: 415, error: "Requests must be sent as application/json." };
  }

  const refused: OriginProblem = { status: 403, error: "This request did not come from Kivo." };

  const origin = headers.get("origin");
  if (origin !== null) {
    const allowed = allowedOrigins.filter((value): value is string => Boolean(value));
    if (!allowed.includes(origin)) return refused;
  }

  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") return refused;

  return null;
}

/** The origin a request was addressed to, as the browser named it. */
export function requestOrigin(headers: HeaderReader, requestUrl: string): string | null {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return originOf(requestUrl);
  const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? new URL(requestUrl).protocol.replace(":", "");
  return originOf(`${proto}://${host}`);
}
