// ─── Nova commands ────────────────────────────────────────────────────────────
// Explicit protocol. A slash command is an instruction, not a sentence to be
// understood, so it is handled by deterministic code. What a natural-language
// message means is never decided here: that is the Understanding Brain.

export type NovaCommand = "study" | "done" | "explain" | "quiz" | "revise";

export interface TranslatedCommand {
  command: NovaCommand | null;
  // The text handed to the orchestrator. For a command it is a plain
  // sentence, so the reply reads naturally; the command itself travels
  // separately and is what triggers deterministic effects.
  text:    string;
}

const COMMAND_RE = /^\/(study|done|explain|quiz|revise)\b\s*(.*)$/is;

export function translateNovaCommand(raw: string): TranslatedCommand {
  const match = raw.trim().match(COMMAND_RE);
  if (!match) return { command: null, text: raw };

  const command = match[1]!.toLowerCase() as NovaCommand;
  const arg     = match[2]!.trim();

  switch (command) {
    case "study":
      return { command, text: arg ? `I want to study ${arg}. What should I do today?` : "I'm ready to study. What should I focus on today?" };
    case "done":
      return { command, text: "I just finished studying." };
    case "explain":
      return { command, text: arg ? `Can you explain ${arg} to me?` : "Can you explain the topic I'm working on?" };
    case "quiz":
      return { command, text: arg ? `Quiz me on ${arg}.` : "Quiz me on what I've been studying." };
    case "revise":
      return { command, text: "What should I revise today based on my schedule?" };
  }
}
