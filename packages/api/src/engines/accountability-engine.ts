import { prisma } from "@repo/db/client";
import type { ConversationAnalysis, Domain } from "../types/mentor.types";
import type { MentorState } from "./user-state-engine";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type CommitmentType     = "daily" | "weekly" | "weekdays" | "every_n_days" | "one_shot";
export type CommitmentPeriod   = "day" | "week";
export type CommitmentStatus   = "active" | "paused" | "completed" | "abandoned";
export type CommitmentOutcome  = "kept" | "missed" | "excused" | "partial";
export type ExcuseCategory     = "time" | "energy" | "external" | "avoidance" | "forgot" | "other";
export type ReportType         = "weekly_review" | "missed_review" | "streak_report" | "accountability_response";

export type ConfidenceLabel =
  | "critical"   // 0-20
  | "low"        // 21-40
  | "moderate"   // 41-60
  | "building"   // 61-75
  | "high"       // 76-88
  | "exceptional"; // 89-100

export type Trajectory = "improving" | "stable" | "declining";

export interface Commitment {
  id:                  string;
  description:         string;
  type:                CommitmentType;
  frequencyPerPeriod:  number;
  period:              CommitmentPeriod;
  domain:              Domain;
  hoursPerSession:     number | null;
  goalId:              string | null;
  startedAt:           Date;
  expiresAt:           Date | null;
  status:              CommitmentStatus;
  sourceMessageText:   string;
  createdAt:           Date;
}

export interface CommitmentRecord {
  id:              string;
  commitmentId:    string;
  date:            Date;
  outcome:         CommitmentOutcome;
  excuse:          string | null;
  excuseCategory:  ExcuseCategory | null;
  evidenceText:    string | null;
  recordedAt:      Date;
}

export interface DayOutcome {
  date:        Date;
  dayName:     string;
  outcome:     CommitmentOutcome | "no_record";
  isExpected:  boolean;
}

export interface StreakData {
  commitmentId:        string;
  currentStreak:       number;
  longestStreak:       number;
  averageStreakLength:  number;
  streakBrokenAt:      Date | null;
  streakBreaks:        number;
  totalDaysTracked:    number;
}

export interface CompletionRates {
  rate7d:    number;  // 0-1
  rate30d:   number;  // 0-1
  rateAllTime: number;
  kept7d:    number;
  expected7d: number;
  kept30d:   number;
  expected30d: number;
  totalKept:  number;
  totalMissed: number;
}

export interface ConfidenceBreakdown {
  completionRate:    { score: number; weight: number; rawValue: number  };
  trendDirection:    { score: number; weight: number; rawValue: string  };
  consecutiveMisses: { score: number; weight: number; rawValue: number  };
  streakBonus:       { score: number; weight: number; rawValue: number  };
}

export interface CommitmentConfidenceScore {
  score:          number;
  label:          ConfidenceLabel;
  breakdown:      ConfidenceBreakdown;
  trajectory:     Trajectory;
  interpretation: string;
  predictedRate7d: number;
}

export interface CommitmentWeeklySummary {
  commitmentId:  string;
  description:   string;
  domain:        Domain;
  expected:      number;
  actual:        number;
  missed:        number;
  completionPct: number;
  missedDays:    string[];
  topExcuse:     string | null;
  streak:        StreakData;
  status:        "on_track" | "slipping" | "missed" | "not_started";
}

export interface WeeklyReview {
  weekStart:          Date;
  weekEnd:            Date;
  summaries:          CommitmentWeeklySummary[];
  totalExpected:      number;
  totalCompleted:     number;
  totalMissed:        number;
  overallRate:        number;
  strongestDay:       string | null;
  weakestDay:         string | null;
  topExcuseCategory:  string | null;
  confidenceScore:    CommitmentConfidenceScore;
  nextWeekTarget:     number;
  reviewText:         string;
}

export interface MissedCommitmentReview {
  commitment:       Commitment;
  period:           { from: Date; to: Date };
  expected:         number;
  actual:           number;
  missedCount:      number;
  completionPct:    number;
  missedDays:       string[];
  excuseCategories: Array<{ category: string; count: number }>;
  pattern:          string | null;
  severity:         "minor" | "moderate" | "major" | "critical";
  reviewText:       string;
  accountabilityText: string;
}

export interface StreakReport {
  streaks:          StreakData[];
  bestCommitment:   string | null;
  totalActiveStreak: number;
  longestEver:      number;
  averageBeforeBreak: number;
  reportText:       string;
}

export interface AccountabilityState {
  commitments:      Commitment[];
  recentRecords:    CommitmentRecord[];
  streaks:          StreakData[];
  rates:            CompletionRates;
  confidenceScore:  CommitmentConfidenceScore;
  lastUpdatedAt:    Date;
}

export interface AccountabilityUpdateResult {
  commitmentCreated:  Commitment | null;
  recordSaved:        CommitmentRecord | null;
  updatedState:       AccountabilityState;
}

