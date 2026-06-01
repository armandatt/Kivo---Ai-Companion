import { prisma } from "@repo/db/client";
import { addToLongTerm, addToShortTerm } from "./memory.service";

type OnboardingStep =
  | "not_started"
  | "q1_energy"
  | "q2_pain"
  | "q3_goal"
  | "q4_accountability"
  | "q5_aspiration"
  | "creature_type"
  | "creature_color"
  | "creature_name"
  | "checkin_time"
  | "complete";

type Answers = Record<string, string>;

const QUESTIONS: Record<OnboardingStep, string> = {
  not_started: "",
  q1_energy: "It’s 7am on a Tuesday. Which version of you shows up?",
  q2_pain: "What’s the one thing you keep saying you’ll fix but never do?",
  q3_goal: "What does a win look like for you in 30 days?",
  q4_accountability: "How do you want to be pushed — gentle nudges or no mercy?",
  q5_aspiration: "Describe the ideal version of yourself in 3 words.",
  creature_type: "Choose what stands beside you: wolf, phoenix, or serpent.",
  creature_color: "Now give it a colour that means something to you.",
  creature_name: "What are you calling it?",
  checkin_time: "One last thing — what time tomorrow do you want me to show up? Give me a time that actually works, not an optimistic one.",
  complete: "",
};

const NEXT_STEP: Record<OnboardingStep, OnboardingStep> = {
  not_started: "q1_energy",
  q1_energy: "q2_pain",
  q2_pain: "q3_goal",
  q3_goal: "q4_accountability",
  q4_accountability: "q5_aspiration",
  q5_aspiration: "creature_type",
  creature_type: "creature_color",
  creature_color: "creature_name",
  creature_name: "checkin_time",
  checkin_time: "complete",
  complete: "complete",
};

export async function handleOnboardingMessage(input: {
  platformChatId: string;
  text: string;
  displayName?: string;
  username?: string;
}) {
  const user = await prisma.messengerUser.upsert({
    where: {
      platform_platformChatId: {
        platform: "telegram",
        platformChatId: input.platformChatId,
      },
    },
    update: {
      displayName: input.displayName,
      username: input.username,
    },
    create: {
      platform: "telegram",
      platformChatId: input.platformChatId,
      displayName: input.displayName,
      username: input.username,
      aspirationWords: [],
      activeModules: [],
    },
  });

  if (user.onboardingComplete) {
    return { handled: false, reply: "" };
  }

  await addToShortTerm(input.platformChatId, input.text, {
    role: "user",
    intent: "onboarding",
    emotion: "neutral",
  });

  const step = normalizeStep(user.onboardingStep);
  const answers = parseAnswers(user.onboardingAnswers);

  if (step === "not_started") {
    await prisma.messengerUser.update({
      where: { id: user.id },
      data: { onboardingStep: "q1_energy" },
    });

    const reply = `Something told me you were going to show up today. Before we go anywhere — I need to know a few things about you. Real things.\n\n${QUESTIONS.q1_energy}`;
    await saveAssistantOnboardingMessage(input.platformChatId, reply);
    return { handled: true, reply };
  }

  const normalizedAnswer = normalizeAnswer(input.text);
  answers[step] = normalizedAnswer;

  const nextStep = NEXT_STEP[step];

  if (step === "checkin_time") {
    const result = await completeOnboarding(user.id, input.platformChatId, answers, normalizedAnswer);
    await saveAssistantOnboardingMessage(input.platformChatId, result.reply);
    return { handled: true, reply: result.reply };
  }

  const acknowledgement = buildAcknowledgement(step, normalizedAnswer);

  if (step === "q5_aspiration") {
    const persona = assignPersona(answers);
    await prisma.messengerUser.update({
      where: { id: user.id },
      data: {
        onboardingAnswers: answers,
        onboardingStep: nextStep,
        persona,
        tonePreference: deriveTonePreference(answers.q4_accountability),
      },
    });

    const reply = `${acknowledgement}\n\nI’m ${personaLabel(persona)}. Not here to decorate your life. Here to notice what you keep avoiding.\n\n${QUESTIONS.creature_type}`;
    await saveAssistantOnboardingMessage(input.platformChatId, reply);
    return { handled: true, reply };
  }

  await prisma.messengerUser.update({
    where: { id: user.id },
    data: {
      onboardingAnswers: answers,
      onboardingStep: nextStep,
    },
  });

  const reply = `${acknowledgement}\n\n${QUESTIONS[nextStep]}`;
  await saveAssistantOnboardingMessage(input.platformChatId, reply);
  return { handled: true, reply };
}

