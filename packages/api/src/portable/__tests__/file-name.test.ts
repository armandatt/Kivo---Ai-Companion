import { attachmentHeader, kivoFileName } from "../export";

describe("the downloaded file's name", () => {
  it("is the title as written, spaces and all", () => {
    expect(kivoFileName("1st year knowledge roadmap")).toBe("1st year knowledge roadmap.kivo");
    expect(kivoFileName("B.Tech CSE – Sem 3")).toBe("B.Tech CSE – Sem 3.kivo");
    expect(kivoFileName("वर्ष 1 नोट्स")).toBe("वर्ष 1 नोट्स.kivo");
  });
  it("loses only what a file system or header cannot carry", () => {
    expect(kivoFileName("OS / DBMS: notes?")).toBe("OS DBMS notes.kivo");
    expect(kivoFileName("  many   spaces  ")).toBe("many spaces.kivo");
    expect(kivoFileName("roadmap.kivo")).toBe("roadmap.kivo");
    expect(kivoFileName("..hidden")).toBe("hidden.kivo");
    expect(kivoFileName("a\u0000b\nc")).toBe("a b c.kivo");
    expect(kivoFileName("///")).toBe("map.kivo");
    expect(kivoFileName("x".repeat(200))).toBe(`${"x".repeat(80)}.kivo`);
  });
  it("is sent exactly (RFC 5987) with a plain fallback that cannot break the header", () => {
    expect(attachmentHeader("1st year knowledge roadmap.kivo")).toBe(`attachment; filename="1st year knowledge roadmap.kivo"; filename*=UTF-8''1st%20year%20knowledge%20roadmap.kivo`);
    const h = attachmentHeader("वर्ष \"1\".kivo");
    expect(h).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    expect(h).not.toMatch(/filename="[^"]*"[^;]*"/);
  });
});
