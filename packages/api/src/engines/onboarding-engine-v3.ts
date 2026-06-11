// ═══════════════════════════════════════════════════════════════════════════════
// ONBOARDING ENGINE V3 — conversation-first migration
//
// Replaces the step-centric understanding layer with an OpenAI extractor while
// preserving ALL V2 persistence, validation, split generation, and DB contracts.
//
// What changed:   understanding layer (OpenAI extracts multi-field from free text)
// What stayed:    OnboardingState schema, saveState, finalizeIntake, generateSplit,
//                 all V2 parsers (now used as normalizers / sanity checks), DB writes
//
// Rollback: set ONBOARDING_V3_ENABLED=false → instant fallback to V2. No deploy needed.
// ═══════════════════════════════════════════════════════════════════════════════

import { prisma }          from "@repo/db/client";
import { addToShortTerm }  from "../services/memory.service";
import {
  type OnboardingState,
  type StepId,
  loadState,
  saveState,
  initState,
  finalizeIntake,
  generateSplit,
  buildReviewCard,
  buildWelcomeMessage,
  normalize,
  parseName,
  parseGoal,
  parseBodyStats,
  parseExperience,
  parseLifts,
  parseDays,
  parseGymTime,
  parseProtein,
  parseInjury,
  parseSplit,
} from "./onboarding-engine-v2";
import { extractOnboardingFacts } from "./onboarding-extractor";

// ── Required fields — must all be collected before review ─────────────────────

const REQUIRED_FIELDS: string[] = [
  "name", "gym_goal", "training_experience",
  "available_training_days", "current_split", "gym_session_time",
];

// Maps required field names to the equivalent V2 step for rollback compatibility.
// V2 uses currentStep to resume; keeping it updated means V3→V2 rollback works.
const REQUIRED_FIELD_TO_STEP: Array<{ field: string; step: StepId }> = [
  { field: "name",                   step: "name"     },
  { field: "gym_goal",               step: "goal"     },
  { field: "training_experience",    step: "experience" },
  { field: "available_training_days",step: "days"     },
  { field: "current_split",          step: "split"    },
  { field: "gym_session_time",       step: "gym_time" },
];

function computeCurrentStep(answers: Record<string, string>): StepId {
  for (const { field, step } of REQUIRED_FIELD_TO_STEP) {
    if (!answers[field]) return step;
  }
  return "review";
}

function allRequiredCollected(answers: Record<string, string>): boolean {
  return REQUIRED_FIELDS.every(f => answers[f]?.trim());
}

// ── V2 parser normalizers — validate + canonicalize extractor output ──────────

// Run V2 parser on extractor-proposed value. Returns canonical value or null.
function normalizeWithParser(
  field: string,
  rawValue: string,
): string | null {
  try {
    switch (field) {
      case "name": {
        const r = parseName(rawValue);
        return r.isUnknown ? null : (r.extractedValue ?? rawValue);
      }
      case "gym_goal": {
        const r = parseGoal(rawValue);
        return r.isUnknown ? rawValue : (r.extractedValue ?? rawValue); // trust extractor if V2 unsure
      }
      case "training_experience": {
        const r = parseExperience(rawValue);
        return r.isUnknown ? rawValue : (r.extractedValue ?? rawValue);
      }
      case "available_training_days": {
        const r = parseDays(rawValue);
        return r.isUnknown ? null : (r.extractedValue ?? null);
      }
      case "gym_session_time": {
        const r = parseGymTime(rawValue);
        return r.isUnknown ? null : (r.extractedValue ?? null);
      }
      case "daily_protein_g": {
        const r = parseProtein(rawValue);
        return r.isUnknown ? null : (r.extractedValue ?? null);
      }
      case "injury_notes": {
        const r = parseInjury(rawValue);
        return r.isUnknown ? rawValue : (r.extractedValue ?? rawValue);
      }
      case "current_split": {
        const r = parseSplit(rawValue);
        // BUILD sentinel means the extractor misidentified — ignore; V3 handles split gen separately
        if (r.extractedValue === "BUILD") return null;
        return r.isUnknown ? rawValue : (r.extractedValue ?? rawValue);
      }
      case "current_bodyweight_kg":
      case "height_cm":
      case "squat_kg":
      case "bench_kg":
      case "deadlift_kg": {
        // Numeric fields — just validate range
        const n = parseFloat(rawValue);
        if (isNaN(n) || n <= 0) return null;
        // Sanity bounds
        if (field === "current_bodyweight_kg" && (n < 20 || n > 400)) return null;
        if (field === "height_cm"             && (n < 100 || n > 250)) return null;
        if ((field.endsWith("_kg")) && n > 1000) return null;
        return String(Math.round(n));
      }
      default:
        return rawValue;
    }
  } catch {
    return rawValue;
  }
}

