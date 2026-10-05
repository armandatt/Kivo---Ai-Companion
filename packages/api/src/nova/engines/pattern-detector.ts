// ─── Nova Pattern Detector ────────────────────────────────────────────────────
// SKILL.md §8.7 — detect long-horizon behavioral patterns across sessions.
// All logic deterministic. No LLM calls.
// NOT called on every message — fired every N messages to amortize cost.
// Owner: Pattern Detector.

import type { DetectedPattern, NovaPatternType, PatternAnalysis } from "../types/engine.types";

export interface PatternDetectorInput {
  // Study session history (last 60 days)
  studySessions: Array<{
    sessionDate:    Date;
    status:         string;
    durationMinutes: number;
  }>;

  // Conversation signal history (last 30 messages)
  signalHistory: Array<{
    timestamp: Date;
    signals:   string[];
  }>;

  // Topic mastery overview
  topicMasteries: Array<{
    topicName:          string;
    masteryProbability: number;
    confidenceReported: number;
    reviewCount:        number;
    lastStudiedAt:      Date | null;
  }>;

  // Prior detected patterns (to track occurrence count)
  priorPatterns: DetectedPattern[];

  messagesSinceLastRun: number;
}

interface PatternDefinition {
  type:            NovaPatternType;
  minConfidence:   number;
  baseSeverity:    DetectedPattern["severity"];
  recommendation:  string;
  detect:          (input: PatternDetectorInput, now: Date) => { matches: boolean; evidence: string[]; confidence: number };
}

// ── Pattern definitions ───────────────────────────────────────────────────────

