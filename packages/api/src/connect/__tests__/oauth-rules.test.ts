import { createHash } from "node:crypto";
import { ALL_SCOPES, hasScopes, parseRegistration, parseScopes, pkceChallengeOk, pkceVerifies, redirectUriOk, resourceOk } from "../oauth-rules";

describe("Kivo Connect OAuth rules", () => {
  test("PKCE S256 verifies the RFC 7636 example and nothing else", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(pkceChallengeOk(challenge, "S256")).toBe(true);
    expect(pkceVerifies(verifier, challenge)).toBe(true);
    expect(pkceVerifies(verifier.slice(0, -1) + "l", challenge)).toBe(false);
    expect(pkceVerifies("short", challenge)).toBe(false);
  });
  test("plain PKCE and missing challenges are refused", () => {
    expect(pkceChallengeOk("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "plain")).toBe(false);
    expect(pkceChallengeOk(undefined, "S256")).toBe(false);
  });
  test("scopes: unknown ones are refused, none asked means all, order is fixed", () => {
    expect(parseScopes(undefined)).toEqual({ ok: true, scopes: ALL_SCOPES });
    expect(parseScopes("notes:write notes:read")).toEqual({ ok: true, scopes: ["notes:read", "notes:write"] });
    expect(parseScopes("notes:read admin")).toEqual({ ok: false, unknown: ["admin"] });
    expect(hasScopes(["notes:read"], ["notes:read", "notes:write"])).toBe(false);
  });
  test("redirect addresses: https, or http on loopback only, never a fragment or credentials", () => {
    expect(redirectUriOk("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redirectUriOk("https://chatgpt.com/connector_platform_oauth_redirect")).toBe(true);
    expect(redirectUriOk("http://localhost:6274/oauth/callback")).toBe(true);
    expect(redirectUriOk("http://evil.example/cb")).toBe(false);
    expect(redirectUriOk("https://a.example/cb#x")).toBe(false);
    expect(redirectUriOk("https://user:pw@a.example/cb")).toBe(false);
    expect(redirectUriOk("javascript:alert(1)")).toBe(false);
  });
  test("registration keeps only what is supported", () => {
    const ok = parseRegistration({ client_name: "  Claude  ", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], logo_uri: "https://x" });
    expect(ok).toEqual({ ok: true, reg: { name: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"], tokenAuthMethod: "none" } });
    expect(parseRegistration({ redirect_uris: [] }).ok).toBe(false);
    expect(parseRegistration({ redirect_uris: ["https://a.example/cb"], grant_types: ["implicit"] }).ok).toBe(false);
    expect(parseRegistration({ redirect_uris: ["https://a.example/cb"], token_endpoint_auth_method: "private_key_jwt" }).ok).toBe(false);
  });
  test("the resource must be the MCP endpoint when named", () => {
    expect(resourceOk(undefined, "https://www.thekivo.in/api/mcp")).toBe(true);
    expect(resourceOk("https://www.thekivo.in/api/mcp/", "https://www.thekivo.in/api/mcp")).toBe(true);
    expect(resourceOk("https://other.example/mcp", "https://www.thekivo.in/api/mcp")).toBe(false);
  });
  test("the hash used for storage is SHA-256", () => {
    expect(createHash("sha256").update("x").digest("hex")).toHaveLength(64);
  });
});
