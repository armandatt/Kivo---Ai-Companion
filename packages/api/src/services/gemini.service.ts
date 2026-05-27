type GeminiPart = {
  text?: string;
};

type GeminiResponse = {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: GeminiPart[];
    };
  }>;
  error?: {
    message?: string;
    status?: string;
  };
};

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export async function generateGeminiText(input: {
  prompt: string;
  systemInstruction?: string;
  maxOutputTokens?: number;
}) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        ...(input.systemInstruction
          ? {
              system_instruction: {
                parts: [{ text: input.systemInstruction }],
              },
            }
          : {}),
        contents: [
          {
            role: "user",
            parts: [{ text: input.prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: input.maxOutputTokens ?? 512,
        },
      }),
    }
  );

  const data = (await res.json()) as GeminiResponse;

  if (!res.ok) {
    throw new Error(
      data.error?.message || `Gemini request failed with status ${res.status}`
    );
  }

  const candidate = data.candidates?.[0];
  const finishReason = candidate?.finishReason;
  const text = candidate?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();

  if (finishReason && finishReason !== "STOP") {
    throw new Error(
      `Gemini stopped before a complete response. finishReason=${finishReason}`
    );
  }

  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  return text;
}