const PATTERN_DEFINITIONS: PatternDefinition[] = [
  {
    type:          "ghosting",
    minConfidence: 0.7,
    baseSeverity:  "emerging",
    recommendation: "Reconnect with a low-friction check-in — ask what one thing they completed.",
    detect: ({ studySessions }, now) => {
      const recent = studySessions
        .filter(s => s.status === "completed")
        .sort((a, b) => b.sessionDate.getTime() - a.sessionDate.getTime());
      const lastCompleted = recent[0];
      // Ghosting is stopping after having started. With no completed session
      // on record there is nothing to have stopped: absence of data is not
      // evidence of a behavior.
      if (!lastCompleted) return { matches: false, evidence: [], confidence: 0 };

      const daysSince = Math.floor((now.getTime() - lastCompleted.sessionDate.getTime()) / 86_400_000);
      if (daysSince < 5) return { matches: false, evidence: [], confidence: 0 };
      const confidence = Math.min(0.95, 0.5 + daysSince / 30);
      return {
        matches:    daysSince >= 5,
        evidence:   [`Last completed session ${daysSince} days ago`],
        confidence,
      };
    },
  },

  {
    type:          "motivation_crash",
    minConfidence: 0.65,
    baseSeverity:  "emerging",
    recommendation: "Surface the gap between stated goals and current behavior without judgment.",
    detect: ({ studySessions, signalHistory }, now) => {
      const last14 = studySessions.filter(s => {
        const days = (now.getTime() - s.sessionDate.getTime()) / 86_400_000;
        return days <= 14;
      });
      const last30 = studySessions.filter(s => {
        const days = (now.getTime() - s.sessionDate.getTime()) / 86_400_000;
        return days <= 30;
      });

      const recent14Completed = last14.filter(s => s.status === "completed").length;
      const prev16Completed = last30.filter(s => {
        const days = (now.getTime() - s.sessionDate.getTime()) / 86_400_000;
        return days > 14 && s.status === "completed";
      }).length;

      const recentRate = recent14Completed / 14;
      const priorRate  = prev16Completed / 16;

      const dropped = priorRate > 0.3 && recentRate < priorRate * 0.4;
      const recentAvoidance = signalHistory.slice(-5).filter(s =>
        s.signals.includes("avoidance") || s.signals.includes("burnout_behavioral"),
      ).length;

      if (!dropped && recentAvoidance < 2) return { matches: false, evidence: [], confidence: 0 };

      const evidence: string[] = [];
      if (dropped) evidence.push(`Session rate dropped from ${(priorRate * 100).toFixed(0)}% to ${(recentRate * 100).toFixed(0)}%`);
      if (recentAvoidance >= 2) evidence.push(`${recentAvoidance} avoidance signals in last 5 messages`);

      return { matches: true, evidence, confidence: 0.70 };
    },
  },

  {
    type:          "excuse_loop",
    minConfidence: 0.70,
    baseSeverity:  "emerging",
    recommendation: "Do not accept the excuse. Gently reflect the pattern back.",
    detect: ({ signalHistory }, now) => {
      const last15 = signalHistory.slice(-15);
      const excuseMessages = last15.filter(s => s.signals.includes("excuse")).length;

      if (excuseMessages < 3) return { matches: false, evidence: [], confidence: 0 };
      const confidence = Math.min(0.95, 0.6 + excuseMessages * 0.05);
      return {
        matches:  true,
        evidence: [`${excuseMessages} excuse signals in last ${last15.length} messages`],
        confidence,
      };
    },
  },

  {
    type:          "overplanning",
    minConfidence: 0.65,
    baseSeverity:  "emerging",
    recommendation: "Redirect from planning to the smallest possible next action.",
    detect: ({ signalHistory, studySessions }, now) => {
      const last10 = signalHistory.slice(-10);
      const planMessages    = last10.filter(s => s.signals.includes("commitment")).length;
      const completedRecent = studySessions.filter(s => {
        const days = (now.getTime() - s.sessionDate.getTime()) / 86_400_000;
        return days <= 7 && s.status === "completed";
      }).length;

      const overplanning = planMessages >= 4 && completedRecent <= 1;
      if (!overplanning) return { matches: false, evidence: [], confidence: 0 };

      return {
        matches:  true,
        evidence: [
          `${planMessages} commitments made in last 10 messages`,
          `Only ${completedRecent} completed sessions this week`,
        ],
        confidence: 0.70,
      };
    },
  },

  {
    type:          "perfectionism",
    minConfidence: 0.65,
    baseSeverity:  "emerging",
    recommendation: "Reframe: done is better than perfect. Encourage submitting partial work.",
    detect: ({ signalHistory, studySessions }, now) => {
      const avoidanceCount = signalHistory.slice(-10).filter(s => s.signals.includes("avoidance")).length;
      const noSessions     = studySessions.filter(s => {
        const days = (now.getTime() - s.sessionDate.getTime()) / 86_400_000;
        return days <= 14 && s.status === "completed";
      }).length === 0;

      const matches = avoidanceCount >= 3 && noSessions;
      if (!matches) return { matches: false, evidence: [], confidence: 0 };
      return {
        matches: true,
        evidence: [`${avoidanceCount} avoidance signals + no completed sessions in 14 days`],
        confidence: 0.65,
      };
    },
  },

  {
    type:          "restart_cycle",
    minConfidence: 0.70,
    baseSeverity:  "emerging",
    recommendation: "Break the restart loop: anchor on the next single session, not a 'new beginning'.",
    detect: ({ signalHistory }, now) => {
      const comebacks = signalHistory.filter(s => s.signals.includes("comeback")).length;
      const excuses   = signalHistory.filter(s => s.signals.includes("excuse")).length;
      const matches   = comebacks >= 3 && excuses >= 3;
      if (!matches) return { matches: false, evidence: [], confidence: 0 };
      return {
        matches:  true,
        evidence: [`${comebacks} comebacks + ${excuses} excuses detected`],
        confidence: 0.72,
      };
    },
  },

  {
    type:          "avoidance_pattern",
    minConfidence: 0.65,
    baseSeverity:  "emerging",
    recommendation: "Find the smallest thing they can do with the avoided topic right now.",
    detect: ({ signalHistory, topicMasteries }, now) => {
      const recentAvoidance = signalHistory.slice(-8).filter(s => s.signals.includes("avoidance")).length;
      const skipped = signalHistory.slice(-8).filter(s => s.signals.includes("study_skip")).length;
      const matches = recentAvoidance >= 2 || (skipped >= 3);
      if (!matches) return { matches: false, evidence: [], confidence: 0 };
      return {
        matches:  true,
        evidence: [`${recentAvoidance} avoidance + ${skipped} skip signals in last 8 messages`],
        confidence: 0.65,
      };
    },
  },

  {
    type:          "comparison_trap",
    minConfidence: 0.65,
    baseSeverity:  "emerging",
    recommendation: "Anchor comparison to their own previous self, not others.",
    detect: ({ signalHistory }, now) => {
      // Comparison trap: self_doubt emotion repeated + discouraged
      const selfDoubt = signalHistory.slice(-10).filter(s =>
        s.signals.includes("self_doubt") || s.signals.includes("identity_doubt"),
      ).length;
      if (selfDoubt < 2) return { matches: false, evidence: [], confidence: 0 };
      return {
        matches:  true,
        evidence: [`${selfDoubt} self-doubt signals in last 10 messages`],
        confidence: 0.65,
      };
    },
  },

  {
    type:          "calibration_delusion",
    minConfidence: 0.70,
    baseSeverity:  "emerging",
    recommendation: "Surface calibration gap explicitly. Trigger CALIBRATION_CHECK intervention.",
    detect: ({ topicMasteries }, now) => {
      const deluded = topicMasteries.filter(t =>
        t.confidenceReported > 0.70 &&
        t.masteryProbability < 0.40 &&
        t.reviewCount > 2,
      );
      if (deluded.length === 0) return { matches: false, evidence: [], confidence: 0 };
      return {
        matches:  true,
        evidence: deluded.map(t =>
          `${t.topicName}: self-confidence ${Math.round(t.confidenceReported * 100)}% vs mastery ${Math.round(t.masteryProbability * 100)}%`,
        ),
        confidence: Math.min(0.95, 0.70 + deluded.length * 0.05),
      };
    },
  },

  {
    type:          "tutorial_hell",
    minConfidence: 0.65,
    baseSeverity:  "emerging",
    recommendation: "Break the consumption loop: assign a concrete output task, not another resource.",
    detect: ({ studySessions, topicMasteries }, now) => {
      // Many short sessions + no mastery growth
      const shortSessions = studySessions.filter(s => {
        const days = (now.getTime() - s.sessionDate.getTime()) / 86_400_000;
        return days <= 21 && s.status === "completed" && s.durationMinutes < 20;
      }).length;

      const lowMasteryHighCount = topicMasteries.filter(t =>
        t.masteryProbability < 0.4 && t.reviewCount > 5,
      ).length;

      const matches = shortSessions >= 8 && lowMasteryHighCount >= 1;
      if (!matches) return { matches: false, evidence: [], confidence: 0 };

      return {
        matches:  true,
        evidence: [`${shortSessions} short sessions (<20min) this week, ${lowMasteryHighCount} topics with low mastery despite many reviews`],
        confidence: 0.67,
      };
    },
  },
];

