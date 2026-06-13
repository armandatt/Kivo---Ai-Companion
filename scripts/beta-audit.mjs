/**
 * REX BETA READINESS AUDIT
 * Pulls last 500 user+assistant message pairs from production DB.
 * Classifies each: trust_breaker | generic | missed_personalization | wrong_intervention | magic_moment | ok
 * Outputs metrics + top 20 failures + top 20 best.
 */

import pg from 'pg';
const { Client } = pg;

const DB_URL = "postgresql://neondb_owner:npg_B52lgHGDZTXd@ep-late-band-a46kxn8z-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

// ── Heuristics ────────────────────────────────────────────────────────────────

// Patterns that signal a generic response (no user-specific anchoring)
const GENERIC_OPENERS = [
  /^(that('?s| is) (great|good|awesome|solid|perfect|amazing))/i,
  /^(great|good|awesome|solid|perfect|nice|well done|excellent)/i,
  /^(keep (it up|going|pushing|working hard))/i,
  /^(sounds (good|great|like a plan|solid))/i,
  /^(i (understand|get it|hear you|see))/i,
  /^(consistency is key)/i,
  /^(you('?re| are) (doing great|on the right track|making progress))/i,
];

const GENERIC_FILLER = [
  "consistency is key",
  "stay the course",
  "trust the process",
  "believe in yourself",
  "you've got this",
  "keep pushing",
  "every step counts",
  "progress takes time",
  "one day at a time",
  "you're on the right track",
  "keep up the good work",
  "you're doing great",
  "results take time",
  "stay consistent",
];

// Burnout/overwhelm phrases in user messages — Rex should NEVER push training here
const BURNOUT_USER_SIGNALS = [
  /\b(burned?[\s-]?out|burnout)\b/i,
  /\b(dread(ing)? train|hate the gym|hate training)\b/i,
  /\b(exhausted|no energy|running on empty|nothing left)\b/i,
  /\b(can'?t do this anymore|done with (this|gym|training))\b/i,
  /\b(feels like (punishment|a chore)|going through the motions)\b/i,
  /\b(overwhelming?|too much|can'?t keep up)\b/i,
];

// Trust-breaking: Rex pushing training despite burnout/completion signals
const TRUST_BREAKER_PATTERNS = [
  /\b(get to the gym|hit the gym|go train|get training|start training)\b/i,
  /\b(push (harder|through|yourself)|don'?t skip|can'?t skip)\b/i,
  /\b(no excuses|no days off)\b/i,
];

// Specific references = personalization signal
const SPECIFIC_REFERENCE_PATTERNS = [
  /\b\d+\s*(kg|lbs?|reps?|sets?|days?|weeks?|months?|sessions?|%)\b/i,
  /\b(bench|squat|deadlift|ohp|overhead press|row|pull[\s-]?up)\b/i,
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(yesterday|last (week|session|time|monday|tuesday|wednesday|thursday|friday))\b/i,
  /\b(streak|consecutive|row|in a row)\b/i,
  /\bppl\b|push.?pull.?legs|upper.?lower|full.?body|bro.?split/i,
];

// Magic moment signals: specific + contextual + surprised reaction
const MAGIC_MOMENT_RESPONSE_PATTERNS = [
  /\b\d+\s*kg\s*(×|x|\*)\s*\d+/i,  // "80kg × 5"
  /\b(last (time|session|week))[^.]*\d/i,  // "last time 80kg"
  /\b(you said|you (mentioned|told me)|remember when)\b/i,
  /\b(streak of \d|on a \d+-?day streak|\d+ (days|sessions) (in a row|straight))\b/i,
];

// Wrong intervention: user logging a win, Rex does accountability
const WIN_USER_SIGNALS = [
  /\b(pr|personal record|personal best|new max|new best)\b/i,
  /\b(crushed it|nailed it|killed it|smashed it|hit it)\b/i,
  /\b(completed|finished|done|logged)\b.{0,30}\b(session|workout|training)\b/i,
  /\b(best (session|workout|week)|felt (strong|great|amazing) (today|tonight))\b/i,
];
const ACCOUNTABILITY_PHRASES = [
  /\b(you (said|committed|promised)|you were (going to|supposed to))\b/i,
  /\b(missed|skipped|didn'?t show|no session)\b/i,
  /\b(what happened|where were you|explain)\b/i,
];

function classifyPair(userMsg, assistantMsg, memories) {
  const u = userMsg.text.toLowerCase();
  const a = assistantMsg.text.toLowerCase();
  const issues = [];

  // 1. Trust Breaker: burnout user + training push
  const hasBurnout = BURNOUT_USER_SIGNALS.some(r => r.test(u));
  const hasPush = TRUST_BREAKER_PATTERNS.some(r => r.test(a));
  if (hasBurnout && hasPush) {
    issues.push({ type: 'trust_breaker', reason: 'Pushed training on burnout signal' });
  }

  // 1b. Trust Breaker: emotion ignored — sad/defeated user, Rex ignores entirely
  const hasNegativeEmotion = /\b(sad|crying|depressed|hopeless|lost|gave up|quit)\b/i.test(u);
  const hasEmotionAck = /\b(hear (you|that)|tough|hard|rough|difficult|understand|that'?s (not |)easy)\b/i.test(a);
  if (hasNegativeEmotion && !hasEmotionAck && a.length > 20) {
    issues.push({ type: 'trust_breaker', reason: 'Ignored obvious negative emotion' });
  }

  // 2. Generic Response
  const startsGeneric = GENERIC_OPENERS.some(r => r.test(assistantMsg.text.trim()));
  const hasGenericFiller = GENERIC_FILLER.filter(f => a.includes(f)).length >= 2;
  const hasSpecific = SPECIFIC_REFERENCE_PATTERNS.some(r => r.test(a));
  const wordCount = assistantMsg.text.split(/\s+/).length;
  if ((startsGeneric || hasGenericFiller) && !hasSpecific && wordCount < 60) {
    issues.push({ type: 'generic', reason: `Generic opener/filler, no specific reference` });
  }

  // 3. Missed Personalization: memories exist, response has no specific data
  const hasMemories = memories && memories.length > 0;
  if (hasMemories && !hasSpecific && wordCount > 15) {
    issues.push({ type: 'missed_personalization', reason: `${memories.length} memories available, none referenced` });
  }

  // 4. Wrong Intervention: user logged a win, Rex uses accountability
  const isWin = WIN_USER_SIGNALS.some(r => r.test(u));
  const isAccountability = ACCOUNTABILITY_PHRASES.some(r => r.test(a));
  if (isWin && isAccountability) {
    issues.push({ type: 'wrong_intervention', reason: 'Used accountability on a win message' });
  }

  // 5. Magic Moment
  const hasMagic = MAGIC_MOMENT_RESPONSE_PATTERNS.some(r => r.test(a));
  const isShortAndSpecific = hasSpecific && wordCount <= 40;
  if (hasMagic || isShortAndSpecific) {
    issues.push({ type: 'magic_moment', reason: hasMagic ? 'Specific historical reference' : 'Short + specific' });
  }

  return issues.length === 0 ? [{ type: 'ok', reason: '' }] : issues;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  console.log("Fetching last 500 assistant messages...\n");

  // Get last 500 assistant messages with the preceding user message
  const { rows: assistantMsgs } = await client.query(`
    SELECT
      a.id, a."userId", a.text, a.intent, a.emotion, a."createdAt",
      u.text AS user_text, u.emotion AS user_emotion, u.intent AS user_intent,
      u."createdAt" AS user_created_at
    FROM "CompanionMessage" a
    LEFT JOIN LATERAL (
      SELECT text, emotion, intent, "createdAt"
      FROM "CompanionMessage"
      WHERE "userId" = a."userId"
        AND role = 'user'
        AND "createdAt" < a."createdAt"
      ORDER BY "createdAt" DESC
      LIMIT 1
    ) u ON true
    WHERE a.role = 'assistant'
      AND a.text NOT LIKE '%went wrong on my end%'
      AND a.text NOT LIKE '%Something went wrong%'
      AND LENGTH(a.text) > 15
    ORDER BY a."createdAt" DESC
    LIMIT 500
  `);

  console.log(`Retrieved ${assistantMsgs.length} message pairs.\n`);

  // Get memory counts per user (batch)
  const userIds = [...new Set(assistantMsgs.map(m => m.userId))];
  const { rows: memRows } = await client.query(`
    SELECT "userId", type, value
    FROM "MemoryFact"
    WHERE "userId" = ANY($1)
      AND "archivedAt" IS NULL
  `, [userIds]);

  const memByUser = {};
  for (const m of memRows) {
    if (!memByUser[m.userId]) memByUser[m.userId] = [];
    memByUser[m.userId].push(m);
  }

  // Also get intake answers per user for context
  const { rows: userRows } = await client.query(`
    SELECT id, "intakeAnswers", "displayName", "createdAt"
    FROM "MessengerUser"
    WHERE id = ANY($1)
  `, [userIds]);
  const userById = {};
  for (const u of userRows) userById[u.id] = u;

  await client.end();

  // ── Classify ───────────────────────────────────────────────────────────────

  const results = [];
  const counters = {
    trust_breaker: 0, generic: 0, missed_personalization: 0,
    wrong_intervention: 0, magic_moment: 0, ok: 0,
  };

  for (const row of assistantMsgs) {
    if (!row.user_text) continue; // skip if no preceding user message

    const userMsg = { text: row.user_text, emotion: row.user_emotion };
    const assistantMsg = { text: row.text };
    const memories = memByUser[row.userId] || [];

    const classifications = classifyPair(userMsg, assistantMsg, memories);
    const primaryClass = classifications[0].type;
    counters[primaryClass]++;

    results.push({
      userId: row.userId,
      userName: userById[row.userId]?.displayName ?? 'unknown',
      userMsg: row.user_text.slice(0, 120),
      rexReply: row.text.slice(0, 180),
      classifications,
      primaryClass,
      createdAt: row.createdAt,
      memCount: memories.length,
    });
  }

  const total = results.length;

  // ── Output Metrics ─────────────────────────────────────────────────────────

  console.log("══════════════════════════════════════════════════");
  console.log("REX BETA READINESS AUDIT — RESULTS");
  console.log(`Analyzed: ${total} conversation pairs`);
  console.log("══════════════════════════════════════════════════\n");

  console.log("METRICS:");
  console.log(`Trust Breaker Rate:        ${pct(counters.trust_breaker, total)}% (${counters.trust_breaker}/${total})`);
  console.log(`Generic Response Rate:     ${pct(counters.generic, total)}% (${counters.generic}/${total})`);
  console.log(`Missed Personalization:    ${pct(counters.missed_personalization, total)}% (${counters.missed_personalization}/${total})`);
  console.log(`Wrong Intervention Rate:   ${pct(counters.wrong_intervention, total)}% (${counters.wrong_intervention}/${total})`);
  console.log(`Magic Moment Rate:         ${pct(counters.magic_moment, total)}% (${counters.magic_moment}/${total})`);
  console.log(`OK Rate:                   ${pct(counters.ok, total)}% (${counters.ok}/${total})`);

  // ── Top 20 Failures ────────────────────────────────────────────────────────

  const failures = results
    .filter(r => ['trust_breaker', 'generic', 'wrong_intervention'].includes(r.primaryClass))
    .slice(0, 20);

  console.log("\n══════════════════════════════════════════════════");
  console.log(`TOP ${failures.length} FAILURES`);
  console.log("══════════════════════════════════════════════════");

  failures.forEach((f, i) => {
    console.log(`\n[${i + 1}] ${f.primaryClass.toUpperCase()} — ${f.classifications[0].reason}`);
    console.log(`User: "${f.userMsg}"`);
    console.log(`Rex:  "${f.rexReply}"`);
    console.log(`Memories available: ${f.memCount} | Date: ${new Date(f.createdAt).toISOString().slice(0,10)}`);
  });

  // ── Top 20 Best ────────────────────────────────────────────────────────────

  const best = results
    .filter(r => r.primaryClass === 'magic_moment')
    .slice(0, 20);

  console.log("\n══════════════════════════════════════════════════");
  console.log(`TOP ${best.length} BEST RESPONSES (MAGIC MOMENTS)`);
  console.log("══════════════════════════════════════════════════");

  best.forEach((b, i) => {
    console.log(`\n[${i + 1}] ${b.classifications[0].reason}`);
    console.log(`User: "${b.userMsg}"`);
    console.log(`Rex:  "${b.rexReply}"`);
    console.log(`Memories available: ${b.memCount} | Date: ${new Date(b.createdAt).toISOString().slice(0,10)}`);
  });

  // ── Missed Personalization examples ───────────────────────────────────────

  const missedPerson = results
    .filter(r => r.primaryClass === 'missed_personalization')
    .slice(0, 10);

  if (missedPerson.length > 0) {
    console.log("\n══════════════════════════════════════════════════");
    console.log("SAMPLE MISSED PERSONALIZATION (top 10)");
    console.log("══════════════════════════════════════════════════");
    missedPerson.forEach((m, i) => {
      console.log(`\n[${i + 1}] ${m.memCount} memories ignored`);
      console.log(`User: "${m.userMsg}"`);
      console.log(`Rex:  "${m.rexReply}"`);
    });
  }

  // ── Volume by day ──────────────────────────────────────────────────────────
  const byDay = {};
  for (const r of results) {
    const d = new Date(r.createdAt).toISOString().slice(0, 10);
    byDay[d] = (byDay[d] || 0) + 1;
  }
  const days = Object.entries(byDay).sort(([a], [b]) => b.localeCompare(a)).slice(0, 14);
  console.log("\n══════════════════════════════════════════════════");
  console.log("VOLUME BY DAY (last 14 days)");
  days.forEach(([d, c]) => console.log(`  ${d}: ${c} messages`));

  console.log("\n══════════════════════════════════════════════════");
  console.log("AUDIT COMPLETE");
}

function pct(n, total) {
  return total === 0 ? 0 : Math.round((n / total) * 1000) / 10;
}

main().catch(err => {
  console.error("Audit failed:", err.message);
  process.exit(1);
});
