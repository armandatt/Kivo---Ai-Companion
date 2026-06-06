const TELEGRAM_LIMIT = 4096;

// ── Patterns that indicate internal engine state leaking into user-visible text ─
// Checked on every outgoing message. On match: log + strip; throw in dev.
const LEAK_PATTERNS: RegExp[] = [
  /domain:\w+/gi,
  /feasibility:\d+/gi,
  /capacity:\d+/gi,
  /Next piece: weekly/gi,
  /\bdays:\d+\b/gi,
  /total:\d+\.?\d*h\b/gi,
  /Last I heard: "[^"]*"/gi,
  /\| \w+:\w+ \|/g,
  /weekly \| /gi,
  /One honest line\./gi,
  /Reply with one line:/gi,
  /Next planned piece:/gi,
  /Six-hour pulse\./gi,
  /Ten-hour pulse\./gi,
  /Second deep checkpoint\./gi,
  /Check-in, \w+\./gi,
  /Pause for one honest minute/gi,
];

export function sanitizeOutput(message: string): string {
  let clean = message;

  for (const pattern of LEAK_PATTERNS) {
    // Reset regex state (g flag keeps lastIndex between calls)
    const re = new RegExp(pattern.source, pattern.flags);
    if (re.test(clean)) {
      console.error("[SANITIZE] Internal data leak:", pattern.toString(), "\nSnippet:", clean.slice(0, 120));

      if (process.env.NODE_ENV === "development") {
        throw new Error(`Internal data leaked in outgoing message: ${pattern}`);
      }

      clean = clean.replace(new RegExp(pattern.source, pattern.flags), "").trim();
    }
  }

  if (clean.length < 10) {
    console.error("[SANITIZE] Message gutted after sanitization — using fallback");
    return "Something came up on my end. Try again.";
  }

  return clean;
}

export function formatMessengerText(text: string) {
  const sanitized = sanitizeOutput(text);
  const clean = sanitized
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  if (clean.length <= TELEGRAM_LIMIT) return clean;

  return `${clean.slice(0, TELEGRAM_LIMIT - 24).trim()}\n\nI'll stop there for now.`;
}
