// What a saved page is, and what it says about itself (resource-meta.ts), 12 Nov.
import { classifyResource, cleanTag, dedupeKey, durationOf, fallbackImage, mergeTags, NO_META, readPageMeta, safeImageUrl, youtubeId } from "../product/resource-meta";

const now = new Date("2026-11-12T10:00:00Z");
const meta = (m: Record<string, unknown>) => readPageMeta(m, now);

describe("the kind of resource", () => {
  it("from the address's structure when it is unambiguous", () => {
    expect(classifyResource("https://www.youtube.com/watch?v=dQw4w9WgXcQ").type).toBe("video");
    expect(classifyResource("https://youtu.be/dQw4w9WgXcQ?si=abc").type).toBe("video");
    expect(classifyResource("https://www.youtube.com/shorts/abcdEFG1234").type).toBe("video");
    expect(classifyResource("https://arxiv.org/abs/1706.03762").type).toBe("paper");
    expect(classifyResource("https://doi.org/10.1145/3292500").type).toBe("paper");
    expect(classifyResource("https://www.nature.com/articles/s41586-021-03819-2").type).toBe("paper");
    expect(classifyResource("https://developer.mozilla.org/en-US/docs/Web/API/fetch").type).toBe("documentation");
    expect(classifyResource("https://docs.python.org/3/library/asyncio.html").type).toBe("documentation");
  });
  it("from what the page declares itself to be", () => {
    expect(classifyResource("https://blog.example.com/p/1", meta({ types: ["BlogPosting"] })).type).toBe("blog");
    expect(classifyResource("https://news.example.com/x", meta({ types: ["NewsArticle"] }))).toEqual({ type: "news", basis: "page" });
    expect(classifyResource("https://example.com/how", meta({ types: ["HowTo"] })).type).toBe("tutorial");
    expect(classifyResource("https://example.com/a", meta({ types: ["article"] })).type).toBe("article");
    expect(classifyResource("https://example.com/p", meta({ citation: true })).type).toBe("paper");
    expect(classifyResource("https://example.com/v", meta({ types: ["video.other"] })).type).toBe("video");
  });
  it("never from a word in the address; unsure is a web page", () => {
    expect(classifyResource("https://example.com/tutorial-on-react").type).toBe("page");
    expect(classifyResource("https://example.com/news/video-paper-docs").type).toBe("page");
    expect(classifyResource("https://example.com/report.pdf")).toEqual({ type: "page", basis: "none" });
    expect(classifyResource("not a url").type).toBe("page");
  });
});

describe("duplicates", () => {
  it("tracking parameters, host spellings, fragments and a trailing slash do not make a new page", () => {
    const key = dedupeKey("https://example.com/post");
    for (const u of ["https://www.example.com/post/", "https://EXAMPLE.com/post?utm_source=x&utm_medium=y", "http://example.com/post#top", "https://example.com/post?fbclid=1&gclid=2"]) expect(dedupeKey(u)).toBe(key);
  });
  it("meaningful parameters are kept, in any order", () => {
    expect(dedupeKey("https://example.com/search?q=rag&page=2")).toBe(dedupeKey("https://example.com/search?page=2&q=rag"));
    expect(dedupeKey("https://example.com/search?q=rag")).not.toBe(dedupeKey("https://example.com/search?q=llm"));
    expect(dedupeKey("https://example.com/item?id=1")).not.toBe(dedupeKey("https://example.com/item?id=2"));
  });
  it("one YouTube video however it is linked; two videos are never one", () => {
    const k = dedupeKey("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    for (const u of ["https://youtu.be/dQw4w9WgXcQ?si=share", "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42", "https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ"]) expect(dedupeKey(u)).toBe(k);
    expect(dedupeKey("https://www.youtube.com/watch?v=aaaaaaaaaaa")).not.toBe(k);
    expect(youtubeId("https://www.youtube.com/watch?v=<script>")).toBeNull();
  });
});

describe("what a page says about itself", () => {
  it("is checked and bounded; a bad field is null, never an error", () => {
    const m = meta({ description: ` ${"word ".repeat(200)}`, imageUrl: "http://insecure.example.com/a.png", author: "Ada\nLovelace", siteName: "Blog", publishedAt: "2031-01-01", duration: "PT1H2M3S", types: ["Article", 42], citation: "yes", extra: "ignored" });
    expect(m.description!.length).toBeLessThanOrEqual(500);
    expect(m.imageUrl).toBeNull();
    expect(m.author).toBe("Ada Lovelace");
    expect(m.publishedAt).toBeNull();
    expect(m.durationSeconds).toBe(3723);
    expect(m.declaredTypes).toEqual(["article"]);
    expect(m.citation).toBe(false);
    for (const raw of [null, "x", [], 42]) expect(readPageMeta(raw, now)).toEqual(NO_META);
  });
  it("images: https only, no login; a YouTube video falls back to its own thumbnail", () => {
    expect(safeImageUrl("https://cdn.example.com/og.png")).toBe("https://cdn.example.com/og.png");
    expect(safeImageUrl("https://user:pw@cdn.example.com/og.png")).toBeNull();
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
    expect(fallbackImage("https://youtu.be/dQw4w9WgXcQ")).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(fallbackImage("https://example.com")).toBeNull();
  });
  it("durations", () => {
    expect([durationOf("PT12M"), durationOf("PT45S"), durationOf(600), durationOf("12:00"), durationOf("P1D"), durationOf(-5)]).toEqual([720, 45, 600, null, null, null]);
  });
});

describe("tags", () => {
  it("cleaned, each once in any case, the learner's own spelling reused, at most twelve", () => {
    expect(cleanTag("  #Vector   Databases ")).toBe("Vector Databases");
    expect(cleanTag("x".repeat(41))).toBeNull();
    expect(mergeTags(["rag", "RAG", "#ai", " Research ", "", 42], ["RAG", "AI"])).toEqual(["RAG", "AI", "Research"]);
    expect(mergeTags(Array.from({ length: 20 }, (_, i) => `t${i}`), [])).toHaveLength(12);
  });
});
