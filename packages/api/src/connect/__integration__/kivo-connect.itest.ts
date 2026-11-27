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
const { checkAuthorize, decide, STATE_MAX } = await import("../authorize.js");
const { learnerFor } = await import("../learner.js");
const { TOOLS, runTool } = await import("../tools.js");
const { approvePendingPlan, pendingPlan } = await import("../audit.js");
const { approveAndApply } = await import("../plans.js");
const { noteHeads } = await import("../../nova/product/notes.js");
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

test("OAuth: a long state (OpenAI's platform sends a signed relay token, ~900 characters) comes back exactly; one too long is refused, never dropped", async () => {
  const userId = await account();
  const reg = await registerClient({ name: `itest ${STAMP} OpenAI`, redirectUris: [REDIRECT], tokenAuthMethod: "none" });
  const v = verifier();
  const scope = "profile:read notes:read";
  const state = `openai_platform_oauth_relay__${"eyJ".padEnd(880, "x")}`;
  const ok = await checkAuthorize({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, scope, state, code_challenge: challengeOf(v), code_challenge_method: "S256", resource: MCP }, MCP, ISSUER);
  assert.ok(ok.ok);
  if (!ok.ok) return;
  const back = new URL(await decide(userId, ok, true, ISSUER));
  assert.equal(back.searchParams.get("state"), state, "returned unchanged");
  assert.ok(back.searchParams.get("code"));
  const tooLong = await checkAuthorize({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, scope, state: "s".repeat(STATE_MAX + 1), code_challenge: challengeOf(v), code_challenge_method: "S256", resource: MCP }, MCP, ISSUER);
  assert.ok(!tooLong.ok && "show" in tooLong, "refused on Kivo's page, not sent back without its state");
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

test("Phase 2: a rename waits for approval (K-10); Approve on Kivo applies it at once; the assistant reads the result; Decline stops a plan for good", async () => {
  const c = await connect(await account());
  const made = await createNote(c.learner.profileId, { title: "Raft notes", body: "leader election", subjectId: (await loadStudyStructure(c.learner.profileId)).subjects[0]!.id, topicName: "Consensus" });
  assert.ok(made.ok); if (!made.ok) return;
  const web = { userId: c.learner.userId, profileId: c.learner.profileId, origin: ISSUER };

  // K-10: nothing renamed before approval; the approval names old and new (K-01).
  const asked = await call("update_note", { noteId: `note:${made.note.id}`, newTitle: "Raft: leader election", baseUpdatedAt: made.note.updatedAt }, c.ctx);
  assert.equal(asked.error, "approval_required", JSON.stringify(asked));
  assert.equal((await getNote(c.learner.profileId, made.note.id))!.title, "Raft notes", "not renamed before approval");
  assert.deepEqual(asked.data!.summary, ["Rename note “Raft notes” to “Raft: leader election” (filed under Distributed Systems › Consensus)"]);
  assert.doesNotMatch(JSON.stringify(asked.data!.summary), new RegExp(made.note.id));
  const stored = await pendingPlan(c.learner.userId, asked.data!.planId);
  assert.equal((stored!.items as any[])[0].to, "Raft: leader election");

  // Still waiting: the assistant is told so, nothing ran.
  const waiting = await call("check_approval", { planId: asked.data!.planId }, c.ctx);
  assert.equal(waiting.data!.approval, "waiting");

  // One click on Kivo: approved and applied, read back.
  const t0 = Date.now();
  const clicked = await approveAndApply(web, asked.data!.planId);
  const approveMs = Date.now() - t0;
  assert.equal(clicked.status, "applied", JSON.stringify(clicked));
  assert.equal((await getNote(c.learner.profileId, made.note.id))!.title, "Raft: leader election");
  assert.equal((await pendingPlan(c.learner.userId, asked.data!.planId))!.changes, undefined, "changes are not kept once run");
  const result = await call("check_approval", { planId: asked.data!.planId }, c.ctx);
  assert.equal(result.data!.approval, "applied", JSON.stringify(result));
  assert.equal(result.data!.status, "completed");
  assert.match(result.data!.items[0].resource.url, /\/notes\//);
  // The assistant's own execute after that runs nothing again.
  const replay = await call("execute_knowledge_changes", { planId: asked.data!.planId, expiresAt: asked.data!.expiresAt, changes: asked.data!.changes }, c.ctx);
  assert.equal(replay.data!.replayed, true);
  assert.equal((await approveAndApply(web, asked.data!.planId)).status, "applied", "a second click applies nothing new");

  // Decline: recorded; neither Kivo nor the assistant can run it afterwards.
  const del = await call("delete_note", { noteId: made.note.id }, c.ctx);
  assert.equal(del.error, "approval_required");
  assert.equal(del.data!.summary[0], "Delete note “Raft: leader election” (filed under Distributed Systems › Consensus)");
  const { declinePendingPlan } = await import("../audit.js");
  assert.equal(await declinePendingPlan(c.learner.userId, del.data!.planId), "declined");
  assert.equal((await approveAndApply(web, del.data!.planId)).status, "declined");
  const refused = await call("execute_knowledge_changes", { planId: del.data!.planId, expiresAt: del.data!.expiresAt, changes: del.data!.changes }, c.ctx);
  assert.equal(refused.error, "declined");
  assert.equal((await call("check_approval", { planId: del.data!.planId }, c.ctx)).data!.approval, "declined");
  assert.ok(await getNote(c.learner.profileId, made.note.id), "a declined delete deletes nothing");

  // A note edited after the preview: the click applies nothing.
  const del2 = await call("delete_note", { noteId: made.note.id }, c.ctx);
  await updateNote(c.learner.profileId, made.note.id, { body: "edited meanwhile" });
  assert.equal((await approveAndApply(web, del2.data!.planId)).status, "changed");
  assert.ok(await getNote(c.learner.profileId, made.note.id), "not deleted");

  // Another learner cannot approve, decline or read this plan.
  const other = await connect(await account());
  assert.equal((await approveAndApply({ userId: other.learner.userId, profileId: other.learner.profileId, origin: ISSUER }, del2.data!.planId)).status, "not_found");
  assert.equal((await call("check_approval", { planId: del2.data!.planId }, other.ctx)).error, "not_found");
  console.log(JSON.stringify({ measure: "approve_and_apply_ms", ms: approveMs }));
});

test("Phase 2: a plan with note text is not kept on the server; Approve only approves it", async () => {
  const c = await connect(await account());
  const changes = Array.from({ length: 13 }, (_, i) => ({ op: "create_note", title: `Bulk ${i}`, body: `text ${i}` }));
  const p = await call("preview_knowledge_changes", { changes }, c.ctx);
  assert.equal(p.data!.approvalRequired, true);
  assert.equal((await pendingPlan(c.learner.userId, p.data!.planId))!.changes, undefined);
  const r = await approveAndApply({ userId: c.learner.userId, profileId: c.learner.profileId, origin: ISSUER }, p.data!.planId);
  assert.equal(r.status, "approved");
  assert.equal(await prisma.novaNote.count({ where: { profileId: c.learner.profileId, title: { startsWith: "Bulk " } } }), 0);
  const ran = await call("execute_knowledge_changes", { planId: p.data!.planId, expiresAt: p.data!.expiresAt, changes }, c.ctx);
  assert.equal(ran.ok, true, JSON.stringify(ran));
  assert.equal(await prisma.novaNote.count({ where: { profileId: c.learner.profileId, title: { startsWith: "Bulk " } } }), 13);
});

test("Phase 2: a new subject comes back with its id (K-28B); workspaces link to their own map (K-28A); previews read notes in one query", async () => {
  const c = await connect(await account());
  const built = await call("build_knowledge_map", { subjectName: "Distributed Systems Two", outline: [{ name: "Gossip" }], mode: "apply" }, c.ctx);
  assert.equal(built.ok, true, JSON.stringify(built));
  const made = (await loadStudyStructure(c.learner.profileId)).subjects.find(s => s.name === "Distributed Systems Two")!;
  assert.deepEqual(built.data!.subject, { id: `subject:${made.id}`, name: "Distributed Systems Two", exists: true, created: true, existedBefore: false });
  assert.equal(built.data!.mapUrl, `${ISSUER}/map?explore=${encodeURIComponent(`subject:${made.id}`)}`);
  const again = await call("build_knowledge_map", { subjectName: "Distributed Systems Two", outline: [{ name: "Gossip" }, { name: "CRDTs" }], mode: "apply" }, c.ctx);
  assert.deepEqual(again.data!.subject, { id: `subject:${made.id}`, name: "Distributed Systems Two", exists: true, created: false, existedBefore: true });

  const ws = await call("list_workspaces", {}, c.ctx);
  const urls = ws.data!.workspaces.map((w: any) => w.url);
  assert.equal(new Set(urls).size, urls.length, "every workspace has its own link");
  for (const w of ws.data!.workspaces) assert.ok(w.url.includes(encodeURIComponent(w.id)) || w.url.includes(w.id.split(":")[1]), JSON.stringify(w));

  // Measured: the old preview read each touched note in full, one after another.
  const ids: string[] = [];
  for (let i = 0; i < 12; i++) { const r = await createNote(c.learner.profileId, { title: `Timing ${i}`, body: `[[Timing ${(i + 1) % 12}]] body ${i}` }); if (r.ok) ids.push(r.note.id); }
  const t0 = Date.now(); for (const id of ids) await getNote(c.learner.profileId, id); const before = Date.now() - t0;
  const t1 = Date.now(); const heads = await noteHeads(c.learner.profileId, ids); const after = Date.now() - t1;
  assert.equal(heads.length, 12);
  console.log(JSON.stringify({ measure: "note_versions_12_notes", beforeMs: before, afterMs: after, readsBefore: "12 full note reads, one after another", readsAfter: "1 query" }));
});

// ── Images (MCP image support) ───────────────────────────────────────────────
const { deflateSync, crc32 } = await import("node:zlib");
function png(w: number, h: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), ...Array.from({ length: w }, () => Buffer.from(rgb))]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}
const imageRows = (profileId: string) => prisma.novaNoteImage.count({ where: { profileId } });
const OS_TEXT = "# Operating Systems\n\nIntro with $O(1)$ maths and **bold**.\n\n## Paging\n\nPages are fixed size.\n\n## Scheduling\n\nRound robin.";

test("images: a note made with a screenshot, more appended and inserted under a heading, read back as the images themselves; retries store nothing twice", async () => {
  const c = await connect(await account());
  const pid = c.learner.profileId;
  const [p1, p2, p3, p4] = [png(4, 3, [255, 0, 0]), png(5, 2, [0, 255, 0]), png(2, 6, [0, 0, 255]), png(3, 3, [9, 9, 9])];

  // 1. Create with one screenshot.
  const made = await call("create_note", { title: "Operating Systems", text: OS_TEXT, subjectName: "Distributed Systems", images: [{ data: p1.toString("base64"), caption: "Page table [fig 1]" }], idempotencyKey: "os-img-1" }, c.ctx);
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.equal(made.data!.status, "completed");
  assert.equal(made.data!.images.length, 1);
  assert.deepEqual([made.data!.images[0].caption, made.data!.images[0].width, made.data!.images[0].height, made.data!.images[0].mimeType], ["Page table fig 1", 4, 3, "image/png"]);
  const noteId = made.data!.items[0].resource.id as string;
  let note = (await getNote(pid, noteId))!;
  const id1 = (made.data!.images[0].imageId as string).slice(6);
  assert.equal(note.body, `${OS_TEXT}\n\n![Page table fig 1](kivo-image:${id1})`, "the text is kept exactly, the image after it");
  assert.equal(note.subjectName, "Distributed Systems");
  // The same call again (a retry) is the first result; nothing is stored twice.
  const again = await call("create_note", { title: "Operating Systems", text: OS_TEXT, images: [{ data: p1.toString("base64") }], idempotencyKey: "os-img-1" }, c.ctx);
  assert.equal(again.data!.replayed, true);
  assert.equal(await imageRows(pid), 1);

  // 2. Append a screenshot at the end; a retry without a key adds nothing.
  const appended = await call("update_note", { noteId, images: [{ data: p2.toString("base64"), caption: "Second" }], baseUpdatedAt: note.updatedAt }, c.ctx);
  assert.equal(appended.ok, true, JSON.stringify(appended));
  note = (await getNote(pid, noteId))!;
  assert.ok(note.body.startsWith(`${OS_TEXT}\n\n![Page table fig 1]`), "earlier text and image untouched");
  assert.ok(note.body.endsWith(`![Second](${"kivo-image:" + (appended.data!.images[0].imageId as string).slice(6)})`));
  const retry = await call("update_note", { noteId, images: [{ data: p2.toString("base64"), caption: "Second" }], baseUpdatedAt: note.updatedAt }, c.ctx);
  assert.equal(retry.ok, true);
  assert.equal(retry.data!.items[0].status, "skipped");
  assert.equal(retry.data!.images[0].alreadyStored, true);
  assert.equal(await imageRows(pid), 2, "a safe retry stores no second copy");
  assert.equal((await getNote(pid, noteId))!.body, note.body);

  // 3. Two screenshots and a line of text at the end of the "Paging" section.
  const inserted = await call("update_note", { noteId, appendText: "Diagrams of paging:", afterHeading: "paging", images: [{ data: p3.toString("base64"), caption: "TLB" }, { data: p4.toString("base64"), caption: "Walk" }], baseUpdatedAt: note.updatedAt, idempotencyKey: "os-img-3" }, c.ctx);
  assert.equal(inserted.ok, true, JSON.stringify(inserted));
  note = (await getNote(pid, noteId))!;
  const [i3, i4] = (inserted.data!.images as Array<{ imageId: string }>).map(i => i.imageId.slice(6));
  assert.ok(note.body.includes(`Pages are fixed size.\n\nDiagrams of paging:\n\n![TLB](kivo-image:${i3})\n\n![Walk](kivo-image:${i4})\n\n## Scheduling`), note.body);
  for (const line of OS_TEXT.split("\n").filter(Boolean)) assert.ok(note.body.includes(line), `kept: ${line}`);

  // 4. Read: the list (no bytes), in the note's order, with captions.
  const read = await call("get_note", { noteId }, c.ctx);
  const images = read.data!.images as Array<Record<string, any>>;
  assert.deepEqual(images.map(i => [i.order, i.caption, i.available, i.width, i.height]), [[1, "TLB", true, 2, 6], [2, "Walk", true, 3, 3], [3, "Page table fig 1", true, 4, 3], [4, "Second", true, 5, 2]], "in the order the note shows them");
  assert.equal((read as any).media, undefined, "no bytes unless asked");
  assert.ok(read.data!.imagesHint);

  // 5. The images themselves, a page at a time, each the stored bytes, labelled with its note and caption.
  const look = (await runTool(tool("get_note"), { noteId, includeImages: true }, c.ctx as never)) as any;
  assert.equal(look.ok, true);
  assert.equal(look.media.length, 3);
  assert.deepEqual(look.media.map((m: any) => Buffer.from(m.data, "base64")), [p3, p4, p1]);
  assert.ok(look.media.every((m: any) => m.mimeType === "image/png"));
  assert.match(look.media[1].label, /^Image 2 of 4 in note "Operating Systems", caption: Walk \(image:/);
  assert.deepEqual([look.data.imagesReturned, look.data.nextImageOffset], [[1, 2, 3], 3]);
  const rest = (await runTool(tool("get_note"), { noteId, includeImages: true, imageOffset: 3 }, c.ctx as never)) as any;
  assert.deepEqual(rest.media.map((m: any) => Buffer.from(m.data, "base64")), [p2]);
  assert.equal(rest.data.nextImageOffset, null);

  // 6. Text-only work on the same note is as before.
  const text = await call("update_note", { noteId, appendText: "Plain text still works.", baseUpdatedAt: (await getNote(pid, noteId))!.updatedAt }, c.ctx);
  assert.equal(text.ok, true);
  assert.ok((await getNote(pid, noteId))!.body.endsWith("Plain text still works."));
});

test("images: another learner reaches none; a stale note, a bad image or a missing heading changes nothing and leaves no image behind", async () => {
  const a = await connect(await account());
  const b = await connect(await account());
  const shot = png(3, 2, [1, 2, 3]).toString("base64");
  const made = await call("create_note", { title: "Private diagram", text: "Mine.", images: [{ data: shot, caption: "secret" }] }, a.ctx);
  const noteA = made.data!.items[0].resource.id as string;
  const imgA = (made.data!.images[0].imageId as string).slice(6);

  // B: A's note is not found, to read or to write; nothing is stored for B.
  assert.equal((await call("get_note", { noteId: noteA, includeImages: true }, b.ctx)).error, "not_found");
  assert.equal((await call("update_note", { noteId: noteA, images: [{ data: shot }], baseUpdatedAt: new Date().toISOString() }, b.ctx)).error, "not_found");
  assert.equal(await imageRows(b.learner.profileId), 0);
  // B's own note naming A's image id shows it as unavailable, never its bytes.
  const forged = await createNote(b.learner.profileId, { title: "Forged", body: `![x](kivo-image:${imgA})` });
  assert.ok(forged.ok);
  const peek = (await runTool(tool("get_note"), { noteId: forged.ok ? forged.note.id : "", includeImages: true }, b.ctx as never)) as any;
  assert.equal(peek.ok, true);
  assert.deepEqual(peek.data.images.map((i: any) => i.available), [false]);
  assert.equal(peek.media?.length ?? 0, 0);

  const before = (await getNote(a.learner.profileId, noteA))!;
  const rows = await imageRows(a.learner.profileId);
  const other = png(6, 6, [7, 7, 7]).toString("base64");
  // Stale: the note changed since it was read.
  const stale = await call("update_note", { noteId: noteA, images: [{ data: other }], baseUpdatedAt: new Date(Date.parse(before.updatedAt as unknown as string) - 60_000).toISOString() }, a.ctx);
  assert.equal(stale.error, "conflict");
  // Not an image a note takes.
  const gif = await call("update_note", { noteId: noteA, images: [{ data: other }, { data: Buffer.from("GIF89a\u0001\u0000\u0001\u0000").toString("base64") }], baseUpdatedAt: before.updatedAt }, a.ctx);
  assert.equal(gif.error, "invalid_input");
  assert.match(gif.message!, /Image 2/);
  // A heading the note doesn't have: the image stored for it is taken back.
  const heading = await call("update_note", { noteId: noteA, images: [{ data: other }], afterHeading: "Nowhere", baseUpdatedAt: before.updatedAt }, a.ctx);
  assert.equal(heading.ok, false);
  assert.match(heading.data?.items?.[0]?.message ?? heading.message ?? "", /no heading "Nowhere"/);
  // A rename with images is refused (a rename waits for approval; images don't ride along).
  assert.equal((await call("update_note", { noteId: noteA, newTitle: "Renamed", images: [{ data: other }], baseUpdatedAt: before.updatedAt }, a.ctx)).error, "invalid_input");

  const after = (await getNote(a.learner.profileId, noteA))!;
  assert.equal(after.body, before.body);
  assert.equal(after.title, before.title);
  assert.equal(await imageRows(a.learner.profileId), rows, "no image left behind by a failed call");
});

// Bug batch 28 Nov, item 6: update_note could only append. Now: exact edits
// (each passage found exactly once, all or nothing), a whole-text replace
// (at once for a short note, approved first for a long one), and every change
// keeps the previous text as a version that restore_note_version puts back.
test("REGRESSION item 6: update_note edits, replaces, keeps versions, and undoes", async () => {
  const userId = await account();
  const c = await connect(userId);
  const made = await createNote(c.learner.profileId, { title: "Paxos", body: "Paxos has two phases.\nPhase one: prepare.\nPhase one: promise." });
  assert.ok(made.ok); if (!made.ok) return;
  const id = made.note.id;
  const now = async () => (await getNote(c.learner.profileId, id))!;

  // A passage that is missing, or found twice: nothing changes, and the call says which edit.
  const missing = await call("update_note", { noteId: id, edits: [{ find: "three phases", replace: "x" }], baseUpdatedAt: made.note.updatedAt }, c.ctx);
  assert.match(JSON.stringify(missing), /Edit 1: that passage is not in the note/);
  const twice = await call("update_note", { noteId: id, edits: [{ find: "Paxos has two phases.", replace: "Paxos has two rounds." }, { find: "Phase one", replace: "Round one" }], baseUpdatedAt: made.note.updatedAt }, c.ctx);
  assert.match(JSON.stringify(twice), /Edit 2: that passage is in the note 2 times/);
  assert.equal((await now()).body, made.note.body, "all or nothing: the first edit did not go in either");

  // A good edit, at once, and the old text kept.
  const edited = await call("update_note", { noteId: id, edits: [{ find: "Phase one: promise.", replace: "Phase two: accept." }], baseUpdatedAt: made.note.updatedAt }, c.ctx);
  assert.equal(edited.ok, true, JSON.stringify(edited));
  assert.equal((await now()).body, "Paxos has two phases.\nPhase one: prepare.\nPhase two: accept.");
  const read = await call("get_note", { noteId: `note:${id}` }, c.ctx);
  assert.equal(read.data!.versions.length, 1);
  assert.equal(read.data!.versions[0].before, "edit");

  // Mixing ways in one call is refused.
  assert.equal((await call("update_note", { noteId: id, edits: [{ find: "Paxos", replace: "P" }], appendText: "x", baseUpdatedAt: (await now()).updatedAt }, c.ctx)).ok, false);

  // A short note is replaced at once.
  const replaced = await call("update_note", { noteId: id, replaceBody: "# Paxos\nRewritten whole.", baseUpdatedAt: (await now()).updatedAt }, c.ctx);
  assert.equal(replaced.ok, true, JSON.stringify(replaced));
  assert.equal((await now()).body, "# Paxos\nRewritten whole.");

  // Undo twice: back to the edit, then back to the original.
  assert.equal((await call("restore_note_version", { noteId: id }, c.ctx)).ok, true);
  assert.equal((await now()).body, "Paxos has two phases.\nPhase one: prepare.\nPhase two: accept.");
  assert.equal((await call("restore_note_version", { noteId: id }, c.ctx)).ok, true);
  assert.equal((await now()).body, made.note.body);

  // A long note is not replaced whole without the learner's approval.
  const long = await createNote(c.learner.profileId, { title: "Long Paxos", body: "x".repeat(2_500) });
  assert.ok(long.ok); if (!long.ok) return;
  const asked = await call("update_note", { noteId: long.note.id, replaceBody: "short", baseUpdatedAt: long.note.updatedAt }, c.ctx);
  assert.equal(asked.error, "approval_required", JSON.stringify(asked));
  assert.match(JSON.stringify(asked.data!.summary), /Replace the text of note/);
  assert.equal((await getNote(c.learner.profileId, long.note.id))!.body.length, 2_500, "nothing replaced before approval");
  // A plan holding note text is not stored (no content in the audit): the
  // learner approves on Kivo, then the assistant sends the same change again.
  const clicked = await approveAndApply({ userId: c.learner.userId, profileId: c.learner.profileId, origin: ISSUER }, asked.data!.planId);
  assert.equal(clicked.status, "approved", JSON.stringify(clicked));
  assert.equal((await getNote(c.learner.profileId, long.note.id))!.body.length, 2_500, "approval alone writes nothing");
  const ran = await call("execute_knowledge_changes", { planId: asked.data!.planId, expiresAt: asked.data!.expiresAt, changes: asked.data!.changes }, c.ctx);
  assert.equal(ran.ok, true, JSON.stringify(ran).slice(0, 400));
  assert.equal((await getNote(c.learner.profileId, long.note.id))!.body, "short");
  assert.equal(await prisma.novaNoteVersion.count({ where: { noteId: long.note.id } }), 1, "the long text is kept");

  // Through the generic batch, a replace is always reviewed.
  const pv = await call("preview_knowledge_changes", { changes: [{ op: "replace_note_body", noteId: id, body: "sneaky", baseUpdatedAt: (await now()).updatedAt }] }, c.ctx);
  assert.equal(pv.data?.approvalRequired, true, JSON.stringify(pv).slice(0, 300));
  const raw = await call("execute_knowledge_changes", { planId: pv.data!.planId, expiresAt: pv.data!.expiresAt, changes: [{ op: "replace_note_body", noteId: id, body: "sneaky", baseUpdatedAt: (await now()).updatedAt }] }, c.ctx);
  assert.notEqual((await now()).body, "sneaky", JSON.stringify(raw).slice(0, 300));
});
