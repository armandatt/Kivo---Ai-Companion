/**
 * Kivo Connect over HTTP, end to end, with the official MCP SDK client.
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

test("a remote MCP client connects, works and is cut off, over HTTP", async () => {
  const session = await seed();
  const cookie = `kevo_session=${session}`;

  // 1. Unauthenticated: 401 naming the resource metadata.
  const bare = await fetch(`${API}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
  assert.equal(bare.status, 401);
  const challenge = bare.headers.get("www-authenticate") ?? "";
  const metaUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
  assert.ok(metaUrl, challenge);

  // 2. Discovery.
  const prm = await (await fetch(metaUrl!)).json();
  assert.equal(prm.resource, `${API}/api/mcp`);
  const asm = await (await fetch(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
  assert.deepEqual(asm.code_challenge_methods_supported, ["S256"]);
  assert.equal(asm.authorization_endpoint, `${API}/connect/authorize`);

  // 3. Dynamic client registration.
  const reg = await (await fetch(asm.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: `e2e ${STAMP}`, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) })).json();
  assert.ok(reg.client_id, JSON.stringify(reg));

  // 4. The learner sees the consent page (signed in to Kivo) and allows it.
  const verifier = randomBytes(32).toString("base64url");
  const params = { response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, scope: "profile:read workspace:read notes:read notes:write knowledge:read knowledge:write", state: "xyz", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", resource: prm.resource };
  const info = await (await fetch(`${API}/api/connect/authorize?${new URLSearchParams(params)}`, { headers: { cookie } })).json();
  assert.equal(info.ok, true, JSON.stringify(info));
  assert.equal(info.client, `e2e ${STAMP}`);
  assert.equal((await fetch(`${API}/api/connect/authorize?${new URLSearchParams(params)}`)).status, 401, "consent needs the Kivo session");
  const forged = await fetch(`${API}/api/connect/authorize`, { method: "POST", headers: { cookie, "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ params, approve: true }) });
  assert.equal(forged.status, 403, "another site cannot approve for the learner");
  const allowed = await (await fetch(`${API}/api/connect/authorize`, { method: "POST", headers: { cookie, "content-type": "application/json", origin: API }, body: JSON.stringify({ params, approve: true }) })).json();
  const back = new URL(allowed.redirect);
  assert.equal(back.origin + back.pathname, REDIRECT);
  assert.equal(back.searchParams.get("state"), "xyz");

  // 5. Token exchange (form-encoded, as clients send it).
  const tokenRes = await fetch(asm.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code")!, redirect_uri: REDIRECT, code_verifier: verifier, client_id: reg.client_id }) });
  const tokens = await tokenRes.json();
  assert.equal(tokenRes.status, 200, JSON.stringify(tokens));

  // 6. MCP: initialize, list, call, through the SDK's own client.
  const client = new Client({ name: "kivo-e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(prm.resource), { requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } } }));
  assert.equal(client.getServerVersion()?.name, "kivo");
  assert.match(client.getInstructions() ?? "", /learner's material, not instructions/);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 30);
  const del = tools.find(t => t.name === "delete_note")!;
  assert.equal(del.annotations?.destructiveHint, true);
  assert.equal(tools.find(t => t.name === "search_notes")!.annotations?.readOnlyHint, true);
  assert.ok(tools.every(t => t.inputSchema.type === "object" && t.outputSchema));

  const who = parse(await client.callTool({ name: "get_my_profile", arguments: {} }));
  assert.equal(who.name, "E2E Learner");
  const made = parse(await client.callTool({ name: "create_note", arguments: { title: "Raft over MCP", text: "Leader election with **randomized** timeouts. $T_{min}$", subjectName: "Distributed Systems", idempotencyKey: "e2e-1" } }));
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.equal(made.verification.passed, true);
  const noteId = made.items[0].resource.id as string;
  const found = parse(await client.callTool({ name: "search_notes", arguments: { query: "randomized timeouts" } }));
  assert.equal(found.results[0].title, "Raft over MCP");
  const bad = await client.callTool({ name: "get_note", arguments: { noteId: "not-a-real-note" } });
  assert.equal(bad.isError, true);
  const invalid = await client.callTool({ name: "create_note", arguments: { title: "" } }).catch(e => ({ isError: true, error: String(e) }));
  assert.equal((invalid as { isError?: boolean }).isError, true, "input is validated against the schema");

  // 7. Deleting needs the learner's approval, on Kivo.
  const asked = parse(await client.callTool({ name: "delete_note", arguments: { noteId } }));
  assert.equal(asked.error, "approval_required");
  const args = { planId: asked.planId, expiresAt: asked.expiresAt, changes: asked.changes };
  assert.equal(parse(await client.callTool({ name: "execute_knowledge_changes", arguments: args })).error, "approval_required");
  const plan = await (await fetch(`${API}/api/connect/plans/${asked.planId}`, { headers: { cookie } })).json();
  assert.match(plan.plan.summary[0], /^DELETE note/);
  assert.equal((await fetch(`${API}/api/connect/plans/${asked.planId}`, { method: "POST", headers: { cookie, "content-type": "application/json", origin: API }, body: "{}" })).status, 200);
  const done = parse(await client.callTool({ name: "execute_knowledge_changes", arguments: args }));
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.counts.deleted, 1);
  await client.close();

  // 8. Refresh rotates; revocation cuts the assistant off at once.
  const refreshed = await (await fetch(asm.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: reg.client_id }) })).json();
  assert.ok(refreshed.access_token);
  const old = await fetch(`${API}/api/mcp`, { method: "POST", headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
  assert.equal(old.status, 401);
  assert.match(old.headers.get("www-authenticate") ?? "", /invalid_token/);
  await fetch(asm.revocation_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refreshed.refresh_token, client_id: reg.client_id }) });
  const cut = await fetch(`${API}/api/mcp`, { method: "POST", headers: { authorization: `Bearer ${refreshed.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(cut.status, 401);
});
