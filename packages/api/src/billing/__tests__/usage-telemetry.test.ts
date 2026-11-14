// ─── Every model call is attributed where it is entered (read from source) ────
// The client records every call; these hold that each entry point says which
// feature it is, with a name from the one list, that only the writer touches
// the table, and that nothing about the allowance reads it.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { USAGE_FEATURES } from "../../services/llm-usage";

const ROOT = join(__dirname, "../../../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const sources = (dir: string) => (readdirSync(join(ROOT, dir), { recursive: true }) as string[])
  .filter(f => /\.tsx?$/.test(f) && !/__tests__|__integration__|__mocks__|\.d\.ts$/.test(f))
  .map(f => join(dir, f));

// Every module that calls the one LLM client, and where its calls are
// attributed. A new one fails here until it is added, with its entry point.
const MODEL_CALLERS: Record<string, string> = {
  "packages/api/src/nova/brains/understanding-brain.ts":         "nova_chat (metered) · telegram_understanding / telegram_onboarding (telegram-turn.ts)",
  "packages/api/src/nova/brains/response-brain.ts":              "nova_chat (metered) · telegram_reply (telegram-turn.ts)",
  "packages/api/src/nova/brains/disambiguation-pass.ts":         "the older turn: nova_chat (metered) or the Telegram turn's context",
  "packages/api/src/nova/brains/first-use-wording.ts":           "telegram_first_use (telegram-turn.ts)",
  "packages/api/src/nova/brains/language-wording.ts":            "telegram_rewording (telegram-turn.ts)",
  "packages/api/src/nova/onboarding/nova-onboarding-extractor.ts": "unreachable: the onboarding orchestrator is imported by nothing",
  "packages/api/src/nova/onboarding/nova-onboarding-response.ts":  "unreachable: the onboarding orchestrator is imported by nothing",
  "packages/api/src/nova/proactive/nova-proactive-response.ts":  "scheduled_nova_message (nova-proactive-cron.ts)",
  "packages/api/src/nova/product/builder-conversation.ts":       "build_with_nova (builder-access.ts startJob)",
  "packages/api/src/nova/product/workspace-generation.ts":       "build_with_nova (job) · create_with_nova · notes_proposal · notes_import · today_copilot (metered)",
  "packages/api/src/nova/product/day-copilot.ts":                "today_copilot (metered)",
  "packages/api/src/nova/product/note-assist.ts":                "notes_assist (metered)",
  "packages/api/src/nova/product/note-edit.ts":                  "notes_editor (metered)",
  "packages/api/src/nova/product/note-import.ts":                "notes_import · paper_import (metered)",
  "packages/api/src/nova/product/note-proposal.ts":              "notes_proposal (metered)",
  "packages/api/src/nova/product/note-tutor.ts":                 "notes_tutor (metered)",
  "packages/api/src/nova/product/page-question.ts":              "extension_ask_nova (metered)",
  "packages/api/src/nova/product/knowledge-placement.ts":        "capture_placement (startInteraction in knowledge-placement.ts; not on the allowance)",
  "packages/api/src/nova/product/browser-agent.ts":              "extension_agent (the task metered once at start; its steps inside it, withinCountedTask: tokens metered, not counted again)",
  "packages/api/src/nova/product/resource-processing.ts":        "saved_page_processing / saved_page_retry (resource-processing.ts)",
  "packages/api/src/nova/product/study-proposal.ts":             "subject_studio (metered)",
  // Rex, reached only through the Telegram webhook and the scheduler.
  "packages/api/src/engines/mentor-orchestrator.ts":    "rex", "packages/api/src/engines/onboarding-engine-v2.ts": "rex",
  "packages/api/src/engines/onboarding-engine-v3.ts":   "rex", "packages/api/src/engines/onboarding-extractor.ts":  "rex",
  "packages/api/src/engines/onboarding-validator.ts":   "rex", "packages/api/src/engines/understanding-layer.ts":   "rex",
  "packages/api/src/processor/messageProcessor.ts":     "rex", "packages/api/src/services/customReminder.service.ts": "rex",
  "packages/api/src/services/intake.service.ts":        "rex", "packages/api/src/services/llm.ts":                 "rex",
  "packages/api/src/services/momentMemory.service.ts":  "rex", "packages/api/src/services/offTopicClassifier.service.ts": "rex",
  "packages/api/src/services/onboarding.service.ts":    "rex", "packages/api/src/services/planner.service.ts":     "rex",
  "packages/api/src/services/realityExtractor.service.ts": "rex", "packages/api/src/services/rexSchedulerMessages.service.ts": "rex",
  "packages/api/src/services/rexSessionContext.service.ts": "rex", "packages/api/src/services/scheduleCheckin.service.ts": "rex",
};

describe("every model call is attributed", () => {
  it("the modules that call the client are exactly the known ones", () => {
    const callers = sources("packages/api/src")
      .filter(f => !f.endsWith("services/openai.service.ts"))
      .filter(f => /generateOpenAIText/.test(read(f)) && /from "(\.\.\/)*(\.\/)?(services\/)?openai\.service"/.test(read(f)));
    expect(callers.sort()).toEqual(Object.keys(MODEL_CALLERS).sort());
  });

  it("every metered route names a feature from the list", () => {
    const routes = sources("apps/api/app").filter(f => read(f).includes("await metered("));
    expect(routes.length).toBe(12);
    for (const route of routes) {
      const features = [...read(route).matchAll(/await metered\([\s\S]*?\{ feature: "([a-z_]+)"(?:, surface: "([a-z]+)")? \}\)/g)];
      expect([route, features.length]).toEqual([route, (read(route).match(/await metered\(/g) ?? []).length]);
      for (const f of features) expect(USAGE_FEATURES).toContain(f[1]);
    }
  });

  it("every feature named anywhere is on the list", () => {
    for (const file of [...sources("packages/api/src"), ...sources("apps/api/app"), ...sources("apps/api/lib")]) {
      const src = read(file);
      if (!/startInteraction|withUsageContext|metered\(/.test(src)) continue;
      for (const m of src.matchAll(/feature: (?:by === "learner" \? )?"([a-z_]+)"(?: : "([a-z_]+)")?/g)) {
        for (const name of [m[1], m[2]].filter(Boolean)) expect([relative(ROOT, join(ROOT, file)), USAGE_FEATURES.includes(name as never)]).toEqual([relative(ROOT, join(ROOT, file)), true]);
      }
    }
  });

  it("Telegram: each kind of call in a turn names its own feature, and only the reading is on the allowance", () => {
    const turn = read("packages/api/src/nova/telegram/telegram-turn.ts");
    expect(turn).toContain('withUsageContext({ feature: "telegram_understanding", isAllowanceCounted: counted }, () => (deps.understand ?? runUnderstandingBrain)(');
    expect(turn).toContain('withUsageContext({ feature: "telegram_onboarding", isAllowanceCounted: counted }, () => runSetupTurn(');
    expect(turn).toContain('withUsageContext({ feature: "telegram_reply", isAllowanceCounted: false }, () => runNovaOrchestrator(');
    expect(turn).toContain('withUsageContext({ feature: "telegram_rewording", isAllowanceCounted: false }, () => sayInLanguage(');
    expect(turn).toContain('withUsageContext({ feature: "telegram_first_use", isAllowanceCounted: false }, () => wordFirstUse(');
    expect(turn).toContain("return counted = (await spendAiRequest(await entitled())).ok");
    const hook = read("apps/api/app/api/telegram/route.ts");
    expect(hook).toContain('return startInteraction({ feature: "rex", surface: "telegram" }, () => handleUpdate(req));');
    expect(hook).toContain("annotateUsage({ learner: chatId.toString()");
  });

  it("background work is marked background, attributed to its learner, and never on the allowance", () => {
    const proactive = read("packages/api/src/nova/proactive/nova-proactive-cron.ts");
    expect(proactive).toMatch(/startInteraction\(\{\s+feature: "scheduled_nova_message", surface: "telegram", learner: chatId, profileId: profile.id,\s+requestId: `proactive:\$\{row.id\}`, isBackground: true, isAllowanceCounted: false,/);
    const pages = read("packages/api/src/nova/product/resource-processing.ts");
    expect(pages).toContain('feature: by === "learner" ? "saved_page_retry" : "saved_page_processing"');
    expect(pages).toContain('isBackground: by !== "learner", isAllowanceCounted: false');
    // The tick is Nova's only (12 Nov); its own interaction makes no model call.
    expect(read("apps/api/lib/checkin-cron.ts")).toContain('startInteraction({ feature: "other", surface: "background", isBackground: true');
    const builder = read("apps/api/lib/nova/builder-access.ts");
    expect(builder).toContain('{ feature: "build_with_nova", surface: "web", learner: platformChatId, requestId: job.jobId, isAllowanceCounted: counted }');
    expect(read("packages/api/src/nova/entry.ts")).toContain('withUsageContext({ feature: "nova_setup" }, () => runWebSetupSentence(');
  });

  it("only usage-events.ts touches the table, and nothing that decides access reads it", () => {
    const touching = [...sources("packages/api/src"), ...sources("apps/api")].filter(f => /aiUsageEvent\./.test(read(f)));
    expect(touching).toEqual(["packages/api/src/billing/usage-events.ts"]);
    for (const f of ["packages/api/src/billing/usage.ts", "packages/api/src/billing/limits.ts", "packages/api/src/billing/entitlements.ts", "apps/api/lib/billing/metered.ts"]) {
      expect([f, /aiUsageEvent|usage-events/.test(read(f))]).toEqual([f, false]);
    }
  });

  it("the client never puts a prompt, a reply or a key into an event", () => {
    const client = read("packages/api/src/services/openai.service.ts");
    for (const m of client.matchAll(/emitLlmCall\(\{([\s\S]*?)\}\);/g)) {
      expect(m[1]).not.toMatch(/prompt|systemInstruction|text|apiKey|attachments/);
    }
    const writer = read("packages/api/src/billing/usage-events.ts");
    expect(writer).not.toMatch(/prompt|reply|apiKey/);
  });
});
