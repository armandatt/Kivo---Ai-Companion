import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
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
}) {
  const apiKey = getOpenAIKey();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions: input.systemInstruction,
      input: input.prompt,
      max_output_tokens: input.maxOutputTokens ?? 512,
      temperature: 0.7,
    }),
  });

  const data = (await res.json()) as OpenAIResponse;

  if (!res.ok) {
    throw new Error(
      data.error?.message || `OpenAI request failed with status ${res.status}`
    );
  }

  const text =
    data.output_text ||
    data.output
      ?.flatMap((item) => item.content || [])
      .map((content) => content.text || "")
      .join("")
      .trim();

  if (!text) {
    throw new Error("OpenAI returned an empty response");
  }

  return text;
}