export async function needsOnboarding(platformChatId: string) {
  const user = await prisma.messengerUser.findUnique({
    where: {
      platform_platformChatId: {
        platform: "telegram",
        platformChatId,
      },
    },
    select: {
      onboardingComplete: true,
    },
  });

  return !user?.onboardingComplete;
}

async function completeOnboarding(
  userId: string,
  platformChatId: string,
  answers: Answers,
  checkInAnswer: string
) {
  answers.checkin_time = checkInAnswer;

  const energyPattern = classifyEnergy(answers.q1_energy);
  const primaryGoal30d = fallbackAnswer(answers.q3_goal, "undefined");
  const goalCategory = classifyGoal(primaryGoal30d, answers.q2_pain);
  const accountabilityStyle = classifyAccountability(answers.q4_accountability);
  const aspirationWords = extractAspirationWords(answers.q5_aspiration);
  const persona = assignPersona(answers);
  const preferredCheckInTime = parseCheckInTime(checkInAnswer) || defaultCheckInTime(energyPattern);
  const creatureName = fallbackAnswer(answers.creature_name, "The one that waits");

  await prisma.messengerUser.update({
    where: { id: userId },
    data: {
      onboardingAnswers: answers,
      onboardingStep: "complete",
      onboardingComplete: true,
      energyPattern,
      corePain: fallbackAnswer(answers.q2_pain, "unknown"),
      primaryGoal30d,
      goalCategory,
      accountabilityStyle,
      aspirationWords,
      persona,
      tonePreference: accountabilityStyle === "hard" ? "hard" : accountabilityStyle === "soft" ? "soft" : "dynamic",
      creatureType: fallbackAnswer(answers.creature_type, "wolf"),
      creatureColor: fallbackAnswer(answers.creature_color, "black"),
      creatureName,
      preferredCheckInTime,
      timezone: "Asia/Kolkata",
    },
  });

  await Promise.all([
    addToLongTerm(platformChatId, "preferences", `energy_pattern: ${energyPattern}`),
    addToLongTerm(platformChatId, "struggles", fallbackAnswer(answers.q2_pain, "unknown")),
    addToLongTerm(platformChatId, "goals", primaryGoal30d),
    addToLongTerm(platformChatId, "preferences", `accountability_style: ${accountabilityStyle}`),
    addToLongTerm(platformChatId, "anchors", `aspiration_words: ${aspirationWords.join(", ")}`),
    addToLongTerm(platformChatId, "anchors", `creature_name: ${creatureName}`),
  ]);

  const reply = [
    `${creatureName}. That’s what we’re building this around. I’ll remember that.`,
    `I’ll show up tomorrow at ${preferredCheckInTime}.`,
    `This is where ${creatureName} is right now. Come back tomorrow.`,
  ].join("\n\n");

  return { reply };
}

function buildAcknowledgement(step: OnboardingStep, answer: string) {
  if (isSkip(answer)) {
    return "Fair enough. We’ll figure that out along the way.";
  }

  if (step === "q1_energy") {
    if (classifyEnergy(answer) === "morning") return "You sound like someone who wants the day before it gets a vote.";
    if (classifyEnergy(answer) === "night") return "Slow start. Good to know — we’ll work with your real rhythm, not a fake one.";
    return "Variable. That usually means the system around you matters more than motivation.";
  }

  if (step === "q2_pain") {
    return `${shorten(answer)}. That is the pattern we’ll keep our eye on.`;
  }

  if (step === "q3_goal") {
    return `${shorten(answer)}. Clear enough to start shaping around.`;
  }

  if (step === "q4_accountability") {
    if (classifyAccountability(answer) === "hard") return "Good. Then I won’t wrap the truth in padding.";
    if (classifyAccountability(answer) === "soft") return "Got it. Steady pressure, not force.";
    return "Dynamic. I’ll read the room, then push accordingly.";
  }

  if (step === "q5_aspiration") {
    return `${extractAspirationWords(answer).join(". ")}. I’m going to remember those.`;
  }

  if (step === "creature_type") {
    return `${shorten(answer)}. That has a shape to it.`;
  }

  if (step === "creature_color") {
    return `${shorten(answer)}. Good. It should mean something.`;
  }

  if (step === "creature_name") {
    return `${shorten(answer)}. There it is.`;
  }

  return "Got it.";
}

