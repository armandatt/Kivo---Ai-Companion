// ─── The first thing Nova says in a newly connected chat ──────────────────────
// What it is about is decided here, from the Today view and nothing else: the
// session that is running, something on record that makes today a day not to
// push, the plan's first block, or the one thing Nova still needs to know.
// Pure: no DB, no LLM. It ranks nothing and computes no learner fact.
//
// Each outcome carries the facts it rests on and a plain sentence that says
// them. The Response Brain may word the facts in the learner's register; it
// is given nothing else, so there is nothing else for it to say. The plain
// sentence is what goes out when the model is unavailable.
//
// A command is never mentioned: the learner is told what Nova would do now
// and that they can simply talk.

import type { SetupQuestion } from "./initialization";
import type { NovaTodayReady, TodayAction } from "../product/today.types";

export type FirstUseKind =
  | "session"     // a session is already running: that, not a new one
  | "hold"        // illness, injury or an emotional strain is on record: no push
  | "recommend"   // the plan's first block, with the way to start it
  | "setup"       // nothing to plan from: the one missing thing
  | "open";       // nothing is pressing today

export interface FirstUse {
  kind:     FirstUseKind;
  // What a Start option would start. Only for "recommend".
  block:    TodayAction | null;
  // What the message rests on, one fact per line. The only things a worded
  // version may state.
  facts:    string[];
  fallback: string;
  // What the wording is asked to do with the facts.
  instruction: string;
}

// Circumstances in which Nova does not open with a study recommendation.
export const NO_PUSH: ReadonlySet<string> = new Set(["health", "injury", "emotional"]);

const inDays = (n: number) => n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
const TALK = "Or just tell me what's going on.";

export function decideFirstUse(view: NovaTodayReady, ask: SetupQuestion | null): FirstUse {
  const session = view.activeSession;
  const hold    = view.constraints.find(c => NO_PUSH.has(c.category)) ?? null;
  const rec     = view.recommendation;
  const exam    = view.nextDeadline;
  const examFact = exam ? `Next exam: ${exam.title}, ${inDays(exam.daysUntil)}.` : null;

  if (session) {
    const what = session.topicName ?? "your session";
    return {
      kind: "session", block: null,
      facts: [`A study session is ${session.status === "paused" ? "paused" : "running"}: ${what}, ${session.elapsedMinutes} min so far.`],
      fallback: `You're connected. ${session.status === "paused" ? "Your session" : "You have a session running"} on ${what}${session.status === "paused" ? " is paused" : ""}: ${session.elapsedMinutes} min so far.`,
      instruction: "They already have a study session open. Say you are connected and point at that session. Do not suggest a different one.",
    };
  }

  if (hold) {
    return {
      kind: "hold", block: null,
      facts: [`On record: ${hold.description}`, ...(examFact ? [examFact] : [])],
      fallback: `You're connected. You told me: ${hold.description}. Nothing from me to push today. I'm here when you want to talk.`,
      instruction: "Something on record makes today a day not to push. Say you are connected, acknowledge it plainly and kindly, and say you are here when they want to talk. Do not suggest studying or a session.",
    };
  }

  if (rec) {
    const why = rec.reasons.slice(0, 2).join(", ");
    const facts = [
      `First on today's plan: ${rec.topicName} (${rec.subjectName}), ${rec.durationMinutes} min.${why ? ` Why: ${why}.` : ""}`,
      ...(examFact ? [examFact] : []),
      ...(view.availableMinutes !== null ? [`Time they said they have today: ${view.availableMinutes} min.`] : []),
      ...view.constraints.slice(0, 1).map(c => `On record: ${c.description}`),
    ];
    const lead = exam && exam.daysUntil <= 14 ? `${exam.title} is ${inDays(exam.daysUntil)}, and ` : "";
    const line = `${lead}${rec.topicName} is first on your plan: ${rec.durationMinutes} min.${why ? ` Why: ${why}.` : ""}`;
    return {
      kind: "recommend", block: rec, facts,
      fallback: `You're set.\n\n${line.charAt(0).toUpperCase()}${line.slice(1)}\n\n${TALK}`,
      instruction: "Say they are set, in a few words. Then the one thing worth doing now and why, from the facts, naming the exam only if one is listed. End by saying they can just tell you what is going on.",
    };
  }

  if (view.emptyReason === "no_topics" && ask) {
    return {
      kind: "setup", block: null, facts: [],
      fallback: `You're connected. I have nothing to plan from yet. ${ask.question}`,
      instruction: "",
    };
  }

  const state = view.emptyReason === "recovery" ? "Today is a recovery day: nothing I'd push on you." : "Nothing is due today and no exam is close.";
  return {
    kind: "open", block: null,
    facts: [state, ...(examFact ? [examFact] : [])],
    fallback: `You're connected. ${state} Tell me what you want to work on, or what's going on.`,
    instruction: "Say you are connected and that nothing is pressing today, from the facts. Invite them to say what they want to work on or what is going on.",
  };
}
