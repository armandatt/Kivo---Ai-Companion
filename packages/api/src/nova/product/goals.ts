// ─── Goals ────────────────────────────────────────────────────────────────────
// What the learner says they are working toward. The one place it is kept is
// NovaAcademicProfile.goals, and this file is the only code that decides what
// goes there: Today, the Planner, Progress and Nova's context all read that
// field and nothing else.
//
// Where a goal comes from:
//
//   sign-up    The quiz asks "What are you working toward right now?" and the
//              answer is stored on the web account (UserProfile.primaryGoal30d).
//              It is copied here once, at the moment the learner's Nova profile
//              is first created (seedGoalFromSignup, called by product/setup.ts
//              inside the create). It is never read again after that.
//   the editor Whatever the learner saves replaces the list, an empty list
//              included.
//
// So a goal the learner cleared stays cleared: the profile exists, nothing
// creates it a second time, and nothing else copies the sign-up answer.
//
// A goal is the learner's statement of intent. It is not evidence, mastery or
// memory, and nothing here touches sessions, topics, exams or tasks.
// No LLM call. The learner is whoever the key resolves to; nothing here takes
// an id from a client.

import { prisma } from "@repo/db/client";
import { learnerKey, webAccountOf } from "./learner-key";
import { GOALS_MAX, GOAL_TEXT_MAX, type GoalsError } from "./goals.types";
import { dailyColumns, seedDailyMinutesFromSignup } from "../adapters/account-preferences-adapter";

export { GOALS_MAX, GOAL_TEXT_MAX } from "./goals.types";
export type { GoalsError, GoalsResponse, NovaGoalsView } from "./goals.types";

// ── Validation (pure) ─────────────────────────────────────────────────────────

// One line: control characters and runs of whitespace become one space.
const oneLine = (text: string): string =>
  [...text].map(ch => (ch.trim() === "" || ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").split(" ").filter(Boolean).join(" ");

// Characters that draw nothing: zero-width space, non-joiner, joiner, word
// joiner, the byte-order mark and the soft hyphen. They are left alone inside
// a goal (scripts and emoji use the joiners), but a goal made of nothing else
// says nothing and is treated as blank.
const INVISIBLE: ReadonlySet<number> = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad]);
const saysSomething = (text: string): boolean => [...text].some(ch => ch !== " " && !INVISIBLE.has(ch.codePointAt(0)!));

// Text longer than this is not read at all: no goal at the limit needs more,
// however it was padded, and the work done on one entry stays small.
const RAW_ENTRY_MAX = GOAL_TEXT_MAX * 4;

export type NormalizedGoals =
  | { ok: true; goals: string[] }
  | { ok: false; error: GoalsError; message: string };

// Reads an untrusted list. Blank entries are dropped and a goal said twice is
// kept once. Nothing is shortened or cut off to make it fit: a list that is
// too long, or a goal that is, is refused and nothing is saved.
//
// The work is bounded whatever is sent: each entry is looked at once, a repeat
// is found by lookup, and reading stops at the first goal past the limit.
export function normalizeGoals(raw: unknown): NormalizedGoals {
  if (!Array.isArray(raw)) return { ok: false, error: "invalid", message: "That is not a list of goals." };
  const goals: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") return { ok: false, error: "invalid", message: "A goal is a line of text." };
    if (item.length > RAW_ENTRY_MAX) return { ok: false, error: "too_long", message: `Keep each goal under ${GOAL_TEXT_MAX} characters.` };
    const goal = oneLine(item);
    if (!saysSomething(goal)) continue;
    const key = goal.toLowerCase();
    if (seen.has(key)) continue;
    if (goal.length > GOAL_TEXT_MAX) return { ok: false, error: "too_long", message: `Keep each goal under ${GOAL_TEXT_MAX} characters.` };
    if (goals.length === GOALS_MAX) return { ok: false, error: "too_many", message: `At most ${GOALS_MAX} goals.` };
    seen.add(key);
    goals.push(goal);
  }
  return { ok: true, goals };
}

// ── The sign-up answer ────────────────────────────────────────────────────────

type Db = Pick<typeof prisma, "userProfile">;

// The answer the learner gave at sign-up, as a goal list: one goal or none.
// Longer than a goal may be, it is kept to the limit; it is theirs, so it is
// not thrown away for its length.
//
// The web account behind a learner: a web learner's key names it; a Telegram
// learner's is the one account linked to that chat. A chat two accounts point
// at has no single owner to take an answer from, and none is taken.
async function signupGoal(db: Db, platformChatId: string): Promise<string[]> {
  const userId = webAccountOf(platformChatId);
  let answer: string | null = null;
  if (userId !== null) {
    answer = (await db.userProfile.findUnique({ where: { userId }, select: { primaryGoal30d: true } }))?.primaryGoal30d ?? null;
  } else {
    const linked = await db.userProfile.findMany({ where: { telegramChatId: platformChatId }, select: { primaryGoal30d: true }, take: 2 });
    answer = linked.length === 1 ? linked[0]!.primaryGoal30d : null;
  }
  const goal = oneLine((answer ?? "").slice(0, RAW_ENTRY_MAX)).slice(0, GOAL_TEXT_MAX).trim();
  return saysSomething(goal) ? [goal] : [];
}

// The goals a brand-new Nova profile starts with. For the `create` half of
// the upsert that makes the profile, and for nothing else: a profile that
// already exists is never given this.
export const seedGoalFromSignup = (db: Db, platformChatId: string): Promise<string[]> => signupGoal(db, platformChatId);

// ── Read and write ────────────────────────────────────────────────────────────

// null: nobody behind this key.
// Before the learner's profile exists (they have not started setup), this is
// the sign-up answer that will become their goal when it does: the editor
// shows what Nova is about to have, not an empty list that then fills itself.
// Reads only.
export async function loadGoals(platformChatId: string): Promise<string[] | null> {
  const user = await prisma.messengerUser.findUnique({
    where:  learnerKey(platformChatId),
    select: { novaAcademicProfile: { select: { goals: true } } },
  });
  if (!user) return null;
  return user.novaAcademicProfile ? user.novaAcademicProfile.goals : signupGoal(prisma, platformChatId);
}

export type SaveGoalsResult =
  | { status: "saved"; goals: string[] }
  | { status: "invalid"; error: GoalsError; message: string }
  | { status: "not_ready" };

// Replaces the learner's goals with what they saved. An empty list clears
// them. Saved before setup has made a profile, it makes one holding exactly
// this list, so the sign-up answer is not added back behind it.
export async function saveGoals(platformChatId: string, raw: unknown): Promise<SaveGoalsResult> {
  const parsed = normalizeGoals(raw);
  if (!parsed.ok) return { status: "invalid", error: parsed.error, message: parsed.message };
  const user = await prisma.messengerUser.findUnique({ where: learnerKey(platformChatId), select: { id: true } });
  if (!user) return { status: "not_ready" };
  const saved = await prisma.novaAcademicProfile.upsert({
    where:  { userId: user.id },
    create: { userId: user.id, goals: parsed.goals, ...dailyColumns(await seedDailyMinutesFromSignup(platformChatId)) },
    update: { goals: { set: parsed.goals } },
    select: { goals: true },
  });
  return { status: "saved", goals: saved.goals };
}
