// Which companion an account uses, and which dashboard pages it may see.

import { NOVA_ROUTES, companionOf, routeAccess } from "../product/companion";

describe("companionOf", () => {
  it("follows the linked chat's persona, whatever was picked on the web", () => {
    expect(companionOf({ primaryPersona: "rex",  hasLinkedChat: true, messengerPersona: "nova" })).toBe("nova");
    expect(companionOf({ primaryPersona: "nova", hasLinkedChat: true, messengerPersona: "rex" })).toBe("rex");
    expect(companionOf({ primaryPersona: null,   hasLinkedChat: true, messengerPersona: "sage" })).toBe("rex");
    expect(companionOf({ primaryPersona: null,   hasLinkedChat: true, messengerPersona: null })).toBe("rex");
  });

  it("falls back to the web persona when no chat is linked", () => {
    expect(companionOf({ primaryPersona: "rex",  hasLinkedChat: false, messengerPersona: undefined })).toBe("rex");
    expect(companionOf({ primaryPersona: "nova", hasLinkedChat: false, messengerPersona: undefined })).toBe("nova");
    expect(companionOf({ primaryPersona: null,   hasLinkedChat: false, messengerPersona: undefined })).toBe("nova");
  });

  it("treats a linked chat with no record yet as Nova's to set up", () => {
    expect(companionOf({ primaryPersona: "rex", hasLinkedChat: true, messengerPersona: undefined })).toBe("nova");
  });
});

const REX_PAGES = ["/coach", "/goals", "/journey", "/progress", "/creature", "/guide"];

describe("routeAccess", () => {
  it("shows a Nova learner Nova's pages", () => {
    for (const { path } of NOVA_ROUTES) expect(routeAccess("nova", path)).toBe("render");
    expect(NOVA_ROUTES.map(r => r.path)).toEqual(["/home", "/planner", "/focus", "/knowledge"]);
  });

  it("never shows a Nova learner a Rex page", () => {
    for (const path of REX_PAGES) expect(routeAccess("nova", path)).toBe("nova_unavailable");
    expect(routeAccess("nova", "/goals/123")).toBe("nova_unavailable");
  });

  it("closes a page nobody has listed yet to Nova learners", () => {
    expect(routeAccess("nova", "/some-new-rex-page")).toBe("nova_unavailable");
  });

  it("does not match on a shared prefix", () => {
    expect(routeAccess("nova", "/homework")).toBe("nova_unavailable");
    expect(routeAccess("nova", "/planner/week")).toBe("render");
  });

  it("leaves every Rex page open to a Rex account", () => {
    for (const path of [...REX_PAGES, "/home", "/planner"]) expect(routeAccess("rex", path)).toBe("render");
  });

  it("keeps Nova-only pages from a Rex account", () => {
    expect(routeAccess("rex", "/focus")).toBe("not_for_rex");
    expect(routeAccess("rex", "/knowledge")).toBe("not_for_rex");
  });

  it("shares settings", () => {
    expect(routeAccess("nova", "/settings")).toBe("render");
    expect(routeAccess("rex", "/settings")).toBe("render");
  });
});