// ── Main analysis function ────────────────────────────────────────────────────

export function runPatternDetector(
  input:      PatternDetectorInput,
  now:        Date = new Date(),
): PatternAnalysis {
  const detectedPatterns: DetectedPattern[] = [];

  for (const def of PATTERN_DEFINITIONS) {
    const result = def.detect(input, now);
    if (!result.matches || result.confidence < def.minConfidence) continue;

    // Check if this pattern was previously detected
    const prior = input.priorPatterns.find(p => p.type === def.type);
    const occurrences = (prior?.occurrences ?? 0) + 1;

    let severity: DetectedPattern["severity"] = def.baseSeverity;
    if (occurrences >= 5) severity = "critical";
    else if (occurrences >= 3) severity = "confirmed";

    detectedPatterns.push({
      type:         def.type,
      confidence:   result.confidence,
      severity,
      firstSeenAt:  prior?.firstSeenAt ?? now,
      occurrences,
      evidence:     result.evidence,
      recommendation: def.recommendation,
    });
  }

  detectedPatterns.sort((a, b) => {
    const severityOrder = { critical: 3, confirmed: 2, emerging: 1 };
    return severityOrder[b.severity] - severityOrder[a.severity] || b.confidence - a.confidence;
  });

  return {
    detectedPatterns,
    dominantPattern:    detectedPatterns[0] ?? null,
    analysisRunAt:      now,
    messagesSinceLastRun: input.messagesSinceLastRun,
  };
}
