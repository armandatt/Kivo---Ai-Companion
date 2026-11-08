// What older browsers (TV browsers) get for Tailwind v4's translate, scale
// and rotate: the same movement as a transform, only where those properties
// are unknown. Run with `npm test --workspace @repo/postcss-legacy-transforms`.

import assert from "node:assert/strict"
import { test } from "node:test"
import postcss from "postcss"
import plugin from "./index.cjs"

const run = async css => (await postcss([plugin()]).process(css, { from: undefined })).css
const fallbackOf = (out, selector) => {
  const root = postcss.parse(out)
  let found = null
  root.walkAtRules("supports", at => {
    if (at.params !== "not (translate: 0)") return
    at.walkRules(rule => { if (rule.selector === selector) rule.walkDecls("transform", d => { found = d.value }) })
  })
  return found
}

test("Tailwind's centring translate becomes a translate() with defaults for the unset axis", async () => {
  const out = await run(".-translate-x-1\\/2{--tw-translate-x:calc(calc(1 / 2 * 100%) * -1);translate:var(--tw-translate-x) var(--tw-translate-y)}")
  assert.equal(fallbackOf(out, ".-translate-x-1\\/2"), "translate(var(--tw-translate-x, 0), var(--tw-translate-y, 0))")
})

test("rotate and a literal scale are passed through", async () => {
  const out = await run(".rotate-180{rotate:180deg}.hover\\:scale-\\[1\\.02\\]:hover{scale:1.02}")
  assert.equal(fallbackOf(out, ".rotate-180"), "rotate(180deg)")
  assert.equal(fallbackOf(out, ".hover\\:scale-\\[1\\.02\\]:hover"), "scale(1.02)")
})

test("a percentage scale kept in Tailwind's variables is written as a number", async () => {
  const out = await run(".hover\\:scale-105:hover{--tw-scale-x:105%;--tw-scale-y:105%;--tw-scale-z:105%;scale:var(--tw-scale-x) var(--tw-scale-y)}")
  assert.equal(fallbackOf(out, ".hover\\:scale-105:hover"), "scale(1.05, 1.05)")
})

test("a scale it cannot work out at build time gets no fallback rather than a wrong one", async () => {
  const out = await run(".s{scale:var(--something-else)}")
  assert.equal(fallbackOf(out, ".s"), null)
})

test("the original rule is untouched, and the fallback is only for browsers without translate", async () => {
  const css = ".t{--tw-translate-y:-1px;translate:var(--tw-translate-x) var(--tw-translate-y)}"
  const out = await run(css)
  assert.ok(out.startsWith(css), "modern browsers read exactly what Tailwind wrote")
  assert.match(out, /@supports not \(translate: 0\)/)
})

test("keyframes, none values and rules without these properties are left alone", async () => {
  const css = "@keyframes k{from{translate:0 0}to{translate:0 10px}}.n{translate:none}.p{color:red}"
  assert.equal(await run(css), css)
})

test("running twice adds nothing more", async () => {
  const once = await run(".rotate-45{rotate:45deg}")
  assert.equal(await run(once), once)
})

test("inside a layer the fallback stays in the layer, so cascade-layers orders it with its rule", async () => {
  const out = await run("@layer utilities{.rotate-90{rotate:90deg}}")
  const root = postcss.parse(out)
  let inLayer = false
  root.walkAtRules("supports", at => { inLayer = at.parent?.type === "atrule" && at.parent.name === "layer" })
  assert.ok(inLayer)
})
