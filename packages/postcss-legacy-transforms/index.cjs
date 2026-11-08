// Older browsers (TV browsers among them: Chromium before 104, Safari before
// 14.1) do not know the separate `translate`, `scale` and `rotate` properties
// that Tailwind v4 writes, so a centred dialog or menu (-translate-x-1/2) is
// drawn off centre and a chevron never turns. For each rule that sets one, this
// adds the same movement as a `transform`, inside `@supports not (translate: 0)`,
// so a browser that knows the properties never sees it.
//
// Each rule's fallback is its own transform: two of them on one element (a
// translate and a hover scale) do not combine in those browsers; the later
// rule wins. A scale Tailwind keeps in a variable as a percentage
// (--tw-scale-x: 105%) is written as the number (1.05), because older
// browsers take only numbers in scale().

const PROPS = new Set(["translate", "scale", "rotate"])
const SUPPORTS = "not (translate: 0)"

// "a b" → ["a", "b"], keeping calc(…) and var(…) whole.
function words(value) {
  const out = []
  let depth = 0
  let word = ""
  for (const ch of value.trim()) {
    if (ch === "(") depth++
    if (ch === ")") depth--
    if (/\s/.test(ch) && depth === 0) {
      if (word) out.push(word)
      word = ""
    } else word += ch
  }
  if (word) out.push(word)
  return out
}

// A variable without a fallback is given one, so an element that sets only
// one axis still moves: var(--tw-translate-y) → var(--tw-translate-y, 0).
const withDefault = (value, fallback) => value.replace(/var\((--[\w-]+)\)/g, `var($1, ${fallback})`)

// The rule's own literal for a scale variable, as a number: 105% → 1.05.
function scaleNumber(rule, name) {
  let found = null
  rule.walkDecls(name, decl => { found = decl.value.trim() })
  if (found === null) return null
  const percent = /^(-?[\d.]+)%$/.exec(found)
  if (percent) return String(Number(percent[1]) / 100)
  return /^-?[\d.]+$/.test(found) ? found : null
}

function transformFor(rule, prop, value) {
  if (value === "none" || value === "initial" || value === "inherit" || value === "unset") return null
  const parts = words(value)
  if (prop === "translate") {
    const [x, y = "0"] = parts.map(p => withDefault(p, "0"))
    return `translate(${x}, ${y})`
  }
  if (prop === "rotate") return parts.length === 1 ? `rotate(${parts[0]})` : null
  // scale: a literal (".98", "1.02 1.02") is used as it is; Tailwind's
  // variables are read from the same rule, where its utilities set them.
  const resolve = part => {
    const v = /^var\((--tw-scale-[xy])\)$/.exec(part)
    if (!v) return /^-?[\d.]+$/.test(part) ? part : null
    return scaleNumber(rule, v[1])
  }
  const [x, y] = [resolve(parts[0]), parts[1] === undefined ? undefined : resolve(parts[1])]
  if (x === null || y === null) return null
  return y === undefined ? `scale(${x})` : `scale(${x}, ${y})`
}

const plugin = () => ({
  postcssPlugin: "kivo-legacy-transforms",
  OnceExit(root, { AtRule, Rule }) {
    root.walkRules(rule => {
      // Keyframes steps cannot hold @supports, and a fallback inside one would
      // be read by every browser.
      if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return
      if (rule.parent?.type === "atrule" && rule.parent.name === "supports" && rule.parent.params === SUPPORTS) return
      const fallback = []
      rule.each(node => {
        if (node.type !== "decl" || !PROPS.has(node.prop)) return
        const t = transformFor(rule, node.prop, node.value)
        if (t) fallback.push(t)
      })
      if (fallback.length === 0) return
      // Already done (the CSS went through this plugin before).
      const next = rule.next()
      if (next?.type === "atrule" && next.name === "supports" && next.params === SUPPORTS && next.first?.selector === rule.selector) return
      const supports = new AtRule({ name: "supports", params: SUPPORTS })
      const copy = new Rule({ selector: rule.selector })
      copy.append({ prop: "transform", value: fallback.join(" ") })
      supports.append(copy)
      rule.after(supports)
    })
  },
})
plugin.postcss = true

module.exports = plugin
module.exports.transformFor = transformFor
