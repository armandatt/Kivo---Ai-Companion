// ─── Whether a plan can be done: the deterministic check ──────────────────────
// Reads a checked plan (workspace-plan.ts) and says, in words, what cannot
// work and what may not. No model call, nothing changed: a date is never
// moved to make a plan look feasible. The learner sees the issues on the
// proposal and can fix them by hand or ask Nova to.
//
//   errors    the plan contradicts itself: work due after the deadline it
//             leads to, a task due before something it waits on, a step due
//             after the task it is part of, a broken wait or step. A version
//             with errors cannot be approved until they are fixed.
//   warnings  advisory: a week planned beyond the time the learner said
//             they have, estimates missing where a deadline needs them,
//             near-duplicates, study topics with no practice or revision
//             task, a shared syllabus nothing cites.
//
// Pure, no imports beyond types and the tree rules, so the page shows the
// same issues the server enforces.

import { wouldLoop, type Wait } from "./task-tree";
import { milestonesOf, parentTopicNames, type PlanTask, type WorkspacePlan } from "./workspace-plan";

export interface FeasibilityIssue {
  level: "error" | "warning";
  code:
    | "after_deadline" | "wait_order" | "step_after_parent" | "broken_wait" | "broken_step" | "wait_loop"
    | "week_overload" | "milestone_overload" | "missing_estimates" | "duplicate_titles" | "unpractised_topics" | "syllabus_uncited" | "unread_file"
    | "unfiled_tasks" | "unconfirmed_date";
  message: string;
  // What it is about, for the page to point at.
  tasks?: string[];
  subject?: string | null;
}
export interface Feasibility { errors: FeasibilityIssue[]; warnings: FeasibilityIssue[] }

