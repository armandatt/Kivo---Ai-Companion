// Which language Nova replies in, and how a reply written by code is said in
// it. No database; the model is stood in.

const generateOpenAIText = jest.fn();
jest.mock("../../services/openai.service", () => ({ generateOpenAIText: (...args: unknown[]) => generateOpenAIText(...args) }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { faithful, figuresIn, sayInLanguage } from "../brains/language-wording";
import { wordFirstUse } from "../brains/first-use-wording";
import { parseLearnerRequest } from "../brains/understanding-parser";
import { UNDERSTANDING_BRAIN_SYSTEM_PROMPT } from "../brains/prompts/understanding-brain.prompt";
import { safeReading } from "../decision/interpretation-safety";
import { decideFirstUse } from "../interaction/first-use";
import { chooseLanguage, heldAfter, languageLine, SENTENCE_WORDS, wordCount } from "../interaction/language";
import { surfaceLanguageLine } from "../product/surface-language";
import { wordProactiveMessage } from "../proactive/nova-proactive-response";
import { isFixedText, TEXT, TEXT_HINGLISH, textFor } from "../telegram/telegram-replies";
import type { NovaTodayReady, TodayAction } from "../product/today.types";
import type { AcademicUnderstanding } from "../types/understanding.types";

const read = (file: string) => readFileSync(join(__dirname, "..", file), "utf8");

beforeEach(() => generateOpenAIText.mockReset());

describe("the reading says which language a message is in", () => {
  it("keeps english, hinglish and hindi, and nothing else", () => {
    expect(parseLearnerRequest({ action: "none", language: "hinglish" }).language).toBe("hinglish");
    expect(parseLearnerRequest({ action: "none", language: "english" }).language).toBe("english");
    // Hindi in Devanagari. Whether a message really is in that script is
    // checked against the message itself (daily-checkin.test.ts).
    expect(parseLearnerRequest({ action: "none", language: "hindi" }).language).toBe("hindi");
    for (const other of ["Hindi", "Hinglish", "tamil", "", 3, null, undefined, ["hinglish"]]) {
      expect(parseLearnerRequest({ action: "none", language: other }).language).toBeNull();
    }
  });

  it("asks the model for it, as a description of the writing only", () => {
    expect(UNDERSTANDING_BRAIN_SYSTEM_PROMPT).toContain("- language: english | hinglish | hindi | null");
    expect(UNDERSTANDING_BRAIN_SYSTEM_PROMPT).toContain("it never changes any other field");
  });

  it("reads no language into noise", () => {
    const noise: AcademicUnderstanding = {
      intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none",
      ambiguityScore: 1, routingSignal: "coaching_only", rawText: "asdfgh",
      request: { ...parseLearnerRequest({ clarity: "unintelligible", language: "hinglish" }) },
    };
    expect(safeReading(noise, { today: "2026-10-08" }).request?.language ?? null).toBeNull();
  });
});

describe("choosing the reply language", () => {
  it("follows the message being answered", () => {
    expect(chooseLanguage("hinglish", "english")).toBe("hinglish");
    expect(chooseLanguage("english", "hinglish")).toBe("english");
  });

  it("keeps the last language when the message does not say", () => {
    expect(chooseLanguage(null, "hinglish")).toBe("hinglish");
    expect(chooseLanguage(undefined, "english")).toBe("english");
  });

  // Regression (staging, 18 October): "How is my progress going?" and "remind
  // me at 8 pm to study" came back with no language after a Hinglish message,
  // and were answered in Hinglish because the last language carried over.
  it("a sentence the reading gave no language is answered in English, whatever came before", () => {
    for (const text of ["How is my progress going?", "remind me at 8 pm to study", "What is my next one-week plan?"]) {
      for (const read of [null, undefined]) {
        expect(chooseLanguage(read, "hinglish", text)).toBe("english");
        expect(chooseLanguage(read, "hindi", text)).toBe("english");
      }
    }
  });

  it("a message too short to tell keeps the conversation's language", () => {
    for (const text of ["ok", "haan", "30", "8 pm", "deadlocks", "ok bhai", "yes do it", "", "???"]) {
      expect(chooseLanguage(null, "hinglish", text)).toBe("hinglish");
      expect(chooseLanguage(null, "english", text)).toBe("english");
    }
  });

  it("a reading that names a language always wins, in both directions", () => {
    expect(chooseLanguage("english", "hinglish", "How is my progress going?")).toBe("english");
    expect(chooseLanguage("hinglish", "english", "Aaj ke plans update karne hain")).toBe("hinglish");
    expect(chooseLanguage("hinglish", "english", "ok bhai")).toBe("hinglish");
    expect(chooseLanguage("hindi", "english", "आज क्या पढ़ना है")).toBe("hindi");
  });

  it("is the same every time for the same message and conversation", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(chooseLanguage(null, i % 2 ? "hinglish" : "english", "How is my progress going?"));
    expect([...seen]).toEqual(["english"]);
  });

  it("counts words that have letters: four make a sentence", () => {
    expect([wordCount("remind me at 8 pm to study"), wordCount("8 pm"), wordCount("30"), wordCount("ok   bhai\nthik hai")]).toEqual([6, 1, 0, 4]);
    expect(SENTENCE_WORDS).toBe(4);
  });

  it("is applied before the reading too, and stored with the message, in the Telegram and setup turns", () => {
    const turn = read("telegram/telegram-turn.ts");
    expect(turn).toContain("chooseLanguage(safe.request?.language, ctx.language, event.text, ctx.preferredLanguage, choice)");
    expect(turn).toContain("request: { ...safe.request, language: ctx.language, languageRequest: ctx.heldLanguage }");
    expect(read("interaction/setup-turn.ts")).toContain("chooseLanguage(understanding.request?.language, ctx.language, text, ctx.preferredLanguage, choice)");
    // A request still in force is stored with the message, and read back for the next one.
    expect(read("persistence/nova-persistence.ts")).toContain("languageHeld: understanding.request?.languageRequest ?? null,");
    expect(turn).toContain("const heldLanguage = user ? await loadHeldLanguage(user.id).catch(() => null) : null;");
  });

  it("adds nothing to a prompt for English, and one line for Hinglish", () => {
    expect(languageLine("english")).toBeNull();
    const line = languageLine("hinglish")!;
    expect(line).toContain("Roman letters");
    expect(line).toContain("No Devanagari");
    expect(line).toContain("exactly as given");
  });

  it("is decided without a pattern over the learner's words", () => {
    for (const file of ["interaction/language.ts", "brains/language-wording.ts"]) {
      const source = read(file);
      expect(source).not.toContain("new RegExp");
      expect(source).not.toContain(".match(");
      expect(source).not.toContain(".test(");
    }
  });
});

describe("the fixed lines", () => {
  const keys = Object.keys(TEXT) as Array<keyof typeof TEXT>;

  it("has every line in Hinglish", () => {
    for (const key of keys) {
      expect(typeof TEXT_HINGLISH[key]).toBe("string");
      expect(TEXT_HINGLISH[key].trim().length).toBeGreaterThan(0);
      expect(TEXT_HINGLISH[key]).not.toBe(TEXT[key]);
    }
    expect(Object.keys(TEXT_HINGLISH).sort()).toEqual([...keys].sort());
  });

  it("writes Hinglish in Roman letters", () => {
    for (const key of keys) expect(faithful(TEXT_HINGLISH[key], TEXT_HINGLISH[key])).toBe(true);
  });

  it("names the same commands and figures in both languages", () => {
    const commands = (text: string) => text.split(/\s+/).filter(w => w.startsWith("/")).map(w => w.replace(/[^/a-z]/g, "")).sort();
    for (const key of keys) {
      expect(commands(TEXT_HINGLISH[key])).toEqual(commands(TEXT[key]));
      expect(figuresIn(TEXT_HINGLISH[key])).toEqual(figuresIn(TEXT[key]));
    }
  });

  it("picks the table by language and knows its own lines", () => {
    expect(textFor("english")).toBe(TEXT);
    expect(textFor("hinglish").later).toBe(TEXT_HINGLISH.later);
    expect(isFixedText(TEXT_HINGLISH.later, "hinglish")).toBe(true);
    expect(isFixedText(TEXT.later, "hinglish")).toBe(false);
    expect(isFixedText("Processes (Operating Systems)\n25 min.", "hinglish")).toBe(false);
  });
});

describe("saying a reply in the learner's language", () => {
  const plain = "Processes (Operating Systems)\n25 min. Why: exam in 8 days, not studied yet.";

  it("calls no model for English", async () => {
    expect(await sayInLanguage({ text: plain, language: "english" })).toEqual({ text: plain, rendered: false });
    expect(generateOpenAIText).not.toHaveBeenCalled();
  });

  it("makes one small-model call for Hinglish, with the text and the language line", async () => {
    generateOpenAIText.mockResolvedValue("Processes (Operating Systems)\n25 min. Kyun: exam 8 din mein hai, abhi tak padha nahi.");
    const said = await sayInLanguage({ text: plain, language: "hinglish" });
    expect(said.rendered).toBe(true);
    expect(said.text).toContain("8 din");
    expect(generateOpenAIText).toHaveBeenCalledTimes(1);
    const request = generateOpenAIText.mock.calls[0]![0] as { model: string; systemInstruction: string; prompt: string };
    expect(request.model).toBe("gpt-4o-mini");
    expect(request.prompt).toBe(plain);
    expect(request.systemInstruction).toContain("Language: Hinglish");
    expect(request.systemInstruction).toContain("nothing that is not in it");
  });

  it("sends the plain text when a figure was changed, added or dropped", async () => {
    for (const bad of [
      "Processes (Operating Systems)\n30 min. Kyun: exam 8 din mein hai.",
      "Processes (Operating Systems)\n25 min. Kyun: exam 8 din mein hai. 2 topics aur hain.",
      "Processes (Operating Systems). Exam paas hai, abhi tak padha nahi.",
    ]) {
      generateOpenAIText.mockResolvedValue(bad);
      expect(await sayInLanguage({ text: plain, language: "hinglish" })).toEqual({ text: plain, rendered: false });
    }
  });

  it("sends the plain text when the model answers in Devanagari, with nothing, or at length", async () => {
    for (const bad of ["Processes\n25 मिनट. 8 दिन.", "", "   ", `${"bahut lamba ".repeat(40)} 25 8`]) {
      generateOpenAIText.mockResolvedValue(bad);
      expect(await sayInLanguage({ text: plain, language: "hinglish" })).toEqual({ text: plain, rendered: false });
    }
  });

  it("sends the plain text when the model is unavailable", async () => {
    const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
    generateOpenAIText.mockRejectedValue(new Error("down"));
    expect(await sayInLanguage({ text: plain, language: "hinglish" })).toEqual({ text: plain, rendered: false });
    quiet.mockRestore();
  });

  it("counts figures wherever they stand", () => {
    expect(figuresIn("0 of 25 min, exam in 8 days")).toEqual(["0", "25", "8"]);
    expect(figuresIn("no figures")).toEqual([]);
    expect(faithful("Logged: 25 min.", "Log ho gaya: 25 min.")).toBe(true);
    expect(faithful("Logged: 25 min.", "Log ho gaya: 52 min.")).toBe(false);
  });
});

describe("messages the Response Brain words", () => {
  const block: TodayAction = { topicName: "Processes", subjectName: "Operating Systems", activityType: "review", durationMinutes: 30, urgency: "high", reasons: ["not studied yet"], rationale: "" };
  const view: NovaTodayReady = {
    status: "ready", generatedAt: "", learnerName: null, goals: [], subjects: ["Operating Systems"], availableMinutes: null,
    recommendation: block, emptyReason: null, alternatives: [],
    activeSession: null, nextDeadline: null, upcoming: [], weakArea: null, reviewDue: { count: 0, topics: [] }, constraints: [],
    progress: { sessionsThisWeek: 0, minutesThisWeek: 0, streakDays: 0, daysSinceLastSession: null, lastSession: null },
    plan: { mode: "standard", blockCount: 1, totalMinutesToday: 30, budgetMinutes: 180, budgetBasis: "preferred", assumptions: [], shortfall: null },
  };
  const promptOf = () => (generateOpenAIText.mock.calls[0]![0] as { prompt: string }).prompt;

  it("tells the first message which language to use, and says nothing for English", async () => {
    generateOpenAIText.mockResolvedValue("Hi Asha.\n\nProcesses se shuru karo, 30 min.");
    const decision = decideFirstUse(view, null);
    await wordFirstUse({ decision, studentName: "Asha", register: "steady", operatingStyle: [], hasButtons: true, language: "hinglish" });
    expect(promptOf()).toContain("Language: Hinglish");
    generateOpenAIText.mockClear();
    await wordFirstUse({ decision, studentName: "Asha", register: "steady", operatingStyle: [], hasButtons: true });
    expect(promptOf()).not.toContain("Language:");
  });

  it("tells a proactive message which language to use", async () => {
    generateOpenAIText.mockResolvedValue("OS exam kal hai.");
    const input = { type: "exam_countdown" as const, studentName: "Asha", facts: ["Operating Systems exam is tomorrow"], register: "serious" as const, operatingStyle: [], hasStartButton: false };
    await wordProactiveMessage({ ...input, language: "hinglish" });
    expect(promptOf()).toContain("Language: Hinglish");
    generateOpenAIText.mockClear();
    await wordProactiveMessage(input);
    expect(promptOf()).not.toContain("Language:");
  });
});

describe("where the language is kept", () => {
  it("is read off the conversation log, not stored as learner state", () => {
    const adapter = read("adapters/conversation-adapter.ts");
    expect(adapter).toContain("export async function loadReplyLanguage");
    expect(adapter).toContain("...(annotation.language ? { language: annotation.language } : {})");
    // No column, no table and no writer of its own.
    expect(read("telegram/channel-store.ts")).not.toContain("language");
  });

  it("is recorded with the message by the canonical turn", () => {
    expect(read("persistence/nova-persistence.ts")).toContain("language: understanding.request?.language ?? null");
  });

  it("keeps the web chat's fixed lines in English", () => {
    const web = read("interaction/web-sentence.ts");
    expect(web.split('language: "english"').length - 1).toBe(2);
    expect(web).not.toContain("sayInLanguage");
  });

  it("words a reply at most once per Telegram turn", () => {
    const turn = read("telegram/telegram-turn.ts");
    // Either the Response Brain words it, or the language step does.
    expect(turn).toContain("const fallback = generate ? english : await inLanguage(english);");
    expect(turn).toContain("if (!generate) await deliver(shell(fallback), true);");
    expect(turn).toContain("reply: (text: string) => deliver(shell(text), true)");
    // A command or a button tap is never reworded by a model.
    expect(turn).toContain('if (event.kind !== "text") return text;');
    // The language step spends from the same daily wording budget.
    expect(turn).toContain('!await spendModelCall(ctx.profileId, "response", budgetDay, await factor())');
  });
});

// ── A chosen language is a standing constraint (12 Nov) ──────────────────────
// Reported: a learner who chose Hinglish got English, then Hinglish again, at
// random. The reading labels each message by its own words, and a Hinglish
// learner's message about a technical topic is mostly English.
describe("a learner who chose Hinglish", () => {
  // What the reading might call fifteen messages from one Hinglish learner.
  const turns: Array<[string, "english" | "hinglish" | null]> = [
    ["explain the deadlock detection algorithm", "english"], ["acha samajh gaya", "hinglish"], ["what is the banker's algorithm?", "english"],
    ["ok", null], ["iska time complexity kya hai", "hinglish"], ["give me an example with 3 processes", "english"],
    ["thoda aur simple bata", "hinglish"], ["and safe state?", "english"], ["30", null], ["how does paging work", "english"],
    ["TLB ka role kya hai", "hinglish"], ["Compare FIFO and LRU page replacement", "english"], ["hmm", null],
    ["What should I study next for OS?", "english"], ["thanks bhai", "hinglish"],
  ];

  it("is answered in Hinglish for fifteen messages in a row, whatever each is written in", () => {
    let language: "english" | "hinglish" | "hindi" = "hinglish";
    let held: "english" | "hinglish" | "hindi" | null = null;
    const replies: string[] = [];
    for (const [text, read] of turns) {
      const choice = { requested: null, held };
      language = chooseLanguage(read, language, text, "hinglish", choice);
      held = heldAfter(choice, "hinglish");
      replies.push(language);
    }
    expect(new Set(replies)).toEqual(new Set(["hinglish"]));
  });

  it("switches only when they ask, stays switched, and switches back when they ask again", () => {
    const run = (steps: Array<{ read: "english" | "hinglish" | null; requested?: "english" | "hinglish" }>) => {
      let language: "english" | "hinglish" | "hindi" = "hinglish";
      let held: "english" | "hinglish" | "hindi" | null = null;
      return steps.map(s => {
        const choice = { requested: s.requested ?? null, held };
        language = chooseLanguage(s.read, language, "a sentence of several words", "hinglish", choice);
        held = heldAfter(choice, "hinglish");
        return language;
      });
    };
    expect(run([
      { read: "hinglish" }, { read: "english", requested: "english" }, { read: "hinglish" }, { read: "english" },
      { read: "hinglish", requested: "hinglish" }, { read: "english" }, { read: "english" },
    ])).toEqual(["hinglish", "english", "english", "english", "hinglish", "hinglish", "hinglish"]);
  });

  it("a request for the language they chose ends a held one; any other request is held", () => {
    expect(heldAfter({ requested: "hinglish" }, "hinglish")).toBeNull();
    expect(heldAfter({ requested: "english" }, "hinglish")).toBe("english");
    expect(heldAfter({ held: "english" }, "hinglish")).toBe("english");
    expect(heldAfter({}, "hinglish")).toBeNull();
  });

  it("with no choice made, what they write in still decides (unchanged)", () => {
    expect(chooseLanguage("english", "hinglish", "How is my progress going?", null)).toBe("english");
    expect(chooseLanguage("hinglish", "english", "Aaj ke plans update karne hain", null)).toBe("hinglish");
  });

  it("every product surface gets the same rule: the whole reply, every turn, technical terms left in English", () => {
    const line = surfaceLanguageLine("hinglish");
    expect(line).toContain("from the first sentence to the last, every turn, even when their message is mostly English");
    expect(line).toContain("do not invent Hindi for technical words");
    expect(line).toContain("only if the learner explicitly asks");
    expect(surfaceLanguageLine(null)).toContain("LANGUAGE: English, unless the learner writes to you in Hinglish");
  });

  it("reaches the editor, the tutor, Today's Nova, the study proposal and Build with Nova", () => {
    const src = (f: string) => require("node:fs").readFileSync(require("node:path").join(__dirname, "..", f), "utf8") as string;
    expect(src("product/note-edit.ts")).toContain("surfaceLanguageLine(language, { content: \"note\" })");
    expect(src("product/note-tutor.ts")).toContain("surfaceLanguageLine(options.language ?? null)");
    expect(src("product/day-copilot.ts")).toContain("surfaceLanguageLine(language)");
    expect(src("product/study-proposal.ts")).toContain("surfaceLanguageLine(language)");
    expect(src("product/builder-conversation.ts")).toContain("return surfaceLanguageLine(chosen)");
  });
});
