/**
 * Kivo Connect: real Postgres.
 *
 * Proves, through the same functions the MCP route calls:
 *   OAuth: registration, consent → code, PKCE exchange, single-use codes,
 *   refresh rotation, reuse revoking the grant, revocation, wrong resource.
 *   Isolation: another learner's ids reach nothing; search sees only one's own.
 *   Notes: create (idempotent by key, one note per title), stale update refused.
 *   Curation: duplicates skipped, same concept enriched, new notes filed, provenance kept.
 *   Maps: build nested topics, rebuild reuses; a big build needs approval.
 *   Reviewed changes: approval enforced by the server, a plan runs once, a
 *   record changed after preview is refused, partial failure reported.
 *   Analysis: unwritten [[links]] and an unfiled note's topic found.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/connect/__integration__/kivo-connect.itest.ts
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
const { createNote, getNote, updateNote } = await import("../../nova/product/notes.js");
const { loadStudyStructure } = await import("../../nova/product/setup-edit.js");
const { registerClient, exchangeCode, refreshTokens, authenticateAccessToken, revokeToken, findClient, listConnections, revokeConnection } = await import("../oauth.js");
const { checkAuthorize, decide } = await import("../authorize.js");
const { learnerFor } = await import("../learner.js");
const { TOOLS, runTool } = await import("../tools.js");
const { approvePendingPlan } = await import("../audit.js");
const { applyChanges } = await import("../changes.js");

const MCP = "https://kivo.test/api/mcp";
const ISSUER = "https://kivo.test";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const STAMP = Date.now();
const users: string[] = [];
const chats: string[] = [];
let n = 0;

after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: chats } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.novaConnectClient.deleteMany({ where: { name: { startsWith: `itest ${STAMP}` } } });
  await prisma.$disconnect();
});

async function account(subjects = [{ name: "Distributed Systems", topics: ["Consensus"] }]) {
  const key = `${STAMP}${++n}`;
  const user = await prisma.user.create({ data: { email: `c${key}@connect-itest.local`, name: `Connect ${key}` } });
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
  return user.id;
}

const verifier = () => randomBytes(32).toString("base64url");
const challengeOf = (v: string) => createHash("sha256").update(v).digest("base64url");

// The whole flow an assistant goes through: register, the learner allows,
// the code is exchanged. Returns the tokens and the learner for tool calls.
async function connect(userId: string, scope = "profile:read workspace:read notes:read notes:write knowledge:read knowledge:write") {
  const reg = await registerClient({ name: `itest ${STAMP} Claude`, redirectUris: [REDIRECT], tokenAuthMethod: "none" });
  const v = verifier();
  const check = await checkAuthorize({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, scope, state: "s1", code_challenge: challengeOf(v), code_challenge_method: "S256", resource: MCP }, MCP, ISSUER);
  assert.equal(check.ok, true, JSON.stringify(check));
  if (!check.ok) throw new Error("unreachable");
  const back = new URL(await decide(userId, check, true, ISSUER));
  assert.equal(back.searchParams.get("state"), "s1");
  assert.equal(back.searchParams.get("iss"), ISSUER);
  const client = (await findClient(reg.client_id))!;
  const tokens = await exchangeCode({ clientRowId: client.id, code: back.searchParams.get("code"), redirectUri: REDIRECT, verifier: v });
  assert.ok("access_token" in tokens, JSON.stringify(tokens));
  if (!("access_token" in tokens)) throw new Error("unreachable");
  const caller = (await authenticateAccessToken(tokens.access_token, MCP))!;
  const l = await learnerFor(caller);
  assert.equal(l.ok, true);
  if (!l.ok) throw new Error("unreachable");
  return { tokens, client, code: back.searchParams.get("code")!, verifier: v, learner: l.learner, ctx: { learner: l.learner, origin: ISSUER, confirm: null } };
}

const tool = (name: string) => TOOLS.find(t => t.name === name)!;
type R = { ok: boolean; error?: string; message?: string; data?: Record<string, any> };
const call = async (name: string, args: Record<string, unknown>, ctx: unknown): Promise<R> => (await runTool(tool(name), args, ctx as never)) as R;

test("OAuth: PKCE exchange, single-use code, rotation, reuse revokes, revocation, wrong resource", async () => {
  const userId = await account();
  const c = await connect(userId);
  assert.equal(c.tokens.scope.split(" ").length, 6);

  // The code was used once; again, it is refused.
  assert.deepEqual(Object.keys(await exchangeCode({ clientRowId: c.client.id, code: c.code, redirectUri: REDIRECT, verifier: c.verifier })), ["error", "error_description"]);
  // A token is only for the resource it was issued for.
  assert.equal(await authenticateAccessToken(c.tokens.access_token, "https://other.test/api/mcp"), null);

  const r1 = await refreshTokens({ clientRowId: c.client.id, refreshToken: c.tokens.refresh_token });
  assert.ok("access_token" in r1);
  if (!("access_token" in r1)) return;
  assert.equal(await authenticateAccessToken(c.tokens.access_token, MCP), null, "the old access token died with the rotation");
  assert.ok(await authenticateAccessToken(r1.access_token, MCP));
  // A refresh cannot widen scopes.
  assert.ok("error" in (await refreshTokens({ clientRowId: c.client.id, refreshToken: r1.refresh_token, scope: "notes:read admin" })));
  // Reusing the first refresh token (a stolen copy) ends the grant.
  assert.ok("error" in (await refreshTokens({ clientRowId: c.client.id, refreshToken: c.tokens.refresh_token })));
  assert.equal(await authenticateAccessToken(r1.access_token, MCP), null);

  // Revocation by the client, and by the learner from Settings.
  const d = await connect(userId);
  await revokeToken(d.tokens.refresh_token, d.client.id);
  assert.equal(await authenticateAccessToken(d.tokens.access_token, MCP), null);
  const e = await connect(userId);
  const list = await listConnections(userId);
  assert.ok(list.some(x => x.id === e.learner.grantId));
  assert.equal(await revokeConnection(userId, e.learner.grantId), true);
  assert.equal(await authenticateAccessToken(e.tokens.access_token, MCP), null);
});

test("OAuth: a wrong verifier, an unregistered redirect and plain PKCE are refused", async () => {
  const userId = await account();
  const reg = await registerClient({ name: `itest ${STAMP} GPT`, redirectUris: [REDIRECT], tokenAuthMethod: "none" });
  const v = verifier();
  const bad = await checkAuthorize({ response_type: "code", client_id: reg.client_id, redirect_uri: "https://evil.example/cb", code_challenge: challengeOf(v), code_challenge_method: "S256" }, MCP, ISSUER);
  assert.ok(!bad.ok && "show" in bad, "never redirected to an address the client did not register");
  const plain = await checkAuthorize({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: "x".repeat(43), code_challenge_method: "plain" }, MCP, ISSUER);
  assert.ok(!plain.ok && "redirect" in plain && plain.error === "invalid_request");
  const ok = await checkAuthorize({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challengeOf(v), code_challenge_method: "S256" }, MCP, ISSUER);
  assert.ok(ok.ok);
  if (!ok.ok) return;
  const code = new URL(await decide(userId, ok, true, ISSUER)).searchParams.get("code");
  const client = (await findClient(reg.client_id))!;
  assert.ok("error" in (await exchangeCode({ clientRowId: client.id, code, redirectUri: REDIRECT, verifier: verifier() })));
  const denied = new URL(await decide(userId, ok, false, ISSUER));
  assert.equal(denied.searchParams.get("error"), "access_denied");
});

test("scopes: a read-only connection gets no write tools' access", async () => {
  const userId = await account();
  const c = await connect(userId, "profile:read notes:read");
  assert.deepEqual(c.learner.scopes, ["profile:read", "notes:read"]);
  const { hasScopes } = await import("../oauth-rules.js");
  const allowed = TOOLS.filter(t => hasScopes(c.learner.scopes, t.scopes)).map(t => t.name).sort();
  assert.deepEqual(allowed, ["get_my_profile", "get_note", "list_recent_notes", "search_notes"].sort());
});

test("isolation: another learner's note, plan or search reaches nothing", async () => {
  const a = await connect(await account());
  const b = await connect(await account());
  const made = await call("create_note", { title: `Secret ${STAMP}`, text: "Only A may read this." }, a.ctx);
  assert.equal(made.ok, true, JSON.stringify(made));
  const noteId = made.data!.items[0].resource.id as string;
  assert.equal((await call("get_note", { noteId }, b.ctx)).error, "not_found");
  assert.equal((await call("update_note", { noteId, appendText: "B was here", baseUpdatedAt: new Date().toISOString() }, b.ctx)).ok, false);
  assert.equal((await call("search_notes", { query: `Secret ${STAMP}` }, b.ctx)).data!.results.length, 0);
  assert.equal((await call("search_notes", { query: `Secret ${STAMP}` }, a.ctx)).data!.results.length, 1);
  // A plan A previewed cannot be approved or run by B.
  const del = await call("delete_note", { noteId }, a.ctx);
  assert.equal(del.error, "approval_required");
  assert.equal(await approvePendingPlan(b.learner.userId, del.data!.planId), "not_found");
  const run = await call("execute_knowledge_changes", { planId: del.data!.planId, expiresAt: del.data!.expiresAt, changes: del.data!.changes }, b.ctx);
  assert.equal(run.ok, false);
  assert.ok(await getNote(a.learner.profileId, noteId), "A's note is still there");
  const audit = await prisma.novaConnectAudit.count({ where: { userId: b.learner.userId, outcome: "refused" } });
  assert.ok(audit >= 1, "the refused attempts were recorded");
});

test("notes: idempotent create, one note per title, a stale update overwrites nothing", async () => {
  const c = await connect(await account());
  const key = `create-${STAMP}`;
  const first = await call("create_note", { title: "RAG", text: "Retrieval-augmented generation.", subjectName: "Distributed Systems", idempotencyKey: key }, c.ctx);
  const retry = await call("create_note", { title: "RAG", text: "Retrieval-augmented generation.", subjectName: "Distributed Systems", idempotencyKey: key }, c.ctx);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(retry.data!.replayed, true);
  assert.equal(await prisma.novaNote.count({ where: { profileId: c.learner.profileId, title: "RAG" } }), 1);
  assert.equal(first.data!.verification.passed, true);
  assert.match(first.data!.items[0].resource.url, /^https:\/\/kivo\.test\/notes\//);

  const again = await call("create_note", { title: "rag", text: "Something else" }, c.ctx);
  assert.equal(again.data!.items[0].status, "skipped");

  const id = first.data!.items[0].resource.id as string;
  const read = await call("get_note", { noteId: `note:${id}` }, c.ctx);
  const opened = read.data!.updatedAt as string;
  await updateNote(c.learner.profileId, id, { body: "Edited on the web meanwhile." });
  const stale = await call("update_note", { noteId: id, appendText: "From the assistant", baseUpdatedAt: opened }, c.ctx);
  assert.equal(stale.ok, false);
  assert.match(JSON.stringify(stale), /changed since it was read/);
  assert.equal((await getNote(c.learner.profileId, id))!.body, "Edited on the web meanwhile.");
  const fresh = await call("update_note", { noteId: id, appendText: "From the assistant", baseUpdatedAt: (await getNote(c.learner.profileId, id))!.updatedAt }, c.ctx);
  assert.equal(fresh.ok, true, JSON.stringify(fresh));
  assert.match((await getNote(c.learner.profileId, id))!.body, /Edited on the web meanwhile\.[\s\S]*From the assistant/);
});

test("capture_knowledge: skip duplicates, enrich the same concept, create and file the new, keep provenance", async () => {
  const c = await connect(await account());
  const raft = await createNote(c.learner.profileId, { title: "Raft", body: "Raft elects a leader with randomized election timeouts and replicates the log to followers." });
  assert.ok(raft.ok);
  const items = [
    { title: "Leader election", kind: "concept", body: "Raft elects a leader with randomized election timeouts and replicates the log to followers." },
    { title: "Raft", kind: "explanation", body: "Terms act as logical clocks: a leader that sees a higher term steps down." },
    { title: "Vector clocks", kind: "concept", body: "Each process keeps one counter per process; comparing vectors orders events causally.", concepts: ["Consensus"] },
  ];
  const preview = await call("capture_knowledge", { items, subjectName: "Distributed Systems", source: { conversationTitle: "Distributed systems chat" }, mode: "preview" }, c.ctx);
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.deepEqual(preview.data!.decisions.map((d: any) => d.action), ["skip", "enrich", "create"]);
  assert.equal(await prisma.novaNote.count({ where: { profileId: c.learner.profileId } }), 1, "preview writes nothing");

  const applied = await call("capture_knowledge", { items, subjectName: "Distributed Systems", source: { conversationTitle: "Distributed systems chat" }, mode: "apply", idempotencyKey: `cap-${STAMP}` }, c.ctx);
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.data!.status, "completed");
  assert.equal(applied.data!.verification.passed, true);
  const enriched = (await getNote(c.learner.profileId, raft.ok ? raft.note.id : ""))!;
  assert.match(enriched.body, /Terms act as logical clocks/);
  assert.match(enriched.body, /Captured from a conversation with itest .* "Distributed systems chat"/);
  const vc = await prisma.novaNote.findFirstOrThrow({ where: { profileId: c.learner.profileId, title: "Vector clocks" }, include: { subject: true } });
  assert.equal(vc.subject?.name, "Distributed Systems");
  assert.equal(vc.topicName, "Consensus");
  assert.doesNotMatch(vc.body, /conversation [a-z0-9]{6,}|\[source\]/, "no invented id or URL");

  const again = await call("capture_knowledge", { items, subjectName: "Distributed Systems", mode: "apply" }, c.ctx);
  assert.equal(again.data!.status, "nothing_new", JSON.stringify(again.data!.decisions));
});

test("build_knowledge_map: nested topics are added once; a rebuild reuses them; a large one needs approval", async () => {
  const c = await connect(await account([{ name: "Computer Science", topics: ["Algorithms"] }]));
  const outline = [{ name: "Operating Systems", children: [{ name: "Processes", children: [{ name: "Scheduling", explanation: "Choosing which process runs next." }] }, { name: "Memory" }] }];
  const built = await call("build_knowledge_map", { subjectName: "Computer Science", outline, mode: "apply" }, c.ctx);
  assert.equal(built.ok, true, JSON.stringify(built));
  const st = await loadStudyStructure(c.learner.profileId);
  const cs = st.subjects.find(s => s.name === "Computer Science")!;
  const byName = new Map(cs.topics.map(t => [t.name, t]));
  assert.equal(byName.get("Processes")!.parentId, byName.get("Operating Systems")!.id);
  assert.equal(byName.get("Scheduling")!.parentId, byName.get("Processes")!.id);
  const details = await prisma.novaTopicMastery.findUniqueOrThrow({ where: { id: byName.get("Scheduling")!.id }, select: { details: true } });
  assert.match(JSON.stringify(details.details), /Choosing which process runs next/);

  const rebuilt = await call("build_knowledge_map", { subjectName: "Computer Science", outline, mode: "apply" }, c.ctx);
  assert.equal(rebuilt.data!.status, "nothing_to_add");

  const big = await call("build_knowledge_map", { subjectName: "Networks", outline: Array.from({ length: 14 }, (_, i) => ({ name: `Layer topic ${i}` })), mode: "apply" }, c.ctx);
  assert.equal(big.error, "approval_required");
  assert.equal((await loadStudyStructure(c.learner.profileId)).subjects.some(s => s.name === "Networks"), false, "nothing written before approval");
  const args = { planId: big.data!.planId, expiresAt: big.data!.expiresAt, changes: big.data!.changes };
  assert.equal((await call("execute_knowledge_changes", args, c.ctx)).error, "approval_required", "the server, not the model, enforces approval");
  assert.equal(await approvePendingPlan(c.learner.userId, args.planId), "approved");
  const ran = await call("execute_knowledge_changes", args, c.ctx);
  assert.equal(ran.ok, true, JSON.stringify(ran));
  assert.equal((await loadStudyStructure(c.learner.profileId)).subjects.find(s => s.name === "Networks")!.topics.length, 14);
  const twice = await call("execute_knowledge_changes", args, c.ctx);
  assert.equal(twice.data!.replayed, true, "a plan runs once");
});

test("reviewed changes: a record changed after preview is refused; tampered changes are refused", async () => {
  const c = await connect(await account());
  const made = await createNote(c.learner.profileId, { title: "Old note", body: "keep me" });
  assert.ok(made.ok);
  if (!made.ok) return;
  const del = await call("delete_note", { noteId: made.note.id }, c.ctx);
  assert.equal(del.error, "approval_required");
  await approvePendingPlan(c.learner.userId, del.data!.planId);
  await updateNote(c.learner.profileId, made.note.id, { body: "edited after the preview" });
  const run = await call("execute_knowledge_changes", { planId: del.data!.planId, expiresAt: del.data!.expiresAt, changes: del.data!.changes }, c.ctx);
  assert.equal(run.error, "conflict", JSON.stringify(run));
  assert.ok(await getNote(c.learner.profileId, made.note.id), "not deleted");

  const p = await call("preview_knowledge_changes", { changes: [{ op: "delete_note", noteId: made.note.id }] }, c.ctx);
  await approvePendingPlan(c.learner.userId, p.data!.planId);
  const other = await createNote(c.learner.profileId, { title: "Other", body: "x" });
  const tampered = await call("execute_knowledge_changes", { planId: p.data!.planId, expiresAt: p.data!.expiresAt, changes: [{ op: "delete_note", noteId: other.ok ? other.note.id : "" }] }, c.ctx);
  assert.equal(tampered.ok, false);
  assert.ok(await getNote(c.learner.profileId, other.ok ? other.note.id : ""), "an approval is not reusable for other changes");
  const real = await call("execute_knowledge_changes", { planId: p.data!.planId, expiresAt: p.data!.expiresAt, changes: [{ op: "delete_note", noteId: made.note.id }] }, c.ctx);
  assert.equal(real.ok, true, JSON.stringify(real));
  assert.equal(await getNote(c.learner.profileId, made.note.id), null);
  assert.equal(real.data!.verification.passed, true);
});

test("partial failure: what worked is reported, what failed is not called a success", async () => {
  const c = await connect(await account());
  const report = await applyChanges(c.learner.profileId, [
    { op: "create_note", title: "Gossip protocols", body: "Epidemic dissemination." },
    { op: "add_topics", subjectName: "No such subject", names: ["X"] },
  ]);
  assert.equal(report.status, "completed_with_warnings");
  assert.equal(report.counts.created, 1);
  assert.equal(report.counts.failed, 1);
  assert.equal(report.verification.passed, true);
  const gossip = await prisma.novaNote.findFirstOrThrow({ where: { profileId: c.learner.profileId, title: "Gossip protocols" } });
  const link = await call("link_notes", { fromNoteId: gossip.id, toNoteTitle: "A note that does not exist" }, c.ctx);
  assert.equal(link.ok, false);
  assert.equal((await getNote(c.learner.profileId, gossip.id))!.body, "Epidemic dissemination.", "a refused link changes nothing");
});

test("analysis: links to notes not written, unfiled notes with a topic's name, coverage against an objective", async () => {
  const c = await connect(await account([{ name: "Machine Learning", topics: ["Gradient Descent", "Backpropagation"] }]));
  await createNote(c.learner.profileId, { title: "Gradient descent notes", body: "See [[Learning rate schedules]] and [[Backpropagation]]." });
  const gaps = await call("find_knowledge_gaps", { expectedConcepts: ["Backpropagation", "Regularization"] }, c.ctx);
  assert.equal(gaps.ok, true, JSON.stringify(gaps));
  assert.deepEqual(gaps.data!.fromRecords.linksToNotesNotWrittenYet.map((x: any) => x.title), ["Learning rate schedules"]);
  assert.deepEqual(gaps.data!.againstObjective.concepts.map((x: any) => x.status), ["on_map", "not_found_in_kivo"]);
  const recs = await call("recommend_connections", {}, c.ctx);
  assert.ok(recs.data!.recommendations.some((r: any) => r.kind === "file_note" && r.change.topicName === "Gradient Descent"), JSON.stringify(recs.data));
  const analysis = await call("analyze_knowledge", { focus: "gradient" }, c.ctx);
  assert.equal(analysis.ok, true);
  assert.ok(analysis.data!.verified.unfiledNotes.length >= 1);
  const ws = await call("list_workspaces", {}, c.ctx);
  assert.ok(ws.data!.workspaces.some((w: any) => w.title === "Machine Learning"));
  const ctxRes = await call("get_workspace_context", { workspace: "Machine Learning" }, c.ctx);
  assert.equal(ctxRes.ok, true);
  assert.equal((await call("get_workspace_context", { workspace: "Nope" }, c.ctx)).error, "not_found");
  const map = await call("get_knowledge_map", { types: ["topic"] }, c.ctx);
  assert.equal(map.data!.nodes.length, 2);
  const conn = await call("get_node_connections", { nodeId: map.data!.nodes[0].id }, c.ctx);
  assert.ok(conn.data!.connections.length >= 1);
});
