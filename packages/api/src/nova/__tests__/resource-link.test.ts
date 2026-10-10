// Saving a link from the web app and from the bookmark: which typed
// addresses are taken, what title a bare address gets, what the bookmark
// carries, and that both go through the one way of saving a page.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeResourceUrl as fromEvents } from "../product/learning-events";
import {
  LINK_PROBLEM_TEXT, bookmarkletCode, captureFragment, checkLink, normalizeResourceUrl, readCapture, samePage, titleFromUrl,
} from "../product/resource-link";
import { EVENT_TITLE_MAX, EVENT_URL_MAX } from "../product/learning-events.types";

const repo = join(__dirname, "..", "..", "..", "..", "..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const problem = (raw: string) => { const r = checkLink(raw); return r.ok ? null : r.problem; };
const url     = (raw: string) => { const r = checkLink(raw); return r.ok ? r.url : null; };

describe("an address typed or pasted into Save a link", () => {
  it("takes ordinary web pages, with or without the scheme", () => {
    expect(url("https://example.com/graphs/bfs")).toBe("https://example.com/graphs/bfs");
    expect(url("  http://example.com/a?b=1  ")).toBe("http://example.com/a?b=1");
    expect(url("example.com/graphs")).toBe("https://example.com/graphs");
    expect(url("www.example.com")).toBe("https://www.example.com/");
    expect(url("HTTPS://Example.com/Path")).toBe("https://example.com/Path");
    expect(url("localhost:3000/notes")).toBe("https://localhost:3000/notes");
  });

  it("says nothing was entered", () => {
    expect(problem("")).toBe("empty");
    expect(problem("   \n ")).toBe("empty");
  });

  it("refuses every scheme that is not http or https, as its own kind of problem", () => {
    for (const raw of [
      "javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<p>x</p>", "file:///etc/passwd", "ftp://example.com/a",
      "chrome://settings", "chrome-extension://abc/popup.html", "mailto:a@example.com", "tel:+123", "about:blank", "blob:https://example.com/1",
      "view-source:https://example.com",
    ]) expect([raw, problem(raw)]).toEqual([raw, "unsupported_scheme"]);
  });

  it("refuses what is not an address", () => {
    for (const raw of ["notes", "two words", "https://", "http://exa mple.com", "example.com/a b", "https://exa\tmple.com", "?x=1", "://example.com"]) {
      expect([raw, problem(raw)]).toEqual([raw, "malformed"]);
    }
  });

  it("refuses an address longer than Nova keeps", () => {
    expect(problem(`https://example.com/${"a".repeat(EVENT_URL_MAX)}`)).toBe("too_long");
  });

  it("has words for every problem", () => {
    for (const p of ["empty", "too_long", "unsupported_scheme", "malformed"] as const) expect(LINK_PROBLEM_TEXT[p].length).toBeGreaterThan(10);
  });

  it("shows the learner the address that will be stored: no login, fragment or credential parameters", () => {
    expect(url("https://user:pw@www.example.com/a?id=7&token=SECRET&X-Amz-Signature=abc#part")).toBe("https://www.example.com/a?id=7");
  });

  it("is the same check the server stores by", () => {
    expect(fromEvents).toBe(normalizeResourceUrl);
    const typed = checkLink("https://www.example.com/a?token=x#y");
    expect(typed.ok && typed.url).toBe(normalizeResourceUrl("https://www.example.com/a?token=x#y")!.url);
  });
});

describe("whether two addresses are the same saved page", () => {
  it("ignores a fragment, a login and credential parameters", () => {
    expect(samePage("https://example.com/a#one", "https://example.com/a#two")).toBe(true);
    expect(samePage("https://example.com/a?token=1", "https://example.com/a")).toBe(true);
  });
  it("keeps different pages apart", () => {
    expect(samePage("https://example.com/a", "https://example.com/b")).toBe(false);
    expect(samePage("https://example.com/a?page=1", "https://example.com/a?page=2")).toBe(false);
    expect(samePage("nonsense", "nonsense")).toBe(false);
  });
});

describe("a title for a link that came without one", () => {
  it("reads the last part of the path as words", () => {
    expect(titleFromUrl("https://en.wikipedia.org/wiki/Deadlock_(computer_science)")).toBe("Deadlock (computer science)");
    expect(titleFromUrl("https://example.com/blog/breadth-first-search.html")).toBe("Breadth first search");
    expect(titleFromUrl("https://example.com/notes/os%20scheduling/")).toBe("Os scheduling");
  });
  it("falls back to the site when the path says nothing", () => {
    expect(titleFromUrl("https://www.example.com/")).toBe("example.com");
    expect(titleFromUrl("https://example.com/watch?v=abc")).toBe("Watch");
    expect(titleFromUrl("https://example.com/p/1234567")).toBe("example.com");
    expect(titleFromUrl("https://example.com/a/x9")).toBe("example.com");
  });
  it("never throws, and stays within a title's length", () => {
    expect(titleFromUrl("not an address")).toBe("");
    expect(titleFromUrl("https://example.com/%E0%A4%A")).toBe("example.com");
    expect(titleFromUrl(`https://example.com/${"word-".repeat(200)}`).length).toBeLessThanOrEqual(EVENT_TITLE_MAX);
  });
});

describe("what the bookmark brings", () => {
  it("round-trips an address and a title through the fragment", () => {
    const fragment = captureFragment("https://example.com/a?b=1&c=2", "Graphs & trees: 100% #1");
    expect(fragment.startsWith("#save=")).toBe(true);
    expect(readCapture(fragment)).toEqual({ url: "https://example.com/a?b=1&c=2", title: "Graphs & trees: 100% #1" });
  });

  it("cleans the address and keeps the title to one line and its length", () => {
    expect(readCapture(captureFragment("https://user:pw@example.com/a?token=SECRET#frag", " A\n\ttitle "))).toEqual({ url: "https://example.com/a", title: "A title" });
    expect(readCapture(captureFragment("https://example.com/", "x".repeat(1000)))!.title.length).toBe(EVENT_TITLE_MAX);
  });

  it("brings nothing when the page is not one Nova keeps", () => {
    for (const fragment of ["", "#", "#connect", "#save=", captureFragment("javascript:alert(1)", "x"), captureFragment("chrome://settings", "x"), captureFragment("file:///a", "x"), `#save=${"a".repeat(20000)}`]) {
      expect(readCapture(fragment)).toBeNull();
    }
  });

  it("treats a title as text", () => {
    expect(readCapture(captureFragment("https://example.com/", "<img src=x onerror=alert(1)>"))!.title).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("the Save to Kivo bookmark", () => {
  const code = bookmarkletCode("https://kivo.example")!;

  it("opens this Kivo's Saved page with the page's address and title in the fragment", () => {
    expect(code.startsWith("javascript:")).toBe(true);
    expect(code).toContain('"https://kivo.example/saved#save="');
    expect(code).toContain("encodeURIComponent(location.href)");
    expect(code).toContain("encodeURIComponent(document.title)");
  });

  it("carries no credential and reads nothing else from the page", () => {
    expect(code).not.toMatch(/cookie|localStorage|sessionStorage|token|authorization|fetch\(|XMLHttpRequest|innerHTML|innerText|textContent|querySelector/i);
    // The capture is in the fragment, which is not sent to a server.
    expect(code).not.toContain("/saved?");
  });

  it("is made only for https, or a local address in development", () => {
    expect(bookmarkletCode("http://localhost:3000")).toContain('"http://localhost:3000/saved#save="');
    expect(bookmarkletCode("http://kivo.example")).toBeNull();
    expect(bookmarkletCode("javascript:alert(1)")).toBeNull();
    expect(bookmarkletCode("not an origin")).toBeNull();
  });

  it("cannot be bent by the origin it is given", () => {
    expect(bookmarkletCode("https://kivo.example/path?x=1#y")).toBe(code);
    expect(bookmarkletCode('https://kivo.example";alert(1);//')).toBeNull();
  });
});

describe("one way of saving a page", () => {
  const helper = read("packages/api/src/nova/product/resource-link.ts");
  const route  = read("apps/api/app/api/nova/learning-events/route.ts");
  const webApi = read("apps/web/components/nova/saved/saved-api.ts");
  const box    = read("apps/web/components/nova/saved/save-link.tsx");

  it("keeps the link helper pure: no network, no database", () => {
    expect(helper).not.toMatch(/\bfetch\(|prisma|@repo\/db|https?\.get|axios|undici/);
    expect([...helper.matchAll(/^import .* from "(.*)";$/gm)].map(m => m[1])).toEqual(["./learning-events.types"]);
  });

  it("saves from the web through the endpoint and owner function the extension uses", () => {
    expect(webApi).toContain("fetch('/api/nova/learning-events', {");
    expect([...route.matchAll(/recordLearningEvent\(([^,]+),/g)].map(m => m[1])).toEqual(["access.profileId", "learner.profileId"]);
    expect(route).not.toMatch(/prisma\./);
  });

  it("takes the learner from the credential and the source from its kind, never from the body", () => {
    expect([...route.matchAll(/source: "(\w+)"/g)].map(m => m[1]).sort()).toEqual(["browser_extension", "web"]);
    expect(route).not.toMatch(/body\)?\.(profileId|userId|learnerId|source)|body as \{[^}]*(profileId|userId|source)/);
  });

  it("answers a signed-in session only when no bearer credential is sent, and never an extension's origin", () => {
    expect(route).toContain('req.headers.has("authorization") ? await handlePOST(req) : await handleWebSave(req)');
    const web = route.slice(route.indexOf("async function handleWebSave"), route.indexOf("async function handlePOST"));
    expect(web.indexOf("fromExtensionOrigin(req)")).toBeGreaterThan(-1);
    expect(web.indexOf("requireWebLearner()")).toBeGreaterThan(web.indexOf("fromExtensionOrigin(req)"));
    expect(web.indexOf("requireWebLearner()")).toBeLessThan(web.indexOf("readSmallJson"));
    expect(web).toContain('startsWith("application/json")');
    expect(web).not.toContain("resolveExtensionCaller");
  });

  it("lets the web app save a page and nothing else", () => {
    expect(route).toContain('eventType !== "resource_saved"');
    expect(webApi).toContain("eventType: 'resource_saved'");
  });

  it("saves nothing until the learner confirms, including a page the bookmark brought", () => {
    expect([...box.matchAll(/saveLink\(/g)].length).toBe(1);
    expect(box.slice(box.indexOf("async function save()"))).toContain("await saveLink(");
    expect(box.slice(box.indexOf("useEffect(() => {\n    if (capture)"), box.indexOf("const already"))).not.toContain("save(");
  });

  it("puts no credential in an address", () => {
    for (const src of [helper, box, read("apps/web/components/nova/saved/pending-capture.ts"), read("apps/web/components/nova/saved/bookmarklet-panel.tsx")]) {
      expect(src).not.toMatch(/kevo_session|document\.cookie|Bearer|nvx_/);
    }
  });
});
