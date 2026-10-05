// ─── Nova Proactive Response Brain ───────────────────────────────────────────
// Generates the text for a proactive message.
// This is the ONLY LLM call in the entire proactive system.
// The scheduler, intervention engine, and decision graph are all deterministic.
// Owner: Phase 5 Proactive Mentor System.

import { generateOpenAIText } from "../../services/openai.service";
import { NOVA_STATIC_LAYER } from "../brains/prompts/nova-static-layer.prompt";
import type { ProactiveDecision, MomentumState } from "../types/proactive.types";
import type { AcademicState } from "../types/academic-state.types";

export interface ProactiveResponseInput {
  studentName:       string;
  decision:          ProactiveDecision;
  momentum:          MomentumState;
  academicState:     AcademicState;
  upcomingExamTitle: string | null;
  overdueTopics:     string[];
  studiedToday:      boolean;
  preferredStudyHoursPerDay: number;
}

// ── Instruction templates (per intervention type) ─────────────────────────────
// Response Brain receives one of these as the instruction.
// Constraints come from the decision — they modify tone, not content.

const PROACTIVE_INSTRUCTIONS: Record<string, string> = {
  morning_brief: `It's the start of the student's day. Send a warm, energising morning brief. Include: what they should focus on today (based on their plan/upcoming exams), a motivational nudge, and one concrete first step. Max 3 sentences. No questions.`,

  study_reminder: `The student's study window is now. Send a brief, friendly nudge to start studying. Reference what they planned or should be working on. One sentence of encouragement, one actionable suggestion. Max 2 sentences.`,

  session_check_in: `The student is in an active study session. Check in briefly — acknowledge they're working, ask how it's going in one sentence. Keep it light and non-disruptive.`,

  mid_session_support: `The student is mid-session. Offer brief, focused support. Acknowledge their effort, and give one helpful tip or encouragement for the current topic. Max 2 sentences.`,

  missed_session: `The student missed a study session. Acknowledge it without judgment. Don't guilt-trip — just ask what got in the way and if they'd like to pick up now. Keep it warm and brief.`,

  reflection_reminder: `The student studied today. Prompt a brief evening reflection: one question about what they learned and how they feel. Keep it soft and introspective. Max 2 sentences.`,

  revision_reminder: `The student has topics overdue for review. Remind them warmly — name the topic(s), explain why now is a good time to revisit. Keep it practical, not pressuring. Max 2 sentences.`,

  exam_countdown: `There's an exam coming soon. Give an energising, focused countdown message. Name the exam. Mention the timeline. Suggest the most important thing to focus on today. Keep it direct and calm — no panic. Max 3 sentences.`,

  weekly_review: `It's the end of the week. Send a brief weekly wrap-up: acknowledge what they accomplished, what to carry into next week, and one goal for Monday. Tone: reflective and forward-looking.`,

  milestone_celebration: `The student hit a study streak or milestone. Celebrate it genuinely — but briefly. One sentence of celebration, one sentence connecting it to their bigger goal. No emojis.`,

  consistency_recovery: `The student has had multiple missed sessions. Don't lecture. Acknowledge things get hard. Ask what one small step they can take today to get back. Warm, not pushy.`,

  burnout_prevention: `The student shows signs of burnout or overwork. Back off all study pressure entirely. Tell them explicitly it's okay to rest. Suggest one restorative activity (walk, sleep, break). Tone: calm, permission-giving.`,
};

// ── Public export ─────────────────────────────────────────────────────────────

export async function runProactiveResponseBrain(
  input: ProactiveResponseInput,
): Promise<string> {
  const instruction = PROACTIVE_INSTRUCTIONS[input.decision.finalInterventionType]
    ?? "Send a brief, supportive check-in message to the student.";

  const dynamicContext = buildProactiveContext(input);
  const fullSystem     = `${NOVA_STATIC_LAYER}\n\n${dynamicContext}`;

  const prompt = [
    `Intervention type: ${input.decision.finalInterventionType}`,
    input.decision.overrideReason ? `Override reason: ${input.decision.overrideReason}` : null,
    ``,
    `Instruction: ${instruction}`,
    ``,
    `IMPORTANT: Reply with plain text only. No JSON. No labels. No quotes. Just the message Nova sends.`,
  ].filter(Boolean).join("\n");

  const raw = await generateOpenAIText({
    model:             "gpt-4o",
    systemInstruction: fullSystem,
    prompt,
    maxOutputTokens:   300,
  });

  return raw.trim();
}

// ── Context builder for proactive messages ────────────────────────────────────
// Proactive context is leaner than conversational context — no conversation
// history, no raw message analysis. Just what the mentor needs to know.

function buildProactiveContext(input: ProactiveResponseInput): string {
  const { studentName, momentum, academicState, upcomingExamTitle, overdueTopics, studiedToday } = input;
  const s = academicState;

  const lines: string[] = [
    `## Proactive Mentor Context`,
    `Student: ${studentName}`,
    `Mode: PROACTIVE (no student message — Nova is initiating)`,
    ``,
    `## Academic State`,
    `Phase: ${s.semesterPhase} | Momentary: ${s.momentaryState}`,
    `Streak: ${momentum.currentStreak}d | Last session: ${momentum.lastSessionDaysAgo}d ago | Misses: ${momentum.consecutiveMisses}`,
    `Momentum: ${momentum.currentMomentum} | Consistency: ${momentum.weeklyConsistency}`,
    `Burnout risk: ${s.scores.burnoutRisk}/100 | Engagement: ${s.scores.engagement}/100`,
    studiedToday ? `Studied today: YES` : `Studied today: NO`,
  ];

  if (upcomingExamTitle && s.daysUntilNextExam !== null) {
    lines.push(`Upcoming exam: ${upcomingExamTitle} in ${s.daysUntilNextExam} day(s)`);
  }

  if (overdueTopics.length > 0) {
    lines.push(`Overdue for review: ${overdueTopics.slice(0, 3).join(", ")}`);
  }

  const activeDirectives = Object.entries(s.hardDirectives)
    .filter(([_, v]) => v === true)
    .map(([k]) => k);
  if (activeDirectives.length > 0) {
    lines.push(`Active directives: ${activeDirectives.join(", ")}`);
  }

  return lines.join("\n");
}
