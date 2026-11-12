/**
 * The saved-pages library — real Postgres (12 Nov).
 *
 * Proves: a save from the extension stores what the page said about itself
 * (checked), and its kind; a save with no metadata (an older extension) or
 * broken metadata is still saved; the same page reached by a tracking link, a
 * redirect's canonical or a YouTube share link is one entry and fills in what
 * it lacked, while two YouTube videos stay two and another learner's save is
 * theirs; collections are made once per name, renamed, and deleted without
 * losing a page; tags reuse the learner's spelling; search, filters and sort
 * run on the server and page through 1,000 saves with no row twice or
 * missing; rows saved before this change are listed with a kind read from
 * their address; another learner sees none of it.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/nova/__integration__/nova-saved-library.itest.ts
 */

import "./test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const { loadLibrary, organizeResource, readLibraryQuery, recordLearningEvent } = await import("../product/learning-events.js");
const { createCollection, deleteCollection, listCollections, ownsCollection, renameCollection } = await import("../product/resource-collections.js");

const STAMP = Date.now();
const chats: string[] = [];
let n = 0, ev = 0;
async function learner() {
  const id = `web:lib_${STAMP}_${n++}`;
  chats.push(id);
  const m = await prisma.messengerUser.create({ data: { platform: "web", platformChatId: id, persona: "nova", displayName: "Asha", novaAcademicProfile: { create: { onboardingComplete: true } } }, select: { novaAcademicProfile: { select: { id: true } } } });
  return { id, profileId: m.novaAcademicProfile!.id };
}
after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: chats } } });
  await prisma.$disconnect();
});
const save = (profileId: string, url: string, title: string, extra: Record<string, unknown> = {}) =>
  recordLearningEvent(profileId, { eventType: "resource_saved", clientEventId: `lib-${STAMP}-${ev++}-xxxxxxxx`, url, title, ...extra }, { source: "browser_extension" });
const q = (o: Record<string, string>) => readLibraryQuery(o);

test("saving: what the page said is kept and checked, its kind is worked out, and a save never depends on metadata", async () => {
  const L = await learner();
  const article = await save(L.profileId, "https://blog.example.com/rag-guide?utm_source=x", "A guide to RAG", { meta: {
    description: "How retrieval-augmented generation works.", imageUrl: "https://blog.example.com/og.png", author: "Ada", siteName: "Example Blog",
    publishedAt: "2026-09-01T00:00:00Z", types: ["BlogPosting"], cookie: "never read",
  } });
  assert.ok(article.success && article.action === "saved");
  const row = await prisma.novaLearningEvent.findUnique({ where: { id: article.eventId } });
  assert.deepEqual([row!.resourceType, row!.description, row!.imageUrl, row!.author, row!.siteName, row!.readingStatus], ["blog", "How retrieval-augmented generation works.", "https://blog.example.com/og.png", "Ada", "Example Blog", "unread"]);
  assert.equal(row!.publishedAt!.toISOString(), "2026-09-01T00:00:00.000Z");

  const video = await save(L.profileId, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "LangGraph in 10 minutes", { meta: { duration: "PT10M5S", author: "Some Channel" } });
  assert.ok(video.success);
  assert.deepEqual([video.resource.resourceType, video.resource.durationSeconds, video.resource.imageUrl], ["video", 605, "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"]);

  // An older extension (no meta) and a broken one: saved all the same.
  const old = await save(L.profileId, "https://arxiv.org/abs/1706.03762", "Attention Is All You Need");
  const broken = await save(L.profileId, "https://example.com/x", "X", { meta: { imageUrl: "javascript:alert(1)", publishedAt: "not a date", duration: "forever", types: "Article" } });
  assert.ok(old.success && broken.success);
  assert.equal(old.resource.resourceType, "paper");
  const b = await prisma.novaLearningEvent.findUnique({ where: { id: broken.eventId } });
  assert.deepEqual([b!.imageUrl, b!.publishedAt, b!.durationSeconds, b!.resourceType], [null, null, null, "page"]);
});

