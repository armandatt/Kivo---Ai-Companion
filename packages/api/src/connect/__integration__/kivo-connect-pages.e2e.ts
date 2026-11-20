/**
 * Kivo Connect Saved Pages over HTTP, end to end, with the official MCP SDK
 * client: what ChatGPT or Claude does through /api/mcp, and what the web app
 * then shows through its own routes.
 *
 * Needs a running API on the test database (see kivo-connect-http.e2e.ts):
 *   NOVA_TEST_DATABASE_URL=$T KIVO_E2E_API=http://localhost:3001 JWT_SECRET=kivo-connect-e2e-secret \
 *      npx tsx --test src/connect/__integration__/kivo-connect-pages.e2e.ts
 *
 * Steps: a connection with pages:write lists the Saved Pages tools; save a
 * page filed on a topic; read it back; the node's pages and connections; the
 * web app's Saved Pages library and Knowledge Map show it; move (refused
 * without replace), unfile (the page stays); duplicates; bad input; another
 * learner's page; a connection made without pages:write sees only the reads;
 * no token is refused.
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
const users: string[] = [], chats: string[] = [];

after(async () => {
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: chats } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.novaConnectClient.deleteMany({ where: { name: { startsWith: `pages-e2e ${STAMP}` } } });
  await prisma.$disconnect();
});

async function learner(name: string) {
  const user = await prisma.user.create({ data: { email: `${name}${STAMP}@pages-e2e.local`, name } });
  users.push(user.id);
  await prisma.userProfile.create({ data: { userId: user.id, onboardingComplete: true, primaryPersona: "nova" } });
  const r = await resolveLearnerForAccount(user.id, user.name);
  const chat = r.kind === "learner" ? r.platformChatId : "";
  chats.push(chat);
  await saveSetup(chat, { subjects: [{ name: "AI Fundamentals", topics: ["Neural Networks", "Transformers"] }], exams: [], dailyMinutes: 60, studyTime: null });
  const m = await prisma.messengerUser.findFirstOrThrow({ where: { platformChatId: chat }, select: { id: true } });
  await prisma.novaAcademicProfile.update({ where: { userId: m.id }, data: { onboardingComplete: true } });
  const jwt = await new SignJWT({ userId: user.id, email: user.email, name: user.name }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(SECRET));
  return { cookie: `kevo_session=${jwt}` };
}

// Discovery, registration, the learner's consent with their Kivo session, PKCE exchange, then the SDK client.
async function mcpClient(cookie: string, scope: string) {
  const bare = await fetch(`${API}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
  assert.equal(bare.status, 401, "no token, no tools");
  const metaUrl = /resource_metadata="([^"]+)"/.exec(bare.headers.get("www-authenticate") ?? "")![1]!;
  const prm = await (await fetch(metaUrl)).json();
  const asm = await (await fetch(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
  assert.ok(asm.scopes_supported.includes("pages:write"), "the new scope is advertised");
  const reg = await (await fetch(asm.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: `pages-e2e ${STAMP}`, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) })).json();
  const verifier = randomBytes(32).toString("base64url");
  const params = { response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, scope, state: "s", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", resource: prm.resource };
  const info = await (await fetch(`${API}/api/connect/authorize?${new URLSearchParams(params)}`, { headers: { cookie } })).json();
  assert.equal(info.ok, true, JSON.stringify(info));
  const allowed = await (await fetch(`${API}/api/connect/authorize`, { method: "POST", headers: { cookie, "content-type": "application/json", origin: API }, body: JSON.stringify({ params, approve: true }) })).json();
  const back = new URL(allowed.redirect);
  const tokens = await (await fetch(asm.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code")!, redirect_uri: REDIRECT, code_verifier: verifier, client_id: reg.client_id }) })).json();
  assert.ok(tokens.access_token, JSON.stringify(tokens));
  const client = new Client({ name: "kivo-pages-e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(prm.resource), { requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } } }));
  return { client, consent: info.scopes as Array<{ scope: string; description: string }> };
}

const out = (r: { content: unknown; structuredContent?: unknown; isError?: boolean }) => (r.structuredContent ?? JSON.parse((r.content as Array<{ text: string }>)[0]!.text)) as Record<string, any>;
const ALL = "profile:read workspace:read notes:read notes:write knowledge:read knowledge:write pages:write";
const OLD = "profile:read workspace:read notes:read notes:write knowledge:read knowledge:write";

test("Saved Pages over MCP: save, find, file, move, unfile, isolation, scopes", async () => {
  const me = await learner("Pages Learner");
  const { client, consent } = await mcpClient(me.cookie, ALL);
  assert.ok(consent.some(s => s.scope === "pages:write" && /Saved Pages/.test(s.description)), "the learner is told what it allows");

  const { tools } = await client.listTools();
  for (const name of ["save_page", "get_saved_page", "search_saved_pages", "file_saved_page", "unfile_saved_page"]) assert.ok(tools.some(t => t.name === name), name);
  const save = tools.find(t => t.name === "save_page")!;
  assert.equal(save.annotations?.destructiveHint, true, "a write is marked as one (Claude directory rule)");
  assert.equal(tools.find(t => t.name === "search_saved_pages")!.annotations?.readOnlyHint, true);
  assert.match(save.description ?? "", /never create a note/);
  assert.match(tools.find(t => t.name === "create_note")!.description ?? "", /use save_page/);

  // The node, found as an assistant finds it.
  const found = out(await client.callTool({ name: "search_knowledge_nodes", arguments: { query: "Transformers", types: ["topic"] } }));
  const topicId = found.nodes[0].id as string;
  assert.match(topicId, /^topic:/);

  const saved = out(await client.callTool({ name: "save_page", arguments: { url: "https://arxiv.org/abs/1706.03762", title: "Attention Is All You Need", description: "Introduces the Transformer.", nodeId: topicId, tags: ["paper"] } }));
  assert.equal(saved.ok ?? true, true, JSON.stringify(saved));
  assert.equal(saved.status, "saved", JSON.stringify(saved));
  const pageId = saved.page.id as string;
  assert.equal(saved.page.filedUnder.nodeId, topicId);

  // Read back three ways.
  assert.equal(out(await client.callTool({ name: "get_saved_page", arguments: { pageId } })).page.title, "Attention Is All You Need");
  assert.deepEqual(out(await client.callTool({ name: "search_saved_pages", arguments: { nodeId: topicId } })).pages.map((p: { id: string }) => p.id), [pageId]);
  const conn = out(await client.callTool({ name: "get_node_connections", arguments: { nodeId: topicId } }));
  assert.ok(conn.connections.some((x: { other: { id: string } | null }) => x.other?.id === pageId), "the topic's connections include the page");

  // The web app, through its own routes with the learner's session.
  const lib = await (await fetch(`${API}/api/nova/saved?q=Attention`, { headers: { cookie: me.cookie } })).json();
  assert.ok(JSON.stringify(lib).includes(pageId.slice("resource:".length)), "listed in Saved Pages");
  const map = await (await fetch(`${API}/api/nova/knowledge-map?workspace=all`, { headers: { cookie: me.cookie } })).json();
  assert.ok(map.edges.some((e: { from: string; to: string }) => e.from === topicId && e.to === pageId), "on the Knowledge Map under the topic");

  // Duplicate: one entry, filing kept.
  const dup = out(await client.callTool({ name: "save_page", arguments: { url: "https://arxiv.org/abs/1706.03762?utm_source=chatgpt.com" } }));
  assert.equal(dup.status, "already_saved");
  assert.equal(dup.page.id, pageId);
  assert.equal(dup.page.filedUnder.nodeId, topicId);

  // Move: refused without replace, then done; unfile keeps the page.
  const other = out(await client.callTool({ name: "search_knowledge_nodes", arguments: { query: "Neural Networks", types: ["topic"] } })).nodes[0].id as string;
  const refused = await client.callTool({ name: "file_saved_page", arguments: { pageId, nodeId: other } });
  assert.equal(refused.isError, true);
  assert.equal(out(refused).error, "conflict");
  const moved = out(await client.callTool({ name: "file_saved_page", arguments: { pageId, nodeId: other, replace: true } }));
  assert.equal(moved.status, "moved");
  assert.equal(moved.previouslyFiledUnder.nodeId, topicId);
  const un = out(await client.callTool({ name: "unfile_saved_page", arguments: { pageId } }));
  assert.equal(un.status, "unfiled");
  assert.equal(out(await client.callTool({ name: "get_saved_page", arguments: { pageId } })).page.filedUnder, null, "still saved, filed nowhere");

  // Bad input never saves.
  const bad = await client.callTool({ name: "save_page", arguments: { url: "javascript:alert(1)" } });
  assert.equal(bad.isError, true);
  const badNode = await client.callTool({ name: "save_page", arguments: { url: "https://example.com/x", nodeId: "topic:not-mine" } });
  assert.equal(out(badNode).error, "not_found");
  const schema = await client.callTool({ name: "save_page", arguments: { url: 42 } as never }).catch((e: Error) => ({ isError: true, thrown: e.message }));
  assert.equal((schema as { isError?: boolean }).isError, true, "a malformed argument is refused by the schema");

  // Another learner: cannot see or touch this page.
  const them = await learner("Other Learner");
  const theirs = (await mcpClient(them.cookie, ALL)).client;
  const peek = await theirs.callTool({ name: "get_saved_page", arguments: { pageId } });
  assert.equal(out(peek).error, "not_found");
  assert.equal(out(await theirs.callTool({ name: "search_saved_pages", arguments: { query: "Attention" } })).pages.length, 0);
  assert.equal(out(await theirs.callTool({ name: "unfile_saved_page", arguments: { pageId } })).error, "not_found");

  // A connection made before pages:write existed: the reads, no writes.
  const old = (await mcpClient(me.cookie, OLD)).client;
  const oldTools = (await old.listTools()).tools.map(t => t.name);
  assert.ok(oldTools.includes("search_saved_pages") && oldTools.includes("get_saved_page"));
  assert.ok(!oldTools.includes("save_page") && !oldTools.includes("file_saved_page") && !oldTools.includes("unfile_saved_page"));
  const blocked = await old.callTool({ name: "save_page", arguments: { url: "https://example.com/y" } }).catch((e: Error) => ({ isError: true, thrown: e.message }));
  assert.equal((blocked as { isError?: boolean }).isError, true, "an unlisted tool cannot be called");
  assert.equal(await prisma.novaLearningEvent.count({ where: { url: "https://example.com/y" } }), 0);

  await client.close(); await theirs.close(); await old.close();
});
