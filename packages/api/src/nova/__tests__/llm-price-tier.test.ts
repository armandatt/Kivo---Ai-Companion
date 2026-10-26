// A request over the model client's prompt-size limit is not sent; the plan
// writers tell the learner to send less instead of "try again".

jest.mock("@repo/db/client", () => ({ prisma: {} }));
jest.mock("../../services/openai.service", () => ({ generateOpenAIText: jest.fn() }));

import { OVER_PRICE_TIER } from "../../services/llmProviders";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gen = require("../product/workspace-generation") as typeof import("../product/workspace-generation");

const over = async () => { throw new Error(`Claude: ${OVER_PRICE_TIER} (180000 tokens > 100000). Send fewer or shorter files.`); };

describe("files over the limit", () => {
  it("each plan writer says to send less, and is not marked unavailable", async () => {
    const plan = await gen.writeBuilderPlan({ today: "2026-10-26", kind: "exam", facts: [{ label: "Exam", value: "DSA" }], known: [], assumptions: [], suggestions: [], conversation: [], learnerText: "", existing: null }, over as never);
    expect(plan).toEqual({ ok: false, message: gen.FILES_TOO_BIG });
    const changes = await gen.writeBuilderChanges({ today: "2026-10-26", kind: "semester", facts: [], proposal: true, current: { subjects: [], tasks: [], dates: [], notes: [] }, proposed: null, change: "Add a mock test", conversation: [] } as never, over as never);
    expect(changes).toEqual({ ok: false, message: gen.FILES_TOO_BIG });
  });
});
