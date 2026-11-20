/**
 * Kivo Connect: Saved Pages over MCP, on real Postgres.
 *
 * Through the same functions the MCP route calls (runTool), with tokens made
 * by the real OAuth flow:
 *   save_page makes a real saved page (never a note), visible in the Saved
 *   Pages library and on the Knowledge Map, filed under the node asked for;
 *   duplicates are one entry and are never re-filed or unfiled by a save;
 *   filing, moving (only with replace) and unfiling keep the page;
 *   bad addresses, unknown or someone else's nodes and pages reach nothing;
 *   a retry with the same key writes once;
 *   a map built over MCP is listed where the web app lists maps.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/connect/__integration__/kivo-connect-pages.itest.ts
 */

import "../../nova/__integration__/test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const { resolveLearnerForAccount } = await import("../../nova/product/learner-identity.js");
const { saveSetup } = await import("../../nova/product/setup.js");
const { createNote } = await import("../../nova/product/notes.js");
const { loadStudyStructure } = await import("../../nova/product/setup-edit.js");
const { loadLibrary } = await import("../../nova/product/learning-events.js");
const { createCollection } = await import("../../nova/product/resource-collections.js");
const { loadNovaKnowledgeMap } = await import("../../nova/product/knowledge-map.js");
const { registerClient, exchangeCode, authenticateAccessToken, findClient } = await import("../oauth.js");
const { checkAuthorize, decide } = await import("../authorize.js");
const { learnerFor } = await import("../learner.js");
const { TOOLS, runTool } = await import("../tools.js");

const MCP = "https://kivo.test/api/mcp";
const ISSUER = "https://kivo.test";
const REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const STAMP = Date.now();
const users: string[] = [];
const chats: string[] = [];
let n = 0;

after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: chats } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.novaConnectClient.deleteMany({ where: { name: { startsWith: `pages ${STAMP}` } } });
  await prisma.$disconnect();
});

async function account(subjects = [{ name: "AI Fundamentals", topics: ["Neural Networks", "Transformers"] }, { name: "Operating Systems", topics: ["Paging"] }]) {
  const key = `${STAMP}${++n}`;
  const user = await prisma.user.create({ data: { email: `p${key}@connect-pages.local`, name: `Pages ${key}` } });
  users.push(user.id);
  await prisma.userProfile.create({ data: { userId: user.id, onboardingComplete: true, primaryPersona: "nova" } });
  const resolved = await resolveLearnerForAccount(user.id, user.name);
  assert.equal(resolved.kind, "learner");
  const chat = resolved.kind === "learner" ? resolved.platformChatId : "";
  chats.push(chat);
  const saved = await saveSetup(chat, { subjects, exams: [], dailyMinutes: 60, studyTime: null });
  assert.equal(saved.status, "saved", JSON.stringify(saved));
  const m = await prisma.messengerUser.findFirstOrThrow({ where: { platformChatId: chat }, select: { id: true } });
  await prisma.novaAcademicProfile.update({ where: { userId: m.id }, data: { onboardingComplete: true } });
  return { userId: user.id, chat };
}

// The real consent flow, with the scopes asked for.
async function connect(userId: string, scope = "profile:read workspace:read notes:read notes:write knowledge:read knowledge:write pages:write") {
  const reg = await registerClient({ name: `pages ${STAMP} ChatGPT`, redirectUris: [REDIRECT], tokenAuthMethod: "none" });
  const v = randomBytes(32).toString("base64url");
  const check = await checkAuthorize({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, scope, state: "s", code_challenge: createHash("sha256").update(v).digest("base64url"), code_challenge_method: "S256", resource: MCP }, MCP, ISSUER);
  assert.equal(check.ok, true, JSON.stringify(check));
  if (!check.ok) throw new Error("unreachable");
  const back = new URL(await decide(userId, check, true, ISSUER));
  const client = (await findClient(reg.client_id))!;
  const tokens = await exchangeCode({ clientRowId: client.id, code: back.searchParams.get("code"), redirectUri: REDIRECT, verifier: v });
  assert.ok("access_token" in tokens, JSON.stringify(tokens));
  if (!("access_token" in tokens)) throw new Error("unreachable");
  const l = await learnerFor((await authenticateAccessToken(tokens.access_token, MCP))!);
  if (!l.ok) throw new Error("no learner");
  return { learner: l.learner, ctx: { learner: l.learner, origin: ISSUER, confirm: null }, scopes: tokens.scope.split(" ") };
}

