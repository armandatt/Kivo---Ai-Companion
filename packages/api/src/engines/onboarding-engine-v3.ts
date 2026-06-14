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

import { prisma }               from "@repo/db/client";
import { addToShortTerm }       from "../services/memory.service";
import { generateOpenAIText }   from "../services/openai.service";
import {
  type OnboardingState,
  type StepId,
  loadState,
  saveState,
  initState,
  finalizeIntake,
  generateSplit,
  buildWelcomeMessage,
  buildOnboardingCompleteMessage,
  parseName,
  parseGoal,
  parseExperience,
  parseDays,
  parseGymTime,
  parseProtein,
  parseInjury,
  parseSplit,
} from "./onboarding-engine-v2";
import { extractOnboardingFacts } from "./onboarding-extractor";

// ── Required fields — must all be collected before review ─────────────────────
//
// IMPORTANT: This list must stay in sync with:
//   1. buildReviewCard() in onboarding-engine-v2.ts — fields it renders with "—"
//   2. The REQUIRED FIELDS section of onboarding-extractor.ts system prompt
//   3. REQUIRED_FIELD_TO_STEP below for V2 rollback compatibility
//
// current_bodyweight_kg and height_cm are marked body_stats: true in V2's
// STEP_REQUIRED table. They were accidentally omitted from V3's required list,
// which caused the review card to appear while Bodyweight and Height showed "—".
const REQUIRED_FIELDS: string[] = [
  "name",
  "gym_goal",
  "current_bodyweight_kg",   // body_stats — V2 required, must collect before review
  "height_cm",               // body_stats — V2 required, must collect before review
  "training_experience",
  "available_training_days",
  "current_split",
  "gym_session_time",
  "daily_protein_g",         // protein — check protein_status too (not_tracking case stores no grams)
  "injury_notes",            // injury — "none" is a valid answer
];

// Maps required field names to the equivalent V2 step for rollback compatibility.
// V2 uses currentStep to resume; keeping it updated means V3→V2 rollback works.
const REQUIRED_FIELD_TO_STEP: Array<{ field: string; step: StepId }> = [
  { field: "name",                    step: "name"       },
  { field: "gym_goal",                step: "goal"       },
  { field: "current_bodyweight_kg",   step: "body_stats" },
  { field: "height_cm",               step: "body_stats" },
  { field: "training_experience",     step: "experience" },
  { field: "available_training_days", step: "days"       },
  { field: "current_split",           step: "split"      },
  { field: "gym_session_time",        step: "gym_time"   },
  { field: "daily_protein_g",         step: "protein"    },
  { field: "injury_notes",            step: "injury"     },
];

// Protein is answered as "not_tracking" — storageKeysFor sets protein_status but NOT daily_protein_g.
// Check protein_status as fallback so "not tracking" doesn't count as missing.
function isFieldCollected(field: string, answers: Record<string, string>): boolean {
  if (field === "daily_protein_g") {
    return !!(answers["daily_protein_g"]?.trim() || answers["protein_status"]?.trim());
  }
  return !!answers[field]?.trim();
}

export function computeCurrentStep(answers: Record<string, string>): StepId {
  for (const { field, step } of REQUIRED_FIELD_TO_STEP) {
    if (!isFieldCollected(field, answers)) return step;
  }
  return "review";
}

