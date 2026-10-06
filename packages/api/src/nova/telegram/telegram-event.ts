// ─── Telegram update → TelegramEvent ──────────────────────────────────────────
// Transport normalisation. Pure: no DB, no model, and no reading of what a
// message means. It answers only "what kind of input is this?".
//
// Everything in an update is untrusted. Nothing here is used as authority:
// the chat id selects a learner only after the webhook secret has been
// checked, and a callback's data is only a reference the server looks up.

import type { TelegramCommandName, TelegramEvent } from "./telegram.types";

const COMMANDS: readonly TelegramCommandName[] = [
  "start", "today", "focus", "done", "status", "settings", "help",
  "study", "explain", "quiz", "revise",
];

export const MAX_TEXT_LENGTH     = 1000;
export const MAX_CALLBACK_LENGTH = 64;     // Telegram's own limit on callback data

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const idOf = (v: unknown): string | null =>
  typeof v === "number" && Number.isSafeInteger(v) ? String(v)
  : typeof v === "string" && v.length > 0 && v.length <= 32 ? v
  : null;

// "/focus@nova_bot deadlocks" → { command: "focus", argument: "deadlocks" }.
// A slash command is protocol: it is split on whitespace, never interpreted.
export function parseCommand(text: string): { name: string; argument: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/") || trimmed.length < 2) return null;
  const breaks = [trimmed.indexOf(" "), trimmed.indexOf("\n")].filter(i => i !== -1);
  const end    = breaks.length > 0 ? Math.min(...breaks) : trimmed.length;
  const head = trimmed.slice(1, end);
  const at   = head.indexOf("@");
  const name = (at === -1 ? head : head.slice(0, at)).toLowerCase();
  if (!name) return null;
  return { name, argument: trimmed.slice(end).trim().slice(0, 120) };
}

export function normalizeTelegramUpdate(body: unknown): TelegramEvent {
  const update   = isRecord(body) ? body : {};
  const updateId = typeof update["update_id"] === "number" ? update["update_id"] : null;

  // ── A button tap ───────────────────────────────────────────────────────────
  const cb = update["callback_query"];
  if (isRecord(cb)) {
    const message = isRecord(cb["message"]) ? cb["message"] : {};
    const chat    = isRecord(message["chat"]) ? message["chat"] : {};
    const chatId  = idOf(chat["id"]);
    const fromId  = isRecord(cb["from"]) ? idOf(cb["from"]["id"]) : null;
    if (!chatId) return { kind: "ignored", reason: "no_chat", updateId, chatId: null };
    if (chat["type"] !== "private") return { kind: "ignored", reason: "not_private", updateId, chatId };
    const callbackId = typeof cb["id"] === "string" ? cb["id"] : null;
    const data       = typeof cb["data"] === "string" ? cb["data"] : null;
    if (!callbackId || !data || data.length > MAX_CALLBACK_LENGTH) {
      return { kind: "ignored", reason: "malformed", updateId, chatId };
    }
    return {
      kind: "callback", updateId, chatId, fromId, callbackId, data,
      messageId: typeof message["message_id"] === "number" ? message["message_id"] : null,
    };
  }

  // ── A message ──────────────────────────────────────────────────────────────
  const message = update["message"];
  if (!isRecord(message)) return { kind: "ignored", reason: "malformed", updateId, chatId: null };
  const chat   = isRecord(message["chat"]) ? message["chat"] : {};
  const chatId = idOf(chat["id"]);
  if (!chatId) return { kind: "ignored", reason: "no_chat", updateId, chatId: null };
  // A mentor chat is one learner. A group is not a learner.
  if (chat["type"] !== "private") return { kind: "ignored", reason: "not_private", updateId, chatId };
  const fromId = isRecord(message["from"]) ? idOf(message["from"]["id"]) : null;

  const text = typeof message["text"] === "string" ? message["text"] : "";
  if (!text.trim()) return { kind: "unsupported", reason: "not_text", updateId, chatId, fromId };

  const command = parseCommand(text);
  if (command) {
    const name = COMMANDS.find(c => c === command.name);
    return name
      ? { kind: "command", updateId, chatId, fromId, command: name, argument: command.argument }
      : { kind: "unsupported", reason: "unknown_command", updateId, chatId, fromId };
  }
  return { kind: "text", updateId, chatId, fromId, text: text.trim().slice(0, MAX_TEXT_LENGTH) };
}

// ── Callback data ─────────────────────────────────────────────────────────────
// "p:<promptId>:<optionId>". Only a reference: what the option does, and
// whose it is, are read from the prompt row.

export function encodeCallback(promptId: string, optionId: string): string {
  return `p:${promptId}:${optionId}`;
}

export function decodeCallback(data: string): { promptId: string; optionId: string } | null {
  const parts = data.split(":");
  if (parts.length !== 3 || parts[0] !== "p") return null;
  const [, promptId, optionId] = parts;
  if (!promptId || !optionId || promptId.length > 40 || optionId.length > 8) return null;
  return { promptId, optionId };
}
