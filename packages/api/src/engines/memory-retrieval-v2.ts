import { prisma } from "@repo/db/client";

// ── Shared input type ─────────────────────────────────────────────────────────
// Defined here so callers don't need to import from context-engine-v2.

export interface RawMemoryInput {
  id:         string;
  type:       string;
  key:        string;
  value:      string;
  confidence: number;
  createdAt:  Date;
  updatedAt:  Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type RetrievalReason =
  | "similar_struggle"
  | "similar_achievement"
  | "related_commitment"
  | "related_promise"
  | "related_breakthrough"
  | "goal_match"
  | "pattern_match";

export interface RankedMemoryV2 {
  id:             string;
  type:           string;
  key:            string;
  value:          string;
  score:          number;
  reason:         RetrievalReason;
  confidence:     number;
  ageHours:       number;
  createdAt:      Date;
  updatedAt:      Date;
}

export interface RetrievalInput {
  message:     string;
  intent:      string;
  emotion:     string;
  activeGoals: string[];
  topK?:       number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY BUCKET
// ═══════════════════════════════════════════════════════════════════════════════

type MemoryBucket =
  | "struggle"
  | "achievement"
  | "commitment"
  | "promise"
  | "breakthrough"
  | "goal"
  | "pattern"
  | "anchor"
  | "preference";

const BUCKET_BASE: Record<MemoryBucket, number> = {
  struggle:     1.00,
  achievement:  0.90,
  commitment:   0.85,
  promise:      0.82,
  breakthrough: 0.78,
  goal:         0.70,
  pattern:      0.65,
  anchor:       0.50,
  preference:   0.30,   // raised dynamically when overlap is high — see scoreFact
};

const ACHIEVEMENT_PATTERN  = /achievement|personal.?record|\bpr\b|milestone|\bwin\b|best|new record|hit.{0,10}goal/i;
const PROMISE_PATTERN      = /promise|pledg|swore?|vow\b|committed to|told myself/i;
const BREAKTHROUGH_PATTERN = /breakthrough|insight|realiz|clicked|finally|figured out/i;
const COMMITMENT_PATTERN   = /commit|going to|plan to|will\b|intend|aiming/i;

function detectBucket(type: string, key: string, value: string): MemoryBucket {
  const combined = `${type} ${key} ${value}`.toLowerCase();
  switch (type) {
    case "struggle":         return "struggle";
    case "achievement":      return "achievement";
    case "commitment":       return "commitment";
    case "promise":          return "promise";
    case "breakthrough":     return "breakthrough";
    case "goal":             return "goal";
    case "detected_pattern": return "pattern";
    case "preference":       return "preference";
    case "anchor":
    case "identity_shift":
    case "comeback":
      if (ACHIEVEMENT_PATTERN.test(combined))  return "achievement";
      if (PROMISE_PATTERN.test(combined))      return "promise";
      if (BREAKTHROUGH_PATTERN.test(combined)) return "breakthrough";
      if (COMMITMENT_PATTERN.test(combined))   return "commitment";
      return "anchor";
    default:
      return "preference";
  }
}

function bucketToReason(bucket: MemoryBucket): RetrievalReason {
  switch (bucket) {
    case "struggle":     return "similar_struggle";
    case "achievement":  return "similar_achievement";
    case "commitment":   return "related_commitment";
    case "promise":      return "related_promise";
    case "breakthrough":
    case "anchor":       return "related_breakthrough";
    case "goal":         return "goal_match";
    default:             return "pattern_match";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIGNAL → BUCKET AMPLIFICATION
// Bug 6 fix: added "avoidant" → promise + commitment + struggle
// ═══════════════════════════════════════════════════════════════════════════════

const SIGNAL_AMPLIFIERS: Record<string, MemoryBucket[]> = {
  // intents
  failure_report:         ["struggle", "commitment", "promise", "breakthrough"],
  accountability_request: ["commitment", "promise", "struggle"],
  progress_report:        ["achievement", "goal"],
  commitment_made:        ["commitment", "promise", "breakthrough"],
  goal_setting:           ["goal", "commitment"],
  deadline_set:           ["commitment", "promise"],
  emotional_vent:         ["struggle", "breakthrough"],
  weekly_review:          ["achievement", "struggle", "goal"],
  reflection:             ["breakthrough", "struggle", "achievement"],
  plan_request:           ["goal", "commitment", "preference"],
  status_update:          ["struggle", "commitment"],
  // emotions
  frustrated:             ["struggle", "commitment", "promise"],
  anxious:                ["struggle", "commitment"],
  motivated:              ["achievement", "goal", "commitment"],
  tired:                  ["struggle", "breakthrough"],
  proud:                  ["achievement", "breakthrough"],
  discouraged:            ["struggle", "breakthrough"],
  avoidant:               ["struggle", "promise", "commitment"],
  determined:             ["commitment", "goal", "achievement"],
  // inline keywords
  struggle:               ["struggle"],
  skipped:                ["struggle", "commitment"],
  missed:                 ["struggle", "commitment"],
  achieved:               ["achievement"],
  breakthrough:           ["breakthrough"],
  committed:              ["commitment", "promise"],
  // "promise" / "promised" as direct message words → stronger boost (see computeSignalBoost)
  promise:                ["promise", "commitment"],
  promised:               ["promise", "commitment"],
  excuse:                 ["promise", "commitment", "struggle"],
  quit:                   ["struggle", "breakthrough"],
  burnout:                ["struggle", "breakthrough"],
};

// Signals that directly name a memory type get a stronger boost when the
// bucket matches (e.g. "promise" in message → promise memories boosted to 0.55).
const STRONG_SIGNAL_KEYS = new Set(["promise","promised","swear","pledge","vow"]);

function computeSignalBoost(signals: Set<string>, bucket: MemoryBucket): number {
  let boost = 0;
  for (const sig of signals) {
    const buckets = SIGNAL_AMPLIFIERS[sig];
    if (!buckets?.includes(bucket)) continue;
    const isStrong = STRONG_SIGNAL_KEYS.has(sig) && (bucket === "promise" || bucket === "commitment");
    boost = Math.max(boost, isStrong ? 0.55 : 0.40);
  }
  return boost;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NORMALISATION
// Bug 3 fix: replace the aggressive suffix-stripper with a two-phase approach:
//   1. Irregular form dictionary for common word families that the stemmer
//      was mangling (quitting→quit, dropped→drop, morning/mornings→morning, etc.)
//   2. Conservative suffix rules that only strip endings when the result is ≥ 4
//      characters, preventing fragments like "morn", "dropp", "promis".
// ═══════════════════════════════════════════════════════════════════════════════

// Maps inflected/variant forms → canonical root.
// Only entries where the automatic suffix rules would produce wrong results.
const IRREGULAR_FORMS: Record<string, string> = {
  // -ing forms where slicing -3 leaves a fragment or wrong root
  quitting:    "quit",
  skipping:    "skip",
  dropping:    "drop",
  stopping:    "stop",
  running:     "run",
  hitting:     "hit",
  getting:     "get",
  sitting:     "sit",
  setting:     "set",
  putting:     "put",
  cutting:     "cut",
  winning:     "win",
  swimming:    "swim",
  beginning:   "begin",
  committing:  "commit",
  // Time-of-day words end in -ing but must stay intact
  morning:     "morning",
  mornings:    "morning",
  evening:     "evening",
  evenings:    "evening",
  // -ed forms where slicing -2 produces a fragment
  dropped:     "drop",
  stopped:     "stop",
  skipped:     "skip",
  committed:   "commit",
  admitted:    "admit",
  submitted:   "submit",
  permitted:   "permit",
  // Short plurals where the -s rule requires len > 4 (and len == 4 fails)
  legs:        "leg",
  days:        "day",
  sets:        "set",
  reps:        "rep",
  runs:        "run",
  gets:        "get",
  // -es where slice(-2) gives a fragment instead of the base form
  excuses:     "excuse",
  loses:       "lose",
  // Promise/session family
  promised:    "promise",
  promises:    "promise",
  sessions:    "session",
  // Travel family
  travelling:  "travel",
  traveled:    "travel",
  travelled:   "travel",
};

function normalize(token: string): string {
  // 1. Check irregular dictionary first
  if (IRREGULAR_FORMS[token]) return IRREGULAR_FORMS[token]!;

  // 2. Conservative suffix rules — only strip if result stays ≥ 4 chars
  const len = token.length;
  if (len > 6 && token.endsWith("ing"))  { const r = token.slice(0, -3); if (r.length >= 4) return r; }
  if (len > 5 && token.endsWith("tion")) { const r = token.slice(0, -4) + "t"; if (r.length >= 4) return r; }
  if (len > 5 && token.endsWith("ed"))   { const r = token.slice(0, -2); if (r.length >= 4) return r; }
  if (len > 5 && token.endsWith("ies"))  { const r = token.slice(0, -3) + "y"; if (r.length >= 4) return r; }
  if (len > 4 && token.endsWith("es"))   { const r = token.slice(0, -2); if (r.length >= 4) return r; }
  if (len > 5 && token.endsWith("er"))   { const r = token.slice(0, -2); if (r.length >= 4) return r; }
  if (len > 5 && token.endsWith("ly"))   { const r = token.slice(0, -2); if (r.length >= 4) return r; }
  if (len > 4 && token.endsWith("s"))    { const r = token.slice(0, -1);  if (r.length >= 4) return r; }
  return token;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STOP WORDS
// ═══════════════════════════════════════════════════════════════════════════════

const STOP_WORDS = new Set([
  "i","me","my","we","our","you","your","he","she","they","it",
  "a","an","the","and","or","but","if","in","on","at","to","for",
  "of","with","by","from","is","are","was","were","be","been","have",
  "has","had","do","does","did","will","would","could","should","not",
  "no","so","as","this","that","which","what","how","when","where",
  "who","there","here","up","down","out","about","just","like",
  "got","can","all","its","also","than","then","them","their","some",
  "each","yes","yeah","okay","ok","now","still","again","way","even",
  "always",   // "always" → "alway" via -s rule; semantically content-free for retrieval
]);

// ═══════════════════════════════════════════════════════════════════════════════
// SYNONYM CLUSTERS
// Bug 5 fix: added burnout/crash, momentum/steam, identity/person,
//            quit/give-up, excuse/avoidance, travel/trip clusters.
// ═══════════════════════════════════════════════════════════════════════════════

const SYNONYM_CLUSTERS: Array<Set<string>> = [
  // Avoidance / skipping — includes "excuse" so "missing sessions" links to "work excuses"
  new Set(["skip","skipped","miss","missed","avoid","avoided","blown","blew","bail","bailed","forget","forgot","excuse"]),
  // Failure / quitting — includes "crash"/"losing" for burnout/momentum-loss queries
  // "drop" intentionally excluded (matches "protein drops" falsely)
  new Set(["fail","failed","give","gave","quit","quitting","walk","walked","abandon","stopped","crash","crashing","losing"]),
  // Struggle / difficulty
  new Set(["struggle","hard","difficult","tough","pain","challenging","impossible"]),
  // Burnout / crash  ← Bug 5
  new Set(["burnout","burned","burn","crash","crash","overtrain","overtrained","exhausted","drained","worn","fatigue","tire","tired"]),
  // Achievement / hitting targets
  new Set(["achieve","hit","crush","nail","finish","complete","smash","reach","accomplish"]),
  // PRs / records  ← kept separate so "28" number still matches "days" context
  new Set(["record","best","milestone","pr","high"]),
  // Commitment / intent
  new Set(["commit","promise","will","plan","intend","aim","swear","pledge","vow"]),
  // Breakthrough / insight  ← Bug 5
  new Set(["breakthrough","insight","realiz","realize","click","clicked","figure","figured","understand"]),
  // Training — "split" included so "training split" queries link to split preferences
  new Set(["train","workout","session","gym","lift","exercise","lifting","split"]),
  // Progress / momentum — "advance" removed: "in advance" (beforehand) ≠ advancing
  new Set(["progress","improve","grow","better","momentum","steam","traction","rhythm","moving","building","losing"]),
  // Consistency
  new Set(["consistent","consistency","discipline","habit","routine","show","showed"]),
  // Identity / self-image  ← Bug 5
  new Set(["identity","person","self","kind","type","someone","who","image","believe","belief"]),
  // Quit / giving up  ← Bug 5
  new Set(["quit","quitting","done","stop","stopping","leave","leaving","give","walk","away","anymore"]),
  // Excuses / avoidance  ← Bug 5
  new Set(["excuse","reason","avoid","avoiding","procrastinat","delay","put"]),
  // Travel / away  ← Bug 5
  new Set(["travel","trip","vacation","away","travelling","traveling","visiting","visit"]),
];

// Reverse index: token → cluster index
const TOKEN_TO_CLUSTER = new Map<string, number>();
for (let i = 0; i < SYNONYM_CLUSTERS.length; i++) {
  for (const term of SYNONYM_CLUSTERS[i]!) {
    // Multi-word cluster entries: index every word
    for (const word of term.split(/\s+/)) {
      if (!TOKEN_TO_CLUSTER.has(word)) TOKEN_TO_CLUSTER.set(word, i);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOKENISE
// Bug 4 fix: numeric tokens are preserved regardless of length.
// A token passes if it is a pure number OR has length > 2.
// ═══════════════════════════════════════════════════════════════════════════════

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => {
      if (t.length === 0) return false;
      // Bug 4: keep numeric tokens (28, 45, 100, etc.) regardless of length
      if (/^\d+$/.test(t)) return true;
      // Keep alphanumeric tokens like "100kg", "5kg", "140kg"
      if (/^\d+[a-z]+$/.test(t) || /^[a-z]+\d+$/.test(t)) return true;
      return t.length > 2 && !STOP_WORDS.has(t);
    })
    .map(normalize);
}

function clusterOf(token: string): number {
  return TOKEN_TO_CLUSTER.get(token) ?? -1;
}

// Dice coefficient — two tokens match if equal OR in the same synonym cluster.
function semanticDice(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;

  const bClusters = new Map<number, number>();
  const bExact    = new Map<string, number>();
  for (const t of bTokens) {
    const c = clusterOf(t);
    if (c >= 0) bClusters.set(c, (bClusters.get(c) ?? 0) + 1);
    bExact.set(t, (bExact.get(t) ?? 0) + 1);
  }

  let matches = 0;
  const used = new Map<string, number>();
  for (const t of aTokens) {
    const c = clusterOf(t);
    if ((bExact.get(t) ?? 0) > (used.get(t) ?? 0)) {
      matches++;
      used.set(t, (used.get(t) ?? 0) + 1);
    } else if (c >= 0 && (bClusters.get(c) ?? 0) > 0) {
      matches++;
      bClusters.set(c, bClusters.get(c)! - 1);
    }
  }

  return (2 * matches) / (aTokens.length + bTokens.length);
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECENCY CURVE
// Bug 8 fix: scoreFact passes the queryOverlap to allow high-overlap facts
// to receive a recency floor of 0.85 regardless of age.
// ═══════════════════════════════════════════════════════════════════════════════

function recencyCurve(updatedAt: Date, now: Date, queryOverlap = 0): number {
  const hours = (now.getTime() - updatedAt.getTime()) / 3_600_000;
  let base: number;
  if (hours < 24)   base = 1.00;
  else if (hours < 168)  base = 0.95;
  else if (hours < 720)  base = 0.88;
  else if (hours < 2160) base = 0.78;
  else if (hours < 4320) base = 0.68;
  else                   base = 0.58;

  // Bug 8: high semantic overlap rescues old-but-exact-match memories
  if (queryOverlap >= 0.65) return Math.max(base, 0.85);
  return base;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXCLUDED TYPES
// ═══════════════════════════════════════════════════════════════════════════════

const EXCLUDED_TYPES = new Set([
  "onboarding_v2",
  "mentor_state",
  "intake_finalized",
  "commitment_record",
  "gym_signal",
]);

// ═══════════════════════════════════════════════════════════════════════════════
// SCORE A SINGLE FACT
// Bug 1 fix: queryTokens contain message-only tokens.
//            goalTokens remain a separate independent signal.
// Bug 2 fix: preference base is promoted to 0.90 when semanticDice >= 0.55,
//            allowing injury/protein/split preferences to outrank irrelevant goals.
// Bug 7 fix: facts with zero semantic+signal relevance are excluded (no 0.04 floor
//            that allowed noise into top results).
// ═══════════════════════════════════════════════════════════════════════════════

function scoreFact(
  fact:        RawMemoryInput,
  queryTokens: string[],   // Bug 1: message tokens ONLY
  goalTokens:  string[],
  signals:     Set<string>,
  now:         Date,
): { score: number; reason: RetrievalReason } | null {
  if (EXCLUDED_TYPES.has(fact.type)) return null;

  const bucket      = detectBucket(fact.type, fact.key, fact.value);
  const factTokens  = tokenize(fact.value + " " + fact.key);

  // Semantic overlap: message vs fact (Bug 1: goals not in queryTokens)
  const queryOverlap = semanticDice(queryTokens, factTokens);

  // Goal relevance: independent signal, unchanged
  const goalOverlap  = goalTokens.length > 0 ? semanticDice(goalTokens, factTokens) : 0;

  // Signal amplification
  const signalBoost  = computeSignalBoost(signals, bucket);

  // Bug 2: dynamic preference promotion.
  // Preferences with semantic overlap are promoted so exact-match preferences
  // (injury notes, protein target, split) can outrank irrelevant goals.
  let basePriority = BUCKET_BASE[bucket];
  if (bucket === "preference") {
    if      (queryOverlap >= 0.55) basePriority = 0.92;  // exact/near-exact
    else if (queryOverlap >= 0.30) basePriority = 0.65;  // partial match
    else if (queryOverlap >  0)    basePriority = 0.50;  // any overlap: compete with goals
  }

  // Confidence weight
  const confWeight = 0.70 + Math.min(fact.confidence, 1) * 0.30;

  // Bug 7: signal dampening.
  // When queryOverlap = 0, signalBoost alone fires for ALL facts of that bucket
  // (e.g. emotional_vent boosts every struggle, including unrelated travel/nutrition).
  // Dampen to 25% when there is no message-level semantic link, so signal-only
  // facts hover near the floor instead of polluting the top results.
  const effectiveSignal = queryOverlap > 0 ? signalBoost : signalBoost * 0.25;

  // Composite relevance with a 0.03 floor so high-priority buckets appear as
  // fallback when a greeting or zero-signal message arrives.
  const relevance = Math.max(
    queryOverlap * 0.50 + effectiveSignal * 0.30 + goalOverlap * 0.20,
    0.03,
  );

  // Bug 8: high-overlap memories get a recency floor
  const recency = recencyCurve(fact.updatedAt, now, queryOverlap);

  const score = basePriority * relevance * confWeight * recency;

  return { score, reason: bucketToReason(bucket) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC — scoreAndRankFacts
// Bug 1 fix: queryTokens = message only (not [message, ...activeGoals])
// ═══════════════════════════════════════════════════════════════════════════════

export function scoreAndRankFacts(
  facts:  RawMemoryInput[],
  input:  RetrievalInput,
  now:    Date = new Date(),
): RankedMemoryV2[] {
  const { message, intent, emotion, activeGoals, topK = 8 } = input;

  // Bug 1: message tokens are strictly message-only
  const queryTokens = tokenize(message);
  const goalTokens  = tokenize(activeGoals.join(" "));

  const signals = new Set<string>();
  if (intent)  signals.add(intent.toLowerCase().trim());
  if (emotion) signals.add(emotion.toLowerCase().trim());
  const msgLower = message.toLowerCase();
  for (const sig of Object.keys(SIGNAL_AMPLIFIERS)) {
    if (msgLower.includes(sig)) signals.add(sig);
  }

  const results: RankedMemoryV2[] = [];

  for (const fact of facts) {
    const result = scoreFact(fact, queryTokens, goalTokens, signals, now);
    if (result === null) continue;

    const ageHours = Math.floor((now.getTime() - fact.createdAt.getTime()) / 3_600_000);
    results.push({
      id:         fact.id,
      type:       fact.type,
      key:        fact.key,
      value:      fact.value,
      score:      result.score,
      reason:     result.reason,
      confidence: fact.confidence,
      ageHours,
      createdAt:  fact.createdAt,
      updatedAt:  fact.updatedAt,
    });
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC — retrieveMemoriesV2
// ═══════════════════════════════════════════════════════════════════════════════

export async function retrieveMemoriesV2(
  platformChatId: string,
  input:          RetrievalInput,
  now:            Date = new Date(),
): Promise<RankedMemoryV2[]> {
  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { id: true },
  });
  if (!user) return [];

  const rawFacts = await prisma.memoryFact.findMany({
    where:   { userId: user.id, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    take:    200,
    select:  { id: true, type: true, key: true, value: true, confidence: true, createdAt: true, updatedAt: true },
  });

  return scoreAndRankFacts(rawFacts, input, now);
}
