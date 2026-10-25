// Web onboarding v3: the questions in order, how each answer is checked on
// its own by the server, where each is kept, and what each changes in Nova.
// Nothing here calls a model or the database.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CREATURE_NAME_MAX, DEFAULT_CREATURE_NAME, V3_FIELDS, checkCreatureName, checkOnboardingV3, isOnboardingV3,
} from "../product/onboarding-answers";
import {
  CUSTOM_ENTRIES_MAX, CUSTOM_ENTRY_MAX, OBSTACLES, OBSTACLE_LABELS, WEEKLY_HOURS_MAX, WORKING_ON, WORKING_ON_LABELS,
  checkCustomEntry, checkMultiAnswer, checkWeeklyHours, dailyMinutesFromWeekly, obstacleLines, parseHours, readWeeklyHours,
  weeklyHoursLine, withoutNotSure, workingOnLine, workingOnOptions,
} from "../product/onboarding-options";
import { TONES, TONE_OPTIONS, accountabilityOfTone, toneOfAccountability } from "../product/tone";
import { chooseRegister, registerLine, type Register } from "../decision/register";
import { chooseLanguage } from "../interaction/language";
import { contextNeeds } from "../interaction/semantics";
import { profileFromAnswersV3 } from "../product/onboarding-completion";
import { dailyColumns, setupFocusIn, signupAnswersIn } from "../adapters/account-preferences-adapter";
import { buildDynamicLayer, buildFocusedLayer } from "../context/context-builder";
import type { NovaContext } from "../types/context.types";
import type { AcademicUnderstanding } from "../types/understanding.types";

// Rex's schedule helper, which onboarding-completion.ts also calls, is not
// what is under test here (and its module does not type-check under ts-jest).
jest.mock("../../services/mentorIntake.service", () => ({ buildOnboardingSchedulePayload: () => ({ nextMessageTime: null }) }));

const repo = (path: string) => readFileSync(join(__dirname, "../../../../..", path), "utf8");

const VALID = {
  version: 3,
  audience: "college",
  workingOn: { selected: ["semester_exams", "new_skill"], custom: ["Final-year thesis"] },
  weeklyHours: { preset: "6_10" },
  obstacles: { selected: ["procrastination", "prioritizing"], custom: [] },
  language: "hinglish",
  tone: "direct",
  telegram: "yes",
  creatureName: "Pip",
};

