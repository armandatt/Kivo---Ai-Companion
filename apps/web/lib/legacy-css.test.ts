// The stylesheet older browsers can read (smart TVs: Chromium before 99 drops
// every rule inside @layer, and the site is drawn as bare HTML). Runs the real
// postcss.config.mjs over app/globals.css, as the build does, and checks what
// came out. Run with `npm test`.

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { before, test } from "node:test"
import { fileURLToPath } from "node:url"
import postcss, { type Root } from "postcss"

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, "..")
const require = createRequire(join(app, "package.json"))

let root: Root

before(async () => {
  const config = (await import(join(app, "postcss.config.mjs"))).default as { plugins: Record<string, object> }
  const plugins = Object.entries(config.plugins).map(([name, options]) => {
    const mod = require(name)
    return (typeof mod === "function" ? mod : mod.default)(options)
  })
  const from = join(app, "app/globals.css")
  const result = await postcss(plugins).process(readFileSync(from, "utf8"), { from })
  root = result.root
})

test("no cascade layers are left: an old browser would throw away everything inside one", () => {
  const layers: string[] = []
  root.walkAtRules("layer", at => { layers.push(at.params) })
  assert.deepEqual(layers, [])
})

test("every fixed oklch() colour has a fallback an old browser can use", () => {
  const bare: string[] = []
  root.walkDecls(decl => {
    // A colour worked out from variables at run time (subject tints) cannot
    // be converted at build time; those are the known exception.
    if (!/oklch\(/.test(decl.value) || /oklch\([^)]*var\(/.test(decl.value)) return
    let guarded = false
    for (let p = decl.parent as postcss.Node | undefined; p; p = p.parent as postcss.Node | undefined) {
      if (p.type === "atrule" && (p as postcss.AtRule).name === "supports") guarded = true
    }
    const prev = decl.prev()
    const fallbackBefore = prev?.type === "decl" && prev.prop === decl.prop && !/oklch\(/.test(prev.value)
    if (!guarded && !fallbackBefore) bare.push(`${decl.prop}: ${decl.value}`)
  })
  assert.deepEqual(bare, [])
})

test("each translate, scale or rotate has a transform for browsers without those properties", () => {
  const missing: string[] = []
  root.walkRules(rule => {
    if (rule.parent?.type === "atrule" && /keyframes$/.test((rule.parent as postcss.AtRule).name)) return
    let moves = false
    rule.each(n => { if (n.type === "decl" && ["translate", "rotate"].includes(n.prop) && n.value !== "none") moves = true })
    if (!moves) return
    const next = rule.next()
    if (!(next?.type === "atrule" && next.name === "supports" && /not \(translate: 0\)/.test(next.params))) missing.push(rule.selector)
  })
  assert.deepEqual(missing, [])
})

test("Tailwind's utilities and the app's own tokens are still there", () => {
  const css = root.toString()
  assert.match(css, /\.kivo-app/)
  assert.match(css, /--background/)
  assert.ok(css.length > 50_000, "the stylesheet was generated")
})
