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

// Said to the Response Brain on a turn made of words, so the reply cannot
// claim a session command the turn did not run.
const SENTENCE_RUNS_NO_SESSION =
  "This message did not start, pause, resume or end a study session, and nothing was added or scheduled. Do not say or imply otherwise. If the student wants to start or end a session, point them to the Start button on this page or to Focus.";

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
    // A typed command (/study, /done) is protocol and runs. A sentence does
    // not start, pause or end a session: the page it is typed on has buttons
    // for that, and the model's reading of a sentence is not a button press.
    // What the sentence says is still read, logged and consolidated.
    const result = await runNovaOrchestrator({
      platformChatId, text: plainText, timestamp, command,
      awaitPersistence: input.awaitPersistence,
      ...(command ? {} : { sessionCommands: "surface" as const, directive: SENTENCE_RUNS_NO_SESSION }),
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