export interface FeasibilityContext {
  // The time the learner said they have each week, in hours. null: not said.
  hoursPerWeek: number | null;
  // The kind of work (exam and semester plans are checked for practice).
  kind: string | null;
  // Everything the learner wrote, when known: a dated item whose day it never
  // names is pointed out (a deadline is theirs to give, not Nova's).
  learnerText?: string | null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// Whether the learner's words name this day: as written (2026-12-14), or as
// "14 December", "December 14", "14 Dec", "Dec 14", "14/12", "14-12", "14.12".
export function namesDay(text: string, day: string): boolean {
  const t = ` ${words(text)} `, raw = text.toLowerCase()
  if (raw.includes(day)) return true
  const m = Number(day.slice(5, 7)), d = Number(day.slice(8, 10))
  const month = MONTHS[m - 1]!, short = month.slice(0, 3)
  const nth = (n: number) => [String(n), `${n}st`, `${n}nd`, `${n}rd`, `${n}th`]
  for (const n of nth(d)) for (const mo of [month, short]) if (t.includes(` ${n} ${mo} `) || t.includes(` ${mo} ${n} `) || t.includes(` ${n} of ${mo} `)) return true
  const dd = String(d).padStart(2, "0"), mm = String(m).padStart(2, "0")
  for (const sep of ["/", "-", "."]) for (const a of [String(d), dd]) for (const b of [String(m), mm]) if (raw.includes(`${a}${sep}${b}`)) return true
  return false
}

const DEADLINE_KINDS = new Set(["exam", "assignment", "project", "certification", "interview"]);
const words = (s: string) => {
  let out = "", gap = false;
  for (const c of s.toLowerCase()) {
    const keep = (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c > "\u007f";
    if (keep) { if (gap && out) out += " "; out += c; gap = false; } else gap = true;
  }
  return out;
};
// Monday of the week a day falls in, as YYYY-MM-DD.
function weekOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}
const quoted = (s: string) => `"${s}"`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function checkFeasibility(plan: WorkspacePlan, ctx: FeasibilityContext): Feasibility {
  const errors: FeasibilityIssue[] = [];
  const warnings: FeasibilityIssue[] = [];
  const byKey = new Map(plan.tasks.map(t => [t.key, t]));
  const hasSteps = new Set(plan.tasks.filter(t => t.parent).map(t => t.parent!));

  // ── Structure: steps and waits name tasks of the plan, never in a circle ──
  for (const t of plan.tasks) {
    if (t.parent && !byKey.has(t.parent)) errors.push({ level: "error", code: "broken_step", message: `${quoted(t.title)} is a step of a task that isn't in the plan.`, tasks: [t.key] });
    for (const a of t.after ?? []) if (!byKey.has(a) || a === t.key) errors.push({ level: "error", code: "broken_wait", message: `${quoted(t.title)} waits on a task that isn't in the plan.`, tasks: [t.key] });
  }
  const waits: Wait[] = [];
  for (const t of plan.tasks) for (const a of t.after ?? []) {
    if (!byKey.has(a) || a === t.key) continue;
    if (wouldLoop(waits, t.key, a)) errors.push({ level: "error", code: "wait_loop", message: `${quoted(t.title)} and ${quoted(byKey.get(a)!.title)} wait on each other, so neither can start.`, tasks: [t.key, a] });
    else waits.push({ task: t.key, on: a });
  }

  // ── Dates against each other ──
  for (const t of plan.tasks) {
    for (const a of t.after ?? []) {
      const on = byKey.get(a);
      if (on?.dueDay && t.dueDay && t.dueDay < on.dueDay) {
        errors.push({ level: "error", code: "wait_order", message: `${quoted(t.title)} is due ${t.dueDay}, before ${quoted(on.title)} (due ${on.dueDay}), which it waits on.`, tasks: [t.key, on.key] });
      }
    }
    const parent = t.parent ? byKey.get(t.parent) : undefined;
    if (parent?.dueDay && t.dueDay && t.dueDay > parent.dueDay) {
      errors.push({ level: "error", code: "step_after_parent", message: `The step ${quoted(t.title)} is due ${t.dueDay}, after the task it is part of, ${quoted(parent.title)} (due ${parent.dueDay}).`, tasks: [t.key, parent.key] });
    }
  }
  // Work due after the last deadline it leads to: its subject's (or, when
  // the plan has one deadline in all, that one).
  const deadlines = plan.dates.filter(d => DEADLINE_KINDS.has(d.kind));
  const lastFor = (subject: string | null) => {
    const own = deadlines.filter(d => d.subject !== null && subject !== null && d.subject.toLowerCase() === subject.toLowerCase());
    const pool = own.length ? own : deadlines.length === 1 ? deadlines : deadlines.filter(d => d.subject === null);
    return pool.reduce<(typeof deadlines)[number] | null>((m, d) => (!m || d.day > m.day ? d : m), null);
  };
  const late = new Map<string, { title: string; day: string; tasks: PlanTask[] }>();
  for (const t of plan.tasks) {
    if (!t.dueDay) continue;
    const d = lastFor(t.subject);
    if (d && t.dueDay > d.day) {
      const k = `${d.title}\n${d.day}`;
      late.set(k, { title: d.title, day: d.day, tasks: [...(late.get(k)?.tasks ?? []), t] });
    }
  }
  for (const { title, day, tasks } of late.values()) {
    errors.push({ level: "error", code: "after_deadline", message: `${tasks.length === 1 ? quoted(tasks[0]!.title) + " is" : `${plural(tasks.length, "task")} (${tasks.slice(0, 3).map(t => quoted(t.title)).join(", ")}${tasks.length > 3 ? ", …" : ""}) are`} due after ${title} on ${day}.`, tasks: tasks.map(t => t.key) });
  }

  // ── Workload against the time they said they have ──
  // Only the work itself is counted: a task with steps is counted in its steps.
  const work = plan.tasks.filter(t => !hasSteps.has(t.key));
  if (ctx.hoursPerWeek) {
    const weeks = new Map<string, { minutes: number; tasks: string[] }>();
    for (const t of work) {
      if (!t.dueDay || !t.estimatedMinutes) continue;
      const w = weekOf(t.dueDay);
      const at = weeks.get(w) ?? { minutes: 0, tasks: [] };
      at.minutes += t.estimatedMinutes; at.tasks.push(t.key);
      weeks.set(w, at);
    }
    for (const [w, { minutes, tasks }] of [...weeks].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (minutes > ctx.hoursPerWeek * 60) {
        warnings.push({ level: "warning", code: "week_overload", message: `The week of ${w} has about ${Math.round(minutes / 6) / 10} hours of work due; you said you have about ${ctx.hoursPerWeek} a week.`, tasks });
      }
    }
    for (const m of milestonesOf(plan)) {
      const h = m.topic.milestone?.hoursPerWeek;
      if (h && h > ctx.hoursPerWeek) warnings.push({ level: "warning", code: "milestone_overload", message: `The milestone ${quoted(m.topic.name)} assumes ${h} hours a week; you said you have about ${ctx.hoursPerWeek}.`, subject: m.subject });
    }
  }
  if (deadlines.length) {
    const unestimated = work.filter(t => t.dueDay && !t.estimatedMinutes);
    if (unestimated.length) warnings.push({ level: "warning", code: "missing_estimates", message: `${plural(unestimated.length, "task")} with a due day ${unestimated.length === 1 ? "has" : "have"} no time estimate, so the load before ${deadlines.map(d => d.title).slice(0, 2).join(" and ")} can't be checked.`, tasks: unestimated.map(t => t.key) });
  }

  // ── Near-duplicates: titles the same but for case, spaces and punctuation ──
  const seen = new Map<string, PlanTask>();
  for (const t of plan.tasks) {
    const k = `${t.parent ?? ""}\n${words(t.title)}`;
    const was = seen.get(k);
    if (was) warnings.push({ level: "warning", code: "duplicate_titles", message: `${quoted(was.title)} and ${quoted(t.title)} look like the same task.`, tasks: [was.key, t.key] });
    else seen.set(k, t);
  }
  for (const s of plan.subjects) {
    const names = new Map<string, string>();
    for (const t of s.topics) {
      const k = words(t.name);
      if (names.has(k) && names.get(k) !== t.name) warnings.push({ level: "warning", code: "duplicate_titles", message: `${quoted(names.get(k)!)} and ${quoted(t.name)} in ${s.name} look like the same topic.`, subject: s.name });
      else names.set(k, t.name);
    }
  }

  // ── Study plans: every topic studied has practice or revision behind it ──
  if (ctx.kind === "exam" || ctx.kind === "semester") {
    for (const s of plan.subjects) {
      const parents = parentTopicNames(s);
      const leaves = s.topics.filter(t => t.kind !== "milestone" && !parents.has(t.name.toLowerCase()));
      if (leaves.length === 0) continue;
      // A task under a topic covers it and everything inside it; one under the subject alone, none.
      const covered = new Set<string>();
      const under = (name: string): string[] => [name.toLowerCase(), ...s.topics.filter(t => t.parent && t.parent.toLowerCase() === name.toLowerCase()).flatMap(t => under(t.name))];
      for (const t of plan.tasks) if (t.topic && t.subject?.toLowerCase() === s.name.toLowerCase()) for (const n of under(t.topic)) covered.add(n);
      const bare = leaves.filter(t => !covered.has(t.name.toLowerCase()));
      if (bare.length) warnings.push({ level: "warning", code: "unpractised_topics", message: `${bare.length} of ${plural(leaves.length, "topic")} in ${s.name} have no practice or revision task (${bare.slice(0, 3).map(t => t.name).join(", ")}${bare.length > 3 ? ", …" : ""}).`, subject: s.name });
    }
  }

  // ── Tasks filed nowhere, and dated items nobody gave ──
  const unfiled = plan.subjects.length > 0 ? plan.tasks.filter(t => !t.parent && !t.subject) : [];
  if (unfiled.length) warnings.push({ level: "warning", code: "unfiled_tasks", message: `${plural(unfiled.length, "task")} ${unfiled.length === 1 ? "is" : "are"} filed under no subject, so ${unfiled.length === 1 ? "it sits" : "they sit"} apart on the Knowledge Map (${unfiled.slice(0, 3).map(t => quoted(t.title)).join(", ")}${unfiled.length > 3 ? ", …" : ""}).`, tasks: unfiled.map(t => t.key) });
  if (ctx.learnerText) for (const d of plan.dates) {
    if (!namesDay(ctx.learnerText, d.day)) warnings.push({ level: "warning", code: "unconfirmed_date", message: `${d.title} on ${d.day} is not a day you gave: check it, or remove it.` });
  }

  // ── Files the plan was meant to follow ──
  for (const f of plan.sources) if (!f.read) warnings.push({ level: "warning", code: "unread_file", message: `${f.file} couldn't be read${f.note ? ` (${f.note})` : ""}, so the plan doesn't follow it.` });
  const read = plan.sources.filter(f => f.read);
  if (read.length) {
    const cited = plan.subjects.some(s => s.topics.some(t => t.sources.length > 0)) || plan.notes.some(n => n.sources.length > 0);
    if (!cited) warnings.push({ level: "warning", code: "syllabus_uncited", message: `Nothing in the plan cites ${read.map(f => f.file).join(", ")}, so it can't be checked against what you shared.` });
  }

  return { errors, warnings };
}
