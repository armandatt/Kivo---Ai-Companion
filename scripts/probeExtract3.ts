import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
loadEnv({ path: resolve(process.cwd(), "packages/api/.env"), override: false });

import { generateOpenAIText } from "@repo/api/services/openai.service";

// Paste the actual extraction system prompt inline to test
const SYSTEM_PROMPT = `You extract current personal realities from messages sent to a fitness accountability coach.

A "reality" is a fact about the user's current life situation that:
1. Is TRUE RIGHT NOW (not hypothetical, not past, not a plan)
2. Will likely remain true for HOURS TO DAYS (not minutes)
3. Is RELEVANT TO COACHING DECISIONS (changes what advice is appropriate)

Return ONLY valid compact JSON — a JSON array. No preamble, no markdown, no commentary.

Schema:
[
  {
    "category": "health" | "injury" | "emotional" | "life_constraint" | "training_context",
    "fact": string,
    "confidence": number,
    "relevanceScore": number,
    "ttlHours": number
  }
]

Return [] if nothing qualifies. Maximum 3 facts.`;

async function main() {
  const text = "My grandmother passed away last week. I haven't been able to do anything. Training is the last thing on my mind.";
  
  console.log("Calling generateOpenAIText...");
  try {
    const raw = await generateOpenAIText({
      systemInstruction: SYSTEM_PROMPT,
      prompt: text,
      maxOutputTokens: 300,
      model: "gpt-4o-mini",
    });
    console.log("Raw type:", typeof raw);
    console.log("Raw value:", JSON.stringify(raw));
    
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
    console.log("Cleaned:", JSON.stringify(cleaned));
    
    const parsed = JSON.parse(cleaned);
    console.log("Parsed:", JSON.stringify(parsed));
  } catch (e: any) {
    console.log("ERROR:", e.message?.slice(0, 300));
    console.log("Stack:", e.stack?.slice(0, 300));
  }
}
main().catch(console.error);