describe("the questions, in order", () => {
  it("are the eight the brief asks for, in its order, and the page asks exactly these", () => {
    // "What should Nova call you?" first (optional), then the eight.
    expect([...V3_FIELDS]).toEqual(["preferredName", "audience", "workingOn", "weeklyHours", "obstacles", "language", "tone", "telegram", "creatureName"]);
    const flow = repo("apps/web/components/onboarding-flow.tsx");
    expect(flow).toContain("const QUESTIONS: readonly OnboardingFieldV3[] = V3_FIELDS;");
    const legends = [
      'legend="What do you currently do?"',
      'legend="What are you currently working on?"',
      'legend="How much time can you realistically give these goals each week?"',
      'legend="What usually makes it difficult to make progress?"',
      'legend="Which language would you prefer Nova to speak?"',
      'legend="How should Nova talk to you?"',
      'legend="Do you use Telegram?"',
      "What would you like to call your creature?",
    ].map(l => flow.indexOf(l));
    expect(legends.every(i => i >= 0)).toBe(true);
    expect([...legends].sort((a, b) => a - b)).toEqual(legends);
  });

  it("opens with one inclusive headline, no study-versus-work split", () => {
    const flow = repo("apps/web/components/onboarding-flow.tsx");
    expect(flow).toContain("Let&apos;s build a system that works for you.");
    expect(flow).toContain("Tell Kivo what you&apos;re working on, how you spend your time, and what kind of support helps you make progress.");
    for (const gone of ["Study this", "Work on this", "What best describes you right now?", "help you with first"]) {
      expect([gone, flow.includes(gone)]).toEqual([gone, false]);
    }
  });

  it("asks nothing cosmetic and no personality quiz", () => {
    const flow = repo("apps/web/components/onboarding-flow.tsx");
    for (const gone of ["creatureColor", "creatureType", "COLORS", "egg", "aspirationWords", "energyPattern", "corePain", "STYLE_QUESTIONS", "signalAnswers", "checkInTime"]) {
      expect([gone, flow.includes(gone)]).toEqual([gone, false]);
    }
  });

  it("is always the dark theme, and keeps the Nova reveal before the creature is named", () => {
    const flow = repo("apps/web/components/onboarding-flow.tsx");
    expect(flow).toContain('<div className="kivo-dark min-h-screen bg-background text-foreground">');
    expect(flow).not.toContain("THEME_SCRIPT");
    expect(flow).toContain("if (STEPS[at + 1] === 'creatureName') { setScene('reveal'); return; }");
    expect(flow).toContain("Name your creature");
    expect(flow).toContain("prefers-reduced-motion: reduce");
  });

  it("puts 'Grow your world.' quietly under the last question only", () => {
    const flow = repo("apps/web/components/onboarding-flow.tsx");
    expect(flow).toContain("{step === 'creatureName' && <p className=\"mt-8 text-center text-xs tracking-wide text-foreground/55\" data-footer>Grow your world.</p>}");
  });

  it("offers every working-on option to every audience; only the order changes", () => {
    for (const audience of [null, "school", "college", "working"] as const) {
      expect(workingOnOptions(audience).map(o => o.id).sort()).toEqual([...WORKING_ON].sort());
    }
    expect(workingOnOptions("working")[0]!.id).toBe("work_goals");
    expect(workingOnOptions("school")[0]!.id).toBe("school_exams");
    expect(workingOnOptions("college")[0]!.id).toBe("semester_exams");
  });

  it("offers the six tones, each with a line of its own", () => {
    expect(TONE_OPTIONS.map(t => t.value)).toEqual([...TONES]);
    expect(TONE_OPTIONS.find(t => t.value === "no_mercy")!.label).toBe("No-mercy coach");
  });
});