const tool = (name: string) => TOOLS.find(t => t.name === name)!;
type R = { ok: boolean; error?: string; message?: string; data?: Record<string, any> };
const call = async (name: string, args: Record<string, unknown>, ctx: unknown): Promise<R> => (await runTool(tool(name), args, ctx as never)) as R;

async function nodeIds(profileId: string) {
  const st = await loadStudyStructure(profileId);
  const ai = st.subjects.find(s => s.name === "AI Fundamentals")!;
  const os = st.subjects.find(s => s.name === "Operating Systems")!;
  return {
    ai: `subject:${ai.id}`, nn: `topic:${ai.topics.find(t => t.name === "Neural Networks")!.id}`,
    tr: `topic:${ai.topics.find(t => t.name === "Transformers")!.id}`, os: `subject:${os.id}`,
  };
}
const pagesOf = (profileId: string) => prisma.novaLearningEvent.findMany({ where: { profileId }, select: { id: true, url: true, source: true, subjectId: true, topicName: true, eventType: true } });

test("save_page makes a real saved page filed on a topic: in Saved Pages, on the map, and no note", async () => {
  const a = await account();
  const c = await connect(a.userId);
  const ids = await nodeIds(c.learner.profileId);
  const notesBefore = await prisma.novaNote.count({ where: { profileId: c.learner.profileId } });

  const r = await call("save_page", {
    url: "https://example.org/attention-is-all-you-need?utm_source=chatgpt.com", title: "Attention Is All You Need",
    description: "The Transformer paper.", nodeId: ids.tr, tags: ["paper", "transformers"],
  }, c.ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data!.status, "saved");
  const page = r.data!.page;
  assert.match(page.id, /^resource:/);
  assert.equal(page.kind, "saved_page");
  assert.equal(page.title, "Attention Is All You Need");
  assert.equal(page.description, "The Transformer paper.");
  assert.deepEqual(page.tags, ["paper", "transformers"]);
  assert.equal(page.filedUnder.nodeId, ids.tr);
  assert.equal(page.filedUnder.subject.name, "AI Fundamentals");
  assert.equal(page.filedUnder.topic.name, "Transformers");
  assert.ok(page.kivoUrl.startsWith(`${ISSUER}/saved?page=`));

  // A Saved Pages row from this connection, and no note.
  const rows = await pagesOf(c.learner.profileId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.eventType, "resource_saved");
  assert.equal(rows[0]!.source, "kivo_connect");
  assert.equal(await prisma.novaNote.count({ where: { profileId: c.learner.profileId } }), notesBefore, "no note was created");

  // The web app's library lists it; the map draws it on the topic.
  const lib = await loadLibrary(a.chat, { sort: "recent" });
  assert.ok(lib.status === "ready" && lib.items.some(i => `resource:${i.id}` === page.id));
  const map = await loadNovaKnowledgeMap(a.chat, { workspace: "all" });
  assert.equal(map.status, "ready");
  if (map.status !== "ready") return;
  assert.ok(map.nodes.some(nd => nd.id === page.id && nd.type === "resource"));
  assert.ok(map.edges.some(e => e.from === ids.tr && e.to === page.id), "the topic holds the page on the map");

  // Read back over MCP: by id, by address, the node's pages, the node's connections.
  const byId = await call("get_saved_page", { pageId: page.id }, c.ctx);
  assert.equal(byId.data!.page.url, page.url);
  const byUrl = await call("get_saved_page", { url: "https://example.org/attention-is-all-you-need" }, c.ctx);
  assert.equal(byUrl.data!.page.id, page.id, "the same page without its tracking parameter");
  const onNode = await call("search_saved_pages", { nodeId: ids.tr }, c.ctx);
  assert.deepEqual(onNode.data!.pages.map((p: { id: string }) => p.id), [page.id]);
  const inSubject = await call("search_saved_pages", { nodeId: ids.ai }, c.ctx);
  assert.equal(inSubject.data!.pages.length, 1, "a subject's pages include its topics'");
  assert.equal((await call("search_saved_pages", { nodeId: ids.nn }, c.ctx)).data!.pages.length, 0);
  assert.equal((await call("search_saved_pages", { query: "transformer" }, c.ctx)).data!.pages.length, 1);
  const conn = await call("get_node_connections", { nodeId: ids.tr }, c.ctx);
  assert.ok(conn.data!.connections.some((x: { other: { id: string } | null }) => x.other?.id === page.id));
});

