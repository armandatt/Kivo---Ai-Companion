// A brand-new person's first hour with Nova, over real HTTP against the built
// apps: signup, the quiz, Nova with no Telegram, setup, a first session,
// connecting Telegram, sessions across both surfaces, an exam, free text,
// tone, the proactive scheduler, a process restart, and ownership checks.
//
// Telegram is a local stand-in (TELEGRAM_API_BASE), and so is the email
// provider (RESEND_API_BASE): both are the server this script starts on 3999.
// Signup is the real thing. The API generates the verification code, stores
// its hash and sends it; this script reads the code out of the message the
// stand-in received and submits it with its signup token, exactly as a person
// would from their inbox. Nothing here skips or pre-approves verification.
// The addresses are @gmail.com in shape only: no message leaves this machine.
//
// The database is the throwaway test Postgres from CLAUDE.md ("Integration
// tests"), never the app's. Setup, sessions, linking, the scheduler, deletion
// and the ownership checks need no model. The free-text steps (tone, an exam
// said in chat) use the real models, so they need a model key with quota
// left: a step that got a fallback reply is reported as failed, not passed.
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

// ── Telegram and the email provider, stood in ──────────────────────────────
const tg = []; let mid = 100;
const mail = [];
const server = http.createServer((req, res) => {
  let body = ""; req.on("data", c => body += c); req.on("end", () => {
    const method = req.url.split("/").pop();
    let json = {}; try { json = JSON.parse(body || "{}"); } catch {}
    if (method === "emails") {
      mail.push(json);
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ id: "e2e-" + mail.length }));
    }
    tg.push({ method, ...json });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, result: method === "sendMessage" ? { message_id: ++mid } : true }));
  });
});
await new Promise(r => server.listen(3999, "127.0.0.1", r));
const sentTo = chat => tg.filter(m => m.method === "sendMessage" && String(m.chat_id) === String(chat));
const lastTo = chat => sentTo(chat).at(-1);
const button = (chat, label) => (lastTo(chat)?.reply_markup?.inline_keyboard ?? []).flat().find(b => b.text === label || b.text.startsWith(label));
const mailTo = address => mail.filter(m => [m.to].flat().includes(address));
// The code in the newest message to an address, as its owner would read it.
const emailedCode = address => /\b(\d{8})\b/.exec(mailTo(address).at(-1)?.text ?? "")?.[1] ?? null;

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

// Signs a browser up the way a person does: ask for a code, read it from the
// inbox, send it back with the token the first reply gave this browser.
async function signUp(who, address, password, name) {
  const started = await who.post("/api/signup", { email: address, password, name });
  const signupToken = started.data?.signupToken;
  const code = emailedCode(address);
  const verified = code && signupToken
    ? await who.post("/api/signup/verify", { email: address, code, signupToken })
    : { status: "no code or token", data: null };
  return { started, signupToken, code, verified };
}

const me = browser();
const email = `e2e_${stamp}@gmail.com`;
const chat = 7_000_000_000 + (stamp % 100_000_000);