describe("each answer, checked on its own", () => {
  it("a whole answer is accepted and normalized", () => {
    const checked = checkOnboardingV3(VALID);
    expect(isOnboardingV3(VALID)).toBe(true);
    expect(checked.ok && checked.answers).toEqual({
      preferredName: null,
      audience: "college",
      workingOn: { selected: ["semester_exams", "new_skill"], custom: ["Final-year thesis"] },
      weeklyHours: { hours: 8, preset: "6_10" },
      obstacles: { selected: ["procrastination", "prioritizing"], custom: [] },
      language: "hinglish", tone: "direct", telegram: "yes", creatureName: "Pip",
    });
  });

  it.each([
    ["audience", { audience: "retired" }],
    ["workingOn", { workingOn: { selected: [], custom: [] } }],
    ["workingOn", { workingOn: { selected: ["world_domination"], custom: [] } }],
    ["weeklyHours", { weeklyHours: { preset: "custom", hours: "-2" } }],
    ["obstacles", { obstacles: { selected: [], custom: ["  "] } }],
    ["language", { language: "french" }],
    ["tone", { tone: "abusive" }],
    ["telegram", { telegram: "maybe" }],
    ["creatureName", { creatureName: "x".repeat(CREATURE_NAME_MAX + 1) }],
  ])("refuses a bad %s and names it", (field, patch) => {
    expect(checkOnboardingV3({ ...VALID, ...patch })).toMatchObject({ ok: false, field });
  });

  it("multi-select: many at once, their own entries kept apart, repeats collapsed, nothing cut to fit", () => {
    const ok = checkMultiAnswer({ selected: ["new_skill", "startup", "new_skill"], custom: ["  My   thesis ", "my thesis", "Learning a new skill"] }, WORKING_ON, WORKING_ON_LABELS, { required: true });
    // Known ids in list order, once; "my thesis" repeats "My thesis"; the option's own label is the option.
    expect(ok).toEqual({ ok: true, value: { selected: ["startup", "new_skill"], custom: ["My thesis"] } });
    expect(checkMultiAnswer({ selected: [], custom: ["x".repeat(CUSTOM_ENTRY_MAX + 1)] }, WORKING_ON, WORKING_ON_LABELS, { required: true })).toEqual({ ok: false, reason: "bad_entry" });
    expect(checkMultiAnswer({ selected: [], custom: Array.from({ length: CUSTOM_ENTRIES_MAX + 1 }, (_, i) => `e${i}`) }, WORKING_ON, WORKING_ON_LABELS, { required: true })).toEqual({ ok: false, reason: "bad_entry" });
    expect(checkMultiAnswer({ selected: [], custom: [] }, WORKING_ON, WORKING_ON_LABELS, { required: false })).toEqual({ ok: true, value: { selected: [], custom: [] } });
    expect(checkMultiAnswer({ selected: "new_skill" }, WORKING_ON, WORKING_ON_LABELS, { required: true })).toEqual({ ok: false, reason: "unknown" });
    expect(checkMultiAnswer({ selected: [], custom: [42] }, WORKING_ON, WORKING_ON_LABELS, { required: true })).toEqual({ ok: false, reason: "bad_entry" });
  });

  it("one entry typed on the page: empty, repeated, too long or one too many is refused with a reason", () => {
    expect(checkCustomEntry("  ", [], [])).toEqual({ ok: false, reason: "empty" });
    expect(checkCustomEntry("Thesis", ["thesis"], [])).toEqual({ ok: false, reason: "duplicate" });
    expect(checkCustomEntry("being consistent", [], OBSTACLE_LABELS)).toEqual({ ok: false, reason: "duplicate" });
    expect(checkCustomEntry("x".repeat(CUSTOM_ENTRY_MAX + 1), [], [])).toEqual({ ok: false, reason: "too_long" });
    expect(checkCustomEntry("one more", Array.from({ length: CUSTOM_ENTRIES_MAX }, (_, i) => `e${i}`), [])).toEqual({ ok: false, reason: "too_many" });
    expect(checkCustomEntry(" Side\tproject \n", [], [])).toEqual({ ok: true, entry: "Side project" });
  });

  it("weekly hours: a range is stored as one number; their own figure is a real, bounded number", () => {
    expect(checkWeeklyHours({ preset: "under_3" })).toEqual({ ok: true, value: { hours: 2, preset: "under_3" } });
    expect(checkWeeklyHours({ preset: "over_30" })).toEqual({ ok: true, value: { hours: 35, preset: "over_30" } });
    expect(checkWeeklyHours({ preset: "custom", hours: "7.5" })).toEqual({ ok: true, value: { hours: 7.5, preset: "custom" } });
    expect(checkWeeklyHours({ preset: "custom", hours: "7,5" })).toEqual({ ok: true, value: { hours: 7.5, preset: "custom" } });
    expect(checkWeeklyHours({ preset: "custom", hours: 0 })).toEqual({ ok: true, value: { hours: 0, preset: "custom" } });
    expect(checkWeeklyHours({ preset: "custom", hours: WEEKLY_HOURS_MAX })).toMatchObject({ ok: true });
    for (const bad of ["-1", "abc", "1e9", "Infinity", "", "1.2.3", " . ", NaN, Infinity, -0.5, WEEKLY_HOURS_MAX + 1, null, {}]) {
      expect([bad, checkWeeklyHours({ preset: "custom", hours: bad }).ok]).toEqual([bad, false]);
    }
    expect(checkWeeklyHours({ preset: "lots" }).ok).toBe(false);
    expect(parseHours("12")).toBe(12);
    expect(checkWeeklyHours({ preset: "custom", hours: "-3" })).toEqual({ ok: false, message: "Hours can't be negative." });
    expect(checkWeeklyHours({ preset: "custom", hours: "--3" })).toEqual({ ok: false, message: "Enter a number of hours, like 6 or 7.5." });
    // A stored answer is read back the same way, and a forged preset figure is ignored.
    expect(readWeeklyHours({ preset: "3_5", hours: 999 })).toEqual({ hours: 4, preset: "3_5" });
    expect(readWeeklyHours({ preset: "custom", hours: 6 })).toEqual({ hours: 6, preset: "custom" });
    expect(readWeeklyHours("lots")).toBeNull();
  });

  it("'not sure' stands alone: chosen with others, the others say more", () => {
    expect(withoutNotSure({ selected: ["not_sure"], custom: [] })).toEqual({ selected: ["not_sure"], custom: [] });
    expect(withoutNotSure({ selected: ["not_sure", "motivation"], custom: [] })).toEqual({ selected: ["motivation"], custom: [] });
    expect(withoutNotSure({ selected: ["not_sure"], custom: ["My phone"] })).toEqual({ selected: [], custom: ["My phone"] });
  });

  it("the creature's name: one line, Kivo by default, never more than the limit", () => {
    expect(checkCreatureName(undefined)).toEqual({ ok: true, name: DEFAULT_CREATURE_NAME });
    expect(checkCreatureName("   ")).toEqual({ ok: true, name: DEFAULT_CREATURE_NAME });
    expect(checkCreatureName(" Pip\nthe\towl ")).toEqual({ ok: true, name: "Pip the owl" });
    expect(checkCreatureName(7)).toMatchObject({ ok: false });
    expect(DEFAULT_CREATURE_NAME).not.toBe("Nova");
  });
});

