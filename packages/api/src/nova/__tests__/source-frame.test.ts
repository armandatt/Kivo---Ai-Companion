// Whether Notes may show a source in a frame (product/source-frame.ts). The
// headers here are the ones the sources sent when this was written: arXiv's
// PDFs allow framing, PubMed Central's refuse it.

import { checkSourceFrame, frameVerdict } from "../product/source-frame";
import type { Get } from "../product/paper-fetch";
import { FetchRefused } from "../product/paper-fetch";

const APP = "https://www.thekivo.in";
const v = (status: number, headers: Record<string, string>) => frameVerdict({ status, headers, appOrigin: APP });

describe("what a source's headers allow", () => {
  it("an arXiv PDF, with no framing rule, is shown in the browser's PDF viewer", () => {
    expect(v(200, { "content-type": "application/pdf", "access-control-allow-origin": "*" })).toBe("pdf");
  });
  it("X-Frame-Options DENY or SAMEORIGIN refuses it (PubMed Central sends DENY)", () => {
    expect(v(200, { "content-type": "application/pdf", "x-frame-options": "DENY" })).toBe("blocked");
    expect(v(200, { "content-type": "text/html", "x-frame-options": "SAMEORIGIN" })).toBe("blocked");
  });
  it("frame-ancestors decides when present, whatever X-Frame-Options says", () => {
    expect(v(200, { "content-type": "application/pdf", "content-security-policy": "default-src 'self'; frame-ancestors 'self'" })).toBe("blocked");
    expect(v(200, { "content-type": "application/pdf", "content-security-policy": "frame-ancestors *", "x-frame-options": "DENY" })).toBe("pdf");
    expect(v(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": `frame-ancestors ${APP}` })).toBe("page");
  });
  it("a file sent as a download, or something that is neither a PDF nor a page, isn't shown", () => {
    expect(v(200, { "content-type": "application/pdf", "content-disposition": "attachment; filename=p.pdf" })).toBe("download");
    expect(v(200, { "content-type": "application/octet-stream" })).toBe("download");
  });
  it("an error status (a sign-in, a robot check) is reported as unreachable, not as allowed", () => {
    expect(v(403, { "content-type": "text/html" })).toBe("unreachable");
    expect(v(500, { "content-type": "application/pdf" })).toBe("unreachable");
  });
});

describe("asking the source", () => {
  it("reads only the headers, through the fetcher it is given", async () => {
    const seen: Array<{ url: string; peek?: boolean }> = [];
    const get: Get = async (url, options) => { seen.push({ url, peek: options?.peek }); return { status: 200, type: "application/pdf", body: Buffer.alloc(0), url, headers: { "content-type": "application/pdf" } }; };
    expect(await checkSourceFrame("https://arxiv.org/pdf/1706.03762", APP, get)).toEqual({ verdict: "pdf", url: "https://arxiv.org/pdf/1706.03762", host: "arxiv.org" });
    expect(seen).toEqual([{ url: "https://arxiv.org/pdf/1706.03762", peek: true }]);
  });
  it("a refused address (private, not https) is unreachable, never an error", async () => {
    const get: Get = async () => { throw new FetchRefused("blocked", "That address isn't on the public internet."); };
    expect((await checkSourceFrame("https://10.0.0.1/x.pdf", APP, get)).verdict).toBe("unreachable");
    expect((await checkSourceFrame("not a url", APP, get)).verdict).toBe("unreachable");
  });
});