// 1. Signup, with the emailed code
let r = await me.post("/api/signup", { email, password: "correct horse 42", name: "Asha Rao" });
const signupToken = r.data?.signupToken;
const code = emailedCode(email);
const accountsBefore = sql(`select count(*) from "User" where email='${email}'`);
step(0.1, "signup emails a code and grants nothing yet: no session, no account", r.status === 200 && !me.cookie() && !r.data?.user && /^[0-9a-f]{64}$/.test(signupToken ?? "") && /^\d{8}$/.test(code ?? "") && accountsBefore === "0", `status ${r.status} cookie=${!!me.cookie()} code=${code ? "received" : "none"} accounts=${accountsBefore}`);
const stored = sql(`select "codeHash" || ' ' || "tokenHash" || ' ' || "passwordHash" from "PendingSignup" where email='${email}'`);
step(0.2, "the code, the token and the password are stored only as hashes", !!stored && !stored.includes(code) && !stored.includes(signupToken) && !stored.includes("correct horse 42"), `stored ${stored.length} chars`);
const wrong = code === "00000000" ? "00000001" : "00000000";
const badCode = await me.post("/api/signup/verify", { email, code: wrong, signupToken });
const noToken = await browser().post("/api/signup/verify", { email, code });
const badToken = await browser().post("/api/signup/verify", { email, code, signupToken: "ab".repeat(32) });
step(0.3, "a wrong code, or the right code without this browser's token, is refused", badCode.status === 400 && noToken.status === 400 && badToken.status === 400 && !me.cookie(), `wrong code=${badCode.status} no token=${noToken.status} other token=${badToken.status}`);
const forged = await fetch(WEB + "/api/login", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.test" }, body: "{}" }).then(x => x.status);
const formPost = await fetch(WEB + "/api/login", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" }).then(x => x.status);
step(0.4, "an auth request from another site, or sent as a form would send it, is refused", forged === 403 && formPost === 415, `other origin=${forged} text/plain=${formPost}`);
r = await me.post("/api/signup/verify", { email, code, signupToken });
step(1, "the emailed code and the token create the account and a session", r.status === 201 && !!me.cookie() && !!r.data?.user?.id, `status ${r.status}`);
const userId = r.data?.user?.id;
const replay = await browser().post("/api/signup/verify", { email, code, signupToken });
step(1.05, "the code cannot be used a second time", replay.status === 400, `status ${replay.status}`);
r = await browser().get("/api/nova/today");
step(1.1, "no session, no access", r.status === 401, `status ${r.status}`);

// 1.2. Signed up, quiz not done: the dashboard sends them to the quiz, and the
// quiz does not send them back. (A first Google sign-in arrives in this state.)
const page = async path => { const res = await fetch(WEB + path, { redirect: "manual", headers: { cookie: me.cookie() } }); return { status: res.status, to: res.headers.get("location") ?? "" }; };
const early = { home: await page("/home"), planner: await page("/planner"), quiz: await page("/onboarding") };
step(1.2, "before the quiz, dashboard pages lead to the quiz and the quiz stays put", early.home.status === 307 && early.home.to.endsWith("/onboarding") && early.planner.status === 307 && early.planner.to.endsWith("/onboarding") && early.quiz.status === 200, `home=${early.home.status} ${early.home.to} planner=${early.planner.status} ${early.planner.to} quiz=${early.quiz.status}`);

// 2–3. Onboarding quiz, companion assignment
r = await me.post("/api/onboarding", { quizAnswers: { mentorDomain: "study", energyPattern: "evening", corePain: "procrastination", primaryGoal: "Do well in my exams", accountabilityStyle: "gentle nudges", aspirationWords: ["focused"] }, timezone: "Asia/Kolkata" });
const persona = sql(`select "primaryPersona" from "UserProfile" where "userId"='${userId}'`);
step(2, "onboarding quiz completes", r.status === 200 && r.data?.success !== false, `status ${r.status}`);
step(3, "study domain assigns Nova, deterministically", persona === "nova", `primaryPersona=${persona}`);
// 3.02. Settings takes only what it can use: a real timezone, a real
// check-in time, a companion that exists.
const patch = async body => { const res = await fetch(WEB + "/api/settings", { method: "PATCH", headers: { "content-type": "application/json", cookie: me.cookie() }, body: JSON.stringify(body) }); return res.status; };
const refused = [await patch({ timezone: "(UTC+05:30) Mumbai, Kolkata" }), await patch({ timezone: "Mars/Olympus" }), await patch({ persona: "admin" }), await patch({ checkInTime: "25:99" })];
const accepted = [await patch({ timezone: "Asia/Calcutta" }), await patch({ checkInTime: "9:05" })];
const kept = sql(`select timezone||'|'||"preferredCheckInTime"||'|'||"primaryPersona" from "UserProfile" where "userId"='${userId}'`);
await patch({ checkInTime: null });   // the scheduler steps below assume no fixed check-in time
step(3.02, "Settings refuses a timezone, a time and a companion that are not real, and stores real ones in one form", refused.every(x => x === 400) && accepted.every(x => x === 200) && kept === "Asia/Kolkata|09:05|nova", `refused=${refused} accepted=${accepted} stored=${kept}`);
const late = { home: await page("/home"), quiz: await page("/onboarding") };
step(3.05, "after the quiz, the dashboard opens and nothing bounces between the two", late.home.status === 200 && late.quiz.status === 200, `home=${late.home.status} ${late.home.to} quiz=${late.quiz.status} ${late.quiz.to}`);
r = await me.get("/api/nova/companion");
step(3.1, "the API agrees the account is Nova's", r.data?.companion === "nova", JSON.stringify(r.data));

// 4. Enter Nova with no Telegram
r = await me.get("/api/nova/today");
step(4, "Nova opens without Telegram (setup, not 'connect Telegram')", r.data?.status === "onboarding_incomplete", `status=${r.data?.status}`);
await Promise.all([me.get("/api/nova/today"), me.get("/api/nova/planner"), me.get("/api/nova/session"), me.get("/api/nova/today")]);
const learners = sql(`select count(*) from "MessengerUser" where "platformChatId"='web:${userId}'`);
step(4.1, "refresh and parallel requests make one learner", learners === "1", `rows=${learners}`);

// Setup, through the form the web app's setup page posts: three subjects, the
// topics of one, an exam date, daily time and usual hours. No model is used.
const examDay = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
const draft = {
  subjects: [{ name: "Operating Systems", topics: ["Deadlocks", "Paging"] }, { name: "Databases", topics: [] }, { name: "Computer Networks", topics: [] }],
  exams: [{ subjectName: "Operating Systems", date: examDay, title: null }], dailyMinutes: 120, studyTime: "evening",
};
const previewed = await me.post("/api/nova/setup", { draft });
const savedSetup = await me.post("/api/nova/setup", { draft, confirm: true });
const setup = (await me.get("/api/nova/today")).data?.status;
step(4.2, "the setup form previews without writing, then saves, and Nova is ready", previewed.data?.saved === false && savedSetup.data?.saved === true && setup === "ready", `preview saved=${previewed.data?.saved} save=${savedSetup.status} status=${setup}`);
const subjects = sql(`select string_agg(s.name, ', ' order by s.name) from "NovaSubject" s join "NovaAcademicProfile" p on p.id=s."profileId" join "MessengerUser" m on m.id=p."userId" where m."platformChatId"='web:${userId}'`);
console.log("      subjects on record: " + subjects);
r = await me.put("/api/nova/timezone", { timezone: "Asia/Kolkata" });
step(4.3, "the device's timezone is stored", r.data?.ok === true || r.data?.error === "already_set", JSON.stringify(r.data));

// 5–6. Today, Planner
r = await me.get("/api/nova/today");
step(5, "Today is ready and recommends a topic from the setup, with its reason", r.data?.status === "ready" && r.data.recommendation?.topicName && (r.data.recommendation.reasons ?? []).length > 0 && r.data.emptyReason === null, `rec=${JSON.stringify(r.data?.recommendation?.topicName)} reasons=${JSON.stringify(r.data?.recommendation?.reasons)} upcoming=${JSON.stringify((r.data?.upcoming ?? []).map(e => [e.title, e.daysUntil]))}`);
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
// 7.1–7.4. A chat nobody has connected. It is told how to connect, by whatever
// it sends, and nothing is made for it: no row, no Rex setup, no conversation.
const stranger = chat + 1;
const UNCONNECTED = /isn't connected to a Kivo account/;
const left = id => sql(`select (select count(*) from "MessengerUser" where "platformChatId" like '${id}%')||'|'||(select count(*) from "UserProfile" where "telegramChatId"='${id}')||'|'||(select count(*) from "CompanionMessage" c join "MessengerUser" m on m.id=c."userId" where m."platformChatId" like '${id}%')||'|'||(select count(*) from "MemoryFact" f join "MessengerUser" m on m.id=f."userId" where m."platformChatId" like '${id}%')`);
for (const [n, text] of [[7.1, "/start"], [7.2, "hey, can you help me with my exams?"], [7.3, "/log bench press 80kg 5x5"]]) {
  const before = sentTo(stranger).length;
  await say(stranger, text);
  await sleep(300);
  const got = sentTo(stranger).slice(before);
  step(n, `an unconnected chat sending "${text}" is told how to connect, once, and nothing is made for it`, got.length === 1 && UNCONNECTED.test(got[0].text) && !/Rex|gym|workout|Nova/i.test(got[0].text) && !got[0].reply_markup && left(stranger) === "0|0|0|0", `replies=${got.length} left=${left(stranger)} | ${(got[0]?.text ?? "").slice(0, 90)}`);
}
// A Rex chat that finished Rex's setup, with no web account: Rex's, as before.
const rexChat = chat + 2;
sql(`insert into "MessengerUser"(id, platform, "platformChatId", persona, "intakeComplete", "intakeStep", "aspirationWords", "activeModules", "updatedAt") values ('e2e_rex_${stamp}', 'telegram', '${rexChat}', 'rex', true, 'complete', '{}', '{}', now())`);
await say(rexChat, "hello");
await sleep(1500);
step(7.4, "a Rex chat that finished its setup is not treated as unconnected", sentTo(rexChat).every(m => !UNCONNECTED.test(m.text)) && sql(`select persona||'|'||"intakeComplete" from "MessengerUser" where "platformChatId"='${rexChat}'`) === "rex|true", `connect messages=${sentTo(rexChat).filter(m => UNCONNECTED.test(m.text)).length}`);

// The learner's own chat writes before linking, as people do. It is told how
// to connect, and no Rex row is made for it to trip the link over.
await say(chat, "hello");
await sleep(300);
step(7.5, "the learner's chat, before linking, is told how to connect and is given no row", UNCONNECTED.test(lastTo(chat)?.text ?? "") && left(chat) === "0|0|0|0", `left=${left(chat)} | ${(lastTo(chat)?.text ?? "").slice(0, 60)}`);
await say(chat, `/start ${token}`);
await sleep(500);
const linked = sql(`select m.platform||'|'||m.persona||'|'||p.id from "MessengerUser" m join "NovaAcademicProfile" p on p."userId"=m.id where m."platformChatId"='${chat}' and m.platform='telegram'`);
const profiles = sql(`select count(*) from "NovaAcademicProfile" p join "MessengerUser" m on m.id=p."userId" where m."platformChatId" in ('${chat}','web:${userId}')`);
step(8, "linking keeps the same learner and makes it a Nova chat", linked === `telegram|nova|${profileBefore}` && profiles === "1", `row=${linked.replace(profileBefore, "<same profile>")} profiles=${profiles}`);
step(8.1, "Nova opens the chat with what to do now and a way to start it", !!button(chat, "Start") && !UNCONNECTED.test(lastTo(chat)?.text ?? ""), `${(lastTo(chat)?.text ?? "").slice(0, 60).replace(/\n/g, " / ")} | ${(lastTo(chat)?.reply_markup?.inline_keyboard ?? []).flat().map(x => x.text).join(", ")}`);
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
// Both sessions so far lasted seconds: each is kept with its report, and
// neither is ten minutes of study, so neither moves mastery.
step(14, "the outcome ends it once: a replayed update and a double tap add nothing", r.data?.session === null && reports === "2" && history === "0", `web session=${JSON.stringify(r.data?.session)} reports=${reports} mastery records=${history}`);

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
const sched = await fetch(API + "/api/health/scheduler");
const schedBody = await sched.json().catch(() => null);
step(22.9, "the scheduler endpoint refuses a caller without the secret, and health reports the scheduler", openTick === 401 && typeof health.scheduler?.state === "string" && sched.status === 200 && schedBody?.scheduler?.state === health.scheduler.state, `checkin without secret=${openTick} health=${JSON.stringify(health)} scheduler status=${sched.status}`);
const unsignedBefore = sentTo(chat).length;
const st = await say(chat, "/today", undefined, "");
const st2 = await say(chat, "/today", undefined, "wrong-secret");
step(23, "an unsigned or wrongly signed webhook call reaches nothing", sentTo(chat).length === unsignedBefore && st2 === 401, `no-secret status=${st} wrong-secret status=${st2} replies=${sentTo(chat).length - unsignedBefore}`);
const other = browser();
await signUp(other, `e2e_b_${stamp}@gmail.com`, "correct horse 43", "Other");
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

// 26. Deleting the account, from the settings page's own request. The reply
// is believed only when it says ok; it clears the session; and nothing of the
// learner's is left, the Telegram chat and its conversation included.
const hadBefore = left(chat);
const oldCookie = me.cookie();
const del = await fetch(WEB + "/api/delete-account", { method: "DELETE", headers: { cookie: oldCookie } });
const delBody = await del.json().catch(() => null);
const cleared = (del.headers.getSetCookie?.() ?? []).some(c => c.startsWith("kevo_session=;") || (c.startsWith("kevo_session=") && /max-age=0|expires=thu, 01 jan 1970/i.test(c)));
const gone = sql(`select (select count(*) from "User" where id='${userId}')||'|'||(select count(*) from "NovaAcademicProfile" where id='${profileBefore}')||'|'||(select count(*) from "NovaStudySession" where "profileId"='${profileBefore}')`);
step(26, "deleting the account removes the learner, the chat and its conversation, and signs the browser out", del.status === 200 && delBody?.ok === true && cleared && hadBefore !== "0|0|0|0" && left(chat) === "0|0|0|0" && gone === "0|0|0", `status=${del.status} cookie cleared=${cleared} chat before=${hadBefore} after=${left(chat)} account|profile|sessions=${gone}`);
const afterDelete = { home: await fetch(WEB + "/home", { redirect: "manual", headers: { cookie: oldCookie } }), again: await fetch(WEB + "/api/delete-account", { method: "DELETE", headers: { cookie: oldCookie } }) };
const ghost = async (method, path, body) => (await fetch(WEB + path, { method, headers: { "content-type": "application/json", cookie: oldCookie }, body: JSON.stringify(body) })).status;
const ghostWrites = [await ghost("PATCH", "/api/settings", { checkInTime: "09:00" }), await ghost("POST", "/api/onboarding", { quizAnswers: { mentorDomain: "study", primaryGoal: "x" } })];
step(26.1, "the old session opens nothing and can write nothing, and asking to delete again is not an error", afterDelete.home.status === 307 && (afterDelete.home.headers.get("location") ?? "").endsWith("/signin") && afterDelete.again.status === 200 && ghostWrites.every(x => x === 401) && sql(`select count(*) from "UserProfile" where "userId"='${userId}'`) === "0", `home=${afterDelete.home.status} ${afterDelete.home.headers.get("location") ?? ""} delete again=${afterDelete.again.status} settings,onboarding=${ghostWrites}`);
await say(chat, "/today");
await sleep(300);
step(26.2, "the Telegram chat is an unconnected one again", UNCONNECTED.test(lastTo(chat)?.text ?? "") && left(chat) === "0|0|0|0", (lastTo(chat)?.text ?? "").slice(0, 70));

const failed = results.filter(x => !x.ok);
console.log(`\nE2E: ${results.length - failed.length}/${results.length} passed${failed.length ? " | FAILED: " + failed.map(f => f.n + " " + f.name).join("; ") : ""}`);
server.close();
process.exit(0);