function allRequiredCollected(answers: Record<string, string>): boolean {
  return REQUIRED_FIELDS.every(f => isFieldCollected(f, answers));
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
        // Only trust the canonical mapping (PPL, Upper/Lower, etc.) when parseSplit matched a
        // named split template. For partial or custom splits ("Back/Tri, Legs/Shoulders, Chest/Bi"),
        // parseSplit correctly detects muscles but incorrectly maps them to PPL via hasPush+hasPull+hasLegs.
        // In those cases, preserve the raw value so the custom split name isn't silently overwritten.
        if (r.parserReason === "known_split") return r.extractedValue ?? rawValue;
        return rawValue;
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

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

// Internal type — mirrors V2's non-exported GeneratedSplitOutput
interface SplitOutput { splitType: string; lines: string[]; splitDaysJson: string; }

// OpenAI-powered split generator — used when the user has a structural preference
// or when they rejected the template and want something different.
async function buildCustomSplit(
  days:              number,
  goal:              string,
  preference:        string,
  previousSplitType: string | null,
): Promise<SplitOutput> {
  const system = `You are a strength training program designer.
Generate a ${days}-day weekly training split.
Goal: ${goal}
User preference: ${preference}${previousSplitType ? `\nPreviously shown (do NOT repeat this structure): ${previousSplitType}` : ""}

Return ONLY compact JSON — no markdown, no explanation outside the JSON:
{"splitType":"<short descriptive name>","days":["<Day 1 muscle groups>","<Day 2>",...]}\n(exactly ${days} entries in the days array)

Each day entry: 1–3 muscle groups, comma-separated. Honor the user preference exactly.`;

  try {
    const raw = await generateOpenAIText({
      model:           "gpt-4o-mini",
      maxOutputTokens: 200,
      systemInstruction: system,
      prompt:          "Generate the split.",
    });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no json");
    const json = JSON.parse(match[0]) as { splitType?: string; days?: string[] };
    const daySlots = (Array.isArray(json.days) ? json.days : []).slice(0, days) as string[];
    if (daySlots.length < days) throw new Error("not enough days");
    return {
      splitType:     json.splitType ?? "Custom",
      lines:         daySlots.map((m, i) => `${WEEKDAYS[i]} — ${m}`),
      splitDaysJson: JSON.stringify(daySlots),
    };
  } catch {
    // Fallback to V2 template if OpenAI fails
    return generateSplit(days, goal);
  }
}

async function triggerSplitGeneration(state: OnboardingState): Promise<string> {
  const days = parseInt(state.answers.available_training_days ?? "4") || 4;
  const goal = state.answers.gym_goal ?? "muscle";

  // Store the days count so available_training_days is not missing after the
  // split is confirmed. Without this the field stays in REQUIRED_FIELDS and V3
  // continues asking for it even though the split was already built around it.
  if (!state.answers.available_training_days) {
    state.answers.available_training_days = String(days);
  }

  const preference    = state.answers._split_preference ?? null;
  const attemptCount  = parseInt(state.answers._split_attempt_count ?? "1");
  const lastSplitType = state.answers._last_split_type ?? null;
  const useCustom     = !!(preference || attemptCount > 1);

  console.log("[SPLIT_AUDIT]", JSON.stringify({
    extractedPreference:    preference,
    storedPreference:       preference,
    preferenceAtGeneration: preference,
    attemptCount,
    lastSplitType,
    generatorUsed:          useCustom ? "buildCustomSplit" : "V2_template",
    days,
    goal,
  }));

  // Use custom OpenAI generation when: user gave a structural preference,
  // OR this is a re-generation after rejection (attempt > 1) — rotate away from previous template.
  const gen: SplitOutput = useCustom
    ? await buildCustomSplit(days, goal, preference ?? "a different structure", lastSplitType)
    : generateSplit(days, goal);

  console.log("[SPLIT_AUDIT]", JSON.stringify({
    generatedSplitType: gen.splitType,
    lines:              gen.lines,
  }));

  // Remember what was shown for rotation on next rejection
  state.answers._last_split_type = gen.splitType;

  const inner = `Here's your ${days}-day split:\n\n${gen.lines.join("\n")}\n\nGood with this, or want changes?`;
  state.pendingGeneratedSplit = { splitType: gen.splitType, displayText: inner, splitDaysJson: gen.splitDaysJson };
  state.answers._pending_split_display = inner;
  return inner;
}

// ── Rex-voice review card ─────────────────────────────────────────────────────
//
// V3-specific replacement for V2's buildReviewCard(). V2's version ends with
// "Looks right? (yes / no)" which reads like a form. Rex presents the profile
// as a coaching summary and invites correction without using yes/no prompts.

function buildReviewCardRex(a: Record<string, string>): string {
  const lines: string[] = [
    `Here's what I've got on you:`,
    ``,
    `Name: ${a.name ?? "—"}`,
    `Goal: ${a.gym_goal ?? "—"}`,
    `Bodyweight: ${a.current_bodyweight_kg ? `${a.current_bodyweight_kg}kg` : "—"}`,
    `Height: ${a.height_cm ? `${a.height_cm}cm` : "—"}`,
    `Experience: ${a.training_experience ?? "—"}`,
    `Training days: ${a.available_training_days ?? "—"}`,
    `Split: ${a.current_split ?? "—"}`,
    `Gym time: ${a.gym_session_time ?? "—"}`,
    `Protein: ${a.daily_protein_g ? `${a.daily_protein_g}g/day` : a.protein_status === "not_tracking" ? "not tracking" : "—"}`,
    `Injuries: ${a.injury_notes ?? "none"}`,
    ``,
    `Anything off? Tell me what to fix. Otherwise say the word and I'll lock it in.`,
  ];
  return lines.join("\n");
}

// ── Field change acknowledgment ───────────────────────────────────────────────

const FIELD_DISPLAY: Record<string, string> = {
  name:                    "Name",
  gym_goal:                "Goal",
  current_bodyweight_kg:   "Weight",
  height_cm:               "Height",
  training_experience:     "Experience",
  available_training_days: "Training days",
  current_split:           "Split",
  gym_session_time:        "Gym time",
  daily_protein_g:         "Protein",
  injury_notes:            "Injuries",
};

function formatFieldValue(field: string, val: string): string {
  if (field === "current_bodyweight_kg") return `${val}kg`;
  if (field === "height_cm")             return `${val}cm`;
  if (field === "daily_protein_g")       return `${val}g/day`;
  return val;
}

function buildFieldAck(before: Record<string, string>, after: Record<string, string>): string {
  const changed = Object.keys(FIELD_DISPLAY).filter(
    f => after[f] && after[f] !== before[f]
  );
  if (changed.length === 0) return "";
  if (changed.length === 1) {
    const f = changed[0]!;
    return `Got it — updated your ${FIELD_DISPLAY[f]!.toLowerCase()} to ${formatFieldValue(f, after[f]!)}.`;
  }
  const lines = changed.map(f => `• ${FIELD_DISPLAY[f]} → ${formatFieldValue(f, after[f]!)}`);
  return `Updated:\n${lines.join("\n")}`;
}

// ── Audit logging ────────────────────────────────────────────────────────────

function v3log(tag: string, data: Record<string, unknown>): void {
  console.log(`[V3-AUDIT] ${tag}`, JSON.stringify(data));
}

// ── V2→V3 migration guard (exported for testing) ─────────────────────────────
//
// Called at the top of every V3 turn. Cleans up V2 artifacts and takes
// authoritative ownership of currentStep and repeatCounts.
export function applyV3StateMigration(state: OnboardingState): void {
  const a = state.answers;

  // Fix 1: pendingVerification — V3 never uses it; clear to prevent V2 re-verification.
  if (state.pendingVerification) {
    state.pendingVerification = null;
  }

  // Fix 2: pendingPartialSplit — V3 extracts the full split in one shot; clear the accumulator.
  if (state.pendingPartialSplit) {
    state.pendingPartialSplit = null;
  }

  // Fix 3: V2 sets currentStep="review" when done; V3 uses _v3_review_shown. Bridge them.
  if (state.currentStep === "review" && a._v3_review_shown !== "true") {
    a._v3_review_shown = "true";
  }

  // Fix 4: repeatCounts keys. V2 uses StepIds ("split", "goal", "gym_time", …).
  //        V3 uses field names ("current_split", "gym_goal", "gym_session_time", …).
  //        Strip non-REQUIRED_FIELDS keys so the extractor never sees phantom stall counts.
  const validRepeatKeys = new Set(REQUIRED_FIELDS);
  for (const key of Object.keys(state.repeatCounts)) {
    if (!validRepeatKeys.has(key)) {
      delete state.repeatCounts[key];
    }
  }

  // Fix 5: V3 is sole owner of currentStep. Recompute from answers before any gate.
  state.currentStep = computeCurrentStep(a);
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

  applyV3StateMigration(state);

  const a = state.answers;

  v3log("TURN_START", { userId, msg: text.slice(0, 120), currentStep: state.currentStep });

  // ── persist helper ────────────────────────────────────────────────────────────
  const persist = async (reply: string) => {
    state!.currentStep = computeCurrentStep(a);
    appendHistory(a, text, reply);
    await saveState(userId, state!);
    await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
  };

  // ── OpenAI extraction — runs first, always ───────────────────────────────────

  const history       = loadHistory(a);
  const missingFields = REQUIRED_FIELDS.filter(f => !isFieldCollected(f, a));
  const stallCounts   = Object.fromEntries(
    missingFields.map(f => [f, state.repeatCounts[f] ?? 0])
  );

  v3log("PRE_EXTRACTION", {
    missingFields,
    stallCounts,
    profileKeys: Object.keys(a).filter(k => !k.startsWith("_")),
  });

  const extraction = await extractOnboardingFacts({
    message:            text,
    profile:            Object.fromEntries(Object.entries(a).filter(([k]) => !k.startsWith("_"))),
    missingFields,
    stallCounts,
    history,
    emotionalTone:      a._v3_emotional_tone      ?? "neutral",
    communicationStyle: a._v3_communication_style ?? "conversational",
  });

  v3log("EXTRACTION_RESULT", {
    extracted:                extraction.extracted,
    intent:                   extraction.intent,
    targetField:              extraction.targetField,
    confirmationConfidence:   extraction.confirmationConfidence,
    conflictDetected:         extraction.conflictDetected,
    conflictField:            extraction.conflictField,
    previousValue:            extraction.previousValue,
    newValue:                 extraction.newValue,
    splitGenerationRequested: extraction.splitGenerationRequested,
    splitPreference:          extraction.splitPreference,
    nextField:                extraction.nextField,
    logicalInconsistency:     extraction.logicalInconsistency,
    communicationStyle:       extraction.communicationStyle,
    emotionalTone:            extraction.emotionalTone,
    done:                     extraction.done,
    reply:                    extraction.reply.slice(0, 120),
  });

  // ── Apply extracted fields — no conflict guard ───────────────────────────────

  const profileBefore = { ...a };

  for (const [field, { value, confidence }] of Object.entries(extraction.extracted)) {
    if (field === "current_split" && (extraction.splitGenerationRequested || a._v3_waiting_split_feedback === "true")) {
      v3log("FIELD_SKIP", { field, value, reason: extraction.splitGenerationRequested ? "splitGenerationRequested=true — split set by generation path" : "waiting_split_feedback — value captured as preference" });
      continue;
    }
    if (confidence < 0.60) {
      v3log("FIELD_SKIP", { field, value, confidence, reason: "low_confidence (<0.60)" });
      continue;
    }
    const canonical = normalizeWithParser(field, value);
    if (!canonical) {
      v3log("FIELD_SKIP", { field, rawValue: value, confidence, reason: "normalizeWithParser returned null" });
      continue;
    }
    const keys = storageKeysFor(field, canonical);
    Object.assign(a, keys);
    v3log("FIELD_STORED", { field, rawValue: value, canonical, confidence, storedKeys: Object.keys(keys) });
  }

  const added:   string[] = [];
  const updated: string[] = [];
  for (const [k, v] of Object.entries(a)) {
    if (k.startsWith("_")) continue;
    if (!(k in profileBefore))        added.push(k);
    else if (profileBefore[k] !== v)  updated.push(k);
  }
  v3log("PROFILE_DIFF", { added, updated, missingAfter: REQUIRED_FIELDS.filter(f => !a[f]?.trim()) });

  // ── Update style / tone metadata ─────────────────────────────────────────────

  a._v3_communication_style = extraction.communicationStyle;
  a._v3_emotional_tone      = extraction.emotionalTone;

  // ── Awaiting split feedback — consume response and regenerate ────────────────
  //
  // Set when the user rejected a split with no preference embedded. The next
  // non-question message is treated as split feedback regardless of intent.

  if (a._v3_waiting_split_feedback === "true") {
    if (
      extraction.intent === "question_about_profile" ||
      extraction.intent === "question_about_onboarding"
    ) {
      // Answer the question, keep waiting
      const reply = `${extraction.reply}\n\nWhat would you like changed in the split?`;
      await persist(reply);
      return { handled: true, reply };
    }

    delete a._v3_waiting_split_feedback;

    // Capture preference: extractor splitPreference field → extracted split value → raw text fallback
    const splitFeedback =
      extraction.splitPreference ??
      extraction.extracted.current_split?.value ??
      text.slice(0, 200);
    a._split_preference    = splitFeedback;
    a._split_attempt_count = String((parseInt(a._split_attempt_count ?? "0")) + 1);

    v3log("SPLIT_FEEDBACK_CONSUMED", { splitFeedback, attempt: a._split_attempt_count });

    const splitDisplay = await triggerSplitGeneration(state);
    await persist(splitDisplay);
    return { handled: true, reply: splitDisplay };
  }

  // ── Gate 1: Pending split confirmation — intent-dispatched ──────────────────

  if (state.pendingGeneratedSplit) {
    const isConfirm = extraction.intent === "confirm_profile" && extraction.confirmationConfidence >= 0.75;
    const isReject  = extraction.intent === "reject_profile";
    const isModify  = extraction.intent === "correction_with_data" && extraction.splitGenerationRequested;

    v3log("GATE_SPLIT_CONFIRM", {
      intent:                 extraction.intent,
      confirmationConfidence: extraction.confirmationConfidence,
      isConfirm, isReject, isModify,
    });

    if (isConfirm) {
      const g = state.pendingGeneratedSplit;
      a.current_split   = g.splitType;
      a.split_raw       = "rex_built";
      a.split_days_json = g.splitDaysJson;
      state.pendingGeneratedSplit = null;
      delete a._pending_split_display;
      v3log("SPLIT_CONFIRMED", { storedAs: a.current_split });
      // Fall through to check if all required fields now collected
    } else if (isModify) {
      // correction_with_data + splitGenerationRequested — preference embedded in message
      a._last_split_type = state.pendingGeneratedSplit.splitType;
      if (extraction.splitPreference) a._split_preference = extraction.splitPreference;
      state.pendingGeneratedSplit = null;
      delete a._pending_split_display;
      a._split_attempt_count = String((parseInt(a._split_attempt_count ?? "0")) + 1);
      const splitDisplay = await triggerSplitGeneration(state);
      await persist(splitDisplay);
      return { handled: true, reply: splitDisplay };
    } else if (isReject) {
      a._last_split_type = state.pendingGeneratedSplit.splitType;
      state.pendingGeneratedSplit = null;
      delete a._pending_split_display;
      if (extraction.splitPreference) {
        // Preference already provided — regenerate immediately
        a._split_preference    = extraction.splitPreference;
        a._split_attempt_count = String((parseInt(a._split_attempt_count ?? "0")) + 1);
        const splitDisplay = await triggerSplitGeneration(state);
        await persist(splitDisplay);
        return { handled: true, reply: splitDisplay };
      }
      // No preference — ask what they want before regenerating
      a._v3_waiting_split_feedback = "true";
      const reply = `Got it. What would you like changed?\n\nMore volume?\nDifferent structure?\nDifferent muscle grouping?\nSomething else?`;
      await persist(reply);
      return { handled: true, reply };
    } else if (extraction.intent === "correction_with_data") {
      // Named split already applied above — clear pending and fall through
      state.pendingGeneratedSplit = null;
      delete a._pending_split_display;
    } else if (
      extraction.intent === "question_about_profile" ||
      extraction.intent === "question_about_onboarding" ||
      extraction.intent === "frustration"
    ) {
      // Answer / acknowledge, then re-show the split so they can still decide
      const reply = `${extraction.reply}\n\n${state.pendingGeneratedSplit.displayText}`;
      await persist(reply);
      return { handled: true, reply };
    } else if (extraction.intent === "answer") {
      // Field data already applied above — acknowledge and re-show split
      const splitPart = state.pendingGeneratedSplit.displayText;
      const reply = extraction.reply
        ? `${extraction.reply}\n\n${splitPart}`
        : `${splitPart}\n\nGood with this, or want changes?`;
      await persist(reply);
      return { handled: true, reply };
    } else {
      // offtopic or unclassified — re-show split
      const reply = `${state.pendingGeneratedSplit.displayText}\n\nGood with this, or want changes?`;
      await persist(reply);
      return { handled: true, reply };
    }
  }

  // ── Gate 2: Review state — intent-dispatched ─────────────────────────────────

  if (a._v3_review_shown === "true") {
    const reviewCard = buildReviewCardRex(a);
    const isConfirm  = extraction.intent === "confirm_profile" && extraction.confirmationConfidence >= 0.75;

    v3log("GATE_REVIEW", {
      intent:                 extraction.intent,
      confirmationConfidence: extraction.confirmationConfidence,
      targetField:            extraction.targetField,
      isConfirm,
    });

    if (isConfirm) {
      state.completedAt = Date.now();
      state.currentStep = "review";
      await saveState(userId, state);
      await finalizeIntake(userId, platformChatId, state);
      const done = buildOnboardingCompleteMessage(a);
      await addToShortTerm(platformChatId, done, { role: "assistant", intent: "intake", emotion: "neutral" });
      return { handled: true, reply: done };
    }

    if (extraction.intent === "reject_profile") {
      delete a._v3_review_shown;
      // Clear the specific rejected field so V3 re-asks it rather than treating old value as valid
      if (extraction.targetField && extraction.targetField in a) {
        delete (a as Record<string, string>)[extraction.targetField];
        // If split is rejected, also clear derived split fields
        if (extraction.targetField === "current_split") {
          delete a.split_raw;
          delete a.split_days_json;
        }
      }
      const reply = extraction.reply;
      await persist(reply);
      return { handled: true, reply };
    }

    if (
      (extraction.intent === "correction_with_data" || extraction.intent === "answer") &&
      extraction.splitGenerationRequested
    ) {
      delete a.current_split;
      delete a.split_raw;
      delete a.split_days_json;
      delete a._v3_review_shown;
      if (extraction.splitPreference) a._split_preference = extraction.splitPreference;
      a._split_attempt_count = String((parseInt(a._split_attempt_count ?? "0")) + 1);
      const splitDisplay = await triggerSplitGeneration(state);
      await persist(splitDisplay);
      return { handled: true, reply: splitDisplay };
    }

    if (extraction.intent === "correction_with_data" || extraction.intent === "answer") {
      const ack         = buildFieldAck(profileBefore, a);
      const updatedCard = buildReviewCardRex(a);
      a._v3_review_shown = "true";
      const reply = ack ? `${ack}\n\n${updatedCard}` : updatedCard;
      await persist(reply);
      return { handled: true, reply };
    }

    // question_about_profile, question_about_onboarding, frustration, or default:
    // Answer the question then re-show the card
    const reply = `${extraction.reply}\n\n${reviewCard}`;
    await persist(reply);
    return { handled: true, reply };
  }

  // ── Handle split generation request ─────────────────────────────────────────

  if (extraction.splitGenerationRequested && !a.current_split) {
    if (extraction.splitPreference) a._split_preference = extraction.splitPreference;
    a._split_attempt_count = String((parseInt(a._split_attempt_count ?? "0")) + 1);

    console.log("[SPLIT_AUDIT] HANDLER_TRIGGER", JSON.stringify({
      extractedPreference:      extraction.splitPreference,
      storedPreference:         a._split_preference ?? null,
      currentSplitBeforeGen:    a.current_split ?? null,
      splitGenerationRequested: extraction.splitGenerationRequested,
      attempt:                  a._split_attempt_count,
      available_training_days:  a.available_training_days ?? "NOT_SET — defaulting to 4",
      gym_goal:                 a.gym_goal ?? "NOT_SET — defaulting to muscle",
    }));

    const splitDisplay = await triggerSplitGeneration(state);
    await persist(splitDisplay);
    return { handled: true, reply: splitDisplay };
  }

  // ── Check if all required fields collected → show review card ────────────────

  if (allRequiredCollected(a) && !a._v3_review_shown) {
    v3log("REVIEW_CARD", { reason: "all required fields collected after extraction", fields: Object.fromEntries(REQUIRED_FIELDS.map(f => [f, a[f]])) });
    const card = buildReviewCardRex(a);
    a._v3_review_shown = "true";
    state.currentStep  = "review";
    await saveState(userId, state);
    await addToShortTerm(platformChatId, card, { role: "assistant", intent: "intake", emotion: "neutral" });
    appendHistory(a, text, card);
    return { handled: true, reply: card };
  }

  // ── Logical inconsistency — show once ────────────────────────────────────────

  let reply = extraction.reply;

  if (extraction.logicalInconsistency && !a._v3_inconsistency_shown) {
    a._v3_inconsistency_shown = "true";
    reply = `${extraction.logicalInconsistency}\n\n${reply}`;
    v3log("INCONSISTENCY_SHOWN", { note: extraction.logicalInconsistency.slice(0, 120) });
  }

  // ── Stall tracking ───────────────────────────────────────────────────────────

  if (extraction.nextField && !a[extraction.nextField]) {
    const newCount = (state.repeatCounts[extraction.nextField] ?? 0) + 1;
    state.repeatCounts[extraction.nextField] = newCount;
    v3log("STALL_TRACKED", {
      field: extraction.nextField,
      count: newCount,
      why: "extractor said this is nextField and it is still missing in profile",
      note: newCount === 1 ? "first increment on first ask — stall-2 triggers on SECOND ask, not third" : undefined,
    });
  }

  // ── Persist and return ───────────────────────────────────────────────────────

  v3log("TURN_END", {
    reply:         reply.slice(0, 120),
    nextField:     extraction.nextField,
    currentStep:   computeCurrentStep(a),
    missingFields: REQUIRED_FIELDS.filter(f => !isFieldCollected(f, a)),
    replySource:   "extractor_reply",
  });

  await persist(reply);
  return { handled: true, reply };
}
