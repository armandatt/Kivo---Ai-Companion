// ─── Consolidation boundary tests (static) ────────────────────────────────────
// SKILL.md §11.7 / §16.4 — no durable user-state write may bypass
// consolidation. These tests read the Nova source tree and fail if a module
// on the wrong side of the boundary reaches a durable table.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const NOVA_ROOT = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    // Runtime code only: unit tests and the real-DB integration test are excluded.
    if (statSync(full).isDirectory()) return name === "__tests__" || name === "__integration__" ? [] : sourceFiles(full);
    return name.endsWith(".ts") ? [full] : [];
  });
}

const FILES = sourceFiles(NOVA_ROOT).map(full => ({
  path: relative(NOVA_ROOT, full).split(sep).join("/"),
  src:  readFileSync(full, "utf8"),
}));

const WRITE = "(create|createMany|update|updateMany|upsert|delete|deleteMany)";

function filesMatching(pattern: RegExp): string[] {
  return FILES.filter(f => pattern.test(f.src)).map(f => f.path).sort();
}

describe("consolidation boundary", () => {
  it("finds the Nova source tree", () => {
    expect(FILES.length).toBeGreaterThan(30);
    expect(FILES.some(f => f.path === "consolidation/consolidator.ts")).toBe(true);
  });

  it("signal, understanding, pattern, decision and context modules never touch persistence", () => {
    const upstream = FILES.filter(f =>
      f.path === "engines/signal-engine.ts" ||
      f.path === "engines/pattern-detector.ts" ||
      f.path.startsWith("brains/") ||
      f.path.startsWith("decision/") ||
      f.path.startsWith("context/"),
    );
    expect(upstream.length).toBeGreaterThan(5);

    const forbidden = /@repo\/db\/client|consolidation\/stores\/|run-consolidation|\/persistence\//;
    const offenders = upstream.filter(f => forbidden.test(f.src)).map(f => f.path);
    expect(offenders).toEqual([]);
  });

  it("Nova never reads or writes MemoryFact", () => {
    expect(filesMatching(/prisma\.memoryFact\b/)).toEqual([]);
  });

  it("UserFact, UserReality and BehavioralPattern are written only by their stores", () => {
    const writers = filesMatching(new RegExp(`\\b(prisma|db|tx)\\.(userFact|userReality|behavioralPattern)\\.${WRITE}\\b`));
    expect(writers).toEqual([
      "consolidation/stores/behavioral-pattern-store.ts",
      "consolidation/stores/reality-store.ts",
      "consolidation/stores/user-fact-store.ts",
    ]);
  });

  it("NovaCognitiveState is written only by its store and the state-score snapshot", () => {
    const writers = filesMatching(new RegExp(`\\b(prisma|db|tx)\\.novaCognitiveState\\.${WRITE}\\b`));
    expect(writers).toEqual([
      "consolidation/stores/cognitive-state-store.ts",
      // Academic State Engine's own rolling score history (stateHistory only).
      "persistence/nova-persistence.ts",
    ]);

    const persistence = FILES.find(f => f.path === "persistence/nova-persistence.ts")!.src;
    expect(persistence).not.toMatch(/investigation(Topic|Status|Hypotheses|Attempts)\s*:/);
  });

  it("the conversation log is written only by the conversation adapter", () => {
    expect(filesMatching(new RegExp(`prisma\\.companionMessage\\.${WRITE}\\b`)))
      .toEqual(["adapters/conversation-adapter.ts"]);
  });

  it("the consolidation job record is written only by its store", () => {
    expect(filesMatching(new RegExp(`\\b(prisma|db|tx)\\.novaConsolidationJob\\.${WRITE}\\b`)))
      .toEqual(["consolidation/stores/consolidation-job-store.ts"]);
  });

  it("every state write of a turn runs inside one transaction", () => {
    const runner = FILES.find(f => f.path === "consolidation/run-consolidation.ts")!.src;
    expect(runner).toMatch(/prisma\.\$transaction\(/);
    // Stores that write consolidated state take the transaction handle; none
    // of them reaches for the global client to write.
    for (const store of ["user-fact-store", "reality-store", "behavioral-pattern-store", "cognitive-state-store"]) {
      const src = FILES.find(f => f.path === `consolidation/stores/${store}.ts`)!.src;
      expect(src).not.toMatch(new RegExp(`\\bprisma\\.[a-zA-Z]+\\.${WRITE}\\b`));
    }
  });

  it("the signal engine does not decide that a session is starting", () => {
    // Starting a session is a command (protocol) or the Understanding Brain's
    // reading of the message (meaning). It is never a regex over the text.
    const engine = FILES.find(f => f.path === "engines/signal-engine.ts")!.src;
    expect(engine).not.toMatch(/SESSION_START_RE/);
    expect(engine).not.toMatch(/type:\s*"session_start",\s*pattern:/);

    const commands = FILES.find(f => f.path === "commands.ts")!.src;
    expect(commands.match(/\/[^/\n]+\/[gimsu]*;/g) ?? []).toHaveLength(1);   // one regex: the slash-command grammar
  });

  it("regex classification lives in the signal engine only, and its output is filtered before use", () => {
    // Other regex in Nova is structural: the slash-command grammar and
    // onboarding's date/format normalization.
    const withRegex = FILES
      .filter(f => /(=\s*\/[^/\n*][^\n]*\/[gimsu]*;)|\.test\(|\.match\(\s*\/|new RegExp/.test(f.src))
      .map(f => f.path).sort();
    expect(withRegex).toEqual([
      "brains/disambiguation-pass.ts",
      "brains/understanding-parser.ts",
      "commands.ts",
      "engines/signal-engine.ts",
      "entry.ts",   // slash-command protocol only: "/help" and stripping the command prefix
      "onboarding/nova-onboarding-extractor.ts",
      "onboarding/nova-onboarding-persistence.ts",
      "onboarding/nova-onboarding-validator.ts",
    ].filter(p => withRegex.includes(p)));

    // The orchestrator narrows signals to established ones before any consumer.
    const orch = FILES.find(f => f.path === "nova-orchestrator.ts")!.src;
    const filterAt = orch.indexOf("resolveTurnSignals(");
    expect(orch).not.toMatch(/\bextractSignals\(/);   // never the raw regex output
    const resolver = FILES.find(f => f.path === "engines/turn-signals.ts")!.src;
    expect(resolver).toMatch(/return establishedSignals\(signals, understanding\);\s*}\s*$/);
    expect(filterAt).toBeGreaterThan(0);
    for (const consumer of ["computeAcademicState(", "computeSessionAction(", "runDecisionGraph(", "runPatternDetector(", "persistTurnAsync("]) {
      expect(orch.indexOf(consumer)).toBeGreaterThan(filterAt);
    }
  });

  it("no new LLM call: the Understanding Brain is the only caller on its path", () => {
    const llmCallers = FILES.filter(f => /generateOpenAIText\(/.test(f.src)).map(f => f.path).sort();
    expect(llmCallers).toEqual([
      "brains/disambiguation-pass.ts",
      "brains/first-use-wording.ts",   // words the one first message of a linked chat; facts decided in code
      "brains/language-wording.ts",    // says a reply code already wrote in the learner's language; adds nothing
      "brains/response-brain.ts",
      "brains/understanding-brain.ts",
      "onboarding/nova-onboarding-extractor.ts",
      "onboarding/nova-onboarding-response.ts",
      "proactive/nova-proactive-response.ts",
    ]);
    const ub = FILES.find(f => f.path === "brains/understanding-brain.ts")!.src;
    expect(ub.match(/generateOpenAIText\(/g)).toHaveLength(1);
  });

  it("stores are reached only through the consolidation runner (reads excepted)", () => {
    const applyCall = /\bapply(Fact|Reality|Pattern|Investigation)Decision\(|\bapply(Session|Mastery)Observation\(/;
    const callers = FILES
      .filter(f => !f.path.startsWith("consolidation/stores/") && applyCall.test(f.src))
      .map(f => f.path);
    expect(callers).toEqual(["consolidation/run-consolidation.ts"]);
  });

  it("policies hold no persistence and stores hold no policy", () => {
    const policies = FILES.filter(f => f.path.startsWith("consolidation/policies/"));
    expect(policies.length).toBeGreaterThanOrEqual(2);
    for (const f of policies) expect(f.src).not.toMatch(/@repo\/db\/client|stores\//);

    const stores = FILES.filter(f => f.path.startsWith("consolidation/stores/"));
    for (const f of stores) expect(f.src).not.toMatch(/from\s+"[^"]*(policies\/|consolidator\.js)/);
  });

  it("the Understanding Brain's parser reads no message text with regex", () => {
    // Shape validation only: the one pattern allowed strips markdown fences.
    const src = FILES.find(f => f.path === "brains/understanding-parser.ts")!.src;
    const regexLiterals = src.match(/\.(test|match|replace)\(\s*\//g) ?? [];
    expect(regexLiterals.length).toBeLessThanOrEqual(2);
    expect(src).not.toMatch(/rawText\.(match|test|search)|RegExp\(/);
  });

  it("the consolidator and evidence builder are pure: no DB, no LLM", () => {
    for (const path of ["consolidation/consolidator.ts", "consolidation/evidence-builder.ts"]) {
      const src = FILES.find(f => f.path === path)!.src;
      expect(src).not.toMatch(/@repo\/db\/client|openai\.service|stores\//);
    }
  });

  it("nothing in the consolidation layer calls an LLM", () => {
    const offenders = FILES
      .filter(f => f.path.startsWith("consolidation/") && /openai\.service|generateOpenAIText/.test(f.src))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });
});