function assignPersona(answers: Answers) {
  const scores: Record<string, number> = {
    rex: 0,
    nova: 0,
    vera: 0,
    zen: 0,
    spark: 0,
    compass: 0,
    anchor: 0,
    lingua: 0,
  };

  const pain = `${answers.q2_pain || ""} ${answers.q3_goal || ""}`.toLowerCase();
  const accountability = classifyAccountability(answers.q4_accountability);
  const energy = classifyEnergy(answers.q1_energy);
  const aspiration = (answers.q5_aspiration || "").toLowerCase();

  if (accountability === "hard") scores.rex += 4;
  if (accountability === "soft") {
    scores.nova += 3;
    scores.vera += 2;
    scores.anchor += 2;
  }
  if (accountability === "dynamic") {
    scores.compass += 2;
    scores.vera += 1;
  }

  if (/\b(gym|fitness|workout|lift|bench|squat|deadlift|diet)\b/.test(pain)) {
    scores.rex += 3;
    scores.spark += 2;
  }
  if (/\b(study|exam|class|assignment|school|college)\b/.test(pain)) scores.vera += 3;
  if (/\b(work|career|business|startup|job)\b/.test(pain)) scores.compass += 3;
  if (/\b(anxiety|chaos|overwhelmed|stress|safe|stable)\b/.test(pain)) scores.anchor += 3;
  if (/\b(life|identity|meaning|spiritual|purpose)\b/.test(pain)) scores.zen += 2;

  if (energy === "morning") scores.spark += 2;
  if (energy === "night") scores.nova += 2;

  if (/\b(disciplined|strong|focused|unforgettable)\b/.test(aspiration)) scores.rex += 1;
  if (/\b(calm|present|free|peaceful)\b/.test(aspiration)) scores.nova += 1;
  if (/\b(clear|directed|purposeful)\b/.test(aspiration)) scores.compass += 1;

  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

function personaLabel(persona: string) {
  return persona.charAt(0).toUpperCase() + persona.slice(1);
}

function classifyEnergy(answer = "") {
  const text = answer.toLowerCase();
  if (/\b(gym|awake|up|coffee|ready|early|run|workout)\b/.test(text)) return "morning";
  if (/\b(asleep|scrolling|phone|tired|late|coffee|dragging|snooze)\b/.test(text)) return "night";
  return "variable";
}

function classifyGoal(goal = "", pain = "") {
  const text = `${goal} ${pain}`.toLowerCase();
  if (/\b(gym|fitness|workout|diet|lift|body|weight)\b/.test(text)) return "fitness";
  if (/\b(study|exam|assignment|class|college|school)\b/.test(text)) return "study";
  if (/\b(work|career|business|startup|job|money)\b/.test(text)) return "work";
  if (/\b(relationship|family|life|phone|sleep|routine)\b/.test(text)) return "life";
  return "mixed";
}

function classifyAccountability(answer = "") {
  const text = answer.toLowerCase();
  if (/\b(no mercy|hard|strict|brutal|direct|push)\b/.test(text)) return "hard";
  if (/\b(gentle|soft|kind|calm|easy)\b/.test(text)) return "soft";
  return "dynamic";
}

function deriveTonePreference(answer = "") {
  const style = classifyAccountability(answer);
  if (style === "hard") return "hard";
  if (style === "soft") return "soft";
  return "dynamic";
}

function extractAspirationWords(answer = "") {
  const words = answer
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);

  return words.length ? words : ["steady", "clear", "present"];
}

function parseCheckInTime(answer = "") {
  const match = answer.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = match[3]?.toLowerCase();

  if (period === "pm" && hour < 12) hour += 12;
  if (period === "am" && hour === 12) hour = 0;

  if (hour > 23 || minute > 59) return null;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function defaultCheckInTime(energyPattern: string) {
  if (energyPattern === "morning") return "07:00";
  if (energyPattern === "night") return "09:00";
  return "08:00";
}

function normalizeStep(step: string | null): OnboardingStep {
  if (!step || !(step in QUESTIONS)) return "not_started";
  return step as OnboardingStep;
}

function parseAnswers(value: unknown): Answers {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Answers;
}

function normalizeAnswer(answer: string) {
  return isSkip(answer) ? "skipped" : answer.trim();
}

function isSkip(answer = "") {
  return /\b(skip|pass|don'?t know|dont know|idk|not sure|don'?t want)\b/i.test(answer);
}

function fallbackAnswer(answer: string | undefined, fallback: string) {
  if (!answer || isSkip(answer)) return fallback;
  return answer;
}

function shorten(answer: string) {
  const clean = fallbackAnswer(answer, "Noted");
  return clean.length > 90 ? `${clean.slice(0, 87).trim()}...` : clean;
}

async function saveAssistantOnboardingMessage(platformChatId: string, reply: string) {
  await addToShortTerm(platformChatId, reply, {
    role: "assistant",
    intent: "onboarding",
    emotion: "neutral",
  });
}