test("duplicates: one entry per page however it was reached; two videos stay two; another learner's save is theirs", async () => {
  const L = await learner(), M = await learner();
  const first = await save(L.profileId, "https://example.com/post", "Post");
  assert.ok(first.success);
  // Tracking parameters, www, a trailing slash: the same entry, and what it lacked is filled in.
  const again = await save(L.profileId, "https://www.example.com/post/?utm_campaign=z&fbclid=1", "Post (again)", { meta: { description: "Now with a description.", types: ["Article"] } });
  assert.ok(again.success && again.action === "already_saved" && again.eventId === first.eventId);
  const row = await prisma.novaLearningEvent.findUnique({ where: { id: first.eventId } });
  assert.deepEqual([row!.description, row!.resourceType], ["Now with a description.", "article"]);
  // Saved once more with less: nothing it had is lost.
  await save(L.profileId, "https://example.com/post", "Post");
  assert.equal((await prisma.novaLearningEvent.findUnique({ where: { id: first.eventId } }))!.description, "Now with a description.");
  // A short link whose page names its canonical address.
  const viaShort = await save(L.profileId, "https://short.example/abc", "Post", { canonicalUrl: "https://example.com/post" });
  assert.ok(viaShort.success && viaShort.eventId === first.eventId);
  // YouTube: a share link is the same video; another video is not.
  const v1 = await save(L.profileId, "https://www.youtube.com/watch?v=aaaaaaaaaaa", "V1");
  const v1share = await save(L.profileId, "https://youtu.be/aaaaaaaaaaa?si=xyz", "V1");
  const v2 = await save(L.profileId, "https://www.youtube.com/watch?v=bbbbbbbbbbb", "V2");
  assert.ok(v1.success && v1share.success && v2.success);
  assert.equal(v1share.eventId, v1.eventId);
  assert.notEqual(v2.eventId, v1.eventId);
  // Meaningful parameters: two searches are two pages.
  const s1 = await save(L.profileId, "https://example.com/search?q=rag", "S");
  const s2 = await save(L.profileId, "https://example.com/search?q=llm", "S");
  assert.ok(s1.success && s2.success && s1.eventId !== s2.eventId);
  // Another learner saving the same page has their own entry.
  const theirs = await save(M.profileId, "https://example.com/post", "Post");
  assert.ok(theirs.success && theirs.action === "saved" && theirs.eventId !== first.eventId);
});

test("collections and tags: made once, renamed, deleted without losing a page; tags reuse the learner's spelling; only their own", async () => {
  const L = await learner(), M = await learner();
  const a = await save(L.profileId, "https://example.com/a", "A");
  const b = await save(L.profileId, "https://example.com/b", "B");
  assert.ok(a.success && b.success);
  const made = await createCollection(L.profileId, { name: "  System   Design " });
  const twice = await createCollection(L.profileId, { name: "system design" });
  assert.ok(made.ok && twice.ok && made.collection!.id === twice.collection!.id && made.collection!.name === "System Design");
  const cid = made.collection!.id;

  const moved = await organizeResource(L.profileId, a.eventId, { collectionId: cid, tags: ["RAG", "#ai"], readingStatus: "reading", personalNote: "Read section 2 again." }, ownsCollection);
  assert.ok(moved.ok);
  assert.deepEqual([moved.resource.collection?.name, moved.resource.tags, moved.resource.readingStatus, moved.resource.personalNote], ["System Design", ["RAG", "ai"], "reading", "Read section 2 again."]);
  // The same tag typed differently on another page is the learner's spelling.
  const tagged = await organizeResource(L.profileId, b.eventId, { tags: ["rag", "AI", "Vector DBs"] }, ownsCollection);
  assert.ok(tagged.ok && JSON.stringify(tagged.resource.tags) === JSON.stringify(["RAG", "ai", "Vector DBs"]));

  // Another learner can't use or see it, or organise this page.
  assert.equal(await ownsCollection(M.profileId, cid), false);
  const intrude = await organizeResource(M.profileId, a.eventId, { readingStatus: "done" }, ownsCollection);
  assert.ok(!intrude.ok && intrude.error === "not_found");
  const mPage = await save(M.profileId, "https://example.com/m", "M");
  assert.ok(mPage.success);
  const wrong = await organizeResource(M.profileId, mPage.eventId, { collectionId: cid }, ownsCollection);
  assert.ok(!wrong.ok && wrong.error === "not_found");
  assert.ok(!(await organizeResource(L.profileId, a.eventId, { readingStatus: "finished" }, ownsCollection)).ok);

  assert.ok((await renameCollection(L.profileId, cid, { name: "Architecture" })).ok);
  assert.deepEqual((await listCollections(L.profileId)).map(c => [c.name, c.count]), [["Architecture", 1]]);
  const clash = await createCollection(L.profileId, { name: "Read later" });
  assert.ok(clash.ok);
  const dup = await renameCollection(L.profileId, clash.collection!.id, { name: "architecture" });
  assert.ok(!dup.ok && dup.error === "exists");
  // Deleting the collection keeps the page.
  assert.ok((await deleteCollection(L.profileId, cid)).ok);
  const kept = await prisma.novaLearningEvent.findUnique({ where: { id: a.eventId } });
  assert.deepEqual([!!kept, kept!.collectionId, kept!.tags], [true, null, ["RAG", "ai"]]);
  assert.ok(!(await deleteCollection(M.profileId, clash.collection!.id)).ok, "not theirs to delete");
});

