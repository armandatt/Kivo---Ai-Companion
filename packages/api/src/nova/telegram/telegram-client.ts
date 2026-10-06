// ─── Telegram Bot API client ──────────────────────────────────────────────────
// The delivery adapter. It sends what it is given and reports honestly what
// happened: delivered (with Telegram's message id), refused, or unknown.
// It decides nothing and stores nothing. Never logs the bot token.

import type { InlineButton, SendResult, TelegramClient } from "./telegram.types";

export const SEND_TIMEOUT_MS = 8000;
export const MAX_MESSAGE_LENGTH = 4000;   // Telegram's limit is 4096

interface ApiResponse {
  ok?:          boolean;
  result?:      { message_id?: number };
  error_code?:  number;
  description?: string;
  parameters?:  { retry_after?: number };
}

export function classifySendFailure(status: number, body: ApiResponse): Extract<SendResult, { ok: false }> {
  const detail = (body.description ?? `http ${status}`).slice(0, 160);
  // 403: the bot was blocked or the chat is gone. 400 "chat not found" is the same thing.
  if (status === 403 || (status === 400 && detail.toLowerCase().includes("chat not found"))) {
    return { ok: false, kind: "blocked", detail };
  }
  if (status === 429) return { ok: false, kind: "rate_limited", retryAfterSeconds: body.parameters?.retry_after ?? 5, detail };
  if (status >= 500)  return { ok: false, kind: "server", detail };
  return { ok: false, kind: "bad_request", detail };
}

export function createTelegramClient(options: { token?: string; baseUrl?: string } = {}): TelegramClient {
  const token = options.token ?? process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN ?? "";
  const base  = (options.baseUrl ?? process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org");

  async function call(method: string, payload: Record<string, unknown>): Promise<{ status: number; body: ApiResponse } | null> {
    if (!token) return { status: 0, body: { description: "bot token not configured" } };
    try {
      const res = await fetch(`${base}/bot${token}/${method}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      const body = await res.json().catch(() => ({})) as ApiResponse;
      return { status: res.status, body };
    } catch {
      return null;   // timeout or network error: the outcome is not known
    }
  }

  return {
    async sendMessage(chatId, text, buttons) {
      const answer = await call("sendMessage", {
        chat_id: chatId,
        text:    text.slice(0, MAX_MESSAGE_LENGTH),
        ...(buttons && buttons.length > 0 ? { reply_markup: { inline_keyboard: buttons } } : {}),
      });
      if (answer === null) return { ok: false, kind: "unknown", detail: "no response" };
      if (answer.status === 0) return { ok: false, kind: "bad_request", detail: "bot token not configured" };
      const id = answer.body.result?.message_id;
      if (answer.body.ok && typeof id === "number") return { ok: true, messageId: id };
      return classifySendFailure(answer.status, answer.body);
    },
    // The three below are courtesies. Their failure changes nothing.
    async answerCallback(callbackId, text) {
      await call("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text: text.slice(0, 180) } : {}) });
    },
    async clearButtons(chatId, messageId) {
      await call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
    },
    async setChatCommands(chatId, commands) {
      await call("setMyCommands", { commands, scope: { type: "chat", chat_id: chatId } });
    },
  };
}

export const NOVA_CHAT_COMMANDS = [
  { command: "today",    description: "What to do now" },
  { command: "focus",    description: "Start a study session" },
  { command: "done",     description: "End the session and say how it went" },
  { command: "status",   description: "Where you stand" },
  { command: "settings", description: "Nudges and timezone" },
];

export type { InlineButton };
