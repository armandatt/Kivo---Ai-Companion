import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
loadEnv({ path: resolve(process.cwd(), "packages/api/.env"), override: false });

import { generateOpenAIText } from "@repo/api/services/openai.service";

async function main() {
  console.log("key present:", !!(process.env.OPEN_API_KEY || process.env.OPENAI_API_KEY));
  try {
    const raw = await generateOpenAIText({
      systemInstruction: 'You extract facts. Return ONLY valid JSON array: [{"category":"emotional","fact":"user is grieving","confidence":0.95,"relevanceScore":0.95,"ttlHours":96}]',
      prompt: "My grandmother passed away last week. I haven't been able to do anything.",
      maxOutputTokens: 200,
      model: "gpt-4o-mini",
    });
    console.log("raw response length:", raw.length);
    console.log("raw response:", JSON.stringify(raw.slice(0, 300)));
  } catch (e: any) {
    console.log("ERROR:", e.message?.slice(0, 200));
  }
}
main().catch(console.error);
