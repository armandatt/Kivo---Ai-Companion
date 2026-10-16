// ─── The learner's changes to today's plan ────────────────────────────────────
// Owner of NovaPlanOverride: nothing else reads or writes it. The Planning
// Engine still works the day out on every request (planning-inputs.ts, the
// orchestrator); what is stored here is only what the learner changed about
// that result for their own calendar day: a topic left out ("skip"), a topic
// added ("pin"), and the order of the blocks ("order").
//
// The rules, held by plan-overrides.test.ts and nova-plan-overrides.itest.ts:
//   - The day is the server's: the learner's calendar day in their timezone.
//     Nothing from the request names a day, a learner or a profile; an
//     override for another day cannot be written, and yesterday's do not
//     apply today.
//   - A topic must be the learner's own and not archived.
//   - Skipping and adding the same topic are opposites: setting one clears
//     the other. A repeat is an upsert, so a retry or a double click changes
//     nothing. Clearing one is how a change is undone.
//   - An order replaces the day's order whole, in one transaction.
//   - The engine applies them inside the day's time (generateStudyPlan): an
//     override never lengthens a day. Nothing here touches sessions, mastery,
//     tasks or exams, and no model writes an override.

import { prisma } from "@repo/db/client";
import { dayKey, resolveTimezone } from "../engines/learner-calendar";
import type { PlanOverrideResponse } from "./plan-overrides.types";

export const PLAN_ORDER_MAX = 20;
const KINDS = new Set(["skip", "pin"]);

export interface DayOverrides { skip: string[]; pin: string[]; order: Array<{ topicId: string; position: number }> }
export const NO_OVERRIDES: DayOverrides = { skip: [], pin: [], order: [] };

async function learnerDay(profileId: string, now: Date): Promise<string> {
  const p = await prisma.novaAcademicProfile.findUnique({ where: { id: profileId }, select: { timezone: true } });
  return dayKey(now, resolveTimezone(p?.timezone ?? null));
}

// The day's overrides, for the engine. Only topics that are still the
// learner's and not archived count.
export async function loadDayOverrides(profileId: string, day: string): Promise<DayOverrides> {
  const rows = await prisma.novaPlanOverride.findMany({
    where:   { profileId, day, topic: { archivedAt: null, subject: { profileId } } },
    select:  { kind: true, topicId: true, position: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    skip:  rows.filter(r => r.kind === "skip").map(r => r.topicId),
    pin:   rows.filter(r => r.kind === "pin").map(r => r.topicId),
    order: rows.filter(r => r.kind === "order" && r.position !== null).map(r => ({ topicId: r.topicId, position: r.position! })),
  };
}

// Today's, for a learner by their profile: the day is worked out here.
export async function loadTodayOverrides(profileId: string, now: Date): Promise<{ day: string; overrides: DayOverrides }> {
  const day = await learnerDay(profileId, now);
  return { day, overrides: await loadDayOverrides(profileId, day) };
}

// What today's overrides name, for the pages ("Skipped today: Paging").
export async function describeTodayOverrides(profileId: string, now: Date): Promise<{ skipped: Array<{ topicId: string; topicName: string }>; added: Array<{ topicId: string; topicName: string }>; ordered: boolean }> {
  const day = await learnerDay(profileId, now);
  const rows = await prisma.novaPlanOverride.findMany({
    where:   { profileId, day, topic: { archivedAt: null, subject: { profileId } } },
    select:  { kind: true, topicId: true, topic: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const named = (kind: string) => rows.filter(r => r.kind === kind).map(r => ({ topicId: r.topicId, topicName: r.topic.name }));
  return { skipped: named("skip"), added: named("pin"), ordered: rows.some(r => r.kind === "order") };
}

async function ownActiveTopic(profileId: string, topicId: string): Promise<boolean> {
  return (await prisma.novaTopicMastery.count({ where: { id: topicId, archivedAt: null, subject: { profileId } } })) === 1;
}

const refuse = (error: Extract<PlanOverrideResponse, { ok: false }>["error"], message: string): PlanOverrideResponse => ({ ok: false, error, message });

// One change to today, from an untrusted request body:
//   { action: "skip" | "pin", topicId }      leave a topic out / add it
//   { action: "clear", kind: "skip" | "pin", topicId }   undo that
//   { action: "order", topicIds: [...] }     the blocks in this order
//   { action: "clear_order" }                back to the engine's order
export async function changeTodayPlan(profileId: string, raw: unknown, now = new Date()): Promise<PlanOverrideResponse> {
  if (!raw || typeof raw !== "object") return refuse("invalid", "That isn't a change Nova can make to today's plan.");
  const input = raw as Record<string, unknown>;
  const day = await learnerDay(profileId, now);
  const str = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

  switch (input.action) {
    case "skip":
    case "pin": {
      const kind = input.action;
      if (!str(input.topicId)) return refuse("invalid", "Name a topic.");
      if (!await ownActiveTopic(profileId, input.topicId)) return refuse("not_found", "That topic isn't one of yours.");
      const topicId = input.topicId;
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "NovaAcademicProfile" WHERE id = ${profileId} FOR UPDATE`;
        // The opposite change on the same topic is taken back.
        await tx.novaPlanOverride.deleteMany({ where: { profileId, day, topicId, kind: kind === "skip" ? "pin" : "skip" } });
        await tx.novaPlanOverride.upsert({
          where:  { profileId_day_kind_topicId: { profileId, day, kind, topicId } },
          create: { profileId, day, kind, topicId },
          update: {},
        });
      });
      return { ok: true, day };
    }
    case "clear": {
      if (!str(input.topicId) || typeof input.kind !== "string" || !KINDS.has(input.kind)) return refuse("invalid", "That isn't a change Nova can make to today's plan.");
      await prisma.novaPlanOverride.deleteMany({ where: { profileId, day, topicId: input.topicId, kind: input.kind } });
      return { ok: true, day };
    }
    case "order": {
      const ids = input.topicIds;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > PLAN_ORDER_MAX || !ids.every(str) || new Set(ids).size !== ids.length) {
        return refuse("invalid", "That isn't an order Nova can use.");
      }
      const owned = await prisma.novaTopicMastery.count({ where: { id: { in: ids }, archivedAt: null, subject: { profileId } } });
      if (owned !== ids.length) return refuse("not_found", "Some of those topics aren't yours.");
      await prisma.$transaction(async tx => {
        // One order change at a time per learner (the lock a session start
        // takes): two at once would both replace the rows and collide.
        await tx.$queryRaw`SELECT id FROM "NovaAcademicProfile" WHERE id = ${profileId} FOR UPDATE`;
        await tx.novaPlanOverride.deleteMany({ where: { profileId, day, kind: "order" } });
        await tx.novaPlanOverride.createMany({ data: ids.map((topicId, position) => ({ profileId, day, kind: "order", topicId, position })) });
      });
      return { ok: true, day };
    }
    case "clear_order":
      await prisma.novaPlanOverride.deleteMany({ where: { profileId, day, kind: "order" } });
      return { ok: true, day };
    default:
      return refuse("invalid", "That isn't a change Nova can make to today's plan.");
  }
}
