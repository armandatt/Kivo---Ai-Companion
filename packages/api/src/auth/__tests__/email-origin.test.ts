// Links in auth emails open on the site the person asked from, and only when
// the request carries the web app's proxy proof (http.ts emailOriginOf).
import { emailOriginOf, handleAuthRequest } from "../http";
import { PROXY_APP_ORIGIN_HEADER, PROXY_CLIENT_IP_HEADER, PROXY_PROOF_HEADER } from "../proxy-headers";
import { proxyProof } from "../secrets";
import { fakeAuth } from "./fake-auth";

const proxied = (origin: string) => new Headers({ [PROXY_PROOF_HEADER]: proxyProof(), [PROXY_CLIENT_IP_HEADER]: "198.51.100.7", [PROXY_APP_ORIGIN_HEADER]: origin });

describe("the address in an email link", () => {
  it("is the site the browser used, when the proxy vouches for it", () => {
    expect(emailOriginOf(proxied("https://www.thekivo.in"), { NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe("https://www.thekivo.in");
  });
  it("is never taken from a request the proxy didn't send", () => {
    expect(emailOriginOf(new Headers({ [PROXY_PROOF_HEADER]: "0".repeat(64), [PROXY_APP_ORIGIN_HEADER]: "https://evil.example" }))).toBeNull();
    expect(emailOriginOf(new Headers({ [PROXY_APP_ORIGIN_HEADER]: "https://evil.example" }))).toBeNull();
  });
  it("is an origin and nothing more, and not localhost or http in production", () => {
    for (const bad of ["https://www.thekivo.in/path", "javascript:alert(1)", "http://www.thekivo.in", "not a url"]) {
      expect([bad, emailOriginOf(proxied(bad), { NODE_ENV: "production" } as NodeJS.ProcessEnv)]).toEqual([bad, null]);
    }
    expect(emailOriginOf(proxied("http://localhost:3000"), { NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBeNull();
    expect(emailOriginOf(proxied("http://localhost:3000"), { NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe("http://localhost:3000");
  });
  it("is used for the reset link, whatever NEXT_PUBLIC_APP_URL says", async () => {
    const auth = fakeAuth({ users: [{ id: "u1", email: "asha@example.com", name: "Asha", password: "hashed(old pass 1234)", emailVerified: new Date() }] });
    const req = new Request("https://api.internal.test/api/forgot-password", { method: "POST", headers: { "content-type": "application/json", [PROXY_PROOF_HEADER]: proxyProof(), [PROXY_CLIENT_IP_HEADER]: "198.51.100.8", [PROXY_APP_ORIGIN_HEADER]: "https://www.thekivo.in" }, body: JSON.stringify({ email: "asha@example.com" }) });
    const res = await handleAuthRequest("forgot-password", req, { deps: auth.deps });
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 20));
    expect(auth.sent.at(-1)!.text).toContain("https://www.thekivo.in/reset-password?token=");
  });
  it("a link can be checked before a password is typed, and checking uses nothing up", async () => {
    const auth = fakeAuth({ users: [{ id: "u2", email: "ravi@example.com", name: "Ravi", password: "hashed(old pass 1234)", emailVerified: new Date() }] });
    const send = (body: unknown) => handleAuthRequest("reset-password", new Request("http://api.local/api/reset-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { deps: auth.deps });
    await handleAuthRequest("forgot-password", new Request("http://api.local/api/forgot-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "ravi@example.com" }) }), { deps: auth.deps });
    await new Promise(r => setTimeout(r, 20));
    const token = auth.lastResetToken();
    expect((await send({ token, check: true })).body).toEqual({ usable: true });
    expect((await send({ token, check: true })).body).toEqual({ usable: true });
    expect((await send({ token, password: "A new password 2" })).status).toBe(200);
    expect((await send({ token, check: true })).status).toBe(400);
    expect((await send({ token: "x", check: true })).status).toBe(400);
  });
});
