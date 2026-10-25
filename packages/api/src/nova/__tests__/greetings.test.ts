// Nova's opening words follow the language the learner chose (point 10 of
// the 25 Oct brief): Today's greeting and Build with Nova's opening.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { builderOpening, greetingFor, startingQuestion } from "../product/greetings";
import { STARTING_QUESTION } from "../product/builder-state";

const repo = (path: string) => readFileSync(join(__dirname, "../../../../..", path), "utf8");

describe("opening words in their language", () => {
  it("greets by the time of day in English, Hindi and Hinglish; anything else is English", () => {
    expect([8, 14, 21].map(h => greetingFor("english", h))).toEqual(["Good morning", "Good afternoon", "Good evening"]);
    expect([8, 14, 21].map(h => greetingFor("hindi", h))).toEqual(["सुप्रभात", "नमस्ते", "शुभ संध्या"]);
    expect(greetingFor("hinglish", 14)).toBe("Namaste");
    expect(greetingFor(null, 3)).toBe("Good evening");
    expect(greetingFor("klingon", 8)).toBe("Good morning");
  });

  it("opens Build with Nova in their language, Hindi in Devanagari and Hinglish in Roman letters", () => {
    expect(builderOpening("english").heading).toBe("What would you like to build?");
    expect([...builderOpening("hindi").heading].some(c => c >= "ऀ" && c <= "ॿ")).toBe(true);
    expect([...builderOpening("hinglish").intro].every(c => c < "ऀ" || c > "ॿ")).toBe(true);
    expect(builderOpening("hindi").addTo("DSA")).toContain("DSA");
    expect(startingQuestion("english")).toBe(STARTING_QUESTION);
    expect(startingQuestion("hinglish")).not.toBe(STARTING_QUESTION);
  });

  it("is what Today, the builder and its code-written questions use", () => {
    expect(repo("apps/web/components/nova/nova-home.tsx")).toContain("greetingFor(view.language, new Date().getHours())");
    expect(repo("apps/web/components/nova/builder/conversation.tsx")).toContain("const opening = builderOpening(language)");
    expect(repo("packages/api/src/nova/product/builder.ts")).toContain("step.question === STARTING_QUESTION ? startingQuestion(language)");
  });
});