test("a page already saved is one entry: a save never re-files or unfiles it", async () => {
  const a = await account();
  const c = await connect(a.userId);
  const ids = await nodeIds(c.learner.profileId);
  const first = await call("save_page", { url: "https://www.example.com/raft", title: "Raft", nodeId: ids.nn }, c.ctx);
  assert.equal(first.ok, true, JSON.stringify(first));

  // Again, unfiled, another spelling of the address: the existing page, still filed.
  const again = await call("save_page", { url: "http://example.com/raft/", title: "Raft (again)" }, c.ctx);
  assert.equal(again.data!.status, "already_saved", JSON.stringify(again));
  assert.equal(again.data!.page.id, first.data!.page.id);
  assert.equal(again.data!.page.filedUnder.nodeId, ids.nn, "saving it again did not unfile it");
  // Again, for another node: left where the learner filed it, and said so.
  const elsewhere = await call("save_page", { url: "https://example.com/raft", nodeId: ids.os }, c.ctx);
  assert.equal(elsewhere.data!.page.filedUnder.nodeId, ids.nn);
  assert.match(elsewhere.data!.notes.join(" "), /already filed under AI Fundamentals › Neural Networks/);
  assert.equal((await pagesOf(c.learner.profileId)).length, 1);

  // A page saved unfiled (as the extension saves it) is filed by a save that names a node.
  const loose = await call("save_page", { url: "https://example.com/paging" }, c.ctx);
  assert.equal(loose.data!.page.filedUnder, null);
  assert.equal(loose.data!.page.title, "Paging", "a title made from the address when none was given");
  const filed = await call("save_page", { url: "https://example.com/paging", nodeId: ids.os }, c.ctx);
  assert.equal(filed.data!.page.filedUnder.nodeId, ids.os);

  // The same key twice: one write.
  const k1 = await call("save_page", { url: "https://example.com/k", idempotencyKey: "same-key" }, c.ctx);
  const k2 = await call("save_page", { url: "https://example.com/k", idempotencyKey: "same-key" }, c.ctx);
  assert.equal(k2.data!.replayed, true);
  assert.equal(k2.data!.page.id, k1.data!.page.id);
  assert.equal((await pagesOf(c.learner.profileId)).length, 3);
});

