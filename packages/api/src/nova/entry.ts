// ─── Nova turn entry point ────────────────────────────────────────────────────
// One function for "a message arrived for Nova", whatever the surface.
// Telegram and the web app both call it, so there is one Nova and one state:
// the same onboarding gate, the same command grammar, the same orchestrator.

import { translateNovaCommand } from "./commands";
import { runNovaOrchestrator } from "./nova-orchestrator";
import { runNovaOnboarding } from "./onboarding/nova-onboarding-orchestrator";

export const NOVA_HELP_TEXT = `Here's what I can do:

/study [topic] — start a study session or get today's plan
/done — log that you finished studying
/explain [topic] — get a clear explanation of a topic
/quiz [topic] — test yourself on what you know
/revise — review what's due based on your schedule
/help — show this message

Or just talk to me. Tell me what you studied, how you're feeling, what you're struggling with. I'll figure out what you need.`;

export interface NovaTurnInput {
  platformChatId: string;
  text:           string;
  onboardingDone: boolean;
  timestamp?:     Date;
  surface:        "telegram" | "web";
  // The web app reads state straight after the reply, so it waits for the
  // turn to be persisted. Telegram does not.
  awaitPersistence?: boolean;
}

export interface NovaTurnResult {
  reply:        string;
  intervention: string | null;
  ok:           boolean;
}

export async function handleNovaTurn(input: NovaTurnInput): Promise<NovaTurnResult> {
  const { platformChatId, text } = input;
  const timestamp = input.timestamp ?? new Date();
  const trimmed   = text.trim();

  // /help always returns static text (works even during onboarding)
  if (/^\/help\b/i.test(trimmed)) return { reply: NOVA_HELP_TEXT, intervention: null, ok: true };

  const { command, text: plainText } = translateNovaCommand(text);

  // Until onboarding is complete every message, commands included, goes to the
  // onboarding orchestrator, as a plain sentence.
  if (!input.onboardingDone) {
    const arg = trimmed.replace(/^\/\w+\s*/i, "").trim();
    const onboardingText =
      command === "study" ? (arg ? `I want to study ${arg}` : "I want to start studying")
      : command === "done" ? "I finished studying today"
      : command ? arg
      : text;
    try {
      const result = await runNovaOnboarding({ platformChatId, text: onboardingText, timestamp });
      return { reply: result.reply, intervention: "onboarding", ok: true };
    } catch (err) {
      console.error("[nova:onboarding] error:", err);
      return { reply: "Something went wrong. Try sending your message again.", intervention: null, ok: false };
    }
  }

  try {
    const result = await runNovaOrchestrator({
      platformChatId, text: plainText, timestamp, command,
      awaitPersistence: input.awaitPersistence,
    });

    console.log(JSON.stringify({
      ts:           new Date().toISOString(),
      chatId:       platformChatId,
      layer:        "nova",
      surface:      input.surface,
      intervention: result.intervention,
      mode:         result.reasoningMode,
      confidence:   result.confidence,
      message:      text.slice(0, 80),
    }));

    return { reply: result.reply, intervention: result.intervention, ok: true };
  } catch (err) {
    console.error("[nova] orchestrator error:", err);
    return { reply: "Something went wrong on my end. Try again in a moment.", intervention: null, ok: false };
  }
}
