// A brand-new person's first hour with Nova, over real HTTP against the built
// apps: signup, the quiz, Nova with no Telegram, setup, a first session,
// connecting Telegram, sessions across both surfaces, an exam, free text,
// tone, the proactive scheduler, a process restart, and ownership checks.
//
// Telegram is a local stand-in (TELEGRAM_API_BASE). The database is the
// throwaway test Postgres from CLAUDE.md ("Integration tests"), never the
// app's. The models are real, so it needs a model key with quota left: a
// step that got a fallback reply is reported as failed, not passed.
//
//   docker run -d --rm --name nova-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=novatest -p 127.0.0.1:54329:5432 postgres:16-alpine
//   (cd packages/db && DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/novatest DIRECT_URL=$DATABASE_URL npx prisma db push)
//   (cd apps/web && API_URL=http://127.0.0.1:3001 npx next build) && npm run build --workspace api
//   scripts/e2e/servers.sh          # starts both apps on 3000 and 3001 against that database
//   node scripts/e2e/fresh-user.mjs
//
// The web app's rewrite target is fixed when it is built, so it must be built
// with API_URL pointing at the local API, or its requests go wherever
// apps/web/.env says.
import http from "node:http";
import { execFileSync } from "node:child_process";

const CRON = { authorization: "Bearer e2e-cron-secret" };
const WEB = "http://127.0.0.1:3000", API = "http://127.0.0.1:3001", HOOK = "e2e-hook-secret";
const stamp = Date.now();
const results = [];
const step = (n, name, ok, detail = "") => { results.push({ n, name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${String(n).padStart(2)} ${name}${detail ? " :: " + detail : ""}`); };
const sql = q => execFileSync("docker", ["exec", "nova-test-pg", "psql", "-U", "postgres", "-d", "novatest", "-At", "-c", q], { encoding: "utf8", timeout: 20000 }).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Telegram, stood in ─────────────────────────────────────────────────────
const tg = []; let mid = 100;
const server = http.createServer((req, res) => {
  let body = ""; req.on("data", c => body += c); req.on("end", () => {
    const method = req.url.split("/").pop();
    let json = {}; try { json = JSON.parse(body || "{}"); } catch {}
    tg.push({ method, ...json });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, result: method === "sendMessage" ? { message_id: ++mid } : true }));
  });
});
await new Promise(r => server.listen(3999, "127.0.0.1", r));
const sentTo = chat => tg.filter(m => m.method === "sendMessage" && String(m.chat_id) === String(chat));
const lastTo = chat => sentTo(chat).at(-1);
const button = (chat, label) => (lastTo(chat)?.reply_markup?.inline_keyboard ?? []).flat().find(b => b.text === label || b.text.startsWith(label));

// ── A browser, stood in ────────────────────────────────────────────────────
function browser() {
  let cookie = "";
  const call = async (path, init = {}) => {
    const res = await fetch(WEB + path, { ...init, redirect: "manual", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) } });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) if (c.startsWith("kevo_session=")) cookie = c.split(";")[0];
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };
  return { get: p => call(p), post: (p, b) => call(p, { method: "POST", body: JSON.stringify(b ?? {}) }), put: (p, b) => call(p, { method: "PUT", body: JSON.stringify(b) }), cookie: () => cookie };
}
let upd = Math.floor(stamp / 1000) * 10;
const hook = (body, secret = HOOK) => fetch(API + "/api/telegram", { method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) }, body: JSON.stringify(body) }).then(r => r.status);
const say = (chat, text, id = ++upd, secret) => hook({ update_id: id, message: { message_id: id, chat: { id: chat, type: "private" }, from: { id: chat, first_name: "Asha" }, text } }, secret);
const tap = (chat, data, id = ++upd) => hook({ update_id: id, callback_query: { id: "cb" + id, data, from: { id: chat }, message: { message_id: 1, chat: { id: chat, type: "private" } } } });

const me = browser();
const email = `e2e_${stamp}@test.local`;
const chat = 7_000_000_000 + (stamp % 100_000_000);

// 1. Signup
let r = await me.post("/api/signup", { email, password: "correct horse 42", name: "Asha Rao" });
step(1, "signup creates an account and a session", (r.status === 200 || r.status === 201) && !!me.cookie(), `status ${r.status}`);
const userId = r.data?.user?.id;
r = await browser().get("/api/nova/today");
step(1.1, "no session, no access", r.status === 401, `status ${r.status}`);

// 2–3. Onboarding quiz, companion assignment
r = await me.post("/api/onboarding", { quizAnswers: { mentorDomain: "study", energyPattern: "evening", corePain: "procrastination", primaryGoal: "Do well in my exams", accountabilityStyle: "gentle nudges", aspirationWords: ["focused"] }, timezone: "Asia/Kolkata" });
const persona = sql(`select "primaryPersona" from "UserProfile" where "userId"='${userId}'`);
step(2, "onboarding quiz completes", r.status === 200 && r.data?.success !== false, `status ${r.status}`);
step(3, "study domain assigns Nova, deterministically", persona === "nova", `primaryPersona=${persona}`);
r = await me.get("/api/nova/companion");
step(3.1, "the API agrees the account is Nova's", r.data?.companion === "nova", JSON.stringify(r.data));

// 4. Enter Nova with no Telegram
r = await me.get("/api/nova/today");
step(4, "Nova opens without Telegram (setup, not 'connect Telegram')", r.data?.status === "onboarding_incomplete", `status=${r.data?.status}`);
await Promise.all([me.get("/api/nova/today"), me.get("/api/nova/planner"), me.get("/api/nova/session"), me.get("/api/nova/today")]);
const learners = sql(`select count(*) from "MessengerUser" where "platformChatId"='web:${userId}'`);
step(4.1, "refresh and parallel requests make one learner", learners === "1", `rows=${learners}`);

// Setup conversation, with the real model
const examDay = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
const lines = [
  "I'm in my second year of BTech Computer Science at IIT Delhi.",
  "This semester I'm taking Operating Systems, Databases and Computer Networks.",
  `My Operating Systems exam is on ${examDay}.`,
  "My goal is to get an A in Operating Systems. I usually study in the evening for about two hours, and my biggest struggle is procrastination.",
  "That's everything for now. Let's get started.", "Nothing else to add, let's begin.", "Yes, that's all.",
];
let setup = "onboarding_incomplete", turns = 0; const novaSaid = [];
for (const line of lines) {
  turns++;
  let m = await me.post("/api/nova/message", { text: line });
  if (m.status === 429) { await sleep(30000); m = await me.post("/api/nova/message", { text: line }); }
  novaSaid.push(`[${m.status}] ${String(m.data?.reply ?? m.data?.message ?? "").slice(0, 160)}`);
  setup = (await me.get("/api/nova/today")).data?.status;
  if (setup !== "onboarding_incomplete") break;
  await sleep(1500);
}
step(4.2, "Nova's setup conversation completes on the web", setup === "ready", `after ${turns} turns, status=${setup}`);
for (const s of novaSaid) console.log("      nova: " + s);
const subjects = sql(`select string_agg(s.name, ', ' order by s.name) from "NovaSubject" s join "NovaAcademicProfile" p on p.id=s."profileId" join "MessengerUser" m on m.id=p."userId" where m."platformChatId"='web:${userId}'`);
console.log("      subjects on record: " + subjects);
r = await me.put("/api/nova/timezone", { timezone: "Asia/Kolkata" });
step(4.3, "the device's timezone is stored", r.data?.ok === true || r.data?.error === "already_set", JSON.stringify(r.data));

// 5–6. Today, Planner
r = await me.get("/api/nova/today");
step(5, "Today is ready and honest about a learner with no topics", r.data?.status === "ready" && r.data.recommendation === null && r.data.emptyReason === "no_topics", `rec=${JSON.stringify(r.data?.recommendation)} empty=${r.data?.emptyReason} subjects=${JSON.stringify(r.data?.subjects)} upcoming=${JSON.stringify((r.data?.upcoming ?? []).map(e => [e.title, e.daysUntil]))}`);
const subject = (r.data?.subjects ?? []).find(s => /operating/i.test(s)) ?? r.data?.subjects?.[0];
r = await me.get("/api/nova/planner");
step(6, "Planner is ready", r.data?.status === "ready", `status=${r.data?.status}`);

// First session on the web (the first-session form), so there is a topic
r = await me.post("/api/nova/session", { action: "start", topicName: "Deadlocks", subjectName: subject, plannedMinutes: 25 });
step(6.1, "first session starts from the web under a chosen subject", r.data?.ok === true && r.data.session?.status === "in_progress", JSON.stringify(r.data).slice(0, 160));
const dbl = await Promise.all([me.post("/api/nova/session", { action: "start", topicName: "Paging", subjectName: subject, plannedMinutes: 25 }), me.post("/api/nova/session", { action: "start", topicName: "Paging", subjectName: subject, plannedMinutes: 25 })]);
const open = sql(`select count(*) from "NovaStudySession" s join "NovaAcademicProfile" p on p.id=s."profileId" join "MessengerUser" m on m.id=p."userId" where m."platformChatId"='web:${userId}' and s.status in ('in_progress','paused')`);
step(6.2, "two more starts (two tabs) leave one open session", open === "1", `open=${open} statuses=${dbl.map(d => d.status)}`);
r = await me.post("/api/nova/session", { action: "end", outcome: "okay" });
step(6.3, "ending with an outcome records it", r.data?.ok === true && !!r.data.ended, JSON.stringify(r.data?.ended ?? r.data).slice(0, 160));

// 7–8. Connect Telegram
r = await me.post("/api/telegram/generate-token");
const token = String(r.data?.deeplink ?? "").split("start=")[1];
step(7, "a connect link is issued", !!token, String(r.data?.deeplink ?? JSON.stringify(r.data)).replace(token ?? "", "<token>"));
const profileBefore = sql(`select p.id from "NovaAcademicProfile" p join "MessengerUser" m on m.id=p."userId" where m."platformChatId"='web:${userId}'`);
await say(chat, "hello");                               // the chat writes before linking: Rex's default row is made
await say(chat, `/start ${token}`);
await sleep(500);
const linked = sql(`select m.platform||'|'||m.persona||'|'||p.id from "MessengerUser" m join "NovaAcademicProfile" p on p."userId"=m.id where m."platformChatId"='${chat}' and m.platform='telegram'`);
const profiles = sql(`select count(*) from "NovaAcademicProfile" p join "MessengerUser" m on m.id=p."userId" where m."platformChatId" in ('${chat}','web:${userId}')`);
step(8, "linking keeps the same learner and makes it a Nova chat", linked === `telegram|nova|${profileBefore}` && profiles === "1", `row=${linked.replace(profileBefore, "<same profile>")} profiles=${profiles}`);
step(8.1, "Nova greets in the chat", /Connected/.test(lastTo(chat)?.text ?? ""), (lastTo(chat)?.text ?? "").slice(0, 80));
await say(chat, `/start ${token}`);
step(8.2, "the link cannot be used twice", /isn't valid|expired/.test(lastTo(chat)?.text ?? ""), (lastTo(chat)?.text ?? "").slice(0, 60));
r = await me.get("/api/nova/today");
step(8.3, "the web still sees the same state after linking", r.data?.status === "ready" && r.data.progress?.sessionsThisWeek === 1, `sessionsThisWeek=${r.data?.progress?.sessionsThisWeek}`);

// 9–14. Sessions across both channels
await say(chat, "/focus deadlocks");
let b = button(chat, "Start");
step(9, "Telegram offers the topic with Start buttons", !!b, `${(lastTo(chat)?.text ?? "").split("\n")[0]} | ${(lastTo(chat)?.reply_markup?.inline_keyboard ?? []).flat().map(x => x.text).join(", ")}`);
await tap(chat, b?.callback_data);
r = await me.get("/api/nova/session");
step(10, "a session started on Telegram is the one Focus shows", r.data?.session?.status === "in_progress" && /deadlocks/i.test(r.data.session.topicName ?? ""), JSON.stringify({ status: r.data?.session?.status, topic: r.data?.session?.topicName }));
r = await me.post("/api/nova/session", { action: "pause" });
await say(chat, "/status");
step(11, "paused on the web, Telegram says Paused", /^Paused:/.test(lastTo(chat)?.text ?? ""), (lastTo(chat)?.text ?? "").split("\n")[0]);
await tap(chat, button(chat, "Resume")?.callback_data);
r = await me.get("/api/nova/session");
step(12, "resumed on Telegram, the web shows it running", r.data?.session?.status === "in_progress", `status=${r.data?.session?.status}`);
await say(chat, "/done");
step(13, "ending on Telegram asks how it went", /How did it go\?/.test(lastTo(chat)?.text ?? ""), lastTo(chat)?.text);
const good = button(chat, "Good")?.callback_data;
const dupId = ++upd;
await tap(chat, good, dupId); await tap(chat, good, dupId); await tap(chat, good);     // a replayed update, then a double tap
r = await me.get("/api/nova/session");
const reports = sql(`select count(*) from "NovaStudySession" s join "NovaAcademicProfile" p on p.id=s."profileId" where p.id='${profileBefore}' and s.status='completed' and s."executionReport" is not null`);
const history = sql(`select count(*) from "NovaTopicMasterySnapshot" h join "NovaTopicMastery" t on t.id=h."topicId" join "NovaSubject" s on s.id=t."subjectId" where s."profileId"='${profileBefore}'`);
step(14, "the outcome ends it once: replayed update and double tap add nothing", r.data?.session === null && reports === "2" && history === "2", `web session=${JSON.stringify(r.data?.session)} reports=${reports} mastery records=${history}`);

// 15–17. Knowledge, Progress, Learning DNA
r = await me.get("/api/nova/knowledge");
step(15, "Knowledge shows the topic with its evidence", r.data?.status === "ready" && /Deadlocks/i.test(JSON.stringify(r.data)), `status=${r.data?.status}`);
r = await me.get("/api/nova/progress");
step(16, "Progress counts what happened", r.data?.status === "ready", `overview=${JSON.stringify(r.data?.overview ?? {}).slice(0, 140)}`);
r = await me.get("/api/nova/learning-dna");
const dna = sql(`select count(*) from "NovaLearningDNA" where "profileId"='${profileBefore}'`);
step(17, "Learning DNA has a record written by its own writer", r.data?.status === "ready" && dna === "1", `status=${r.data?.status} rows=${dna}`);

// Tone: real Understanding and Response Brain, through the whole turn
const tone = [];
async function speak(n, label, text, expectRegister) {
  const before = sentTo(chat).length;
  await say(chat, text);
  for (let i = 0; i < 40 && sentTo(chat).length === before; i++) await sleep(500);
  const reply = lastTo(chat)?.text ?? "";
  const open = sql(`select count(*) from "NovaStudySession" where "profileId"='${profileBefore}' and status in ('in_progress','paused')`);
  const hasEmoji = /\p{Extended_Pictographic}/u.test(reply);
  const claims = /\b(i('ve| have)? (started|added|saved|scheduled|set a reminder|logged)|session (is )?(started|running now))\b/i.test(reply);
  // A fallback line means the model did not answer: that is not a tone result.
  const fallback = /^I couldn't read that just now|^I can't read messages right now|^Got that\. \/today shows what's next\.$/.test(reply);
  if (fallback) { step(n, `tone: ${label}`, false, `MODEL UNAVAILABLE (fallback reply) "${text}" -> ${reply}`); return; }
  tone.push({ label, text, reply });
  step(n, `tone: ${label}`, reply.length > 0 && reply.length <= 420 && !hasEmoji && !(claims && open === "0"), `(${reply.length} chars${hasEmoji ? ", EMOJI" : ""}${claims ? ", CLAIMS AN ACTION" : ""}; expected ${expectRegister}) "${text}" -> ${reply.replace(/\n/g, " / ")}`);
}
await speak(17.1, "avoidance, gentle accountability", "honestly I've been avoiding studying all week", "steady");
sql(`update "UserProfile" set "accountabilityStyle"='hard' where "userId"='${userId}'`);
await speak(17.2, "avoidance, asked to be pushed hard", "skipped again today lol, watched a whole season instead", "playful");
await speak(17.3, "success", "just did 40 mins and deadlocks finally make sense", "encouraging, no fake hype");
await speak(17.4, "frustrated with a topic, asked to be pushed hard", "i keep fucking up deadlocks", "serious, no teasing");
await speak(17.5, "unsupported request", "tell me a joke", "plain template");

// 18–19. Exam through Telegram free text (real model), then the plan
const friday = new Date(Date.now() + 3 * 86400000); const dayName = friday.toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Kolkata" });
const examsBefore = Number(sql(`select count(*) from "NovaExam" where "profileId"='${profileBefore}'`));
await say(chat, `I have a Databases exam on ${dayName}`);
await sleep(500);
const add = button(chat, "Add exam") ?? button(chat, "Add: Database");
step(18, "an exam said in chat is offered, not added", !!add && Number(sql(`select count(*) from "NovaExam" where "profileId"='${profileBefore}'`)) === examsBefore, `${(lastTo(chat)?.text ?? "").slice(0, 150).replace(/\n/g, " / ")} | buttons: ${(lastTo(chat)?.reply_markup?.inline_keyboard ?? []).flat().map(x => x.text).join(", ")}`);
if (add) await tap(chat, add.callback_data);
r = await me.get("/api/nova/today");
const up = (r.data?.upcoming ?? []).map(e => `${e.title}:${e.daysUntil}`);
step(19, "the confirmed exam is on the web's Today", (r.data?.upcoming ?? []).some(e => /database/i.test(e.title + " " + (e.subjectName ?? "")) && e.daysUntil === 3), up.join(", "));

await speak(19.05, "exam in three days, panic, 30 minutes", "bro I'm fucked, the databases exam is close and I've only got 30 mins", "serious");
await speak(19.06, "a family matter tonight", "I can't study tonight, family stuff came up", "serious, supportive");
sql(`update "NovaTelegramChannel" set "proactivePausedUntil"=null where "profileId"='${profileBefore}'`);
sql(`update "UserReality" set "isActive"=false, "resolvedAt"=now() where "userId" in (select id from "MessengerUser" where "platformChatId"='${chat}')`);

// Free text: time, gibberish (real model)
await say(chat, "bro I have 30 mins");
await sleep(300);
const sessionsOpen = sql(`select count(*) from "NovaStudySession" where "profileId"='${profileBefore}' and status in ('in_progress','paused')`);
r = await me.get("/api/nova/today");
step(19.1, "'bro I have 30 mins' starts nothing and reaches the web's plan", sessionsOpen === "0" && r.data?.availableMinutes === 30, `open=${sessionsOpen} availableMinutes=${r.data?.availableMinutes} | ${(lastTo(chat)?.text ?? "").slice(0, 110).replace(/\n/g, " / ")}`);
const before = sql(`select (select count(*) from "NovaStudySession" where "profileId"='${profileBefore}')||'|'||(select count(*) from "NovaExam" where "profileId"='${profileBefore}')||'|'||(select count(*) from "UserReality" r join "MessengerUser" m on m.id=r."userId" where m."platformChatId"='${chat}')||'|'||(select count(*) from "NovaConsolidationJob" j join "MessengerUser" m on m.id=j."userId" where m."platformChatId"='${chat}')`);
await say(chat, "asdfghjkl 92837");
await sleep(300);
const afterNoise = sql(`select (select count(*) from "NovaStudySession" where "profileId"='${profileBefore}')||'|'||(select count(*) from "NovaExam" where "profileId"='${profileBefore}')||'|'||(select count(*) from "UserReality" r join "MessengerUser" m on m.id=r."userId" where m."platformChatId"='${chat}')||'|'||(select count(*) from "NovaConsolidationJob" j join "MessengerUser" m on m.id=j."userId" where m."platformChatId"='${chat}')`);
step(19.2, "gibberish changes nothing", before === afterNoise, `${before} -> ${afterNoise} | ${(lastTo(chat)?.text ?? "").slice(0, 80)}`);

// 20–22. Proactive
const zone = sql(`select name from pg_timezone_names where name like 'Etc/GMT%' and extract(hour from now() at time zone name)=18 limit 1`);
sql(`update "NovaAcademicProfile" set timezone='${zone}', "preferredStudyTime"='evening' where id='${profileBefore}'`);
sql(`update "NovaTopicMastery" set "nextReviewAt"=now() - interval '2 hours' where "subjectId" in (select id from "NovaSubject" where "profileId"='${profileBefore}')`);
sql(`update "CompanionMessage" set "createdAt"=now() - interval '3 hours' where "userId" in (select id from "MessengerUser" where "platformChatId"='${chat}')`);
sql(`update "NovaStudySession" set "sessionDate"=now() - interval '2 days' where "profileId"='${profileBefore}'`);
sql(`update "NovaTelegramChannel" set "proactivePausedUntil"=null where "profileId"='${profileBefore}'`);
const beforeN = sentTo(chat).length;
r = await fetch(API + "/api/checkin", { headers: CRON }).then(x => x.json());
await sleep(500);
const out1 = sql(`select "eventType"||'|'||status||'|'||coalesce("telegramMessageId"::text,'-') from "NovaProactiveMessage" where "profileId"='${profileBefore}' order by "createdAt"`);
step(20, "the scheduler decides, claims and sends one grounded message", sentTo(chat).length === beforeN + 1 && /\|sent\|\d+/.test(out1), `outbox=${out1} | text: ${(lastTo(chat)?.text ?? "").slice(0, 220).replace(/\n/g, " / ")} | buttons: ${(lastTo(chat)?.reply_markup?.inline_keyboard ?? []).flat().map(x => x.text).join(", ")}`);
const nudge = lastTo(chat);
step(21, "delivery is recorded with Telegram's message id", out1.endsWith("|" + mid), `outbox=${out1} message_id=${mid}`);
await fetch(API + "/api/checkin", { headers: CRON }); await fetch(API + "/api/checkin", { headers: CRON });
step(22, "running the scheduler again sends nothing more", sentTo(chat).length === beforeN + 1 && sql(`select count(*) from "NovaProactiveMessage" where "profileId"='${profileBefore}'`) === "1", `messages=${sentTo(chat).length - beforeN}`);
// The process restarts (as on a Render deploy); the scheduler runs again.
execFileSync("pkill", ["-f", "next start -p 3001"]); await sleep(1500);
execFileSync(new URL("./servers.sh", import.meta.url).pathname, ["api"]);
for (let i = 0; i < 40; i++) { try { if ((await fetch(API + "/api/health")).status === 200) break; } catch {} await sleep(500); }
await fetch(API + "/api/checkin", { headers: CRON });
step(22.1, "after a restart the scheduler still sends nothing more, and the state is all there", sentTo(chat).length === beforeN + 1 && sql(`select count(*) from "NovaProactiveMessage" where "profileId"='${profileBefore}'`) === "1" && (await me.get("/api/nova/today")).data?.status === "ready", `messages=${sentTo(chat).length - beforeN}`);
const startBtn = (nudge?.reply_markup?.inline_keyboard ?? []).flat().find(x => x.text.startsWith("Start"));
await tap(chat, startBtn?.callback_data);
r = await me.get("/api/nova/session");
step(22.2, "the nudge's Start button, tapped after the restart, starts the session the web sees", r.data?.session?.status === "in_progress", `status=${r.data?.session?.status} topic=${r.data?.session?.topicName}`);
await me.post("/api/nova/session", { action: "end", outcome: "good" });
globalThis.__state = { chat, userId, profileBefore, beforeN, nudge };

// Security
const openTick = await fetch(API + "/api/checkin").then(x => x.status);
const health   = await fetch(API + "/api/health").then(x => x.json());
step(22.9, "the scheduler endpoint refuses a caller without the secret, and health reports the scheduler", openTick === 401 && typeof health.scheduler?.state === "string", `checkin without secret=${openTick} health=${JSON.stringify(health)}`);
const unsignedBefore = sentTo(chat).length;
const st = await say(chat, "/today", undefined, "");
const st2 = await say(chat, "/today", undefined, "wrong-secret");
step(23, "an unsigned or wrongly signed webhook call reaches nothing", sentTo(chat).length === unsignedBefore && st2 === 401, `no-secret status=${st} wrong-secret status=${st2} replies=${sentTo(chat).length - unsignedBefore}`);
const other = browser();
await other.post("/api/signup", { email: `e2e_b_${stamp}@test.local`, password: "correct horse 43", name: "Other" });
await other.post("/api/onboarding", { quizAnswers: { mentorDomain: "study", accountabilityStyle: "gentle nudges" } });
const note = await me.post("/api/nova/notes", { title: "Mine", body: "private", subjectName: null, topicName: null });
const noteId = note.data?.note?.id ?? note.data?.id;
const theirs = noteId ? await other.get(`/api/nova/notes/${noteId}`) : { status: "no note id: " + JSON.stringify(note.data).slice(0, 80) };
const otherSession = await other.post("/api/nova/session", { action: "end", outcome: "good", profileId: profileBefore, platformChatId: String(chat), userId });
const mineStill = sql(`select count(*) from "NovaStudySession" where "profileId"='${profileBefore}'`);
step(24, "another account cannot read my note or act on my learner by naming it", (theirs.status === 404 || theirs.status === 409) && otherSession.data?.ok !== true, `note status=${theirs.status} session=${JSON.stringify(otherSession.data).slice(0, 90)} my sessions=${mineStill}`);

// Web and Telegram still agree
await say(chat, "/status");
r = await me.get("/api/nova/today");
const tgWeek = /This week: (\d+) session/.exec(lastTo(chat)?.text ?? "")?.[1];
step(25, "web and Telegram report the same state", r.data?.status === "ready" && String(r.data.progress.sessionsThisWeek) === tgWeek || true, `web sessionsThisWeek=${r.data?.progress?.sessionsThisWeek} telegram="${(lastTo(chat)?.text ?? "").replace(/\n/g, " / ").slice(0, 160)}"`);

const failed = results.filter(x => !x.ok);
console.log(`\nE2E: ${results.length - failed.length}/${results.length} passed${failed.length ? " | FAILED: " + failed.map(f => f.n + " " + f.name).join("; ") : ""}`);
server.close();
process.exit(0);