test("file, move (only with replace) and unfile: the page itself always stays", async () => {
  const a = await account();
  const c = await connect(a.userId);
  const ids = await nodeIds(c.learner.profileId);
  const p = (await call("save_page", { url: "https://example.com/backprop", title: "Backpropagation" }, c.ctx)).data!.page;

  const f = await call("file_saved_page", { pageId: p.id, nodeId: ids.nn }, c.ctx);
  assert.equal(f.data!.status, "filed", JSON.stringify(f));
  assert.equal(f.data!.page.filedUnder.nodeId, ids.nn);
  assert.equal((await call("file_saved_page", { pageId: p.id, nodeId: ids.nn }, c.ctx)).data!.status, "already_filed");

  const refused = await call("file_saved_page", { pageId: p.id, nodeId: ids.tr }, c.ctx);
  assert.equal(refused.error, "conflict");
  assert.equal(refused.data!.filedUnder.nodeId, ids.nn);
  assert.equal((await call("get_saved_page", { pageId: p.id }, c.ctx)).data!.page.filedUnder.nodeId, ids.nn, "nothing moved");

  const moved = await call("file_saved_page", { pageId: p.id, nodeId: ids.tr, replace: true }, c.ctx);
  assert.equal(moved.data!.status, "moved");
  assert.equal(moved.data!.previouslyFiledUnder.nodeId, ids.nn);
  assert.equal(moved.data!.page.filedUnder.nodeId, ids.tr);

  const un = await call("unfile_saved_page", { pageId: p.id }, c.ctx);
  assert.equal(un.data!.status, "unfiled");
  assert.equal(un.data!.previouslyFiledUnder.nodeId, ids.tr);
  const still = await call("get_saved_page", { pageId: p.id }, c.ctx);
  assert.equal(still.ok, true, "the page is still saved");
  assert.equal(still.data!.page.filedUnder, null);
  assert.equal(still.data!.page.title, "Backpropagation");
  assert.equal((await call("search_saved_pages", { nodeId: ids.tr }, c.ctx)).data!.pages.length, 0);
  assert.equal((await call("unfile_saved_page", { pageId: p.id }, c.ctx)).data!.status, "not_filed");
});

test("bad input, unknown and someone else's nodes and pages reach nothing", async () => {
  const a = await account(), b = await account();
  const ca = await connect(a.userId), cb = await connect(b.userId);
  const idsA = await nodeIds(ca.learner.profileId), idsB = await nodeIds(cb.learner.profileId);

  for (const url of ["ftp://example.com/x", "javascript:alert(1)", "not a link", "file:///etc/passwd"]) {
    const r = await call("save_page", { url }, ca.ctx);
    assert.equal(r.error, "invalid_input", `${url}: ${JSON.stringify(r)}`);
  }
  // B's topic, a made-up id, a note id, an archived-looking prefix: refused before anything is saved.
  for (const nodeId of [idsB.tr, "topic:nope", "note:abc", "subject:"]) {
    const r = await call("save_page", { url: "https://example.com/x", nodeId }, ca.ctx);
    assert.ok(r.error === "not_found", `${nodeId}: ${JSON.stringify(r)}`);
  }
  assert.equal((await call("save_page", { url: "https://example.com/x", collection: "Nope" }, ca.ctx)).error, "not_found");
  assert.equal((await pagesOf(ca.learner.profileId)).length, 0, "nothing was saved by a refused call");

  // B's page: A can neither read, find, file nor unfile it.
  const pb = (await call("save_page", { url: "https://example.com/b-only", title: "B's page", nodeId: idsB.nn }, cb.ctx)).data!.page;
  assert.equal((await call("get_saved_page", { pageId: pb.id }, ca.ctx)).error, "not_found");
  assert.equal((await call("get_saved_page", { url: "https://example.com/b-only" }, ca.ctx)).error, "not_found");
  assert.equal((await call("file_saved_page", { pageId: pb.id, nodeId: idsA.nn }, ca.ctx)).error, "not_found");
  assert.equal((await call("unfile_saved_page", { pageId: pb.id }, ca.ctx)).error, "not_found");
  assert.equal((await call("search_saved_pages", { query: "B's page" }, ca.ctx)).data!.pages.length, 0);
  assert.equal((await call("search_saved_pages", { nodeId: idsB.nn }, ca.ctx)).error, "not_found");
  assert.equal((await call("get_saved_page", { pageId: pb.id }, cb.ctx)).data!.page.filedUnder.nodeId, idsB.nn, "B's page untouched");
  assert.equal((await call("get_saved_page", {}, ca.ctx)).error, "invalid_input");
});

