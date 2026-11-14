// ─── A browser-agent task's ticket ────────────────────────────────────────────
// One task (one thing the learner asked in the side panel) is one AI request
// on their allowance, counted when it starts (POST …/agent/start), however
// many steps it then takes: a click is not a request. The steps are still
// bounded (AGENT_TASK_STEPS server-side, the extension's own limits lower)
// and every token they use is metered on the account (apps/api metered.ts
// `withinTask`).
//
// The ticket says which task a step belongs to, so a step without a started
// task is refused: `<taskId>.<issuedAt>.<hmac>`, keyed with the server secret
// and bound to the extension connection that started it. Nothing is stored;
// the step count per task is the route's in-memory limiter (one instance).

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { serverSecret } from "../../auth/secrets";

export const AGENT_TASK_TTL_MS = 45 * 60_000;
export const AGENT_TASK_STEPS = 40;

const sign = (connectionId: string, taskId: string, issuedAt: number) =>
  createHmac("sha256", serverSecret()).update(`agent-task:${connectionId}:${taskId}:${issuedAt}`).digest("base64url");

export function issueAgentTicket(connectionId: string, now = Date.now()): { ticket: string; taskId: string; expiresAt: number } {
  const taskId = randomBytes(12).toString("hex");
  return { ticket: `${taskId}.${now}.${sign(connectionId, taskId, now)}`, taskId, expiresAt: now + AGENT_TASK_TTL_MS };
}

export type TicketCheck = { ok: true; taskId: string } | { ok: false; reason: "missing" | "invalid" | "expired" };

export function checkAgentTicket(ticket: unknown, connectionId: string, now = Date.now()): TicketCheck {
  if (typeof ticket !== "string" || !ticket) return { ok: false, reason: "missing" };
  const parts = ticket.split(".");
  if (parts.length !== 3) return { ok: false, reason: "invalid" };
  const [taskId, at, mac] = parts as [string, string, string];
  const issuedAt = Number(at);
  if (taskId.length !== 24 || !Number.isSafeInteger(issuedAt) || !mac) return { ok: false, reason: "invalid" };
  const want = Buffer.from(sign(connectionId, taskId, issuedAt));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "invalid" };
  if (issuedAt > now + 60_000 || now - issuedAt > AGENT_TASK_TTL_MS) return { ok: false, reason: "expired" };
  return { ok: true, taskId };
}
