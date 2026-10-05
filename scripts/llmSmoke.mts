/**
 * Live check of the configured LLM provider. Makes three small calls, the
 * same three shapes the app makes, and prints what came back.
 *
 * Run from repo root (reads packages/api/.env if the variables are not set):
 *   npx tsx scripts/llmSmoke.mts
 *
 * It never prints the API key.
 */
import { generateOpenAIText } from "../packages/api/src/services/openai.service.ts";
import { selectProvider, geminiModelFor } from "../packages/api/src/services/llmProviders.ts";

async function check(label: string, fn: () => Promise<string>, verify: (out: string) => boolean) {
  const started = Date.now();
  try {
    const out = await fn();
    const ok  = verify(out);
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (${Date.now() - started}ms)\n      → ${out.replace(/\n/g, " ").slice(0, 160)}\n`);
    return ok;
  } catch (err) {
    console.log(`FAIL  ${label}  (${Date.now() - started}ms)\n      → ERROR: ${(err as Error).message.slice(0, 300)}\n`);
    return false;
  }
}

const results = [
  // 1. A classification capped at 3 tokens (Rex uses caps this small).
  await check("tiny cap, fast tier", () => generateOpenAIText({
    model: "gpt-4o-mini", maxOutputTokens: 3,
    systemInstruction: "Answer with exactly one word: yes or no.",
    prompt: "Is 'I benched 80kg today' about gym training?",
  }), out => /^(yes|no)\b/i.test(out.trim())),

  // 2. Structured JSON on the fast tier (the Understanding Brain's shape).
  await check("JSON, fast tier", () => generateOpenAIText({
    model: "gpt-4o-mini", maxOutputTokens: 120,
    systemInstruction: 'Classify the message. Return ONLY JSON: {"intent": "study_report" | "other", "topic": string | null}',
    prompt: "I finished chapter 3 of operating systems",
  }), out => { try { return typeof JSON.parse(out).intent === "string"; } catch { return false; } }),

  // 3. A reply on the main tier with no cap (the Response Brain / Rex shape).
  await check("free text, main tier", () => generateOpenAIText({
    model: "gpt-4o",
    systemInstruction: "You are a direct study coach. Reply in one short sentence.",
    prompt: "I have 40 minutes free. What should I do?",
  }), out => out.trim().length > 10),
];

// Resolved after the first call, so packages/api/.env has been loaded.
const provider = selectProvider(process.env);
console.log(`provider: ${provider}`);
if (provider === "gemini") {
  console.log(`models:   fast=${geminiModelFor("gpt-4o-mini", process.env)}  main=${geminiModelFor("gpt-4o", process.env)}`);
}
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
process.exit(results.every(Boolean) ? 0 : 1);
