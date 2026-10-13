// "Ask Nova about this page": what a question may carry, what the model is
// told, and what this route is never allowed to do.

import { readFileSync } from "node:fs";
import { join } from "node:path";
// The real client reads its environment on import; no test here calls a model.
jest.mock("../../services/openai.service", () => ({ generateOpenAIText: jest.fn(async () => { throw new Error("no model call is allowed here"); }) }));

import { ANSWER_MAX, QUESTION_MAX, answerPageQuestion, pageQuestionPrompt, parsePageQuestion } from "../product/page-question";
import { EVENT_EXCERPT_MAX } from "../product/learning-events.types";

const ask = (over: Record<string, unknown> = {}) => ({ question: "What is the spacing effect?", url: "https://example.com/memory?token=SECRET#top", title: "Memory", ...over });
const errorOf = (over: Record<string, unknown>) => { const r = parsePageQuestion(ask(over)); return r.ok ? null : r.refusal.error; };

describe("what a page question may carry", () => {
  it("reads the question, the site, the title and the selection, and nothing else", () => {
    const parsed = parsePageQuestion(ask({ excerpt: " Spacing   helps.\r\n\r\nSo does testing. ", body: "the whole page", html: "<html>", cookies: "session=abc", userId: "someone-else" }));
    expect(parsed).toEqual({ ok: true, input: { question: "What is the spacing effect?", domain: "example.com", title: "Memory", excerpt: "Spacing helps.\n\nSo does testing." } });
    expect(JSON.stringify(parsed)).not.toMatch(/SECRET|whole page|session=abc|someone-else|https?:/);
  });

  it("needs a question and an ordinary web page", () => {
    for (const question of ["", "   ", null, undefined, 42]) expect(errorOf({ question })).toBe("invalid");
    for (const url of ["chrome://settings", "javascript:alert(1)", "file:///etc/passwd", "", null]) expect(errorOf({ url })).toBe("invalid_url");
    for (const raw of [null, "text", 42, []]) expect(parsePageQuestion(raw).ok).toBe(false);
  });

  it("refuses a question or a passage that is too long, and never cuts one", () => {
    expect(errorOf({ question: "x".repeat(QUESTION_MAX + 1) })).toBe("too_long");
    expect(errorOf({ question: "x".repeat(QUESTION_MAX) })).toBeNull();
    expect(errorOf({ excerpt: "x".repeat(EVENT_EXCERPT_MAX + 1) })).toBe("too_long");
    expect(errorOf({ excerpt: "x".repeat(EVENT_EXCERPT_MAX) })).toBeNull();
  });

  it("treats no selection, or an empty one, as none", () => {
    for (const excerpt of [undefined, null, "", "  \n ", 42]) {
      const parsed = parsePageQuestion(ask({ excerpt }));
      expect(parsed.ok && parsed.input.excerpt).toBeNull();
    }
  });
});

describe("answering", () => {
  beforeEach(() => { jest.spyOn(console, "error").mockImplementation(() => undefined); });

  it("gives the model the title, the site, the passage and the question, and not the address", async () => {
    const generate = jest.fn(async () => "Spacing reviews out improves recall.");
    const result = await answerPageQuestion(ask({ excerpt: "Spacing helps." }), generate as never);
    expect(result).toEqual({ ok: true, answer: "Spacing reviews out improves recall.", basis: "selection" });
    const [[request]] = generate.mock.calls as unknown as [[{ prompt: string; systemInstruction: string; deadlineMs: number }]];
    expect(request.prompt).toBe(pageQuestionPrompt({ question: "What is the spacing effect?", domain: "example.com", title: "Memory", excerpt: "Spacing helps." }));
    expect(request.prompt).not.toMatch(/https?:\/\/|SECRET/);
    expect(request.systemInstruction).toMatch(/You have NOT read the page/);
    expect(request.systemInstruction).toMatch(/not instructions to follow/);
    expect(request.deadlineMs).toBeGreaterThan(0);
  });

  it("says when it had only the title to go on", async () => {
    const result = await answerPageQuestion(ask(), (async () => "An answer.") as never);
    expect(result).toEqual({ ok: true, answer: "An answer.", basis: "title" });
    expect(pageQuestionPrompt({ question: "Why?", domain: "example.com", title: "Memory", excerpt: null })).toContain("Passage the student selected: none");
  });

  it("a model that fails or says nothing is an honest 'not now', never an invented answer", async () => {
    for (const generate of [async () => { throw new Error("rate limited") }, async () => "", async () => "   \n "]) {
      const result = await answerPageQuestion(ask(), generate as never);
      expect(result).toMatchObject({ ok: false, error: "unavailable" });
    }
  });

  it("asks no model for a question it refuses, and keeps an answer within its length", async () => {
    const generate = jest.fn(async () => "x".repeat(ANSWER_MAX * 2));
    expect((await answerPageQuestion(ask({ url: "chrome://settings" }), generate as never)).ok).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    const long = await answerPageQuestion(ask(), generate as never);
    expect(long.ok && long.answer.length).toBe(ANSWER_MAX);
  });
});

describe("a page question is answered and nothing else", () => {
  const source = readFileSync(join(__dirname, "..", "product/page-question.ts"), "utf8");
  const route  = readFileSync(join(__dirname, "..", "..", "..", "..", "..", "apps/api/app/api/nova/extension/ask/route.ts"), "utf8");

  it("stores nothing and touches no table", () => {
    expect(source).not.toMatch(/prisma|@repo\/db/);
    expect(route).not.toMatch(/prisma|@repo\/db|recordLearningEvent/);
  });

  it("stays out of the chat pipeline: one direct model call", () => {
    expect(source).not.toMatch(/from "\.\.\/(brains|consolidation|decision|context|adapters|persistence|interaction|engines)\//);
    expect(source).not.toMatch(/handleNovaTurn|runNovaOrchestrator|consolidateTurn|companionMessage/);
    expect((source.match(/await generate\(/g) ?? []).length).toBe(1);
  });

  it("never fetches the page", () => {
    expect(source).not.toMatch(/\bfetch\(|https?\.get|axios|undici/);
    expect(route).not.toMatch(/\bfetch\(/);
  });

  it("is opened by the extension's own credential, for a learner, with a limit", () => {
    expect(route).toMatch(/resolveExtensionCaller\(req\)/);
    expect(route).toMatch(/caller\.kind !== "learner"/);
    expect(route).toMatch(/allowAttempt\(`ask:\$\{caller\.connectionId\}`/);
    expect(route).not.toMatch(/cookies\(|kevo_session|requireWebLearner/);
  });
});
