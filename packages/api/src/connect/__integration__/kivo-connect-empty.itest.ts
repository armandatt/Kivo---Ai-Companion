/**
 * Kivo Connect from zero (28 Nov): a brand-new account (no signup quiz, no
 * Nova setup, no map, no notes) connects an assistant through the real OAuth
 * flow and builds its first Knowledge Map. Real Postgres.
 *
 *   NOVA_TEST_DATABASE_URL=postgresql://... npx tsx --test src/connect/__integration__/kivo-connect-empty.itest.ts
 */
import "../../nova/__integration__/test-database.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

process.env.TELEGRAM_BOT_TOKEN = ""; process.env.GEMINI_API_KEY = ""; process.env.OPENAI_API_KEY = ""; process.env.ANTHROPIC_API_KEY = "";

const { prisma } = await import("@repo/db/client");
const { registerClient, exchangeCode, authenticateAccessToken, findClient } = await import("../oauth.js");
const { checkAuthorize, decide } = await import("../authorize.js");
const { learnerFor, forgetLearner, profileForAccount } = await import("../learner.js");
const { TOOLS, runTool } = await import("../tools.js");
const { loadStudyStructure } = await import("../../nova/product/setup-edit.js");
const { resolveNoteLearner } = await import("../../nova/product/notes.js");
const { loadKnowledgeMap } = await import("../../nova/product/knowledge-map.js").catch(() => ({ loadKnowledgeMap: null as never }));