// Derive storageKeys for a given field and canonical value (mirrors V2 STEPS.storageKeys)
function storageKeysFor(field: string, canonical: string): Record<string, string> {
  switch (field) {
    case "name":                    return { name: canonical };
    case "gym_goal":                return { gym_goal: canonical, gym_goal_raw: canonical };
    case "training_experience":     return { training_experience: canonical };
    case "available_training_days": return { available_training_days: canonical };
    case "gym_session_time":        return { gym_session_time: canonical };
    case "daily_protein_g":
      return canonical === "not_tracking"
        ? { protein_raw: "not_tracking", protein_status: "not_tracking" }
        : { protein_raw: canonical, daily_protein_g: canonical, protein_status: "reported" };
    case "injury_notes":            return { injury_notes: canonical };
    case "current_split":           return { current_split: canonical, split_raw: canonical };
    case "current_bodyweight_kg":   return { current_bodyweight_kg: canonical };
    case "height_cm":               return { height_cm: canonical };
    case "squat_kg":                return { squat_kg: canonical };
    case "bench_kg":                return { bench_kg: canonical };
    case "deadlift_kg":             return { deadlift_kg: canonical };
    default:                        return { [field]: canonical };
  }
}

// Conflict fields: warn before overwriting these
const CONFLICT_FIELDS = new Set(["gym_goal", "training_experience", "available_training_days", "current_split"]);

// ── Conversation history helpers ──────────────────────────────────────────────

type HistoryTurn = { r: "u" | "a"; t: string };

function loadHistory(answers: Record<string, string>): Array<{ role: "user" | "assistant"; text: string }> {
  try {
    const raw: HistoryTurn[] = JSON.parse(answers._v3_history ?? "[]");
    return raw.map(x => ({ role: x.r === "u" ? "user" : "assistant", text: x.t }));
  } catch { return []; }
}

function appendHistory(
  answers:   Record<string, string>,
  userMsg:   string,
  assistantMsg: string,
): void {
  const current = loadHistory(answers);
  current.push({ role: "user",      text: userMsg.slice(0, 300) });
  current.push({ role: "assistant", text: assistantMsg.slice(0, 300) });
  // Keep last 20 entries (10 turns)
  const trimmed = current.slice(-20);
  answers._v3_history = JSON.stringify(trimmed.map(m => ({ r: m.role === "user" ? "u" : "a", t: m.text })));
}

// ── Split generation ──────────────────────────────────────────────────────────

function triggerSplitGeneration(state: OnboardingState): string {
  const days = parseInt(state.answers.available_training_days ?? "4") || 4;
  const goal = state.answers.gym_goal ?? "muscle";
  const gen  = generateSplit(days, goal);

  const inner = `Here's your ${days}-day split:\n\n${gen.lines.join("\n")}\n\nGood with this, or want changes?`;
  state.pendingGeneratedSplit = { splitType: gen.splitType, displayText: inner, splitDaysJson: gen.splitDaysJson };
  state.answers._pending_split_display = inner;
  return inner;
}

// ── Main V3 handler ───────────────────────────────────────────────────────────

