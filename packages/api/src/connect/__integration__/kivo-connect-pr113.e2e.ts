/**
 * PR #113 smoke test: update_note's new modes, restore_note_version and
 * set_topic_status over HTTP with the official MCP SDK client (same setup
 * as kivo-connect-http.e2e.ts, whose header says how to run it).
 *
 * Needs a running API on the test database, with KIVO_CONNECT_ORIGIN set to
 * its own address and a known JWT_SECRET:
 *
 *   (cd apps/api && DATABASE_URL=$T DIRECT_URL=$T JWT_SECRET=kivo-connect-e2e-secret \
 *      KIVO_CONNECT_ORIGIN=http://localhost:3001 DISABLE_INTERNAL_CHECKIN_CRON=true npx next dev --port 3001)
 *   NOVA_TEST_DATABASE_URL=$T KIVO_E2E_API=http://localhost:3001 JWT_SECRET=kivo-connect-e2e-secret \
 *      npx tsx --test src/connect/__integration__/kivo-connect-http.e2e.ts
 *
 * What a remote MCP client (ChatGPT, Claude) does, step by step: 401 with the
 * resource metadata address, discovery, dynamic registration, the learner's
 * consent (with their Kivo session), PKCE token exchange, initialize,
 * tools/list, tools/call, approval on Kivo, refresh, revocation.
 */

import "../../nova/__integration__/test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const { prisma } = await import("@repo/db/client");
const { resolveLearnerForAccount } = await import("../../nova/product/learner-identity.js");
const { saveSetup } = await import("../../nova/product/setup.js");

const API = process.env.KIVO_E2E_API ?? "http://localhost:3001";
const SECRET = process.env.JWT_SECRET ?? "kivo-connect-e2e-secret";
const REDIRECT = "http://localhost:6274/oauth/callback";
const STAMP = Date.now();
let userId = "";
let chat = "";

