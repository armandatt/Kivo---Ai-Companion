// ─── Nova Onboarding Response Brain ───────────────────────────────────────────
// SKILL.md: Response Brain expresses only. It does not decide what to ask,
// does not evaluate completeness, does not choose next focus.
// All decisions arrive as structured input (OnboardingDecision).
//
// Receives: extraction (what was understood) + decision (what to do) + context
// Produces: one conversational reply string
//
// Silent Confirmation:
//   Instead of review cards or explicit "I captured X", Nova weaves newly
//   learned facts naturally into conversation — "Bennett, second year CSE —
//   placements as the goal. Which subjects are you taking this semester?"
//   This allows effortless correction without confirmation screens.
//
// Model: gpt-4o-mini. Onboarding replies are 1-2 short sentences; the full
// gpt-4o Response Brain is reserved for post-onboarding emotional/academic
// coaching where reasoning depth matters.
// Owner: Response Brain layer.

import { generateOpenAIText } from "../../services/openai.service";
import type { AcademicExtractionResult, OnboardingCurrentState } from "./nova-onboarding-extractor";
import type { OnboardingDecision }                                from "./nova-onboarding-decision-engine";

// ── Next focus → question instructions ───────────────────────────────────────

const FOCUS_PROMPT: Record<string, string> = {
  year:             "Ask which year of study they're in. If institution is also unknown, fold that in: 'Which year are you in, and where?'",
  subjects:         "Ask which subjects they're taking this semester.",
  goals:            "Ask what they're studying towards — placement, higher studies, competitive exams, etc.",
  target_gpa:       "Ask what CGPA they're targeting.",
  study_hours:      "Ask how many hours per day they can realistically study.",
  biggest_struggle: "Ask what they find hardest about studying — consistency, specific subjects, distractions, etc.",
  study_time:       "Ask when during the day they study best.",
};

function buildNextQuestion(nextFocus: string | null): string {
  if (!nextFocus) return "Tell the student you have what you need to start. Ask what they want to work on today.";
  return FOCUS_PROMPT[nextFocus] ?? `Ask about ${nextFocus}.`;
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(
  decision:     OnboardingDecision,
  currentState: OnboardingCurrentState,
  history:      Array<{ role: "user" | "nova"; text: string }>,
): string {
  const isFirstMessage = !currentState.institution && !currentState.yearOfStudy &&
                         !currentState.subjectCount && !currentState.goals.length;

  const capturedLines = decision.justCaptured.length > 0
    ? decision.justCaptured.map(f => `  - ${f.label}${f.isUpdated ? " (updated)" : ""}`).join("\n")
    : "  (nothing new this turn)";

  const conflictLines = decision.conflictsDetected.length > 0
    ? decision.conflictsDetected.map(c =>
        `  - ${c.field}: had "${c.previousValue}", student now says "${c.newValue}"`
      ).join("\n")
    : "";

  const unknownLines = decision.projectedState.subjectCount === 0 &&
                       decision.justCaptured.length === 0 &&
                       decision.needsClarification
    ? "  (student said something unclear — ask gently for clarification)"
    : "";

  const historyText = history.length > 0
    ? history.slice(-6).map(m =>
        `  ${m.role === "user" ? "Student" : "Nova"}: ${m.text.slice(0, 160)}`
      ).join("\n")
    : "  (start of conversation)";

  return `You are Nova — a warm, direct academic study companion.

YOUR ONLY JOB: Write one short, natural reply. All decisions have been made for you.

WHAT WAS JUST LEARNED THIS TURN:
${capturedLines}
${conflictLines ? `\nCONFLICT DETECTED:\n${conflictLines}` : ""}
${unknownLines}

WHAT TO ASK NEXT:
${buildNextQuestion(decision.nextFocus)}

RECENT CONVERSATION:
${historyText}

─── REPLY RULES ───────────────────────────────────────────────────────────────
SILENT CONFIRMATION: Weave 1–2 newly learned facts into the reply naturally.
Do NOT list all facts. Do NOT say "I've noted" or "I've captured".
Acknowledge briefly, then ask the one question.

FORMAT: 1–2 short sentences maximum.
  - Sentence 1: natural acknowledgment of 1-2 things just learned (skip if nothing new)
  - Sentence 2: the one question

FIRST MESSAGE (nothing known yet): Use a warm 1-sentence welcome + ask.
  "Hey, I'm Nova. Which year are you in, and where are you studying?"
  OR a context-appropriate variation.

CONFLICT: If a conflict was detected, gently acknowledge: "Got it — you're in 3rd year then, not 2nd."
  Then continue with the next question.

CLARIFICATION: If something was unclear, ask naturally: "What subject was that — I didn't catch the full name."

COMPLETION (nextFocus = null): Don't fabricate a celebration.
  "You're all set. What do you want to work on today?"

VOICE: Warm. Direct. Curious. Never clinical. Never form-like.
  RIGHT: "Bennett, second year CSE. Which subjects are you taking this semester?"
  RIGHT: "Six subjects — that's a full load. What are you primarily studying towards?"
  RIGHT: "Placements as the goal. What's your target CGPA?"
  WRONG: "Great! I've noted your details. Now, could you please tell me your subjects?"
  WRONG: "I need to know your subjects to complete your academic profile."
  WRONG: "Awesome! What is your target GPA?" (hollow filler)

${isFirstMessage ? "\nThis is the FIRST message — start with a warm welcome, not just a question." : ""}`.trim();
}

const FALLBACK_REPLY = "Tell me about your studies — which year are you in and where?";

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateOnboardingReply(input: {
  originalText: string;
  extraction:   AcademicExtractionResult;
  decision:     OnboardingDecision;
  currentState: OnboardingCurrentState;
  history:      Array<{ role: "user" | "nova"; text: string }>;
}): Promise<string> {
  const { originalText, extraction, decision, currentState, history } = input;

  // Fast path: nothing to confirm, nothing clarified, completion → static phrase
  if (decision.isCompleteEnough && !decision.nextFocus && decision.justCaptured.length === 0) {
    return "You're all set. What do you want to work on today?";
  }

  // Fast path: offtopic and no extraction at all → gentle redirect to onboarding
  if (extraction.intent === "offtopic" && Object.keys(extraction.extracted).length === 0) {
    const year = currentState.yearOfStudy ?? decision.projectedState.yearOfStudy;
    if (!year) {
      return "We can get to that later. First — which year are you in, and where are you studying?";
    }
    const nextQ = FOCUS_PROMPT[decision.nextFocus ?? ""] ?? "What do you want to work on today?";
    return `Let's stay on track. ${nextQ}`;
  }

  const systemPrompt = buildSystemPrompt(decision, currentState, history);
  const prompt       = `Student: ${originalText}`;

  try {
    const raw = await generateOpenAIText({
      model:             "gpt-4o-mini",
      maxOutputTokens:   120,
      systemInstruction: systemPrompt,
      prompt,
    });

    const cleaned = raw.trim();
    return cleaned.length >= 5 ? cleaned : FALLBACK_REPLY;
  } catch {
    // Hard fallback: ask the next question directly
    const nextQuestion = FOCUS_PROMPT[decision.nextFocus ?? ""] ?? "What do you want to work on today?";
    return nextQuestion;
  }
}
