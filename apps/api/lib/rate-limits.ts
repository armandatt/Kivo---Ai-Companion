// Route-side rate limits (packages/api/src/rate-limits, docs/RATE_LIMITS.md).
// A route names its policy; this file finds who is asking (the account
// behind the learner, the same on every surface; the client address when the
// policy counts addresses) and turns a refusal into the one response shape.
//
//   const limited = await rateGate("notes.tutor", { learner: access.platformChatId, req })
//   if (limited) return limited
//
// The account is billing's usage key for the learner (`user:<id>`, cached a
// minute with the plan tier: rate-limits/account.ts), so a gate costs one
// round trip for the counters.

import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
//@ts-ignore
import { accountOf, acquireSlot, checkRate, releaseSlot, renewSlot, clientAddress, httpRefusal, safeSubject, type Decision, type Refusal, type Slot, type Who } from "@repo/api/rate-limits"

export interface GateWho {
  learner?: string | null      // platformChatId: resolved to the account
  userId?: string | null       // a signed-in account without a learner (billing, OAuth consent)
  client?: string | null       // OAuth client, MCP grant or extension connection id
  task?: string | null         // browser-agent task id
  req?: Request                // for policies that count client addresses
  weight?: number              // units this request counts (batch items, megabytes)
  headers?: Record<string, string> // extra headers on a refusal (the extension's CORS)
}

export async function whoOf(g: GateWho): Promise<Who> {
  const account = g.learner ? await accountOf(g.learner) : null
  const user = account?.user ?? (g.userId ? safeSubject("user", g.userId) : null)
  return {
    user,
    tier: account?.tier ?? null,
    ip: g.req ? clientAddress(g.req.headers).subject : null,
    client: g.client ? safeSubject("client", g.client) : null,
    task: g.task ? safeSubject("task", g.task) : null,
    authenticated: Boolean(user),
  }
}

export function refusalResponse(r: Refusal, extraHeaders: Record<string, string> = {}): NextResponse {
  const h = httpRefusal(r)
  return NextResponse.json(h.body, { status: h.status, headers: { ...h.headers, ...extraHeaders } })
}

/** Checks each policy (all are counted); the first refusal, as a response, or null. */
export async function rateGate(policies: string | string[], g: GateWho): Promise<NextResponse | null> {
  const who = await whoOf(g)
  const list = Array.isArray(policies) ? policies : [policies]
  const decisions: Decision[] = await Promise.all(list.map(p => checkRate(p, who, { weight: g.weight })))
  const refused = decisions.find((d): d is Refusal => !d.allowed)
  return refused ? refusalResponse(refused, g.headers) : null
}

/**
 * A slot of a policy's concurrency limit for one operation. `holder` names
 * the operation (a task or job id) so a retry reuses its slot; omitted, the
 * slot is this request's. Run `release()` in `finally`.
 */
export async function concurrencyGate(policy: string, g: GateWho, holder?: string): Promise<{ refused: NextResponse; release?: undefined } | { refused?: undefined; release: () => Promise<void> }> {
  const who = await whoOf(g)
  const slot: Slot = await acquireSlot(policy, who, holder ?? randomUUID())
  if (!slot.decision.allowed) return { refused: refusalResponse(slot.decision as Refusal, g.headers) }
  return { release: slot.release }
}

/**
 * Every learner-initiated AI request, on any surface: the account-wide AI
 * rate (ai.account) and its at-once limit, held until the work ends. Called
 * by `metered` and the AI routes that do not go through it.
 */
export async function aiAdmission(learner: string, extra: { req?: Request; headers?: Record<string, string> } = {}): Promise<{ refused: NextResponse; release?: undefined } | { refused?: undefined; release: () => Promise<void> }> {
  const g: GateWho = { learner, req: extra.req, headers: extra.headers }
  const limited = await rateGate("ai.account", g)
  if (limited) return { refused: limited }
  return concurrencyGate("ai.account", g)
}

/** Keeps an operation's slot taken in an earlier request (a running agent task). */
export async function renewGate(policy: string, g: GateWho, holder: string): Promise<void> {
  try { await renewSlot(policy, await whoOf(g), holder) } catch { /* the slot expires; the work goes on */ }
}

/** Gives back a slot taken in an earlier request. Safe to call twice. */
export async function releaseGate(policy: string, g: GateWho, holder: string): Promise<void> {
  try { await releaseSlot(policy, await whoOf(g), holder) } catch { /* the slot expires */ }
}
