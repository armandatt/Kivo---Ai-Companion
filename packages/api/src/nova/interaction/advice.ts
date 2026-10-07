// ─── Answering "should I study X?" ────────────────────────────────────────────
// A learner's question about a topic of theirs, answered from what the
// engines already decided: today's plan, what is due, the next exam, the time
// they said they have, and what is going on in their life. Pure: no DB, no
// LLM. It ranks nothing and computes no learner fact of its own; it finds the
// topic in the Today view and reports where it stands.
//
// The verdict is decided here. The Response Brain may reword the sentence; it
// does not get to change the answer.

import type { NovaTodayReady, TodayAction } from "../product/today.types";

export type AdviceVerdict =
  | "in_session"    // a session is already running
  | "hold"          // something on record says today is not the day to push
  | "top_pick"      // it is the plan's first block
  | "planned"       // it is on today's plan, further down
  | "review_due"    // not planned today, but its review is due
  | "not_planned";  // the plan has other things, or nothing

export interface TopicAdvice {
  verdict: AdviceVerdict;
  text:    string;
  // The plan's own block for the topic, when it has one: what a Start
  // option would start.
  block:   TodayAction | null;
  // The record the answer rests on, one fact per line. The only figures a
  // reworded reply may use.
  facts:   string[];
}

// Circumstances in which Nova does not recommend pushing on.
const HOLD: ReadonlySet<string> = new Set(["health", "injury", "emotional"]);

const inDays = (n: number) => n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;

// Today's block for something the learner named: the topic itself, or a
// subject of theirs (by name or code) that has a block today.
export function planBlockFor(
  view:     NovaTodayReady,
  named:    string,
  subjects: Array<{ name: string; code?: string | null }> = [],
): TodayAction | null {
  const planned = [view.recommendation, ...view.alternatives].filter((a): a is TodayAction => a !== null);
  const want    = named.trim().toLowerCase();
  const subject = subjects.find(s => s.name.toLowerCase() === want || (s.code ?? "").toLowerCase() === want)?.name.toLowerCase() ?? want;
  return planned.find(a => a.topicName.toLowerCase() === want)
    ?? planned.find(a => a.subjectName.toLowerCase() === subject)
    ?? null;
}

export function adviseOnTopic(
  view:     NovaTodayReady,
  named:    string,
  subjects: Array<{ name: string; code?: string | null }> = [],
): TopicAdvice {
  const topic = named.trim().slice(0, 120);
  const block = planBlockFor(view, topic, subjects);
  const top   = view.recommendation;
  const due   = view.reviewDue.topics.find(t => t.topicName.toLowerCase() === topic.toLowerCase()) ?? null;
  const exam  = view.nextDeadline;
  const hold  = view.constraints.find(c => HOLD.has(c.category)) ?? null;

  const facts: string[] = [];
  if (view.activeSession) facts.push(`Session running: ${view.activeSession.topicName ?? "untitled"}, ${view.activeSession.elapsedMinutes} min so far.`);
  if (block) facts.push(`On today's plan: ${block.topicName} (${block.subjectName}), ${block.durationMinutes} min. ${block.reasons.slice(0, 3).join(", ")}.`);
  else facts.push(`${topic} is not on today's plan.`);
  if (top && top !== block) facts.push(`First on today's plan: ${top.topicName} (${top.subjectName}), ${top.durationMinutes} min.`);
  if (due) facts.push(`Review of ${due.topicName} is ${due.daysOverdue > 0 ? `${due.daysOverdue} days overdue` : "due today"}.`);
  if (exam) facts.push(`Next exam: ${exam.title}, ${inDays(exam.daysUntil)}.`);
  facts.push(view.availableMinutes !== null ? `Time they said they have today: ${view.availableMinutes} min.` : "Time they have today: not stated.");
  for (const c of view.constraints.slice(0, 2)) facts.push(`On record: ${c.description}`);

  const soon = exam && exam.daysUntil <= 7 ? ` ${exam.title} is ${inDays(exam.daysUntil)}.` : "";
  const why  = (a: TodayAction) => a.reasons.length > 0 ? ` Why: ${a.reasons.slice(0, 2).join(", ")}.` : "";

  if (view.activeSession) {
    const running = view.activeSession.topicName;
    const sameOne = running !== null && running.toLowerCase() === topic.toLowerCase();
    return {
      verdict: "in_session", block: null, facts,
      text: sameOne ? `You're already in a session on ${running}. Keep going.`
                    : `You have a session running${running ? ` on ${running}` : ""}. Finish that one first, then ${topic}.`,
    };
  }
  if (hold) {
    return { verdict: "hold", block: null, facts, text: `Not today. You told me: ${hold.description}. ${topic} will keep.${soon}` };
  }
  if (block && block === top) {
    return { verdict: "top_pick", block, facts, text: `Yes. ${block.topicName} is the first thing on today's plan: ${block.durationMinutes} min.${why(block)}${soon}` };
  }
  if (block) {
    return {
      verdict: "planned", block, facts,
      text: `Yes, it's on today's plan: ${block.topicName}, ${block.durationMinutes} min.${why(block)}${top ? ` ${top.topicName} is ahead of it.` : ""}${soon}`,
    };
  }
  if (due) {
    return {
      verdict: "review_due", block: null, facts,
      text: `Yes. ${due.topicName} is ${due.daysOverdue > 0 ? `${due.daysOverdue} days overdue for review` : "due for review today"}.${soon}`,
    };
  }
  return {
    verdict: "not_planned", block: null, facts,
    text: top
      ? `${topic} isn't on today's plan. ${top.topicName} is first: ${top.durationMinutes} min.${why(top)} ${topic} is still yours to pick.${soon}`
      : `${topic} isn't on today's plan, and nothing else is pressing. It's yours to pick.${soon}`,
  };
}
