// The web app's middleware tells the API which browser is asking, with the
// same proof the auth proxy uses (packages/api/src/auth/secrets.ts proxyProof).
import { test } from "node:test"
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { PROXY_CLIENT_IP_HEADER, PROXY_PROOF_HEADER } from "@repo/api/auth/proxy-headers"
import { proxyProof } from "@repo/api/auth/secrets"
import { apiProof, withClientAddress } from "./middleware"

// Both sides read the secret when called, not when loaded.
process.env.JWT_SECRET = "middleware-test-secret"

test("the proof is the API's own proxyProof for the same secret", async () => {
  assert.equal(await apiProof(), proxyProof())
  assert.notEqual(await apiProof({ JWT_SECRET: "another" }), proxyProof())
})

test("no secret in production: nothing is claimed", async () => {
  assert.equal(await apiProof({ NODE_ENV: "production" }), null)
})

test("the browser's address goes with the proof; what the browser sent in those headers is dropped", async () => {
  const req = new NextRequest("https://www.thekivo.in/api/nova/today", {
    headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1", [PROXY_PROOF_HEADER]: "forged", [PROXY_CLIENT_IP_HEADER]: "198.51.100.1" },
  })
  const h = await withClientAddress(req)
  assert.equal(h.get(PROXY_CLIENT_IP_HEADER), "203.0.113.9")
  assert.equal(h.get(PROXY_PROOF_HEADER), proxyProof())
})

test("no address known: no proof and no address are sent", async () => {
  const req = new NextRequest("https://www.thekivo.in/api/nova/today", { headers: { [PROXY_PROOF_HEADER]: "forged", [PROXY_CLIENT_IP_HEADER]: "198.51.100.1" } })
  const h = await withClientAddress(req)
  assert.equal(h.get(PROXY_PROOF_HEADER), null)
  assert.equal(h.get(PROXY_CLIENT_IP_HEADER), null)
})
