// Tailwind first; then what keeps the site readable in older browsers (smart
// TVs, older iPads). Tailwind v4 puts every style inside cascade layers
// (@layer), and a browser older than Chromium 99 or Safari 15.4 throws away
// everything inside a layer, so the page is drawn as bare HTML.
//
//   1. legacy-transforms: a `transform` beside each translate/scale/rotate,
//      only for browsers without those properties (packages/postcss-legacy-transforms).
//   2. oklab-function: an rgb() fallback for each oklch() colour of our own
//      (the palette in globals.css); Tailwind already writes fallbacks for its own.
//   3. cascade-layers: the layers flattened into ordinary rules with the same
//      order of precedence, so a browser without @layer applies them. Last,
//      so it also orders what the plugins above add inside a layer.
//
// Modern browsers get the same result as before. Plugins are named by
// package: Turbopack requires each name from its build folder, so a relative
// path or an imported function does not work here.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    "@repo/postcss-legacy-transforms": {},
    "@csstools/postcss-oklab-function": { preserve: true },
    "@csstools/postcss-cascade-layers": {},
  },
}

export default config
