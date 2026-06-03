import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_OPENAI_MODEL = "gpt-5";
const __dirname = dirname(fileURLToPath(import.meta.url));
let packageEnvLoaded = false;

function loadPackageEnv() {
  if (packageEnvLoaded) return;
  packageEnvLoaded = true;

  try {
    const envPath = resolve(__dirname, "../../.env");
    const env = readFileSync(envPath, "utf8");

    for (const line of env.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;

      const key = trimmed.slice(0, separator).trim();
      const rawValue = trimmed.slice(separator + 1).trim();

      if (!key || process.env[key]) continue;

      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  } catch {
    // The API app can also provide these env vars directly.
  }
}

function getOpenAIKey() {
  loadPackageEnv();
  return process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY;
}

export async function generateOpenAIText(input: {
  prompt: string;
  systemInstruction?: string;
  maxOutputTokens?: number;
  model?: string;             // per-call override; falls back to OPENAI_MODEL env → gpt-4o-mini
}) {
  const apiKey = getOpenAIKey();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const model = input.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(input.systemInstruction
          ? [{ role: "system", content: input.systemInstruction }]
          : []),
        { role: "user", content: input.prompt },
      ],
      max_completion_tokens: input.maxOutputTokens ?? 512,
    }),
  });

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>;
    error?: { message?: string };
  };

  if (!res.ok) {
    throw new Error(
      data.error?.message || `OpenAI request failed with status ${res.status}`
    );
  }

  const choice  = data.choices?.[0];
  const text    = choice?.message?.content?.trim();
  const refusal = choice?.message?.refusal;

  if (refusal) {
    throw new Error(`OpenAI refused the request: ${refusal}`);
  }

  if (!text) {
    // Reasoning models (gpt-5, o-series) can exhaust max_completion_tokens on CoT
    // and return empty content. Log for visibility, throw so callers use their fallback.
    console.error("[OpenAI] empty response — finish_reason:", choice?.finish_reason, "| model:", model);
    throw new Error(`OpenAI returned empty content (finish_reason: ${choice?.finish_reason ?? "unknown"})`);
  }

  return text;
}