test("the library: search, filters and sort on the server; 1,000 saves paged with none twice or missing; older rows listed; nothing of another learner's", async () => {
  const L = await learner(), M = await learner();
  const coll = await createCollection(L.profileId, { name: "ML" });
  assert.ok(coll.ok);
  const base = Date.now();
  const types = ["article", "video", "paper", "documentation", "blog", null];
  await prisma.novaLearningEvent.createMany({ data: Array.from({ length: 1000 }, (_, i) => ({
    profileId: L.profileId, eventType: "resource_saved", source: "browser_extension", clientEventId: `bulk-${STAMP}-${i}-xxxxxxxxxx`,
    url: `https://site${i % 7}.example.com/p/${i}`, domain: `site${i % 7}.example.com`, title: i % 50 === 0 ? `Vector databases ${i}` : `Resource ${String(i).padStart(4, "0")}`,
    occurredAt: new Date(base - i * 60_000), resourceType: types[i % types.length], readingStatus: i % 3 === 0 ? "done" : "unread",
    tags: i % 10 === 0 ? ["RAG"] : [], collectionId: i % 4 === 0 ? coll.collection!.id : null, processingStatus: "none",
  })) });
  await save(M.profileId, "https://example.com/theirs", "Vector databases (theirs)");

  // Paging the whole library: every row once, newest first.
  const seen: string[] = [];
  let cursor: string | undefined, pages = 0;
  do {
    const page = await loadLibrary(L.id, q({ limit: "100", ...(cursor ? { cursor } : {}) }));
    assert.ok(page.status === "ready");
    seen.push(...page.items.map(i => i.id));
    cursor = page.nextCursor ?? undefined;
    pages++;
    if (pages === 1) {
      assert.equal(page.items.length, 100);
      assert.equal(page.facets.total, 1000);
      assert.equal(page.facets.statuses.done, 334);
      assert.equal(page.facets.unfiled, 750);
      assert.deepEqual(page.facets.tags[0], { tag: "RAG", count: 100 });
      assert.ok(Date.parse(page.items[0]!.savedAt) >= Date.parse(page.items[99]!.savedAt));
    }
  } while (cursor && pages < 20);
  assert.equal(seen.length, 1000);
  assert.equal(new Set(seen).size, 1000);

  // Search and filters together.
  const found = await loadLibrary(L.id, q({ q: "vector", status: "done" }));
  assert.ok(found.status === "ready");
  assert.ok(found.matched > 0 && found.items.every(i => i.title.startsWith("Vector") && i.readingStatus === "done"));
  assert.ok(found.items.every(i => !i.title.includes("theirs")), "nothing of another learner's");
  const vids = await loadLibrary(L.id, q({ type: "article", collection: coll.collection!.id, limit: "100" }));
  assert.ok(vids.status === "ready" && vids.items.length > 0 && vids.matched === 84 && vids.items.every(i => i.resourceType === "article" && i.collection?.id === coll.collection!.id));
  // Rows saved before the library (no stored kind) are "page" here, worked out from the address.
  const pagesOnly = await loadLibrary(L.id, q({ type: "page", limit: "5" }));
  assert.ok(pagesOnly.status === "ready" && pagesOnly.matched === 166 && pagesOnly.items.every(i => i.resourceType === "page"));
  const tagged = await loadLibrary(L.id, q({ tag: "RAG" }));
  assert.ok(tagged.status === "ready" && tagged.matched === 100);
  const site = await loadLibrary(L.id, q({ domain: "site3.example.com" }));
  assert.ok(site.status === "ready" && site.items.every(i => i.domain === "site3.example.com"));
  const byTitle = await loadLibrary(L.id, q({ sort: "title", limit: "3" }));
  assert.ok(byTitle.status === "ready");
  assert.deepEqual(byTitle.items.map(i => i.title), [...byTitle.items.map(i => i.title)].sort());
  const recent = await loadLibrary(L.id, q({ days: "1", limit: "1" }));
  assert.ok(recent.status === "ready" && recent.matched === 1000);
  // Another learner's cursor or collection id is no way in.
  const other = await loadLibrary(M.id, q({ collection: coll.collection!.id }));
  assert.ok(other.status === "ready" && other.matched === 0);
});