describe("where each answer is kept", () => {
  const checked = checkOnboardingV3(VALID);
  const answers = checked.ok ? checked.answers : null!;
  const { profileData } = profileFromAnswersV3(answers, "Asia/Kolkata");

  it("in the onboarding answers, each under its own key, with the audience as a learning context", () => {
    expect(profileData.onboardingAnswers).toEqual({
      version: 3, learningContexts: ["college"],
      workingOn: answers.workingOn, weeklyHours: answers.weeklyHours, obstacles: answers.obstacles,
      language: "hinglish", tone: "direct", telegram: "yes",
    });
    expect(profileData.onboardingComplete).toBe(true);
    expect(profileData.timezone).toBe("Asia/Kolkata");
  });

  it("the creature is named; Nova stays Nova", () => {
    expect(profileData.creatureName).toBe("Pip");
    expect(profileData.primaryPersona).toBe("nova");
    expect(profileData.personaName).toBe("NOVA");
    expect(profileData.creatureColor).toBeNull();
    expect(profileData.creatureType).toBeNull();
    // Nothing in Nova reads the creature's name, so naming it renames nothing.
    const novaRoot = join(__dirname, "..");
    const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
      const full = join(dir, f);
      return statSync(full).isDirectory() ? (f.startsWith("__") ? [] : files(full)) : full.endsWith(".ts") ? [full] : [];
    });
    const naming = files(novaRoot).filter(f => readFileSync(f, "utf8").includes("creatureName")).map(f => f.slice(novaRoot.length + 1)).sort();
    expect(naming).toEqual(["product/onboarding-answers.ts", "product/onboarding-completion.ts"]);
  });

  it("saying Yes to Telegram is an intention, never a connection", () => {
    expect(profileData).not.toHaveProperty("telegramConnected");
    expect(profileData).not.toHaveProperty("telegramChatId");
    expect(profileData).not.toHaveProperty("telegramConnectToken");
  });

  it("no goal is seeded from what they are working on", () => {
    expect(profileData.primaryGoal30d).toBeNull();
  });

  it("the tone keeps the older soft/hard answer in step, and an older answer reads as a tone", () => {
    expect(TONES.map(accountabilityOfTone)).toEqual(["soft", null, null, null, "hard", "hard"]);
    expect(profileData.accountabilityStyle).toBeNull();
    expect(profileFromAnswersV3({ ...answers, tone: "no_mercy" }, undefined).profileData.accountabilityStyle).toBe("hard");
    expect(toneOfAccountability("soft")).toBe("gentle");
    expect(toneOfAccountability("hard")).toBe("no_mercy");
    expect(toneOfAccountability(null)).toBeNull();
  });

  it("is read back by Nova's one adapter; anything unreadable is 'not said'", () => {
    const read = signupAnswersIn(profileData.onboardingAnswers);
    expect(read).toEqual({ workingOn: answers.workingOn, weeklyHours: answers.weeklyHours, obstacles: answers.obstacles, language: "hinglish", tone: "direct", preferredName: null });
    expect(signupAnswersIn({ tone: "shouty", language: "klingon", workingOn: "lots", preferredName: 42 })).toEqual({ workingOn: null, weeklyHours: null, obstacles: null, language: null, tone: null, preferredName: null });
    // An account from before tones: its soft/hard answer is its tone.
    expect(signupAnswersIn(null, "hard").tone).toBe("no_mercy");
    expect(signupAnswersIn({ tone: "calm" }, "hard").tone).toBe("calm");
  });

  it("the setup page's templates follow the first thing they are working on", () => {
    expect(setupFocusIn(profileData.onboardingAnswers)).toEqual({ id: "exam", detail: null });
    expect(setupFocusIn({ firstFocus: { id: "habit", detail: null }, ...profileData.onboardingAnswers })).toEqual({ id: "habit", detail: null });
    expect(setupFocusIn({ workingOn: { selected: [], custom: ["Thesis"] } })).toBeNull();
  });
});

