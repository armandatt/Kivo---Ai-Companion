// A Telegram chat nobody has connected: what it is told, and that the webhook
// asks before it writes anything or hands the chat to either companion.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { notConnectedMessage } from "../telegram/telegram-link";

describe("what an unconnected chat is told", () => {
  const said = notConnectedMessage(null);

  it("says the chat is not connected and how to connect it, from the web", () => {
    expect(said).toContain("isn't connected to a Kio account");
    expect(said).toContain("Connect Telegram");
    expect(said).toContain("on the web");
  });

  it("names no companion and nothing about fitness or study", () => {
    for (const word of ["Rex", "Nova", "gym", "workout", "coach", "mentor", "study"]) {
      expect(said.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  it("is short, plain text, and asks nothing", () => {
    expect(said.length).toBeLessThan(260);
    expect(said).not.toContain("?");
    expect(said).not.toContain("*");
    expect(said).not.toContain("_");
  });

  it("gives the web address only when this deployment has one, and never makes one up", () => {
    expect(notConnectedMessage("https://app.example.test")).toBe(`${said}\n\nhttps://app.example.test`);
    expect(notConnectedMessage("https://app.example.test///")).toBe(`${said}\n\nhttps://app.example.test`);
    for (const none of [null, undefined, "", "   ", "app.example.test", "javascript:alert(1)"]) {
      expect(notConnectedMessage(none)).toBe(said);
    }
    expect(said).not.toContain("http");
  });
});

// The webhook route lives in apps/api and cannot be loaded here, so the order
// it does things in is read from its source.
describe("the webhook", () => {
  const route = readFileSync(join(__dirname, "../../../../../apps/api/app/api/telegram/route.ts"), "utf8");
  const post  = route.slice(route.indexOf("export async function POST"));
  const gate  = post.indexOf("isLinkedTelegramChat(");
  const gateEnd = post.indexOf("const stopTyping", gate);

  it("asks whether the chat is connected before it writes a row for it", () => {
    expect(gate).toBeGreaterThan(0);
    expect(post.indexOf("updateUserProfile(")).toBeGreaterThan(gate);
  });

  it("asks after the request is authenticated and replays are dropped, not before", () => {
    expect(post.indexOf("admitTelegramUpdate(")).toBeGreaterThan(0);
    expect(post.indexOf("admitTelegramUpdate(")).toBeLessThan(gate);
  });

  it("asks before either companion's pipeline: Nova's turn, Rex's intake, commands and the model", () => {
    for (const later of ["needsIntake(", "handleOnboardingV2(", "handleOnboardingV3(", "handleIntakeMessage(", "handleWorkoutCommand(", "runUnderstandingLayer(", "checkRateLimit(", "startTelegramTyping(chatId)"]) {
      const at = post.indexOf(later);
      expect(at).toBeGreaterThan(gate);
    }
    // The only Nova call ahead of it is the button branch, which acts on Nova chats alone.
    expect(post.slice(0, gate)).toContain("isNovaChat(event.chatId)");
  });

  it("an unconnected chat's only way on is the connect link; otherwise it is answered and the request ends", () => {
    const block = post.slice(gate, gateEnd);
    expect(block).toContain("handleTelegramConnectStart(");
    expect(block).toContain("notConnectedMessage(");
    expect(block).toContain("return Response.json({ ok: true })");
    for (const never of ["updateUserProfile(", "handleNovaTelegramEvent(", "processMessage(", "runOrchestrator(", "addToShortTerm("]) {
      expect(block).not.toContain(never);
    }
  });
});