const MCP = "https://kivo.test/api/mcp", ISSUER = "https://kivo.test", REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const STAMP = Date.now();
const users: string[] = [];
let n = 0;
after(async () => {
  const chats = users.map(u => `web:${u}`);
  await prisma.messengerUser.deleteMany({ where: { platformChatId: { in: chats } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.novaConnectClient.deleteMany({ where: { name: { startsWith: `itest-empty ${STAMP}` } } });
  await prisma.$disconnect();
});

// A user row and nothing else: the account as signup leaves it before the quiz.
async function brandNew(profile?: { primaryPersona: string | null }) {
  const key = `${STAMP}${++n}`;
  const user = await prisma.user.create({ data: { email: `e${key}@connect-empty.local`, name: `Empty ${key}` } });
  users.push(user.id);
  if (profile) await prisma.userProfile.create({ data: { userId: user.id, onboardingComplete: profile.primaryPersona !== null, primaryPersona: profile.primaryPersona ?? undefined } as never });
  return user.id;
}
const verifier = () => randomBytes(32).toString("base64url");
const challengeOf = (v: string) => createHash("sha256").update(v).digest("base64url");
async function connect(userId: string, scope = "profile:read workspace:read notes:read notes:write knowledge:read knowledge:write pages:write") {
  const reg = await registerClient({ name: `itest-empty ${STAMP} ChatGPT`, redirectUris: [REDIRECT], tokenAuthMethod: "none" });
  const v = verifier();
  const check = await checkAuthorize({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, scope, state: "s", code_challenge: challengeOf(v), code_challenge_method: "S256", resource: MCP }, MCP, ISSUER);
  assert.equal(check.ok, true, JSON.stringify(check));
  if (!check.ok) throw new Error();
  const back = new URL(await decide(userId, check, true, ISSUER));
  const client = (await findClient(reg.client_id))!;
  const tokens = await exchangeCode({ clientRowId: client.id, code: back.searchParams.get("code"), redirectUri: REDIRECT, verifier: v });
  assert.ok("access_token" in tokens, JSON.stringify(tokens));
  if (!("access_token" in tokens)) throw new Error();
  const caller = (await authenticateAccessToken(tokens.access_token, MCP))!;
  return { caller, tokens };
}
const tool = (name: string) => TOOLS.find(t => t.name === name)!;
type R = { ok: boolean; error?: string; message?: string; data?: Record<string, any> };
const call = async (name: string, args: Record<string, unknown>, ctx: unknown): Promise<R> => (await runTool(tool(name), args, ctx as never)) as R;

test("A: a brand-new account (no quiz, no setup, no map) connects; every read answers empty, never 'set up first'", async () => {
  const userId = await brandNew();
  const { caller } = await connect(userId);
  const l = await learnerFor(caller);
  assert.equal(l.ok, true, JSON.stringify(l));
  if (!l.ok) return;
  const ctx = { learner: l.learner, origin: ISSUER, confirm: null };
  const reads: Array<[string, Record<string, unknown>]> = [
    ["get_my_profile", {}], ["list_workspaces", {}], ["get_dashboard_summary", {}], ["get_knowledge_map", {}],
    ["search_notes", { query: "anything" }], ["list_recent_notes", {}], ["global_search", { query: "ai" }],
    ["search_knowledge_nodes", { query: "ai" }], ["search_saved_pages", { query: "ai" }], ["find_knowledge_gaps", {}], ["analyze_knowledge", {}],
  ];
  for (const [name, args] of reads) {
    const r = await call(name, args, ctx);
    assert.equal(r.ok, true, `${name}: ${JSON.stringify(r)}`);
  }
});

test("B: from zero an assistant builds the first map (subject, topics, nesting, links); it opens on the web; a retry adds nothing", async () => {
  const userId = await brandNew();
  const { caller } = await connect(userId);
  const l = await learnerFor(caller);
  assert.ok(l.ok);
  if (!l.ok) return;
  const ctx = { learner: l.learner, origin: ISSUER, confirm: null };
  const outline = [{ name: "Machine Learning", children: [{ name: "Deep Learning", children: [{ name: "Neural Networks" }] }] }, { name: "NLP" }];
  const built = await call("build_knowledge_map", { subjectName: "Artificial Intelligence", outline, mode: "apply" }, ctx);
  assert.equal(built.ok, true, JSON.stringify(built));
  const st = await loadStudyStructure(l.learner.profileId);
  const ai = st.subjects.find(s => s.name === "Artificial Intelligence");
  assert.ok(ai, "the first subject exists");
  const by = new Map(ai!.topics.map(t => [t.name, t]));
  assert.equal(by.get("Neural Networks")!.parentId, by.get("Deep Learning")!.id);
  assert.equal(by.get("Deep Learning")!.parentId, by.get("Machine Learning")!.id);
  // A relationship: a note that links to a topic ([[…]]), Kivo's own kind.
  const note0 = await call("create_note", { title: "Transformers", body: "Built on attention." }, ctx);
  assert.equal(note0.ok, true, JSON.stringify(note0));
  const noteId = `note:${note0.data!.items[0].resource.id}`;
  const linked = await call("connect_knowledge_nodes", { from: noteId, to: `topic:${by.get("Deep Learning")!.id}`, relation: "links_to" }, ctx);
  assert.equal(linked.ok, true, JSON.stringify(linked));
  // The web's own check opens it: no "set up first".
  assert.equal((await resolveNoteLearner(l.learner.platformChatId)).status, "ready");
  const map = await call("get_knowledge_map", {}, ctx);
  assert.equal(map.ok, true);
  assert.match(JSON.stringify(map.data), /Neural Networks/);
  // Retried by the assistant: nothing twice.
  const again = await call("build_knowledge_map", { subjectName: "Artificial Intelligence", outline, mode: "apply" }, ctx);
  assert.equal(again.ok, true);
  const after = await loadStudyStructure(l.learner.profileId);
  assert.equal(after.subjects.filter(s => s.name === "Artificial Intelligence").length, 1);
  assert.equal(after.subjects.find(s => s.name === "Artificial Intelligence")!.topics.length, ai!.topics.length);
  // Notes from zero too.
  const note = await call("create_note", { title: "What is attention?", body: "Weights over tokens." }, ctx);
  assert.equal(note.ok, true, JSON.stringify(note));
});

test("E: isolation: one account's token reaches only its own space; a Rex account is still refused; approval works before setup", async () => {
  const a = await brandNew(), b = await brandNew();
  const la = await learnerFor((await connect(a)).caller), lb = await learnerFor((await connect(b)).caller);
  assert.ok(la.ok && lb.ok);
  if (!la.ok || !lb.ok) return;
  assert.notEqual(la.learner.profileId, lb.learner.profileId);
  await call("build_knowledge_map", { subjectName: "Only A", outline: [{ name: "Secret" }], mode: "apply" }, { learner: la.learner, origin: ISSUER, confirm: null });
  const seen = await call("search_knowledge_nodes", { query: "Secret" }, { learner: lb.learner, origin: ISSUER, confirm: null });
  assert.doesNotMatch(JSON.stringify(seen.data ?? {}), /Secret/);
  // An id from the model can't move B into A's space: tools take the learner from the token only.
  const sneaky = await call("get_workspace_structure", { workspaceId: la.learner.profileId }, { learner: lb.learner, origin: ISSUER, confirm: null });
  assert.doesNotMatch(JSON.stringify(sneaky.data ?? {}), /Only A/);
  // Approving a big change on Kivo works for an account that never set Nova up.
  assert.equal(await profileForAccount(b), lb.learner.profileId);
  // A Rex account keeps its own rule.
  const rex = await brandNew({ primaryPersona: "rex" });
  forgetLearner(rex);
  const lr = await learnerFor((await connect(rex)).caller);
  assert.equal(lr.ok, false);
  // An invalid token is no caller at all.
  assert.equal(await authenticateAccessToken("kivo_at_not-a-real-token", MCP), null);
});