describe("what each answer changes", () => {
  it("weekly time: a new Nova profile's usual day, to five minutes, never under ten", () => {
    expect(dailyMinutesFromWeekly({ hours: 2, preset: "under_3" })).toBe(15);
    expect(dailyMinutesFromWeekly({ hours: 4, preset: "3_5" })).toBe(35);
    expect(dailyMinutesFromWeekly({ hours: 35, preset: "over_30" })).toBe(300);
    expect(dailyMinutesFromWeekly({ hours: 0.5, preset: "custom" })).toBeNull();
    expect(dailyMinutesFromWeekly(null)).toBeNull();
    expect(dailyColumns(35)).toEqual({ dailyStudyMinutes: 35, preferredStudyHoursPerDay: 0.58 });
    expect(dailyColumns(null)).toEqual({});
  });

  it("weekly time is seeded only when the profile is made, in every place that makes one", () => {
    const setup = repo("packages/api/src/nova/product/setup.ts");
    expect(setup).toContain("create: { userId: learner.id, goals: firstGoals, ...dailyColumns(firstDaily) },");
    expect(setup).toContain("...dailyColumns(await seedDailyMinutesFromSignup(platformChatId)) },");
    expect(repo("packages/api/src/nova/product/goals.ts")).toContain("create: { userId: user.id, goals: parsed.goals, ...dailyColumns(await seedDailyMinutesFromSignup(platformChatId)) },");
    // The setup page shows that day before the profile exists, so saving it keeps it.
    expect(setup).toContain("dailyMinutes:  profile ? statedDailyMinutes(profile) : seededDaily,");
  });

  it("nothing creates tasks, events, reminders or messages from an answer", () => {
    for (const file of ["product/onboarding-completion.ts", "product/onboarding-options.ts", "product/onboarding-answers.ts", "product/tone.ts"]) {
      const src = repo(`packages/api/src/nova/${file}`);
      for (const banned of ["novaTask", "novaCalendarEvent", "novaProactiveMessage", "sendMessage", "remindAt"]) {
        expect([file, banned, src.includes(banned)]).toEqual([file, banned, false]);
      }
      // No check-in time is chosen for them: the only one written is none.
      expect([file, src.split("preferredCheckInTime:").length - 1]).toEqual([file, src.split("preferredCheckInTime: null").length - 1]);
    }
  });

  it("tone: each one has its own register; distress, a hard stretch or a close exam still overrides it", () => {
    const base = { emotion: "neutral" as const, daysUntilNextExam: null, activeReality: [], accountability: null };
    const registers = TONES.map(tone => chooseRegister({ ...base, tone }));
    expect(registers).toEqual(["gentle", "calm", "friendly", "direct", "firm", "playful"]);
    expect(new Set([...registers, "steady", "serious"].map(r => registerLine(r as Register))).size).toBe(8);
    for (const tone of TONES) {
      expect(chooseRegister({ ...base, tone, emotion: "overwhelmed" })).toBe("serious");
      expect(chooseRegister({ ...base, tone, activeReality: ["health"] })).toBe("serious");
      expect(chooseRegister({ ...base, tone, daysUntilNextExam: 1 })).toBe("serious");
    }
    // A chosen tone outranks the older soft/hard answer; without one, that answer still applies.
    expect(chooseRegister({ ...base, accountability: "hard", tone: "gentle" })).toBe("gentle");
    expect(chooseRegister({ ...base, accountability: "hard", tone: null })).toBe("playful");
  });

  it("only the no-mercy coach may tease, and it may never insult, humiliate or threaten", () => {
    for (const r of ["gentle", "calm", "direct", "firm", "steady", "serious"] as const) {
      expect([r, registerLine(r).toLowerCase().includes("no teasing")]).toEqual([r, true]);
    }
    expect(registerLine("friendly")).toContain("no teasing about them or their habits");
    const coach = registerLine("playful");
    expect(coach).toContain("blunt, intense and brief");
    expect(coach).toContain("No insults, no humiliation, no shaming, no threats");
    expect(coach).toContain("never about them, their ability or their worth");
  });

  it("language: what they write in wins; their choice answers what the reading cannot place", () => {
    const sentence = "How is my progress going?";
    expect(chooseLanguage(null, "english", sentence, "hinglish")).toBe("hinglish");
    expect(chooseLanguage(null, "english", sentence, null)).toBe("english");
    expect(chooseLanguage("english", "hinglish", sentence, "hindi")).toBe("english");
    // A short reply keeps the conversation's language.
    expect(chooseLanguage(null, "english", "ok", "hinglish")).toBe("english");
  });

  it("language: the conversation starts in their choice, and Nova speaks first in it", () => {
    expect(repo("packages/api/src/nova/adapters/conversation-adapter.ts")).toContain("export async function loadReplyLanguage(userId: string, fallback: ReplyLanguage = \"english\"): Promise<ReplyLanguage> {");
    const turn = repo("packages/api/src/nova/telegram/telegram-turn.ts");
    expect(turn).toContain('const lastLanguage = user ? await loadReplyLanguage(user.id, preferredLanguage ?? "english") : (preferredLanguage ?? "english");');
    expect(repo("packages/api/src/nova/proactive/nova-proactive-cron.ts")).toContain("(await loadVoicePreferences(chatId).catch(() => ({ language: null }))).language ?? await loadReplyLanguage(profile.user.id),");
    // The web's worded replies get the same language line Telegram's do.
    const web = repo("packages/api/src/nova/interaction/web-sentence.ts");
    expect(web).toContain("const language  = scriptLanguage(text) ?? chooseLanguage(safe.request?.language, await loadReplyLanguage(user.id, preferred ?? \"english\"), text, preferred);");
    expect(web).toContain("directive: told(blocked ? SENTENCE_RUNS_NO_SESSION");
  });

  it("tone reaches every place Nova words a reply", () => {
    expect(repo("packages/api/src/nova/nova-orchestrator.ts")).toContain("tone:              await loadTone(platformChatId),");
    expect(repo("packages/api/src/nova/telegram/telegram-turn.ts")).toContain("tone: await loadTone(event.chatId) }),");
    expect(repo("packages/api/src/nova/proactive/nova-proactive-cron.ts")).toContain("tone:           await loadTone(chatId),");
  });
});