test("organisation, notes kept apart, and the redirect from a note-shaped request", async () => {
  const a = await account();
  const c = await connect(a.userId);
  const col = await createCollection(c.learner.profileId, { name: "Read later" });
  assert.equal(col.ok, true);
  // An existing note with a link stays a note.
  const note = await createNote(c.learner.profileId, { title: "My thoughts on attention", body: "See https://example.org/attn for the paper." });
  assert.equal(note.ok, true);

  const r = await call("save_page", { url: "https://example.org/attn", title: "Attention", collection: "read later", personalNote: "Read section 3 first", tags: ["ML"] }, c.ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data!.page.collection, "Read later");
  assert.equal(r.data!.page.personalNote, "Read section 3 first");
  // Saved again with more tags and another note: tags added, the learner's note kept.
  const r2 = await call("save_page", { url: "https://example.org/attn", tags: ["papers"], personalNote: "different" }, c.ctx);
  assert.deepEqual([...r2.data!.page.tags].sort(), ["ML", "papers"]);
  assert.equal(r2.data!.page.personalNote, "Read section 3 first");
  assert.match(r2.data!.notes.join(" "), /already has a personal note/);

  const notes = await prisma.novaNote.findMany({ where: { profileId: c.learner.profileId }, select: { title: true } });
  assert.deepEqual(notes.map(x => x.title), ["My thoughts on attention"], "notes are untouched");
  assert.equal((await call("search_notes", { query: "attention" }, c.ctx)).data!.results.length, 1, "search_notes finds the note, not the page");

  // A note's tools say what to use for a page; connect_knowledge_nodes points to file_saved_page.
  assert.match(tool("create_note").description, /use save_page/);
  const viaConnect = await call("connect_knowledge_nodes", { from: r.data!.page.id, to: "subject:x", relation: "filed_under" }, c.ctx);
  assert.match(viaConnect.message ?? "", /file_saved_page/);
});

test("a map built over MCP is listed where the web app lists maps, and has an id that opens it", async () => {
  const a = await account([{ name: "Seed", topics: ["One"] }]);
  const c = await connect(a.userId);
  const built = await call("build_knowledge_map", { subjectName: "Graph Theory", outline: [{ name: "Trees" }, { name: "Cycles" }], mode: "apply" }, c.ctx);
  assert.equal(built.ok, true, JSON.stringify(built));
  const subjectId = built.data!.subject.id as string;
  assert.match(subjectId, /^subject:/);

  // MCP's own list, and the list the web map switcher reads (knowledge-map.ts): the same id.
  const listed = await call("list_workspaces", {}, c.ctx);
  assert.ok(listed.data!.workspaces.some((w: { id: string }) => w.id === subjectId));
  const map = await loadNovaKnowledgeMap(a.chat, { workspace: subjectId });
  assert.equal(map.status, "ready");
  if (map.status !== "ready") return;
  assert.ok(map.workspaces!.some(w => w.id === subjectId && w.title === "Graph Theory"), "in the map switcher");
  assert.equal(map.workspaceId, subjectId, "the map opens on it");
  assert.ok(map.nodes.some(nd => nd.type === "topic" && nd.label === "Trees"));
  assert.match(built.data!.mapUrl, /\/map\?explore=subject%3A/);
});

test("scopes: the save tools need pages:write; a connection made without it keeps only the reads", async () => {
  assert.deepEqual(["save_page", "file_saved_page", "unfile_saved_page"].map(t => tool(t).scopes), [["pages:write"], ["pages:write"], ["pages:write"]]);
  assert.deepEqual(["get_saved_page", "search_saved_pages"].map(t => tool(t).scopes), [["knowledge:read"], ["knowledge:read"]]);
  const a = await account();
  const old = await connect(a.userId, "profile:read workspace:read notes:read notes:write knowledge:read knowledge:write");
  assert.ok(!old.scopes.includes("pages:write"));
  const everything = await connect(a.userId, "");
  assert.ok(everything.scopes.includes("pages:write"), "a client that asks for nothing in particular gets every scope, the new one too");
});