export interface AccountabilityReport {
  type:         ReportType;
  generatedAt:  Date;
  weeklyReview?:       WeeklyReview;
  missedReview?:       MissedCommitmentReview;
  streakReport?:       StreakReport;
  accountabilityText?: string;
  state:        AccountabilityState;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIDENCE_THRESHOLDS: Array<[min: number, label: ConfidenceLabel]> = [
  [89, "exceptional"],
  [76, "high"],
  [61, "building"],
  [41, "moderate"],
  [21, "low"],
  [0,  "critical"],
];

const CONFIDENCE_WEIGHTS = {
  completionRate:    0.40,
  trendDirection:    0.30,
  consecutiveMisses: 0.20,
  streakBonus:       0.10,
} as const;

const EXCUSE_CATEGORY_PATTERNS: Array<{ category: ExcuseCategory; pattern: RegExp }> = [
  { category: "time",      pattern: /\b(busy|no time|time crunch|work|meeting|packed|hectic|couldn'?t find time)\b/i },
  { category: "energy",    pattern: /\b(tired|exhausted|drained|no energy|low energy|burnt? out|sick|unwell)\b/i },
  { category: "avoidance", pattern: /\b(didn'?t feel like|couldn'?t be bothered|procrastinat|avoided|kept putting off)\b/i },
  { category: "forgot",    pattern: /\b(forgot|slipped my mind|lost track|completely forgot)\b/i },
  { category: "external",  pattern: /\b(family|emergency|unexpected|came up|power|internet|travel)\b/i },
];

const COMMITMENT_FREQ_PATTERNS: Array<{ pattern: RegExp; frequencyPerPeriod: number; period: CommitmentPeriod }> = [
  { pattern: /\b(\d+)\s*(?:times?|questions?|problems?|tasks?|sessions?|chapters?|pages?|reps?)\s*(?:per|a|each|every)\s*day\b/i,   frequencyPerPeriod: -1, period: "day"  },
  { pattern: /\b(\d+)\s*(?:times?|questions?|problems?|tasks?|sessions?|chapters?|pages?)\s*(?:per|a|each)\s*week\b/i,             frequencyPerPeriod: -1, period: "week" },
  { pattern: /\b(every|each)\s*day\b|daily\b/i,                                                                                    frequencyPerPeriod: 1,  period: "day"  },
  { pattern: /\b(\d+)\s*(?:days?)\s*(?:per|a|each)\s*week\b/i,                                                                    frequencyPerPeriod: -1, period: "week" },
  { pattern: /\b(?:once|one time)\s*(?:per|a|each)\s*day\b/i,                                                                     frequencyPerPeriod: 1,  period: "day"  },
  { pattern: /\b(?:twice|two times?)\s*(?:per|a|each)\s*day\b/i,                                                                  frequencyPerPeriod: 2,  period: "day"  },
  { pattern: /\b(?:three times?)\s*(?:per|a|each)\s*(day|week)\b/i,                                                               frequencyPerPeriod: 3,  period: "day"  },
];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function dayStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((dayStart(b).getTime() - dayStart(a).getTime()) / 86_400_000);
}

function dateToISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getDayName(date: Date): string {
  return DAY_NAMES[date.getDay()] ?? "Unknown";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function weekStart(date: Date): Date {
  const d = dayStart(date);
  d.setDate(d.getDate() - d.getDay()); // back to Sunday
  return d;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMITMENT PARSER
// ═══════════════════════════════════════════════════════════════════════════════

function parseExcuseCategory(text: string): ExcuseCategory {
  for (const { category, pattern } of EXCUSE_CATEGORY_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return "other";
}

function parseCommitmentFrequency(text: string): { frequencyPerPeriod: number; period: CommitmentPeriod } | null {
  for (const rule of COMMITMENT_FREQ_PATTERNS) {
    const match = text.match(rule.pattern);
    if (!match) continue;

    const freq = rule.frequencyPerPeriod === -1
      ? parseInt(match[1] ?? "1")
      : rule.frequencyPerPeriod;

    return { frequencyPerPeriod: freq, period: rule.period };
  }
  return null;
}

function inferCommitmentType(freq: number, period: CommitmentPeriod): CommitmentType {
  if (period === "day" && freq === 1)  return "daily";
  if (period === "week")               return "weekly";
  if (period === "day" && freq > 1)    return "daily";
  return "one_shot";
}

export function parseCommitmentFromAnalysis(
  analysis: ConversationAnalysis,
  now: Date
): Omit<Commitment, "id" | "createdAt"> | null {
  if (!analysis.hasCommitment && analysis.intent !== "commitment_made" && analysis.intent !== "goal_set") {
    return null;
  }

  const text = analysis.normalizedText;
  const freqResult = parseCommitmentFrequency(text);

  if (!freqResult) {
    if (analysis.intent !== "commitment_made") return null;
    // One-shot commitment
    return {
      description:        analysis.goal?.normalized ?? text.slice(0, 80),
      type:               "one_shot",
      frequencyPerPeriod: 1,
      period:             "day",
      domain:             analysis.domain,
      hoursPerSession:    analysis.entities.duration ? analysis.entities.duration.minutes / 60 : null,
      goalId:             null,
      startedAt:          now,
      expiresAt:          analysis.entities.deadline?.dueAt ?? null,
      status:             "active",
      sourceMessageText:  analysis.rawText.slice(0, 200),
    };
  }

  return {
    description:        analysis.goal?.normalized ?? text.slice(0, 80),
    type:               inferCommitmentType(freqResult.frequencyPerPeriod, freqResult.period),
    frequencyPerPeriod: freqResult.frequencyPerPeriod,
    period:             freqResult.period,
    domain:             analysis.domain,
    hoursPerSession:    analysis.entities.duration ? analysis.entities.duration.minutes / 60 : null,
    goalId:             null,
    startedAt:          now,
    expiresAt:          null,
    status:             "active",
    sourceMessageText:  analysis.rawText.slice(0, 200),
  };
}

function matchMessageToCommitment(
  analysis: ConversationAnalysis,
  commitments: Commitment[]
): Commitment | null {
  const active = commitments.filter((c) => c.status === "active");
  if (active.length === 0) return null;
  if (active.length === 1) return active[0]!;

  // Match by domain first
  const domainMatch = active.find((c) => c.domain === analysis.domain);
  if (domainMatch) return domainMatch;

  // Match by keyword overlap
  const words = analysis.normalizedText.split(/\s+/).filter((w) => w.length >= 4);
  const scored = active.map((c) => {
    const descWords = c.description.toLowerCase().split(/\s+/);
    const overlap = words.filter((w) => descWords.includes(w)).length;
    return { commitment: c, overlap };
  });

  const best = scored.sort((a, b) => b.overlap - a.overlap)[0];
  return best && best.overlap > 0 ? best.commitment : active[active.length - 1]!;
}

function detectOutcomeFromAnalysis(
  analysis: ConversationAnalysis,
  commitment: Commitment
): CommitmentOutcome {
  if (analysis.hasFailureReport) {
    return analysis.hasExcuse ? "excused" : "missed";
  }

  if (analysis.intent === "status_update" || analysis.intent === "progress_report") {
    // Check if partial
    const partial = /\b(half|partial|some|bit of|little|few|started|1 of|2 of|3 of)\b/i.test(analysis.rawText);
    return partial ? "partial" : "kept";
  }

  if (analysis.intent === "check_in_response") {
    const negative = /\b(no|nope|didn'?t|not yet|haven'?t|nah)\b/i.test(analysis.normalizedText);
    return negative ? "missed" : "kept";
  }

  return "kept";
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPECTED COUNT COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════════

function computeExpectedCount(
  commitment: Commitment,
  fromDate: Date,
  toDate: Date
): number {
  if (commitment.type === "one_shot") return 1;

  const days = Math.max(0, daysBetween(fromDate, toDate));

  if (commitment.period === "day") {
    if (commitment.type === "weekdays") {
      // Count weekdays only
      let weekdays = 0;
      const d = new Date(fromDate);
      while (daysBetween(d, toDate) > 0) {
        if (d.getDay() >= 1 && d.getDay() <= 5) weekdays++;
        d.setDate(d.getDate() + 1);
      }
      return weekdays * commitment.frequencyPerPeriod;
    }
    return days * commitment.frequencyPerPeriod;
  }

  // Weekly
  const weeks = Math.floor(days / 7);
  const remainder = days % 7;
  // Pro-rate the partial week
  const partialWeekExpected = Math.floor((remainder / 7) * commitment.frequencyPerPeriod);
  return weeks * commitment.frequencyPerPeriod + partialWeekExpected;
}

function computeActualCount(records: CommitmentRecord[], commitmentId: string): number {
  return records
    .filter((r) => r.commitmentId === commitmentId)
    .reduce((sum, r) => {
      if (r.outcome === "kept")    return sum + 1;
      if (r.outcome === "partial") return sum + 0.5;
      return sum;
    }, 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STREAK COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════════

function buildDailyGrid(
  commitment: Commitment,
  records: CommitmentRecord[],
  fromDate: Date,
  toDate: Date
): DayOutcome[] {
  const grid: DayOutcome[] = [];
  const recordMap = new Map<string, CommitmentRecord>();

  for (const r of records) {
    if (r.commitmentId === commitment.id) {
      recordMap.set(dateToISO(r.date), r);
    }
  }

  const cur = new Date(fromDate);
  while (daysBetween(cur, toDate) >= 0) {
    const key = dateToISO(cur);
    const record = recordMap.get(key);
    const isWeekday = cur.getDay() >= 1 && cur.getDay() <= 5;
    const isExpected =
      commitment.type === "one_shot"    ? false :
      commitment.type === "weekdays"    ? isWeekday :
      commitment.type === "every_n_days"? false : // simplified
      true;

    grid.push({
      date:       new Date(cur),
      dayName:    getDayName(cur),
      outcome:    record ? record.outcome : "no_record",
      isExpected,
    });

    cur.setDate(cur.getDate() + 1);
  }

  return grid;
}

function computeStreaks(
  commitment: Commitment,
  records: CommitmentRecord[],
  now: Date
): StreakData {
  const fromDate = new Date(commitment.startedAt);
  const grid = buildDailyGrid(commitment, records, fromDate, now);

  let currentStreak  = 0;
  let longestStreak  = 0;
  let tempStreak     = 0;
  let streakBreaks   = 0;
  let streakBrokenAt: Date | null = null;
  const streakLengths: number[] = [];

  for (const day of grid) {
    if (!day.isExpected) continue;

    const success = day.outcome === "kept" || day.outcome === "partial";
    if (success) {
      tempStreak++;
      longestStreak = Math.max(longestStreak, tempStreak);
    } else if (day.outcome === "missed") {
      if (tempStreak > 0) {
        streakLengths.push(tempStreak);
        streakBreaks++;
        streakBrokenAt = day.date;
      }
      tempStreak = 0;
    }
  }

  if (tempStreak > 0) streakLengths.push(tempStreak);
  currentStreak = tempStreak;

  const averageStreakLength = streakLengths.length > 0
    ? round1(streakLengths.reduce((s, n) => s + n, 0) / streakLengths.length)
    : 0;

  return {
    commitmentId:        commitment.id,
    currentStreak,
    longestStreak,
    averageStreakLength,
    streakBrokenAt:     currentStreak === 0 ? streakBrokenAt : null,
    streakBreaks,
    totalDaysTracked:   grid.filter((d) => d.isExpected).length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLETION RATES
// ═══════════════════════════════════════════════════════════════════════════════

function computeCompletionRates(
  commitments: Commitment[],
  records: CommitmentRecord[],
  now: Date
): CompletionRates {
  const cutoff7d  = new Date(now.getTime() - 7  * 86_400_000);
  const cutoff30d = new Date(now.getTime() - 30 * 86_400_000);

  const active = commitments.filter((c) => c.status === "active");

  let expected7d  = 0, kept7d  = 0;
  let expected30d = 0, kept30d = 0;
  let totalKept = 0, totalMissed = 0;

  for (const commitment of active) {
    const start = new Date(Math.max(commitment.startedAt.getTime(), cutoff7d.getTime()));
    expected7d += computeExpectedCount(commitment, start, now);
  }
  for (const commitment of active) {
    const start = new Date(Math.max(commitment.startedAt.getTime(), cutoff30d.getTime()));
    expected30d += computeExpectedCount(commitment, start, now);
  }

  for (const r of records) {
    const isKept = r.outcome === "kept" || r.outcome === "partial";
    const isMissed = r.outcome === "missed";

    if (isKept || isMissed) {
      if (isKept) { totalKept++;  if (r.date >= cutoff7d) kept7d++;  if (r.date >= cutoff30d) kept30d++;  }
      if (isMissed) totalMissed++;
    }
  }

  return {
    rate7d:      expected7d  > 0 ? clamp(kept7d  / expected7d,  0, 1) : 0,
    rate30d:     expected30d > 0 ? clamp(kept30d / expected30d, 0, 1) : 0,
    rateAllTime: (totalKept + totalMissed) > 0 ? clamp(totalKept / (totalKept + totalMissed), 0, 1) : 0,
    kept7d,
    expected7d,
    kept30d,
    expected30d,
    totalKept,
    totalMissed,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIDENCE SCORE
// ═══════════════════════════════════════════════════════════════════════════════

function computeConfidenceScore(
  rates: CompletionRates,
  state: MentorState,
  streaks: StreakData[]
): CommitmentConfidenceScore {
  const longestStreak = Math.max(0, ...streaks.map((s) => s.currentStreak));

  // Component 1: 30-day completion rate (0-100)
  const completionRateScore = clamp(rates.rate30d * 100, 0, 100);

  // Component 2: trend direction — is 7d rate improving vs 30d baseline? (0-100)
  const trend = rates.rate7d - rates.rate30d;
  let trendScore: number;
  let trendLabel: string;
  if      (trend >=  0.20) { trendScore = 100; trendLabel = "strongly improving"; }
  else if (trend >=  0.10) { trendScore = 80;  trendLabel = "improving"; }
  else if (trend >=  0.00) { trendScore = 60;  trendLabel = "stable"; }
  else if (trend >= -0.10) { trendScore = 40;  trendLabel = "slightly declining"; }
  else if (trend >= -0.20) { trendScore = 20;  trendLabel = "declining"; }
  else                     { trendScore = 5;   trendLabel = "sharply declining"; }

  // Component 3: consecutive misses penalty (0-100)
  const missesScore = clamp((1 - (Math.min(state.consecutiveMisses, 6) / 6)) * 100, 0, 100);

  // Component 4: current streak bonus (0-100)
  const streakBonus = clamp((longestStreak / 30) * 100, 0, 100);

  const rawScore =
    completionRateScore * CONFIDENCE_WEIGHTS.completionRate    +
    trendScore          * CONFIDENCE_WEIGHTS.trendDirection    +
    missesScore         * CONFIDENCE_WEIGHTS.consecutiveMisses +
    streakBonus         * CONFIDENCE_WEIGHTS.streakBonus;

  const score = Math.round(clamp(rawScore, 0, 100));

  const label: ConfidenceLabel =
    CONFIDENCE_THRESHOLDS.find(([min]) => score >= min)?.[1] ?? "critical";

  const trajectory: Trajectory =
    trend >= 0.10 ? "improving" : trend <= -0.10 ? "declining" : "stable";

  const INTERPRETATION: Record<ConfidenceLabel, string> = {
    exceptional: "Exceptional follow-through. History supports ambitious commitments.",
    high:        "Strong track record. Plans set here tend to get executed.",
    building:    "Consistency is improving. Foundation is forming.",
    moderate:    "Inconsistent follow-through. Plans often slip in week 2.",
    low:         "Low completion rate. Commitments are not being kept reliably.",
    critical:    "Pattern of missed commitments. Current commitments are unlikely to hold.",
  };

  // Simple next-period prediction: weighted avg of 7d and 30d with trend bias
  const predictedRate7d = clamp(rates.rate7d + (trend * 0.5), 0, 1);

  return {
    score,
    label,
    breakdown: {
      completionRate:    { score: Math.round(completionRateScore), weight: CONFIDENCE_WEIGHTS.completionRate,    rawValue: round1(rates.rate30d * 100) },
      trendDirection:    { score: Math.round(trendScore),          weight: CONFIDENCE_WEIGHTS.trendDirection,    rawValue: trendLabel },
      consecutiveMisses: { score: Math.round(missesScore),         weight: CONFIDENCE_WEIGHTS.consecutiveMisses, rawValue: state.consecutiveMisses },
      streakBonus:       { score: Math.round(streakBonus),         weight: CONFIDENCE_WEIGHTS.streakBonus,       rawValue: longestStreak },
    },
    trajectory,
    interpretation: INTERPRETATION[label],
    predictedRate7d: round1(predictedRate7d * 100),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORT GENERATORS
// ═══════════════════════════════════════════════════════════════════════════════

function buildCommitmentWeeklySummary(
  commitment: Commitment,
  records: CommitmentRecord[],
  fromDate: Date,
  toDate: Date,
  now: Date
): CommitmentWeeklySummary {
  const expected = computeExpectedCount(commitment, fromDate, toDate);
  const actual   = computeActualCount(records, commitment.id);
  const missed   = Math.max(0, expected - Math.ceil(actual));
  const pct      = expected > 0 ? Math.round((actual / expected) * 100) : 0;

  const weekRecords = records.filter(
    (r) => r.commitmentId === commitment.id && r.date >= fromDate && r.date <= toDate
  );
  const missedDays = weekRecords
    .filter((r) => r.outcome === "missed")
    .map((r) => getDayName(r.date));

  // Top excuse this week
  const excuseCounts = new Map<string, number>();
  for (const r of weekRecords.filter((r) => r.excuseCategory)) {
    const cat = r.excuseCategory!;
    excuseCounts.set(cat, (excuseCounts.get(cat) ?? 0) + 1);
  }
  const topExcuse = excuseCounts.size > 0
    ? [...excuseCounts.entries()].sort(([, a], [, b]) => b - a)[0]![0]
    : null;

  const streak = computeStreaks(commitment, records, now);

  const status: CommitmentWeeklySummary["status"] =
    pct >= 85 ? "on_track" :
    pct >= 50 ? "slipping" :
    pct > 0   ? "missed" :
    "not_started";

  return {
    commitmentId: commitment.id,
    description:  commitment.description,
    domain:       commitment.domain,
    expected,
    actual: Math.round(actual * 2) / 2,
    missed,
    completionPct: pct,
    missedDays,
    topExcuse,
    streak,
    status,
  };
}

function buildWeeklyReviewText(summaries: CommitmentWeeklySummary[], confidence: CommitmentConfidenceScore, weekStart: Date, weekEnd: Date): string {
  const lines: string[] = [];
  const total = summaries.reduce((s, c) => ({ exp: s.exp + c.expected, act: s.act + c.actual }), { exp: 0, act: 0 });
  const overallPct = total.exp > 0 ? Math.round((total.act / total.exp) * 100) : 0;

  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  lines.push(`Week ${fmt(weekStart)} – ${fmt(weekEnd)}`);
  lines.push("");

  for (const s of summaries) {
    const indicator = s.status === "on_track" ? "✓" : s.status === "slipping" ? "~" : "✗";
    lines.push(`${indicator} ${s.description}: ${s.actual}/${s.expected} (${s.completionPct}%)`);
    if (s.missedDays.length > 0) lines.push(`  Missed: ${s.missedDays.join(", ")}`);
    if (s.streak.currentStreak >= 3) lines.push(`  Streak: ${s.streak.currentStreak} days`);
  }

  lines.push("");
  lines.push(`Overall: ${total.act}/${total.exp} — ${overallPct}%`);
  lines.push(`Commitment confidence: ${confidence.label} (${confidence.score}/100)`);

  const recommendation = buildNextWeekRecommendation(summaries, overallPct);
  if (recommendation) {
    lines.push("");
    lines.push(recommendation);
  }

  return lines.join("\n");
}

function buildNextWeekRecommendation(summaries: CommitmentWeeklySummary[], overallPct: number): string {
  if (overallPct >= 85) return "Strong week. Same targets next week.";
  if (overallPct >= 60) return "Slipping on the middle days. Protect Tuesday–Thursday blocks specifically.";
  if (overallPct >= 30) return `Reduce to ${Math.ceil(summaries[0]?.expected ?? 7 * 0.6)} this week — build the habit before the full load.`;
  return `Drop to minimum viable: one ${summaries[0]?.domain ?? "task"} per day. Rebuild from there.`;
}

export function generateWeeklyReview(
  commitments: Commitment[],
  records: CommitmentRecord[],
  state: MentorState,
  now: Date
): WeeklyReview {
  const wStart = weekStart(now);
  const wEnd   = new Date(Math.min(now.getTime(), wStart.getTime() + 6 * 86_400_000));

  const active   = commitments.filter((c) => c.status === "active");
  const summaries = active.map((c) => buildCommitmentWeeklySummary(c, records, wStart, wEnd, now));

  const total = summaries.reduce(
    (acc, s) => ({ exp: acc.exp + s.expected, act: acc.act + s.actual, missed: acc.missed + s.missed }),
    { exp: 0, act: 0, missed: 0 }
  );
  const overallRate = total.exp > 0 ? round1(total.act / total.exp) : 0;

  // Strongest / weakest day: count kept/missed across all commitments by day-of-week
  const dayScores = new Map<string, { kept: number; total: number }>();
  for (const r of records) {
    if (r.date < wStart || r.date > wEnd) continue;
    const day = getDayName(r.date);
    const entry = dayScores.get(day) ?? { kept: 0, total: 0 };
    entry.total++;
    if (r.outcome === "kept") entry.kept++;
    dayScores.set(day, entry);
  }
  const daySorted = [...dayScores.entries()]
    .filter(([, v]) => v.total >= 1)
    .map(([day, v]) => ({ day, rate: v.kept / v.total }))
    .sort((a, b) => b.rate - a.rate);

  const strongestDay = daySorted[0]?.day ?? null;
  const weakestDay   = daySorted[daySorted.length - 1]?.day ?? null;

  // Top excuse
  const excuseCounts = new Map<string, number>();
  for (const s of summaries) {
    if (s.topExcuse) excuseCounts.set(s.topExcuse, (excuseCounts.get(s.topExcuse) ?? 0) + 1);
  }
  const topExcuse = excuseCounts.size > 0
    ? [...excuseCounts.entries()].sort(([, a], [, b]) => b - a)[0]![0]
    : null;

  const streaks    = active.map((c) => computeStreaks(c, records, now));
  const rates      = computeCompletionRates(commitments, records, now);
  const confidence = computeConfidenceScore(rates, state, streaks);

  const nextWeekTarget = total.exp > 0
    ? Math.round(total.exp * Math.min(1.1, Math.max(0.6, overallRate * 1.15)))
    : 7;

  return {
    weekStart:         wStart,
    weekEnd:           wEnd,
    summaries,
    totalExpected:     total.exp,
    totalCompleted:    Math.round(total.act),
    totalMissed:       total.missed,
    overallRate,
    strongestDay,
    weakestDay,
    topExcuseCategory: topExcuse,
    confidenceScore:   confidence,
    nextWeekTarget,
    reviewText:        buildWeeklyReviewText(summaries, confidence, wStart, wEnd),
  };
}

export function generateMissedCommitmentReview(
  commitment: Commitment,
  records: CommitmentRecord[],
  fromDate: Date,
  toDate: Date,
  now: Date
): MissedCommitmentReview {
  const expected   = computeExpectedCount(commitment, fromDate, toDate);
  const actual     = computeActualCount(records, commitment.id);
  const missedCount = Math.max(0, expected - Math.ceil(actual));
  const pct        = expected > 0 ? Math.round((actual / expected) * 100) : 0;

  const periodRecords = records.filter(
    (r) => r.commitmentId === commitment.id && r.date >= fromDate && r.date <= toDate
  );
  const missedDays = periodRecords
    .filter((r) => r.outcome === "missed")
    .map((r) => getDayName(r.date));

  // Excuse category distribution
  const excuseMap = new Map<string, number>();
  for (const r of periodRecords.filter((r) => r.excuseCategory)) {
    const cat = r.excuseCategory!;
    excuseMap.set(cat, (excuseMap.get(cat) ?? 0) + 1);
  }
  const excuseCategories = [...excuseMap.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([category, count]) => ({ category, count }));

  // Pattern detection
  const dayOfWeekMisses = new Map<number, number>();
  for (const r of periodRecords.filter((r) => r.outcome === "missed")) {
    const dow = r.date.getDay();
    dayOfWeekMisses.set(dow, (dayOfWeekMisses.get(dow) ?? 0) + 1);
  }
  const topMissDay = [...dayOfWeekMisses.entries()].sort(([, a], [, b]) => b - a)[0];
  let pattern: string | null = null;
  if (topMissDay && topMissDay[1] >= 2) {
    pattern = `${DAY_NAMES[topMissDay[0]]}s are consistently missed`;
  } else if (excuseCategories[0] && excuseCategories[0].count >= 2) {
    pattern = `"${excuseCategories[0].category}" appears repeatedly as a reason`;
  }

  const severity: MissedCommitmentReview["severity"] =
    pct >= 70 ? "minor" :
    pct >= 40 ? "moderate" :
    pct >= 15 ? "major" :
    "critical";

  const reviewText = buildMissedReviewText(commitment, expected, actual, pct, missedDays, excuseCategories, pattern);
  const accountabilityText = generateAccountabilityResponse(commitment, expected, actual, periodRecords);

  return {
    commitment,
    period:           { from: fromDate, to: toDate },
    expected,
    actual:           round1(actual),
    missedCount,
    completionPct:    pct,
    missedDays,
    excuseCategories,
    pattern,
    severity,
    reviewText,
    accountabilityText,
  };
}

function buildMissedReviewText(
  commitment: Commitment,
  expected: number,
  actual: number,
  pct: number,
  missedDays: string[],
  excuseCategories: Array<{ category: string; count: number }>,
  pattern: string | null
): string {
  const lines: string[] = [];
  lines.push(`${commitment.description}`);
  lines.push(`Expected: ${expected}. Completed: ${Math.round(actual)}. Rate: ${pct}%.`);
  if (missedDays.length > 0) lines.push(`Missed days: ${missedDays.join(", ")}.`);
  if (excuseCategories.length > 0) {
    lines.push(`Top reason: "${excuseCategories[0]!.category}" (${excuseCategories[0]!.count}× cited).`);
  }
  if (pattern) lines.push(`Pattern: ${pattern}.`);
  return lines.join("\n");
}

export function generateAccountabilityResponse(
  commitment: Commitment,
  expectedCount: number,
  actualCount: number,
  records: CommitmentRecord[]
): string {
  const actual   = Math.round(actualCount);
  const missed   = Math.max(0, expectedCount - actual);
  const pct      = expectedCount > 0 ? Math.round((actual / expectedCount) * 100) : 0;
  const period   = commitment.period === "day" ? "days" : "weeks";

  const characterization =
    pct >= 85 ? "solid" :
    pct >= 70 ? "mostly consistent" :
    pct >= 50 ? "inconsistent" :
    pct >= 25 ? "mostly missed" :
    "barely started";

  const excuseCategories: Map<string, number> = new Map();
  for (const r of records.filter((r) => r.excuseCategory)) {
    const cat = r.excuseCategory!;
    excuseCategories.set(cat, (excuseCategories.get(cat) ?? 0) + 1);
  }
  const topExcuse = excuseCategories.size > 0
    ? [...excuseCategories.entries()].sort(([, a], [, b]) => b - a)[0]![0]
    : null;

  const missedDays = records
    .filter((r) => r.outcome === "missed")
    .slice(0, 3)
    .map((r) => getDayName(r.date));

  const lines: string[] = [];

  // Lead line: the hard truth
  lines.push(`${expectedCount} ${period}. ${actual} done. That's ${pct}% — ${characterization}.`);

  // The gap
  if (missed > 0) {
    lines.push(`${missed} ${period} you didn't show up for ${commitment.description}.`);
  }

  // Pattern or excuse
  if (topExcuse && pct < 70) {
    lines.push(`"${topExcuse}" keeps appearing. That's a pattern, not a coincidence.`);
  } else if (missedDays.length > 0 && missedDays.length <= 3) {
    lines.push(`Missed on: ${missedDays.join(", ")}.`);
  }

  // Closing question or directive
  if (pct < 30) {
    lines.push(`What specifically changes this week, or is the commitment too large?`);
  } else if (pct < 60) {
    lines.push(`What happened on the days you missed?`);
  } else {
    lines.push(`You're close. What protects the remaining gap?`);
  }

  return lines.join("\n");
}

export function generateStreakReport(
  commitments: Commitment[],
  records: CommitmentRecord[],
  state: MentorState,
  now: Date
): StreakReport {
  const active = commitments.filter((c) => c.status === "active");
  const streaks = active.map((c) => computeStreaks(c, records, now));

  const longestEver      = Math.max(0, ...streaks.map((s) => s.longestStreak));
  const totalActive      = streaks.reduce((sum, s) => sum + s.currentStreak, 0);
  const avgBeforeBreak   = streaks.length > 0
    ? round1(streaks.reduce((s, streak) => s + streak.averageStreakLength, 0) / streaks.length)
    : 0;

  const best = streaks
    .sort((a, b) => b.currentStreak - a.currentStreak)
    .find((s) => s.currentStreak > 0);
  const bestCommitment = best
    ? active.find((c) => c.id === best.commitmentId)?.description ?? null
    : null;

  const lines: string[] = [];
  for (const [i, s] of streaks.entries()) {
    const c = active[i]!;
    if (s.currentStreak > 0) {
      lines.push(`${c.description}: ${s.currentStreak}-day streak (longest: ${s.longestStreak})`);
    } else if (s.longestStreak > 0) {
      lines.push(`${c.description}: streak broken — longest was ${s.longestStreak} days`);
    } else {
      lines.push(`${c.description}: no streak established yet`);
    }
  }

  if (avgBeforeBreak > 0) {
    lines.push(`\nAverage streak before a break: ${avgBeforeBreak} days.`);
  }
  if (totalActive >= 7) {
    lines.push(`${totalActive} consecutive days active across all commitments.`);
  }

  return {
    streaks,
    bestCommitment,
    totalActiveStreak:  totalActive,
    longestEver,
    averageBeforeBreak: avgBeforeBreak,
    reportText:         lines.join("\n"),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DB PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════════

async function getUserId(platformChatId: string): Promise<string | null> {
  const user = await prisma.messengerUser.findUnique({
    where: { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { id: true },
  });
  return user?.id ?? null;
}

async function saveCommitment(userId: string, commitment: Commitment): Promise<void> {
  const value = JSON.stringify({
    ...commitment,
    startedAt:  commitment.startedAt.toISOString(),
    expiresAt:  commitment.expiresAt?.toISOString() ?? null,
    createdAt:  commitment.createdAt.toISOString(),
  });

  await prisma.$transaction([
    prisma.memoryFact.deleteMany({ where: { userId, type: "commitment", key: commitment.id } }),
    prisma.memoryFact.create({ data: { userId, type: "commitment", key: commitment.id, value, confidence: 1.0 } }),
  ]);
}

async function saveCommitmentRecord(userId: string, record: CommitmentRecord): Promise<void> {
  const key   = `${record.commitmentId}_${dateToISO(record.date)}`;
  const value = JSON.stringify({
    ...record,
    date:       record.date.toISOString(),
    recordedAt: record.recordedAt.toISOString(),
  });

  await prisma.$transaction([
    prisma.memoryFact.deleteMany({ where: { userId, type: "commitment_record", key } }),
    prisma.memoryFact.create({ data: { userId, type: "commitment_record", key, value, confidence: 1.0 } }),
  ]);
}

async function loadAccountabilityData(
  platformChatId: string,
  lookbackDays = 30
): Promise<{ commitments: Commitment[]; records: CommitmentRecord[] } | null> {
  const userId = await getUserId(platformChatId);
  if (!userId) return null;

  const cutoff = new Date(Date.now() - lookbackDays * 86_400_000);

  const facts = await prisma.memoryFact.findMany({
    where: {
      userId,
      type: { in: ["commitment", "commitment_record"] },
    },
    orderBy: { createdAt: "asc" },
  });

  const commitments: Commitment[] = [];
  const records: CommitmentRecord[] = [];

  for (const fact of facts) {
    try {
      const parsed = JSON.parse(fact.value);

      if (fact.type === "commitment") {
        commitments.push({
          ...parsed,
          startedAt: new Date(parsed.startedAt),
          expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
          createdAt: new Date(parsed.createdAt),
        } as Commitment);
      }

      if (fact.type === "commitment_record") {
        const record: CommitmentRecord = {
          ...parsed,
          date:       new Date(parsed.date),
          recordedAt: new Date(parsed.recordedAt),
        };
        if (record.date >= cutoff) records.push(record);
      }
    } catch {
      // skip corrupted records
    }
  }

  return { commitments, records };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN UPDATE FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

export async function updateAccountability(
  platformChatId: string,
  analysis: ConversationAnalysis,
  state: MentorState,
  now = new Date()
): Promise<AccountabilityUpdateResult> {
  const userId = await getUserId(platformChatId);
  if (!userId) {
    return { commitmentCreated: null, recordSaved: null, updatedState: emptyState(state) };
  }

  const data = await loadAccountabilityData(platformChatId, 60);
  if (!data) return { commitmentCreated: null, recordSaved: null, updatedState: emptyState(state) };

  let { commitments, records } = data;
  let commitmentCreated: Commitment | null = null;
  let recordSaved: CommitmentRecord | null = null;

  // 1. New commitment declared
  if (analysis.intent === "commitment_made" || (analysis.intent === "goal_set" && analysis.hasCommitment)) {
    const parsed = parseCommitmentFromAnalysis(analysis, now);
    if (parsed) {
      const newCommitment: Commitment = { ...parsed, id: generateId(), createdAt: now };
      await saveCommitment(userId, newCommitment);
      commitments = [...commitments, newCommitment];
      commitmentCreated = newCommitment;
      console.log(`[ACCOUNTABILITY] New commitment created: "${newCommitment.description}" (${newCommitment.frequencyPerPeriod}/${newCommitment.period})`);
    }
  }

  // 2. Outcome reported (kept, missed, excused)
  const active = commitments.filter((c) => c.status === "active");
  if (
    active.length > 0 &&
    (analysis.hasFailureReport || analysis.intent === "status_update" || analysis.intent === "check_in_response" || analysis.intent === "progress_report")
  ) {
    const matched = matchMessageToCommitment(analysis, active);
    if (matched) {
      const outcome = detectOutcomeFromAnalysis(analysis, matched);
      const excuse = analysis.hasExcuse ? analysis.rawText.slice(0, 200) : null;
      const newRecord: CommitmentRecord = {
        id:             generateId(),
        commitmentId:   matched.id,
        date:           dayStart(now),
        outcome,
        excuse,
        excuseCategory: excuse ? parseExcuseCategory(excuse) : null,
        evidenceText:   analysis.rawText.slice(0, 200),
        recordedAt:     now,
      };
      await saveCommitmentRecord(userId, newRecord);
      records = [...records, newRecord];
      recordSaved = newRecord;
      console.log(`[ACCOUNTABILITY] Record saved: ${matched.description} — ${outcome} on ${dateToISO(now)}`);
    }
  }

  const updatedState = buildAccountabilityState(commitments, records, state, now);
  return { commitmentCreated, recordSaved, updatedState };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATE BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

function buildAccountabilityState(
  commitments: Commitment[],
  records: CommitmentRecord[],
  state: MentorState,
  now: Date
): AccountabilityState {
  const streaks      = commitments.filter((c) => c.status === "active").map((c) => computeStreaks(c, records, now));
  const rates        = computeCompletionRates(commitments, records, now);
  const confidence   = computeConfidenceScore(rates, state, streaks);

  return {
    commitments,
    recentRecords:  records,
    streaks,
    rates,
    confidenceScore: confidence,
    lastUpdatedAt:   now,
  };
}

function emptyState(state: MentorState): AccountabilityState {
  const now  = new Date();
  const rates: CompletionRates = { rate7d: 0, rate30d: 0, rateAllTime: 0, kept7d: 0, expected7d: 0, kept30d: 0, expected30d: 0, totalKept: 0, totalMissed: 0 };
  return {
    commitments:   [],
    recentRecords: [],
    streaks:       [],
    rates,
    confidenceScore: computeConfidenceScore(rates, state, []),
    lastUpdatedAt:   now,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load current accountability state — used by mentor-decision-engine.
 */
export async function computeAccountabilityState(
  platformChatId: string,
  state: MentorState,
  now = new Date()
): Promise<AccountabilityState> {
  const data = await loadAccountabilityData(platformChatId, 60);
  if (!data) return emptyState(state);
  return buildAccountabilityState(data.commitments, data.records, state, now);
}

/**
 * Generate a specific accountability report.
 */
export async function generateReport(
  platformChatId: string,
  state: MentorState,
  reportType: ReportType,
  now = new Date()
): Promise<AccountabilityReport> {
  const data = await loadAccountabilityData(platformChatId, 60);
  if (!data) {
    const s = emptyState(state);
    return { type: reportType, generatedAt: now, state: s };
  }

  const { commitments, records } = data;
  const accState = buildAccountabilityState(commitments, records, state, now);

  if (reportType === "weekly_review") {
    return {
      type: reportType,
      generatedAt: now,
      weeklyReview: generateWeeklyReview(commitments, records, state, now),
      state: accState,
    };
  }

  if (reportType === "streak_report") {
    return {
      type: reportType,
      generatedAt: now,
      streakReport: generateStreakReport(commitments, records, state, now),
      state: accState,
    };
  }

  if (reportType === "missed_review" || reportType === "accountability_response") {
    const active = commitments.filter((c) => c.status === "active");
    if (active.length === 0) return { type: reportType, generatedAt: now, state: accState };

    const primary     = active[0]!;
    const fromDate    = new Date(Math.max(primary.startedAt.getTime(), new Date(now.getTime() - 7 * 86_400_000).getTime()));
    const review      = generateMissedCommitmentReview(primary, records, fromDate, now, now);

    return {
      type: reportType,
      generatedAt:         now,
      missedReview:        review,
      accountabilityText:  review.accountabilityText,
      state:               accState,
    };
  }

  return { type: reportType, generatedAt: now, state: accState };
}

/**
 * Returns the accountability response text for a specific commitment.
 * Used by the LLM layer as a context-injected template.
 */
export async function getAccountabilityText(
  platformChatId: string,
  state: MentorState,
  now = new Date()
): Promise<string> {
  const data = await loadAccountabilityData(platformChatId, 14);
  if (!data || data.commitments.length === 0) {
    return "No active commitments on record. What specifically are you holding yourself to?";
  }

  const active  = data.commitments.filter((c) => c.status === "active");
  const primary = active[0]!;
  const from    = new Date(Math.max(primary.startedAt.getTime(), new Date(now.getTime() - 7 * 86_400_000).getTime()));
  const expected = computeExpectedCount(primary, from, now);
  const actual   = computeActualCount(data.records, primary.id);
  const periodRecords = data.records.filter((r) => r.commitmentId === primary.id && r.date >= from);

  return generateAccountabilityResponse(primary, expected, actual, periodRecords);
}

/**
 * One-line summary of current accountability health — for logs and decision engine hints.
 */
export function summarizeAccountabilityState(state: AccountabilityState): string {
  const { rates, confidenceScore, streaks } = state;
  const maxStreak = Math.max(0, ...streaks.map((s) => s.currentStreak));
  return [
    `confidence:${confidenceScore.score} (${confidenceScore.label})`,
    `rate7d:${Math.round(rates.rate7d * 100)}%`,
    `rate30d:${Math.round(rates.rate30d * 100)}%`,
    maxStreak > 0 ? `streak:${maxStreak}d` : "no_streak",
    `kept:${rates.totalKept} missed:${rates.totalMissed}`,
  ].join(" | ");
}