describe("what Nova's prompt carries", () => {
  const u = (over: Partial<AcademicUnderstanding> & { request?: unknown } = {}): AcademicUnderstanding => ({
    intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none", ambiguityScore: 0, routingSignal: "coaching_only", rawText: "hi",
    request: { clarity: "clear", action: "none", asks: "none", promptAnswer: null, changeOfMind: false, availableMinutes: null, exam: null, deferUntil: null, struggleTopic: null, setup: null, language: null },
    ...over,
  } as unknown as AcademicUnderstanding);

  const ctx = (profile: Record<string, unknown>): NovaContext => ({
    platformChatId: "c1", rawMessage: "hi", timestamp: new Date(),
    understanding: u(),
    academicState: {
      semesterPhase: "midterm", activeMode: "standard", momentaryState: "neutral",
      scores: { engagement: 50, confidence: 50, momentum: 50, burnoutRisk: 20, planAdherence: 60 },
      hardDirectives: { noStudyPressure: false, examCrisisMode: false, planFreezeMode: false, calibrationAlert: false, noChallenging: false, recoveryMode: false, beginnerMode: false },
      daysSinceJoined: 10, daysSinceLastSession: 1, consecutiveMisses: 0, studyStreakDays: 2, daysUntilNextExam: null, momentum7dTrend: [0, 0, 0, 0, 0, 0, 0], stateHistory: [],
    },
    signals: { detectedSignals: [], stateUpdates: [] },
    userProfile: { displayName: "Asha", goals: [], yearOfStudy: null, major: null, institution: null, learningContexts: ["college"], firstFocus: null, preferredStudyHoursPerDay: 1, subjects: ["OS"], daysSinceJoined: 10, ...profile },
    topicMastery: null, examContext: null, studyPlan: null, activeSession: null, sessionContext: null, sessionAction: null,
    patterns: { detectedPatterns: [], dominantPattern: null, analysisRunAt: new Date(), messagesSinceLastRun: 1 },
    topRelevantMemories: [], contrastiveMemories: [], conversationHistory: [], realityFacts: [], activeRealityFacts: [],
    cognitiveState: { investigationTopic: null, investigationHypotheses: [], investigationMissingData: [], followUpChecks: null, reasoningHistory: null },
  } as unknown as NovaContext);

  const signup = {
    workingOn: { selected: ["semester_exams"], custom: ["Final-year thesis"] },
    weeklyHours: { hours: 4, preset: "3_5" },
    obstacles: { selected: ["procrastination", "not_sure"], custom: ["My phone"] },
    firstFocus: { id: "habit", detail: null },
  };

  it("what they are working on and their weekly time, as their own answers, never as a commitment", () => {
    const layer = buildDynamicLayer(ctx(signup));
    expect(layer).toContain('Working on (their own answer at sign-up; context for suggestions, not tasks or deadlines): preparing for semester exams; "Final-year thesis".');
    expect(layer).toContain("about 3–5 hours (their estimate at sign-up, not a commitment; never hold them to it or comment on it being low)");
    // The newer answer stands in for the older single one.
    expect(layer).not.toContain("First asked Nova to help with");
    expect(workingOnLine(null)).toBeNull();
    expect(weeklyHoursLine({ hours: 6.5, preset: "custom" })).toContain("about 6.5 hours");
  });

  it("what gets in the way: suggestions under their own header, never a reason to remind or message", () => {
    const layer = buildDynamicLayer(ctx(signup));
    expect(layer).toContain("## How to help (their own answer)");
    expect(layer).toContain("never set reminders or send messages because of it");
    expect(layer).toContain("- Procrastination or getting started: make the first step small enough to start now; a focus session is an option, not a demand.");
    expect(layer).toContain('- In their words: "My phone".');
    expect(layer).not.toContain("I am not sure yet");
    expect(obstacleLines({ selected: ["not_sure"], custom: [] })).toEqual([]);
    expect(buildDynamicLayer(ctx({ obstacles: { selected: ["not_sure"], custom: [] } }))).not.toContain("## How to help");
    for (const id of OBSTACLES) expect(typeof obstacleLines({ selected: [id], custom: [] }).length).toBe("number");
  });

  it("is sent only where it can shape the reply", () => {
    const has = (x: AcademicUnderstanding) => contextNeeds(x).includes("support");
    const request = (over: Record<string, unknown>) => ({ ...(u().request as object), ...over }) as never;
    expect(has(u({ request: request({ asks: "knowledge" }) }))).toBe(false);
    expect(has(u({ request: request({ action: "start_session" }) }))).toBe(false);
    expect(has(u({ emotion: "overwhelmed" }))).toBe(true);
    expect(has(u())).toBe(true);   // a conversation
    const focused = buildFocusedLayer(ctx(signup), ["recent"]);
    expect(focused).not.toContain("## How to help");
    expect(buildFocusedLayer(ctx(signup), ["recent", "support"])).toContain("## How to help");
  });
});

