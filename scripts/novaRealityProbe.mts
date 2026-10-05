/**
 * Live check of the Understanding Brain (calls OpenAI).
 * Shows, for realistic messages, the reality it reports, the session intent
 * it reads, what it correctly leaves empty, and for mixed messages whether
 * every stated signal survives (secondaryIntents → established signals). Not a test: model output is not deterministic.
 *
 * Run from repo root:  npx tsx scripts/novaRealityProbe.mts [filter]
 * Uses whichever provider is configured (GEMINI_API_KEY or OPENAI_API_KEY).
 */
import { runUnderstandingBrain } from "../packages/api/src/nova/brains/understanding-brain.ts";
import { resolveTurnSignals } from "../packages/api/src/nova/engines/turn-signals.ts";
import { STATE_BASELINES } from "../packages/api/src/nova/types/academic-state.types.ts";
const cases: Array<[string, string]> = [
  ["illness",      "I've had the flu since Monday, can't focus at all"],
  ["injury",       "broke my wrist playing football so writing notes is really slow"],
  ["travel",       "I'm away at my cousin's wedding until Sunday"],
  ["exams",        "finals week starts tomorrow, three exams in five days"],
  ["work",         "I work night shifts at the warehouse four days a week"],
  ["emotional",    "my grandfather died on Friday. I can't think about revision right now"],
  ["schedule",     "my sister is staying this week so my evenings are gone"],
  ["resolution",   "I was sick last week, I'm fine now"],
  ["NEG report",   "I finished chapter 3 and did all the exercises"],
  ["NEG question", "can you explain eigenvalues again?"],
  ["NEG excuse",   "I was busy, didn't get to it"],
  ["NEG mood",     "ugh, tired today"],
  ["NEG plan",     "what should I revise this week?"],
  ["NEG other",    "my roommate has the flu lol"],
  ["START",        "I have 30 minutes, let's do OS"],
  ["START",        "ok starting my session"],
  ["BREAK",        "need a break, back in ten"],
  ["NEG later",    "I'll study chapter 4 tonight"],
  // Multi-signal: each message states several things. All must survive.
  ["MULTI 1",      "I finished chapter 3 but I'm exhausted."],
  ["MULTI 2",      "I studied OS for an hour, understood deadlocks better, but I'm still really confused about Banker's algorithm."],
  ["MULTI 3",      "I was supposed to study DBMS tonight but my exam got moved to next week, so I'm taking tonight off."],
  ["MULTI 4",      "I completed today's session, but I couldn't focus because I barely slept."],
];
const STATE = {
  semesterPhase: "midterm", activeMode: "standard", momentaryState: "neutral", scores: { ...STATE_BASELINES },
  hardDirectives: { noStudyPressure: false, examCrisisMode: false, planFreezeMode: false, calibrationAlert: false, noChallenging: false, recoveryMode: false, beginnerMode: false },
  daysSinceJoined: 30, daysSinceLastSession: 1, consecutiveMisses: 0, studyStreakDays: 0,
  daysUntilNextExam: null, momentum7dTrend: [0, 0, 0, 0, 0, 0, 0], stateHistory: [],
} as const;

// The free tier allows about 15 requests a minute. PROBE_DELAY_MS=0 on a paid key.
const delayMs = Number(process.env.PROBE_DELAY_MS ?? 4500);
const only    = process.argv[2]?.toLowerCase();   // e.g. `multi` runs only the MULTI cases

for (const [label, msg] of cases.filter(([l]) => !only || l.toLowerCase().includes(only))) {
  await new Promise(resolve => setTimeout(resolve, delayMs));
  const u = await runUnderstandingBrain(msg, []);
  const r = (u.realityObservations ?? []).map(o => `${o.category}/${o.subtype} ${o.status} ${o.persistence} ${o.expectedDurationHours ?? "-"}h c=${o.confidence} "${o.claim}"`);
  // What the rest of Nova will actually see for this message.
  const established = resolveTurnSignals({ text: msg, command: null, understanding: u, state: STATE as never })
    .detectedSignals.map(s => `${s.type}(${s.evidence === "understanding" ? "UB" : "regex+UB"})`);
  console.log(`${label.padEnd(13)} "${msg}"`);
  console.log(`              intent=${u.intent} secondary=[${(u.secondaryIntents ?? []).join(",")}] emotion=${u.emotion} session=${u.sessionIntent ?? "none"} topic=${u.topic ?? "-"} disc=${u.disclosureClass}`);
  console.log(`              signals=[${established.join(", ")}]`);
  console.log(`              reality=${r.length ? r.join(" | ") : "[]"}\n`);
}