test("MCP-03: the notes ChatGPT made instead of saved pages are found from the audit, read-only, with evidence", async () => {
  const { reviewAccidentalPageNotes } = await import("../accidental-notes.js");
  const a = await account();
  const gpt = await connect(a.userId);                    // registered as "… ChatGPT"
  // What happened before save_page existed: four links saved as notes.
  const made: string[] = [];
  for (const [title, url] of [["Attention paper", "https://arxiv.org/abs/1706.03762"], ["Karpathy video", "https://youtube.com/watch?v=kCc8FmEb1nY"], ["Illustrated Transformer", "https://jalammar.github.io/illustrated-transformer/"], ["Raft site", "https://raft.github.io/"]] as const) {
    const r = await call("create_note", { title, text: `Saved link: ${url}`, subjectName: "AI Fundamentals" }, gpt.ctx);
    assert.equal(r.ok, true, JSON.stringify(r));
    made.push(r.data!.items[0].resource.id);
  }
  // The learner wrote a real note with a link through ChatGPT too: not a candidate.
  await call("create_note", { title: "My notes on attention", text: "Scaled dot-product attention divides by sqrt(d_k) so the softmax does not saturate; multi-head attention lets each head attend to a different subspace. ".repeat(4) + "Source: https://arxiv.org/abs/1706.03762" }, gpt.ctx);
  // One was edited by the learner since; one page is already in Saved Pages.
  const edited = await prisma.novaNote.findUniqueOrThrow({ where: { id: made[3]! } });
  await prisma.novaNote.update({ where: { id: edited.id }, data: { createdAt: new Date(Date.now() - 3_600_000) } });
  await prisma.novaNote.update({ where: { id: edited.id }, data: { body: `${edited.body}\n\nRead the paper section first.` } });
  await call("save_page", { url: "https://jalammar.github.io/illustrated-transformer/" }, gpt.ctx);
  // A note made by another assistant (Claude) is not counted as ChatGPT's.
  const reg = await registerClient({ name: `pages ${STAMP} Claude`, redirectUris: ["https://claude.ai/api/mcp/auth_callback"], tokenAuthMethod: "none" });
  void reg;

  const before = { notes: await prisma.novaNote.count({ where: { profileId: gpt.learner.profileId } }), pages: await prisma.novaLearningEvent.count({ where: { profileId: gpt.learner.profileId } }) };
  const r = await reviewAccidentalPageNotes(a.userId, { client: "chatgpt", since: new Date(Date.now() - 86_400_000) });
  assert.equal(r.found, true);
  if (!r.found) return;
  const c = r.candidates.filter(x => "title" in x) as Array<{ noteId: string; title: string; urls: string[]; recommendation: string; editedAfterCreation: boolean; alreadyInSavedPages: Array<{ pageId: string | null }> }>;
  assert.deepEqual(c.map(x => x.title).sort(), ["Attention paper", "Illustrated Transformer", "Karpathy video", "Raft site"], "the four, and not the learner's real note");
  const by = (t: string) => c.find(x => x.title === t)!;
  assert.match(by("Attention paper").recommendation, /^convert: save the page/);
  assert.match(by("Illustrated Transformer").recommendation, /already in Saved Pages/);
  assert.ok(by("Illustrated Transformer").alreadyInSavedPages[0]!.pageId);
  assert.equal(by("Raft site").editedAfterCreation, true);
  assert.match(by("Raft site").recommendation, /^review/);
  // Read-only: nothing changed.
  assert.deepEqual({ notes: await prisma.novaNote.count({ where: { profileId: gpt.learner.profileId } }), pages: await prisma.novaLearningEvent.count({ where: { profileId: gpt.learner.profileId } }) }, before);
  // Another client's name finds none of them.
  const claude = await reviewAccidentalPageNotes(a.userId, { client: "claude", since: new Date(Date.now() - 86_400_000) });
  assert.equal(claude.found && claude.candidates.length, 0);
});
