// Every Kivo Connect tool is classed read or write for usage accounting
// (connect/usage-class.ts), from what its handler does, and batch tools say
// how many items one call carries.

import { TOOLS } from "../tools";
import { classifyMcpCall, MCP_TOOL_CLASS, unclassifiedTools } from "../usage-class";

describe("MCP tool classes", () => {
  it("name every tool the server registers", () => {
    expect(unclassifiedTools(TOOLS.map(t => t.name))).toEqual([]);
  });
  it("name no tool that does not exist", () => {
    const names = new Set(TOOLS.map(t => t.name));
    expect(Object.keys(MCP_TOOL_CLASS).filter(n => !names.has(n))).toEqual([]);
  });
  it("never class a tool that changes the learner's data as a read", () => {
    for (const t of TOOLS) if (t.kind !== "read") expect(MCP_TOOL_CLASS[t.name]!.kind).toBe("write");
  });
  it("class preview_knowledge_changes as a write: its plan is applied by Approve", () => {
    expect(TOOLS.find(t => t.name === "preview_knowledge_changes")!.kind).toBe("read");
    expect(classifyMcpCall("preview_knowledge_changes", { changes: [{}, {}] })).toEqual({ kind: "write", items: 2, classified: true });
  });
  it("class capture_knowledge and build_knowledge_map as writes in preview mode too", () => {
    expect(classifyMcpCall("capture_knowledge", { mode: "preview", items: [{}, {}, {}] }).kind).toBe("write");
    expect(classifyMcpCall("build_knowledge_map", { mode: "preview", outline: [{}] }).kind).toBe("write");
  });
  it("account a tool it does not know as a write", () => {
    expect(classifyMcpCall("a_tool_added_later", {})).toEqual({ kind: "write", items: 1, classified: false });
  });
});

describe("batch items", () => {
  it("count an outline's topics at every level", () => {
    const outline = [{ name: "A", children: [{ name: "A1" }, { name: "A2", children: [{ name: "A2a" }] }] }, { name: "B" }];
    expect(classifyMcpCall("build_knowledge_map", { mode: "apply", outline }).items).toBe(5);
  });
  it("count captured items, changes, topics, and a note's files", () => {
    expect(classifyMcpCall("capture_knowledge", { items: new Array(7).fill({}) }).items).toBe(7);
    expect(classifyMcpCall("execute_knowledge_changes", { changes: new Array(12).fill({}) }).items).toBe(12);
    expect(classifyMcpCall("add_knowledge_node", { type: "topics", topics: ["a", "b", "c"] }).items).toBe(3);
    expect(classifyMcpCall("add_knowledge_node", { type: "subject", subjectName: "X" }).items).toBe(1);
    expect(classifyMcpCall("create_note", { title: "t", text: "x", images: [{}, {}] }).items).toBe(3);
  });
  it("count one item for any other call, and survive odd arguments", () => {
    expect(classifyMcpCall("search_notes", { query: "x" }).items).toBe(1);
    expect(classifyMcpCall("capture_knowledge", null).items).toBe(1);
  });
});
