// ─── The plan Nova prepares before the learner arrives (item 12, 28 Nov) ────
// At the learner's check-in time (the scheduler, nova-proactive-cron.ts), or
// the first time they open Today after it (a learner with no Telegram, or a
// tick that was missed), Nova prepares today's plan: one full-context model
// call (askCopilot with proposePlan: deadlines, exams, priorities, the
// Knowledge Map, goals, recent study), with code holding the rules (only their
// own tasks and topics, at least three items, a ranked fallback). It is kept
// apart from their flow and never applied by itself: on Today they take it
// (all of it or the items they keep), tweak it with Nova, or set it aside.
// One per learner per local day; preparing twice returns the first.

import { prisma } from "@repo/db/client";
import { askCopilot, propose, PROPOSE_PLAN_MESSAGE } from "./day-copilot";
import { loadDayFlow } from "./day-flow";
import { loadAccountPreferences } from "../adapters/account-preferences-adapter";
import { localHour, localMinute, resolveTimezone } from "../engines/learner-calendar";
import type { FlowOp, PendingChange } from "./day-flow.types";
import { recentNoteActivity } from "./notes";
import { startInteraction } from "../../services/llm-usage";

// Only for learners active in the last ACTIVE_DAYS days (owner decision 28 Nov,
// PR #113 B.3): a study session, a note edited, today's flow touched or a
// message to Nova. Nobody's plan is prepared for an account nobody opens.
export const ACTIVE_DAYS = 7;
export async function activeWithin(profileId: string, platformChatId: string, now = new Date(), days = ACTIVE_DAYS): Promise<boolean> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const [sessions, notes, flows, messages] = await Promise.all([
    prisma.novaStudySession.count({ where: { profileId, sessionDate: { gte: since } } }),
    recentNoteActivity(profileId, since, 1),
    prisma.novaDayFlow.count({ where: { profileId, updatedAt: { gte: since } } }),
    prisma.companionMessage.count({ where: { user: { platformChatId }, role: "user", createdAt: { gte: since } } }),
  ]);
  return sessions > 0 || notes.length > 0 || flows > 0 || messages > 0;
}

export type PreparedTrigger = "check_in" | "first_open";

export interface PreparedPlanView {
  day: string;
  reply: string;
  preparedAt: string;
  trigger: PreparedTrigger;
  // The plan read against today's flow as it now stands: what taking it would do.
  pending: PendingChange;
}

const isUnique = (e: unknown) => (e as { code?: string } | null)?.code === "P2002";

// Prepares today's plan once. null: nothing to plan from, or the model and the
// ranking both came back empty. Never writes to the learner's flow.
export async function preparePlan(
  profileId: string, platformChatId: string, trigger: PreparedTrigger,
  ask: typeof askCopilot = askCopilot,
): Promise<{ id: string; day: string } | null> {
  const flow = await loadDayFlow(profileId, platformChatId);
  const had = await prisma.novaPreparedPlan.findUnique({ where: { profileId_day: { profileId, day: flow.day } }, select: { id: true, day: true } });
  if (had) return had;
  if (process.env.NOVA_PREPARED_PLANS === "off") return null;
  if (!await activeWithin(profileId, platformChatId)) return null;
  // Its model call is recorded in the AI telemetry as "prepared_plan" (B.3),
  // background at check-in; never counted against the learner's allowance.
  const res = await startInteraction({
    feature: "prepared_plan", surface: trigger === "check_in" ? "background" : "web", learner: platformChatId, profileId,
    requestId: `prepared:${profileId}:${flow.day}`, isBackground: trigger === "check_in", isAllowanceCounted: false,
  }, () => ask(profileId, platformChatId, { message: PROPOSE_PLAN_MESSAGE, proposePlan: true, version: flow.version }));
  if (!res.ok || !res.pending) return null;
  try {
    const row = await prisma.novaPreparedPlan.create({
      data: { profileId, day: flow.day, ops: res.pending.ops as unknown as object, reply: res.reply.slice(0, 2_000), trigger },
      select: { id: true, day: true },
    });
    console.log(JSON.stringify({ layer: "nova:prepared_plan", profileId, day: flow.day, trigger, items: res.pending.ops.length }));
    return row;
  } catch (e) {
    if (isUnique(e)) return prisma.novaPreparedPlan.findUnique({ where: { profileId_day: { profileId, day: flow.day } }, select: { id: true, day: true } });
    throw e;
  }
}

// Whether Today may prepare it on opening: past their check-in time, or at
// any time when they chose none.
export async function pastCheckin(platformChatId: string, now = new Date()): Promise<boolean> {
  const prefs = await loadAccountPreferences(platformChatId).catch(() => null);
  if (!prefs || prefs.checkinMinute === null) return true;
  const zone = resolveTimezone(prefs.timezone);
  return localHour(now, zone) * 60 + localMinute(now, zone) >= prefs.checkinMinute;
}

// Today's prepared plan, read against the flow as it stands. Items already in
// the flow are left out; nothing left, or set aside, or taken: null.
export async function loadPreparedPlan(
  profileId: string, platformChatId: string,
  // force: prepare now whatever the time (the learner pressed Propose a plan).
  opts: { prepareIfMissing?: boolean; force?: boolean; now?: Date; ask?: typeof askCopilot } = {},
): Promise<PreparedPlanView | null> {
  const flow = await loadDayFlow(profileId, platformChatId, opts.now);
  let row = await prisma.novaPreparedPlan.findUnique({ where: { profileId_day: { profileId, day: flow.day } } });
  if (!row && opts.prepareIfMissing && (opts.force || await pastCheckin(platformChatId, opts.now))) {
    await preparePlan(profileId, platformChatId, "first_open", opts.ask).catch(err => { console.error("[nova:prepared_plan] prepare failed", err); return null; });
    row = await prisma.novaPreparedPlan.findUnique({ where: { profileId_day: { profileId, day: flow.day } } });
  }
  if (!row || row.status !== "ready") return null;
  const inFlow = new Set(flow.items.flatMap(i => [i.taskId ? `t:${i.taskId}` : null, i.topicId ? `p:${i.topicId}` : null].filter((x): x is string => x !== null)));
  const ops = (Array.isArray(row.ops) ? row.ops as unknown as FlowOp[] : []).filter(o => o.op === "add" && (
    o.item.kind === "task" ? !inFlow.has(`t:${o.item.taskId}`) : o.item.kind === "topic" ? !inFlow.has(`p:${o.item.topicId}`) : true));
  if (!ops.length) return null;
  const made = await propose(profileId, platformChatId, flow, ops);
  if (!made.ok) return null;
  return { day: row.day, reply: row.reply, preparedAt: row.preparedAt.toISOString(), trigger: row.trigger as PreparedTrigger, pending: made.pending };
}

// Taken (applied) or set aside: it is not shown again today.
export async function closePreparedPlan(profileId: string, day: string, status: "taken" | "dismissed"): Promise<boolean> {
  const done = await prisma.novaPreparedPlan.updateMany({ where: { profileId, day, status: "ready" }, data: { status, closedAt: new Date() } });
  return done.count === 1;
}