export async function handleOnboardingV3(input: {
  platformChatId: string;
  text:           string;
  now?:           Date;
}): Promise<{ handled: boolean; reply: string }> {
  const { platformChatId, text } = input;

  const user = await prisma.messengerUser.findUnique({
    where:  { platform_platformChatId: { platform: "telegram", platformChatId } },
    select: { id: true, intakeComplete: true },
  });
  if (!user || user.intakeComplete) return { handled: false, reply: "" };

  const userId = user.id;

  // Track user message in short-term memory
  await addToShortTerm(platformChatId, text, { role: "user", intent: "intake", emotion: "neutral" });

  let state = await loadState(userId);

  // ── First message: initialize and show welcome ───────────────────────────────
  if (!state) {
    state = initState(userId);
    const welcome = buildWelcomeMessage();
    await saveState(userId, state);
    await addToShortTerm(platformChatId, welcome, { role: "assistant", intent: "intake", emotion: "neutral" });
    return { handled: true, reply: welcome };
  }

  const a = state.answers;
  const n = normalize(text);

  // ── Gate 1: Pending split confirmation ──────────────────────────────────────
  if (state.pendingGeneratedSplit) {
    if (n.isYes) {
      const g = state.pendingGeneratedSplit;
      a.current_split    = g.splitType;
      a.split_raw        = "rex_built";
      a.split_days_json  = g.splitDaysJson;
      state.pendingGeneratedSplit   = null;
      delete a._pending_split_display;
      // Fall through to check if all required fields now collected
    } else if (n.isNo) {
      // User rejected — clear pending, let extractor ask for preferences
      state.pendingGeneratedSplit = null;
      delete a._pending_split_display;
      const reply = "No problem. What split are you thinking — or should I try a different structure?";
      await saveState(userId, state);
      await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
      appendHistory(a, text, reply);
      return { handled: true, reply };
    } else {
      // Unclear — re-show split
      const reply = `${state.pendingGeneratedSplit.displayText}\n\nSay yes to keep it, or no to change.`;
      await saveState(userId, state);
      await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
      return { handled: true, reply };
    }
  }

  // ── Gate 2: Review confirmation ──────────────────────────────────────────────
  if (a._v3_review_shown === "true") {
    if (n.isYes) {
      state.completedAt = Date.now();
      state.currentStep = "review";
      await saveState(userId, state);
      await finalizeIntake(userId, platformChatId, state);
      const done = `You're all set, ${a.name ?? "Athlete"}.\n\nI've got everything I need. Let's build something.`;
      await addToShortTerm(platformChatId, done, { role: "assistant", intent: "intake", emotion: "neutral" });
      return { handled: true, reply: done };
    }
    if (n.isNo) {
      // User wants to change something — clear review flag, let extractor guide
      delete a._v3_review_shown;
      const reply = "What would you like to change?";
      await saveState(userId, state);
      await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
      appendHistory(a, text, reply);
      return { handled: true, reply };
    }
    // Unknown — re-show review card
    const card = buildReviewCard(a);
    await addToShortTerm(platformChatId, card, { role: "assistant", intent: "intake", emotion: "neutral" });
    return { handled: true, reply: card };
  }

  // ── Gate 3: All required fields already collected → show review ──────────────
  if (allRequiredCollected(a) && !a._v3_review_shown) {
    const card = buildReviewCard(a);
    a._v3_review_shown = "true";
    state.currentStep  = "review";
    await saveState(userId, state);
    await addToShortTerm(platformChatId, card, { role: "assistant", intent: "intake", emotion: "neutral" });
    appendHistory(a, text, card);
    return { handled: true, reply: card };
  }

  // ── OpenAI extraction ────────────────────────────────────────────────────────

  const history   = loadHistory(a);
  const missingFields = REQUIRED_FIELDS.filter(f => !a[f]?.trim());
  const stallCounts   = Object.fromEntries(
    missingFields.map(f => [f, state.repeatCounts[f] ?? 0])
  );

  const extraction = await extractOnboardingFacts({
    message:           text,
    profile:           Object.fromEntries(Object.entries(a).filter(([k]) => !k.startsWith("_"))),
    missingFields,
    stallCounts,
    history,
    emotionalTone:      a._v3_emotional_tone      ?? "neutral",
    communicationStyle: a._v3_communication_style ?? "conversational",
  });

  // ── Process extracted fields ─────────────────────────────────────────────────

  let conflictReply: string | null = null;

  for (const [field, { value, confidence }] of Object.entries(extraction.extracted)) {
    if (confidence < 0.60) continue;  // skip low-confidence extractions

    const canonical = normalizeWithParser(field, value);
    if (!canonical) continue;

    // Conflict check for high-stakes fields
    if (CONFLICT_FIELDS.has(field) && a[field] && a[field] !== canonical) {
      conflictReply = `You said ${field === "gym_goal" ? "goal" : field} was "${a[field]}" before — now you're saying "${canonical}". Which one should I keep?`;
      continue;  // don't overwrite; wait for confirmation
    }

    // Store
    const keys = storageKeysFor(field, canonical);
    Object.assign(a, keys);
  }

  // ── Update style / tone metadata ─────────────────────────────────────────────

  a._v3_communication_style = extraction.communicationStyle;
  a._v3_emotional_tone      = extraction.emotionalTone;

  // ── Handle split generation request ─────────────────────────────────────────

  if (extraction.splitGenerationRequested && !a.current_split) {
    const splitDisplay = triggerSplitGeneration(state);
    state.currentStep  = computeCurrentStep(a);
    await saveState(userId, state);
    await addToShortTerm(platformChatId, splitDisplay, { role: "assistant", intent: "intake", emotion: "neutral" });
    appendHistory(a, text, splitDisplay);
    return { handled: true, reply: splitDisplay };
  }

  // ── Check if all required fields collected after this extraction ─────────────

  if (allRequiredCollected(a) && !a._v3_review_shown) {
    const card = buildReviewCard(a);
    a._v3_review_shown = "true";
    state.currentStep  = "review";
    await saveState(userId, state);
    await addToShortTerm(platformChatId, card, { role: "assistant", intent: "intake", emotion: "neutral" });
    appendHistory(a, text, card);
    return { handled: true, reply: card };
  }

  // ── Logical inconsistency — show once ────────────────────────────────────────

  let reply = conflictReply ?? extraction.reply;

  if (extraction.logicalInconsistency && !a._v3_inconsistency_shown) {
    a._v3_inconsistency_shown = "true";
    reply = `${extraction.logicalInconsistency}\n\n${reply}`;
  }

  // ── Stall tracking ───────────────────────────────────────────────────────────

  if (extraction.nextField && !a[extraction.nextField]) {
    state.repeatCounts[extraction.nextField] = (state.repeatCounts[extraction.nextField] ?? 0) + 1;
  }

  // ── Update V2-compatible currentStep for rollback ────────────────────────────

  state.currentStep = computeCurrentStep(a);

  // ── Persist and return ───────────────────────────────────────────────────────

  appendHistory(a, text, reply);
  await saveState(userId, state);
  await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
  return { handled: true, reply };
}
