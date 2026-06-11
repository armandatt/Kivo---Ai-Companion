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
  classifyConfirmation,
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

// ── Review response classifier ────────────────────────────────────────────────
//
// Wraps classifyConfirmation with Rex-specific affirmation phrases. AFFIRM_RE in
// the parsing engine doesn't include coaching idioms ("solid", "lock it in", etc.)
// because those are Rex-specific. Handling them here keeps the parser general.

const REX_REVIEW_AFFIRM_RE = /^(?:solid|save\s+it|lock(?:\s+it)?(?:\s+in)?|ship\s+it|we(?:'re)?\s+good|that'?s\s+(?:fine|good|right|it)|done\s+deal|all\s+(?:good|solid|set)|good\s+to\s+go|let'?s\s+(?:lock|go|do\s+it))\.?!?$/i;

function classifyReviewResponse(text: string, card: string): "yes" | "no" | "modify" | "unclear" {
  const base = classifyConfirmation(text, card);
  if (base !== "unclear") return base;
  if (REX_REVIEW_AFFIRM_RE.test(text.trim())) return "yes";
  return "unclear";
}

// ── Audit logging ────────────────────────────────────────────────────────────

function v3log(tag: string, data: Record<string, unknown>): void {
  console.log(`[V3-AUDIT] ${tag}`, JSON.stringify(data));
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

  v3log("TURN_START", { userId, msg: text.slice(0, 120), currentStep: state.currentStep });

  // ── Gate 1: Pending split confirmation ──────────────────────────────────────
  if (state.pendingGeneratedSplit) {
    // classifyConfirmation handles natural phrasing ("looks good", "perfect"),
    // modification keywords (swap/change/adjust), and bare rejections.
    // DENY_RE is anchored so it misses "no I want two body parts per day" —
    // add a leading-"no" check to catch rejection-with-embedded-preference.
    const splitConfirmCls = classifyConfirmation(text, state.pendingGeneratedSplit.displayText);
    const leadingNo = /^no[,\s!.]/i.test(text.trim());
    const effectiveCls = (splitConfirmCls === "unclear" && leadingNo) ? "no" : splitConfirmCls;

    v3log("GATE_SPLIT_CONFIRM", {
      decision:       effectiveCls,
      classifyResult: splitConfirmCls,
      leadingNo,
      normalizedMsg:  text.toLowerCase().trim().slice(0, 80),
    });

    if (effectiveCls === "yes") {
      const g = state.pendingGeneratedSplit;
      a.current_split   = g.splitType;
      a.split_raw       = "rex_built";
      a.split_days_json = g.splitDaysJson;
      state.pendingGeneratedSplit = null;
      delete a._pending_split_display;
      v3log("SPLIT_CONFIRMED", { storedAs: a.current_split });
      // Fall through to check if all required fields now collected
    } else if (effectiveCls === "no" || effectiveCls === "modify") {
      // Save what was shown so triggerSplitGeneration can avoid repeating it
      a._last_split_type = state.pendingGeneratedSplit.splitType;
      state.pendingGeneratedSplit = null;
      delete a._pending_split_display;
      // Do NOT return — fall through so the extractor processes any preference
      // embedded in the message (e.g. "no I want two body parts per day")
    } else {
      // Genuinely unclear (short/ambiguous message) — re-show split
      const reply = `${state.pendingGeneratedSplit.displayText}\n\nSay yes to keep it, or no to change.`;
      await saveState(userId, state);
      await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
      return { handled: true, reply };
    }
  }

  // ── Gate 2: Review confirmation ──────────────────────────────────────────────
  if (a._v3_review_shown === "true") {
    const reviewCard = buildReviewCardRex(a);
    const reviewCls  = classifyReviewResponse(text, reviewCard);

    if (reviewCls === "yes") {
      state.completedAt = Date.now();
      state.currentStep = "review";
      await saveState(userId, state);
      await finalizeIntake(userId, platformChatId, state);
      const done = `You're all set, ${a.name ?? "Athlete"}.\n\nI've got everything I need. Let's build something.`;
      await addToShortTerm(platformChatId, done, { role: "assistant", intent: "intake", emotion: "neutral" });
      return { handled: true, reply: done };
    }
    if (reviewCls === "no" || reviewCls === "modify") {
      delete a._v3_review_shown;
      // Gate 3 (pre-extraction) checks allRequiredCollected and fires if true.
      // After a review rejection all required fields ARE set, so without this
      // flag the very next user message would hit Gate 3 and re-show the review
      // card before the extractor ever sees it. _v3_awaiting_correction bypasses
      // Gate 3 for the correction turn and is cleared once extraction runs.
      a._v3_awaiting_correction = "true";
      const reply = "What would you like to change?";
      await saveState(userId, state);
      await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
      appendHistory(a, text, reply);
      return { handled: true, reply };
    }
    // Unclear — re-show review card
    await addToShortTerm(platformChatId, reviewCard, { role: "assistant", intent: "intake", emotion: "neutral" });
    return { handled: true, reply: reviewCard };
  }

  // ── Gate 3: All required fields already collected → show review ──────────────
  // _v3_awaiting_correction bypasses this gate: user just said "no" on the review
  // and the next message is their correction request — it must reach the extractor,
  // not hit Gate 3 and re-show the review card before anything is processed.
  const missingForReview = REQUIRED_FIELDS.filter(f => !a[f]?.trim());
  const reviewAllowed    = missingForReview.length === 0 && !a._v3_awaiting_correction;

  console.log("[REVIEW_AUDIT] PRE_REVIEW_GATE", JSON.stringify({
    missingFields:       missingForReview,
    awaitingCorrection:  a._v3_awaiting_correction === "true",
    reviewShown:         a._v3_review_shown === "true",
    reviewAllowed,
  }));

  if (reviewAllowed && !a._v3_review_shown) {
    const card = buildReviewCardRex(a);
    a._v3_review_shown = "true";
    state.currentStep  = "review";
    await saveState(userId, state);
    await addToShortTerm(platformChatId, card, { role: "assistant", intent: "intake", emotion: "neutral" });
    appendHistory(a, text, card);
    return { handled: true, reply: card };
  }

  // ── OpenAI extraction ────────────────────────────────────────────────────────

  // Clear the correction flag now that this turn will be processed by the extractor.
  // The flag only needs to survive a single turn (the one immediately after review
  // rejection). Clearing here ensures Gate 3 works normally on subsequent turns.
  if (a._v3_awaiting_correction) {
    delete a._v3_awaiting_correction;
    console.log("[REVIEW_AUDIT] CHANGE_REQUEST", JSON.stringify({
      requestedChange:    text.slice(0, 120),
      awaitingCorrection: true,
      note:               "Correction turn — Gate 3 was bypassed, extraction running",
    }));
  }

  const history   = loadHistory(a);
  const missingFields = REQUIRED_FIELDS.filter(f => !a[f]?.trim());
  const stallCounts   = Object.fromEntries(
    missingFields.map(f => [f, state.repeatCounts[f] ?? 0])
  );

  v3log("PRE_EXTRACTION", {
    missingFields,
    stallCounts,
    profileKeys: Object.keys(a).filter(k => !k.startsWith("_")),
    note: "missingFields snapshot is pre-extraction — extractor reply may re-ask a field captured this same turn",
  });

  const extraction = await extractOnboardingFacts({
    message:           text,
    profile:           Object.fromEntries(Object.entries(a).filter(([k]) => !k.startsWith("_"))),
    missingFields,
    stallCounts,
    history,
    emotionalTone:      a._v3_emotional_tone      ?? "neutral",
    communicationStyle: a._v3_communication_style ?? "conversational",
  });

  v3log("EXTRACTION_RESULT", {
    extracted:                extraction.extracted,
    intent:                   extraction.intent,
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

  // ── Process extracted fields ─────────────────────────────────────────────────

  // Hardcoded conflict strings were removed. The extractor's conflict detection
  // generates a coaching-style reply. The handler still enforces "don't overwrite"
  // for high-stakes fields as a safety check. If the extractor missed a conflict,
  // extraction.reply still contextually fits (it'll ask for the next missing field,
  // and the unchanged value will show on the review card for correction).
  let handlerSkippedConflict = false;
  const profileBefore = { ...a };

  for (const [field, { value, confidence }] of Object.entries(extraction.extracted)) {
    // If the extractor is requesting split generation it must NOT also store a
    // current_split value from extraction — that would set a.current_split and
    // cause the generation guard (!a.current_split) to fail silently, leaving
    // the user with whatever name the extractor guessed (e.g. "Bro Split")
    // instead of an actually generated split.
    if (field === "current_split" && extraction.splitGenerationRequested) {
      v3log("FIELD_SKIP", { field, value, reason: "splitGenerationRequested=true — split will be set by generation path, not from extractor label" });
      continue;
    }

    if (confidence < 0.60) {
      v3log("FIELD_SKIP", { field, value, confidence, reason: "low_confidence (<0.60)" });
      continue;
    }

    const canonical = normalizeWithParser(field, value);
    if (!canonical) {
      v3log("FIELD_SKIP", { field, rawValue: value, confidence, reason: "normalizeWithParser returned null — V2 parser rejected value" });
      continue;
    }

    if (CONFLICT_FIELDS.has(field) && a[field] && a[field] !== canonical) {
      handlerSkippedConflict = true;
      v3log("FIELD_CONFLICT", { field, existing: a[field], proposed: canonical, extractorDetected: extraction.conflictDetected, action: "skipped — extractor reply handles it" });
      continue;
    }

    const keys = storageKeysFor(field, canonical);
    Object.assign(a, keys);
    v3log("FIELD_STORED", { field, rawValue: value, canonical, confidence, storedKeys: Object.keys(keys) });
  }

  // Profile diff
  const added:   string[] = [];
  const updated: string[] = [];
  for (const [k, v] of Object.entries(a)) {
    if (k.startsWith("_")) continue;
    if (!(k in profileBefore))            added.push(k);
    else if (profileBefore[k] !== v)      updated.push(k);
  }
  v3log("PROFILE_DIFF", {
    added,
    updated,
    missingAfter: REQUIRED_FIELDS.filter(f => !a[f]?.trim()),
  });

  // ── Update style / tone metadata ─────────────────────────────────────────────

  a._v3_communication_style = extraction.communicationStyle;
  a._v3_emotional_tone      = extraction.emotionalTone;

  // ── Handle split generation request ─────────────────────────────────────────

  if (extraction.splitGenerationRequested && !a.current_split) {
    // Store structural preference if extractor provided one (e.g. "two muscle groups per session")
    if (extraction.splitPreference) {
      a._split_preference = extraction.splitPreference;
    }
    // Track how many times generation has been attempted so triggerSplitGeneration
    // can rotate away from the previous template on re-generations.
    a._split_attempt_count = String((parseInt(a._split_attempt_count ?? "0")) + 1);

    console.log("[SPLIT_AUDIT] HANDLER_TRIGGER", JSON.stringify({
      extractedPreference:      extraction.splitPreference,
      storedPreference:         a._split_preference ?? null,
      currentSplitBeforeGen:    a.current_split ?? null,   // must be null; if set, generation guard would fail
      splitGenerationRequested: extraction.splitGenerationRequested,
      attempt:                  a._split_attempt_count,
      available_training_days:  a.available_training_days ?? "NOT_SET — defaulting to 4",
      gym_goal:                 a.gym_goal ?? "NOT_SET — defaulting to muscle",
    }));

    const splitDisplay = await triggerSplitGeneration(state);
    state.currentStep  = computeCurrentStep(a);
    await saveState(userId, state);
    await addToShortTerm(platformChatId, splitDisplay, { role: "assistant", intent: "intake", emotion: "neutral" });
    appendHistory(a, text, splitDisplay);
    return { handled: true, reply: splitDisplay };
  }

  // ── Check if all required fields collected after this extraction ─────────────

  if (allRequiredCollected(a) && !a._v3_review_shown) {
    v3log("REVIEW_CARD", { reason: "all required fields collected after extraction", fields: Object.fromEntries(REQUIRED_FIELDS.map(f => [f, a[f]])) });
    delete a._v3_awaiting_correction; // already cleared above, but belt-and-suspenders
    const card = buildReviewCardRex(a);
    a._v3_review_shown = "true";
    state.currentStep  = "review";
    await saveState(userId, state);
    await addToShortTerm(platformChatId, card, { role: "assistant", intent: "intake", emotion: "neutral" });
    appendHistory(a, text, card);
    return { handled: true, reply: card };
  }

  // ── Logical inconsistency — show once ────────────────────────────────────────

  // extraction.reply is always used — the extractor handles conflict replies
  // in coaching voice. The handler only enforces storage safety (skip field).
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
      note: newCount === 1 ? "first increment happens on first ask — stall-2 behavior triggers on SECOND ask, not third" : undefined,
    });
  }

  // ── Update V2-compatible currentStep for rollback ────────────────────────────

  state.currentStep = computeCurrentStep(a);

  v3log("TURN_END", {
    reply:               reply.slice(0, 120),
    nextField:           extraction.nextField,
    nextFieldWhy:        extraction.nextField
      ? (a[extraction.nextField] ? "ALREADY_COLLECTED — extractor used pre-extraction snapshot" : "still missing")
      : "extractor returned null",
    currentStep:         state.currentStep,
    missingFields:       REQUIRED_FIELDS.filter(f => !a[f]?.trim()),
    handlerSkippedConflict,
    replySource:         "extractor_reply",
  });

  // ── Persist and return ───────────────────────────────────────────────────────

  appendHistory(a, text, reply);
  await saveState(userId, state);
  await addToShortTerm(platformChatId, reply, { role: "assistant", intent: "intake", emotion: "neutral" });
  return { handled: true, reply };
}