describe("the route, Settings and the finish (read from source)", () => {
  const route = repo("apps/api/onboarding/route.ts");
  const settings = repo("apps/api/settings/route.ts");
  const flow = repo("apps/web/components/onboarding-flow.tsx");

  it("the server checks v3 itself, before the older payloads, and completes once", () => {
    expect(route.indexOf("if (isOnboardingV3(body)) {")).toBeLessThan(route.indexOf("} else if (isOnboardingV2(body)) {"));
    expect(route).toContain("const checked = checkOnboardingV3(body)");
    expect(route).toContain("const outcome = await completeOnboardingOnce(session.userId, profileData)");
  });

  it("every answer can be changed later in Settings, checked as onboarding checks it", () => {
    for (const piece of [
      "checkMultiAnswer(workingOn, WORKING_ON, WORKING_ON_LABELS, { required: false })",
      "checkMultiAnswer(obstacles, OBSTACLES, OBSTACLE_LABELS, { required: false })",
      "const checked = checkWeeklyHours(weeklyHours)",
      "if (language !== null && !REPLY_LANGUAGES.some(l => l === language))",
      "if (!isTone(tone)) return NextResponse.json({ error: \"Unknown tone\" }, { status: 400 })",
      "profileUpdates.accountabilityStyle = accountabilityOfTone(tone)",
      "const checked = checkCreatureName(creatureName)",
      "return NextResponse.json({ ok: true, saved })",
    ]) expect([piece, settings.includes(piece)]).toEqual([piece, true]);
    const prefs = repo("apps/web/components/nova/help-preferences.tsx");
    expect(prefs).toContain("if (!Array.isArray(data?.saved) || !keys.every(k => data!.saved!.includes(k)))");
    expect(prefs).toContain("TONE_OPTIONS.map");
    // One place to choose a tone: the check-in card no longer has its own.
    expect(repo("apps/web/components/nova/checkin-settings.tsx")).not.toContain("accountabilityStyle");
  });

  it("Telegram: the linking flow appears only after the answers are saved, and 'connected' only when the server says so", () => {
    expect(flow).toContain("{done.telegram === 'yes' && <TelegramStep />}");
    expect(flow).toContain("link.connection.connected ? (");
    expect(flow).toContain("Kivo never asks for your Telegram password or login code.");
    for (const asked of ["password\"", "type=\"password\"", "loginCode", "botToken"]) expect([asked, flow.includes(asked)]).toEqual([asked, false]);
  });

  it("finishing goes to the app's own pages (Build with Nova, or /home when finished before), on the host the learner signed in on", () => {
    expect(flow).toContain("onEnter={() => router.push(done.alreadyComplete ? '/home' : '/build')}");
    expect(flow).not.toContain("thekivo.in");
    expect(flow).not.toContain("NEXT_PUBLIC_APP_URL");
    expect(flow).not.toContain("window.location.href = 'http");
  });

  it("the draft survives back and refresh, and is cleared only once the server has saved it", () => {
    expect(flow).toContain("window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, at }))");
    const finish = flow.slice(flow.indexOf("async function finish()"), flow.indexOf("function next("));
    expect(finish.indexOf("if (!res.ok || !result?.success)")).toBeLessThan(finish.indexOf("clearDraft()"));
    // A refused answer sends the learner back to that question, answers kept.
    expect(finish).toContain("if (field) setAt(STEPS.indexOf(field));");
  });

  it("an account that already finished is told nothing changed", () => {
    expect(flow).toContain("Onboarding was finished before, so these answers didn&apos;t change anything.");
  });
});