after(async () => {
  if (chat) await prisma.messengerUser.deleteMany({ where: { platformChatId: chat } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.novaConnectClient.deleteMany({ where: { name: `e2e ${STAMP}` } });
  await prisma.$disconnect();
});

async function seed() {
  const user = await prisma.user.create({ data: { email: `e2e${STAMP}@connect-e2e.local`, name: "E2E Learner" } });
  userId = user.id;
  await prisma.userProfile.create({ data: { userId, onboardingComplete: true, primaryPersona: "nova" } });
  const r = await resolveLearnerForAccount(userId, user.name);
  assert.equal(r.kind, "learner");
  chat = r.kind === "learner" ? r.platformChatId : "";
  await saveSetup(chat, { subjects: [{ name: "Distributed Systems", topics: ["Consensus"] }], exams: [], dailyMinutes: 60, studyTime: null });
  const m = await prisma.messengerUser.findFirstOrThrow({ where: { platformChatId: chat }, select: { id: true } });
  await prisma.novaAcademicProfile.update({ where: { userId: m.id }, data: { onboardingComplete: true } });
  return new SignJWT({ userId, email: user.email, name: user.name }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(SECRET));
}

const parse = (r: { content: unknown; structuredContent?: unknown }) => (r.structuredContent ?? JSON.parse((r.content as Array<{ text: string }>)[0]!.text)) as Record<string, any>;


async function connected() {
  const session = await seed();
  const cookie = `kevo_session=${session}`;
  const bare = await fetch(`${API}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
  const metaUrl = /resource_metadata="([^"]+)"/.exec(bare.headers.get("www-authenticate") ?? "")![1]!;
  const prm = await (await fetch(metaUrl)).json();
  const asm = await (await fetch(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
  const reg = await (await fetch(asm.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: `e2e ${STAMP}`, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) })).json();
  const verifier = randomBytes(32).toString("base64url");
  const params = { response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, scope: "profile:read workspace:read notes:read notes:write knowledge:read knowledge:write", state: "s", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", resource: prm.resource };
  const allowed = await (await fetch(`${API}/api/connect/authorize`, { method: "POST", headers: { cookie, "content-type": "application/json", origin: API }, body: JSON.stringify({ params, approve: true }) })).json();
  const code = new URL(allowed.redirect).searchParams.get("code")!;
  const tokens = await (await fetch(asm.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: verifier, client_id: reg.client_id }) })).json();
  const client = new Client({ name: "kivo-smoke", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(prm.resource), { requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } } }));
  return client;
}

const report: Array<[string, string]> = [];
test("PR #113 over MCP: update_note edits, replaces and their approvals; restore_note_version; set_topic_status", async () => {
  const client = await connected();
  const call = async (name: string, args: Record<string, unknown>) => parse(await client.callTool({ name, arguments: args }));
  const { tools } = await client.listTools();
  assert.ok(["restore_note_version", "set_topic_status"].every(n => tools.some(t => t.name === n)), "the new tools are listed");

  const made = await call("create_note", { title: "Smoke: Raft", text: "Raft elects a leader.\nTerms increase.\nTerms increase.", subjectName: "Distributed Systems", idempotencyKey: "smoke-1" });
  const noteId = made.items[0].resource.id as string;
  const at = async () => (await call("get_note", { noteId })).updatedAt as string;

  const exact = await call("update_note", { noteId, edits: [{ find: "Raft elects a leader.", replace: "Raft elects one leader per term." }], baseUpdatedAt: await at() });
  assert.equal(exact.ok, true, JSON.stringify(exact)); report.push(["exact-passage edit", "applied at once"]);
  const missing = await call("update_note", { noteId, edits: [{ find: "Paxos", replace: "x" }], baseUpdatedAt: await at() });
  assert.equal(missing.ok, false); assert.match(JSON.stringify(missing), /not in the note/); report.push(["missing passage", "refused, nothing changed"]);
  const dup = await call("update_note", { noteId, edits: [{ find: "Terms increase.", replace: "x" }], baseUpdatedAt: await at() });
  assert.equal(dup.ok, false); assert.match(JSON.stringify(dup), /2 times/); report.push(["duplicate passage", "refused (found 2 times), nothing changed"]);
  const small = await call("update_note", { noteId, replaceBody: "Raft elects one leader per term.\nTerms increase.\nTerms increase.\nLogs replicate.", baseUpdatedAt: await at() });
  assert.equal(small.ok, true, JSON.stringify(small)); report.push(["small replace keeping its words", "applied at once"]);
  const removal = await call("update_note", { noteId, replaceBody: "Gone.", baseUpdatedAt: await at() });
  assert.equal(removal.error, "approval_required", JSON.stringify(removal)); report.push([">50% removal on a short note", "approval_required (approveUrl, planId)"]);

  const long = await call("create_note", { title: "Smoke: long", text: "word ".repeat(500).trim(), subjectName: "Distributed Systems", idempotencyKey: "smoke-2" });
  const longId = long.items[0].resource.id as string;
  const longAt = (await call("get_note", { noteId: longId })).updatedAt;
  const big = await call("update_note", { noteId: longId, replaceBody: "word ".repeat(500).trim() + " more", baseUpdatedAt: longAt });
  assert.equal(big.error, "approval_required", JSON.stringify(big)); report.push([">2,000-character replace", "approval_required"]);

  const restored = await call("restore_note_version", { noteId });
  assert.equal(restored.ok, true, JSON.stringify(restored));
  const back = await call("get_note", { noteId });
  assert.match(back.text, /Raft elects one leader per term\.\nTerms increase\.\nTerms increase\.$/, back.text);
  assert.ok(back.versions.length >= 1); report.push(["restore_note_version", "previous text back; versions listed in get_note"]);

  const st = await call("get_workspace_structure", {});
  const consensus = JSON.stringify(st.subjects).match(/"id":"([^"]+)","name":"Consensus"/)![1];
  const set = await call("set_topic_status", { topicId: `topic:${consensus}`, status: "completed" });
  assert.equal(set.status, "completed", JSON.stringify(set));
  assert.match(JSON.stringify((await call("get_workspace_structure", {})).subjects), /"name":"Consensus","studied":false,"status":"completed"/);
  report.push(["set_topic_status", "completed, read back in get_workspace_structure"]);
  console.log(JSON.stringify({ smoke: report }));
  await client.close();
});
