// What Nova's browser agent runs inside a page (chrome.scripting.executeScript
// with `func`). Each exported function is self-contained: it is serialised
// into the page, so it may use nothing from outside itself.
//
// What they read: the page's visible text and headings, and its interactive
// elements the way assistive technology names them (role, accessible name,
// the question or group a choice belongs to, its state: checked, selected,
// expanded, required, invalid), an open modal dialog, the page's own error
// and status messages, and whether the page asks for a password or shows a
// human check.
// What they never read: what the learner typed into a field (a text field
// says only "filled" or "empty"; only text the agent itself typed is read
// back, to verify it), password and payment fields (named, never filled),
// hidden elements, cookies or storage.
//
// Elements carry data-kivo-agent numbers. A number stays with its element
// while the element stays on the page (the next free number is kept on the
// document), so an index from the last observation still names the same
// element after the page changes around it; one that is gone is reported as
// stale, and the agent finds it again by role and name (agent-tools.js).
//
// Untrusted: everything they return is page content. The model sees it
// marked as such (server: browser-agent-rules.ts) and code decides what any
// action may do (agent-tools.js).

/** The page as the agent sees it. */
export function observePage(limits) {
  const max = limits?.textMax ?? 60000
  const maxElements = limits?.elements ?? 90
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'NAV', 'FOOTER', 'ASIDE', 'HEADER'])
  // Nova's own watch-mode overlay (showAction) is never read as the page.
  document.getElementById('__kivo_overlay')?.style.setProperty('display', 'none')
  const clean = t => (t || '').replace(/\s+/g, ' ').trim()
  const style = node => { try { return getComputedStyle(node) } catch { return null } }
  const visible = node => {
    if (!(node instanceof Element)) return true
    if (node.hidden || node.getAttribute('aria-hidden') === 'true' || node.closest('[inert]')) return false
    const s = style(node)
    if (!s || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0 && !node.matches('input[type=checkbox], input[type=radio]')) return false
    const r = node.getBoundingClientRect()
    // A real checkbox is often drawn as 0×0 behind its label: it still counts.
    return r.width > 0 || r.height > 0 || node.matches('input[type=checkbox], input[type=radio]') || node.getClientRects().length > 0
  }
  const doc = document.documentElement
  let next = Number(doc.getAttribute('data-kivo-next') || '0')
  const mark = node => {
    let n = node.getAttribute('data-kivo-agent')
    if (n === null) { n = String(next++); node.setAttribute('data-kivo-agent', n) }
    return Number(n)
  }

  // ── The open modal, if any: what to deal with first ────────────────────────
  const dialogs = [...document.querySelectorAll('dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]')].filter(visible)
  const dialog = dialogs[dialogs.length - 1] || null

  // ── Accessible names ───────────────────────────────────────────────────────
  const byIds = ids => clean((ids || '').split(' ').map(id => document.getElementById(id)?.innerText || '').join(' '))
  const textOf = node => clean(node.innerText || node.textContent || '')
  function nameOf(el) {
    const aria = el.getAttribute('aria-labelledby')
    if (aria) { const t = byIds(aria); if (t) return t }
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'))
    if (el.id) { const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (label) { const t = textOf(label); if (t) return t } }
    const wrap = el.closest('label')
    if (wrap) { const t = textOf(wrap); if (t) return t }
    if (el.matches('input, textarea, select')) {
      const t = clean(el.getAttribute('placeholder') || el.getAttribute('title') || '')
      if (t) return t
      // A label drawn just before the field (a div, not a <label>).
      const prev = el.previousElementSibling
      if (prev && !prev.matches('input, select, textarea, button') && textOf(prev).length < 120) { const p = textOf(prev); if (p) return p }
      return clean(el.name || '')
    }
    const own = textOf(el)
    if (own) return own
    const img = el.querySelector('img[alt]')
    if (img) return clean(img.getAttribute('alt'))
    return clean(el.getAttribute('title') || (el.matches('input[type=submit], input[type=button], input[type=reset]') ? el.getAttribute('value') : '') || '')
  }

  const ROLE_OF = el => {
    const role = el.getAttribute('role')
    if (role) return role
    const tag = el.tagName
    const type = (el.getAttribute('type') || '').toLowerCase()
    if (tag === 'A') return 'link'
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button'
    if (tag === 'SELECT') return el.multiple ? 'listbox' : 'menu'
    if (tag === 'TEXTAREA') return 'textbox'
    if (el.isContentEditable) return 'textbox'
    if (el.matches('[onclick]') && !['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return 'clickable'
    if (tag === 'INPUT') {
      if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button'
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (type === 'range') return 'slider'
      if (type === 'search') return 'searchbox'
      if (type === 'file') return 'file'
      return 'textbox'
    }
    return 'element'
  }
  const sensitive = el => {
    const type = (el.getAttribute('type') || '').toLowerCase()
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase()
    const hint = `${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase()
    if (type === 'password') return 'password'
    if (ac.startsWith('cc-') || ['cardnumber', 'card-number', 'cvv', 'cvc', 'iban'].some(w => hint.includes(w))) return 'payment'
    if (ac === 'one-time-code') return 'code'
    return null
  }

  // The question a choice belongs to: a fieldset's legend, a group's name,
  // else the text of the nearest container holding its sibling choices.
  function groupOf(el) {
    const fs = el.closest('fieldset')
    if (fs) { const lg = fs.querySelector('legend'); if (lg) return textOf(lg).slice(0, 240) }
    const g = el.closest('[role=radiogroup], [role=group]')
    if (g) { const n = g.getAttribute('aria-labelledby') ? byIds(g.getAttribute('aria-labelledby')) : clean(g.getAttribute('aria-label') || ''); if (n) return n.slice(0, 240) }
    const same = el.name ? `input[name="${CSS.escape(el.name)}"]` : null
    let node = el.parentElement
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      const siblings = same ? node.querySelectorAll(same).length : node.querySelectorAll('input[type=radio], input[type=checkbox], [role=radio], [role=checkbox]').length
      if (siblings > 1) {
        // The container's own words that are not its choices' labels.
        const labels = [...node.querySelectorAll('label')].map(textOf)
        let t = textOf(node)
        for (const l of labels) if (l) t = t.split(l).join(' ')
        t = clean(t)
        if (t) return t.slice(0, 240)
        const before = node.previousElementSibling
        return before ? textOf(before).slice(0, 240) : ''
      }
    }
    return ''
  }

  // ── Where the writing is (for reading) ──────────────────────────────────────
  // The element holding the most paragraph text (its parent counts half), not
  // whatever is tagged main (which often holds the site's tools too). An
  // <article> wins outright; an open dialog is read first.
  const score = new Map()
  for (const p of document.querySelectorAll('p, blockquote')) {
    const n = (p.innerText || '').trim().length
    if (n < 60 || !p.parentElement) continue
    score.set(p.parentElement, (score.get(p.parentElement) ?? 0) + n)
    const gp = p.parentElement.parentElement
    if (gp) score.set(gp, (score.get(gp) ?? 0) + n / 2)
  }
  let dense = null, best = 0
  for (const [node, n] of score) if (n > best && node !== document.body) { best = n; dense = node }
  const prose = el => { let n = 0; for (const p of el.querySelectorAll('p, blockquote')) { const t = (p.innerText || '').trim().length; if (t >= 60) n += t } return n }
  if (dense) for (let up = dense.parentElement; up && up !== document.body && up !== doc; up = up.parentElement) {
    if (prose(up) > prose(dense) * 1.3) dense = up
    else break
  }
  // A page that is mostly a form (a quiz, a sign-up) is read whole: its
  // questions are not paragraphs.
  const formish = document.querySelectorAll('input:not([type=hidden]), select, textarea, [role=radio], [role=checkbox]').length >= 3
  const root = document.querySelector('article') || (best > 400 && !formish ? dense : null) || document.querySelector('main, [role=main]') || document.body
  const blocks = []
  const BLOCK = new Set(['P', 'LI', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'DD', 'DT', 'FIGCAPTION', 'CAPTION', 'LEGEND', 'LABEL'])
  let length = 0
  const walk = el => {
    if (length > max) return
    for (const child of el.children) {
      if (SKIP.has(child.tagName) && child !== root) continue
      if (!visible(child)) continue
      if (BLOCK.has(child.tagName)) {
        const text = child.tagName === 'PRE' ? (child.innerText || '').trim() : clean(child.innerText)
        if (text.length >= 2) { const line = /^H[1-6]$/.test(child.tagName) ? `\n## ${text}` : child.tagName === 'LI' ? `- ${text}` : text; blocks.push(line); length += line.length + 1 }
        continue
      }
      // Text written straight into a div (many apps): kept when it is the div's own.
      const own = [...child.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ')
      if (clean(own).length >= 20 && !child.querySelector('p, li, h1, h2, h3, h4')) { const t = clean(child.innerText); blocks.push(t); length += t.length + 1; continue }
      walk(child)
    }
  }
  if (dialog) { blocks.push(`[Dialog] ${clean(dialog.innerText).slice(0, 2000)}`); length += 2000 }
  walk(root)
  // The rest of the page, after the main writing: sections outside the
  // article (a sidebar's "References", a second column, a section a site
  // put outside <main>) are read too, so "the page has no X" is never said
  // of a part that was simply not read. Site navigation and footers stay out.
  if (root !== document.body && length < max) {
    const before = blocks.length
    const rest = el => {
      if (length > max) return
      for (const child of el.children) {
        if (child === root || child.contains(root)) { if (child !== root) rest(child); continue }
        if ((SKIP.has(child.tagName) && child.tagName !== 'ASIDE') || !visible(child) || child.id === '__kivo_overlay') continue
        if (BLOCK.has(child.tagName)) {
          const text = clean(child.innerText)
          if (text.length >= 2) { const line = /^H[1-6]$/.test(child.tagName) ? `\n## ${text}` : child.tagName === 'LI' ? `- ${text}` : text; blocks.push(line); length += line.length + 1 }
          continue
        }
        const own = [...child.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ')
        if (clean(own).length >= 20 && !child.querySelector('p, li, h1, h2, h3, h4')) { const t = clean(child.innerText); blocks.push(t); length += t.length + 1; continue }
        rest(child)
      }
    }
    rest(document.body)
    if (blocks.length > before) blocks.splice(before, 0, '\n## (Elsewhere on this page)')
  }
  let text = blocks.join('\n').trim()
  if (text.length < 200) text = clean(root.innerText).slice(0, max)

  const headings = [...root.querySelectorAll('h1, h2, h3')].filter(visible).map(h => clean(h.innerText)).filter(Boolean).slice(0, 30)
  // Every heading on the page, in order, wherever it is: the page's outline.
  const outline = [...document.querySelectorAll('h1, h2, h3, h4')].filter(h => visible(h) && !h.closest('nav, footer')).map(h => `${'#'.repeat(Number(h.tagName[1]))} ${clean(h.innerText).slice(0, 120)}`).filter(h => h.length > 3).slice(0, 60)

  // ── Interactive elements ────────────────────────────────────────────────────
  const elements = []
  const links = []
  const seenHref = new Set()
  const CONTROLS = 'button, input, select, textarea, summary, [role=button], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=option], [role=combobox], [role=textbox], [role=searchbox], [role=slider], [role=link]:not(a), [contenteditable=""], [contenteditable=true], [role=row], [role=treeitem], [role=gridcell][tabindex], [role=listitem][tabindex], [onclick]:not(body):not(html)'
  const scope = dialog || document
  const candidates = [...scope.querySelectorAll(CONTROLS)]
  // Inside the dialog first; then form controls before buttons.
  const rank = el => (el.matches('input, select, textarea, [role=checkbox], [role=radio], [role=switch], [role=combobox], [role=textbox], [contenteditable]') ? 0 : el.matches('[role=row], [role=treeitem], [role=gridcell], [role=listitem], [onclick]') ? 2 : 1)
  candidates.sort((a, b) => rank(a) - rank(b) || (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  for (const el of candidates) {
    if (elements.length >= maxElements) break
    const type = (el.getAttribute('type') || '').toLowerCase()
    if (el.tagName === 'INPUT' && type === 'hidden') continue
    if (!visible(el)) continue
    const role = ROLE_OF(el)
    // A row of an app's list (an email, an issue) contains a link or button
    // of its own sometimes; then that one is listed and the row is not.
    if (rank(el) === 2 && el.querySelector('a[href], button')) continue
    const name = nameOf(el).slice(0, 140)
    const item = { i: mark(el), role, name }
    const states = []
    const secret = sensitive(el)
    if (secret) states.push(`${secret} field: only the learner fills it`)
    if (role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'menuitemcheckbox' || role === 'menuitemradio') {
      const on = el.tagName === 'INPUT' ? el.checked : el.getAttribute('aria-checked') === 'true'
      states.push(on ? 'checked' : 'not checked')
      const group = groupOf(el)
      if (group) item.group = group
    }
    if (el.tagName === 'SELECT') {
      const chosen = [...el.selectedOptions].map(o => clean(o.text)).filter(Boolean)
      states.push(chosen.length ? `selected: ${chosen.join(', ')}` : 'nothing selected')
      item.options = [...el.options].map(o => clean(o.text)).filter(Boolean).slice(0, 20)
    }
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox' && el.matches('input')) {
      if (el.getAttribute('type')) states.push(`type ${type}`)
      const filled = el.isContentEditable ? clean(el.innerText).length > 0 : Boolean(el.value)
      states.push(filled ? 'filled' : 'empty')
      // Only what the agent itself typed is read back.
      if (!secret && el.getAttribute('data-kivo-filled') === '1') item.value = (el.isContentEditable ? clean(el.innerText) : String(el.value)).slice(0, 200)
    }
    if (el.getAttribute('aria-expanded')) states.push(el.getAttribute('aria-expanded') === 'true' ? 'expanded' : 'collapsed')
    if (el.getAttribute('aria-selected') === 'true') states.push('selected')
    if (el.getAttribute('aria-pressed') === 'true') states.push('pressed')
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') states.push('disabled')
    if (el.required || el.getAttribute('aria-required') === 'true') states.push('required')
    const invalid = el.getAttribute('aria-invalid') === 'true' || (el.getAttribute('data-kivo-touched') === '1' && el.validity && !el.validity.valid)
    if (invalid) states.push(`invalid${el.validationMessage ? `: ${clean(el.validationMessage).slice(0, 80)}` : ''}`)
    if (role === 'button' && el.closest('form') && (el.matches('[type=submit], input[type=image]') || el.tagName === 'BUTTON' && !el.getAttribute('type'))) states.push('submits the form')
    if (states.length) item.state = states.join(', ')
    if (!name && !item.group && role !== 'textbox') continue
    elements.push(item)
  }
  const vh = window.innerHeight
  for (const a of (dialog || document).querySelectorAll('a[href]')) {
    if (links.length >= 400) break
    if (!visible(a)) continue
    let href
    try { href = new URL(a.getAttribute('href'), location.href) } catch { continue }
    if (href.protocol !== 'https:' && href.protocol !== 'http:') continue
    const label = clean(a.innerText || a.getAttribute('aria-label') || a.title).slice(0, 120)
    if (!label) continue
    const key = href.href.split('#')[0] + '|' + label
    if (seenHref.has(key)) continue
    seenHref.add(key)
    const r = a.getBoundingClientRect()
    links.push({ i: mark(a), text: label, href: href.href.slice(0, 500), inMain: root.contains(a), inView: r.bottom > 0 && r.top < vh })
  }
  // In view first, then the main writing's, then the rest; more than the
  // model is sent are found with find (findOnPage), never silently missing.
  const linkRank = l => (l.inView ? 0 : 2) + (l.inMain ? 0 : 1)
  links.sort((x, y) => linkRank(x) - linkRank(y))
  const linksTotal = links.length
  doc.setAttribute('data-kivo-next', String(next))

  // ── What the page says about itself ─────────────────────────────────────────
  const alerts = [...document.querySelectorAll('[role=alert], [aria-live=assertive], .error, .errors, .invalid-feedback, .field-error, [data-error]')]
    .filter(visible).map(a => clean(a.innerText)).filter(t => t && t.length < 300).slice(0, 6)
  const body = (document.body?.innerText || '').slice(0, 4000).toLowerCase()
  const challenge = Boolean(document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare"], .g-recaptcha, .h-captcha, .cf-turnstile, #challenge-form')) ||
    ['verify you are a human', 'are you a robot', 'unusual traffic', 'complete the security check', 'confirm this search was made by a human'].some(w => body.includes(w))
  const signIn = [...document.querySelectorAll('input[type=password]')].some(visible)
  const more = window.innerHeight + window.scrollY < doc.scrollHeight - 200

  // Kivo's Knowledge Map: its own description of what is in view (synchronous: the map answers at once).
  let map = null
  const bridge = document.querySelector('[data-kivo-map-bridge]')
  if (bridge) {
    try {
      const rid = `o${Date.now().toString(36)}`
      bridge.dispatchEvent(new CustomEvent('kivo-map:request', { detail: JSON.stringify({ op: 'describe', rid }) }))
      const r = JSON.parse(bridge.dataset.response || 'null')
      if (r && r.rid === rid) map = { summary: String(r.result || '').slice(0, 300), nodes: (r.nodes || []).slice(0, 40), edges: (r.edges || []).slice(0, 60) }
    } catch { map = null }
  }
  document.getElementById('__kivo_overlay')?.style.removeProperty('display')
  const fingerprint = `${location.href}|${text.length}|${headings.length}|${elements.map(e => e.state || '').join(';').length}|${dialog ? 'd' : ''}`
  return {
    url: location.href, title: clean(document.title).slice(0, 300), headings, text: text.slice(0, max),
    links: links.slice(0, 40).map(({ inMain, inView, ...l }) => l), linksTotal, elementsTotal: candidates.length, outline, elements,
    dialog: dialog ? (nameOf(dialog) || clean(dialog.innerText).slice(0, 120)).slice(0, 160) : null,
    alerts, signIn, challenge, more, fingerprint, isPdf: document.contentType === 'application/pdf', map,
  }
}

/**
 * A search results page (DuckDuckGo's HTML page, or Bing's): title, address
 * and snippet of each result, and whether the site is asking for a human
 * check instead (which the agent never tries to pass: the learner does).
 */
export function readSearchResults() {
  const clean = t => (t || '').replace(/\s+/g, ' ').trim()
  const body = (document.body?.innerText || '').slice(0, 3000).toLowerCase()
  const challenge = Boolean(document.querySelector('.anomaly-modal, #anomaly-modal, iframe[src*="captcha"], #b_captcha, .captcha')) ||
    ['confirm this search was made by a human', 'verify you are a human', 'unusual traffic', 'are you a robot', 'complete the following challenge'].some(w => body.includes(w))
  const out = []
  let i = 0
  const doc = document.documentElement
  let next = Number(doc.getAttribute('data-kivo-next') || '0')
  const mark = a => { let n = a.getAttribute('data-kivo-agent'); if (n === null) { n = String(next++); a.setAttribute('data-kivo-agent', n) } return Number(n) }
  if (location.hostname.endsWith('bing.com')) {
    for (const li of document.querySelectorAll('li.b_algo')) {
      const a = li.querySelector('h2 a')
      if (!a) continue
      let href = a.getAttribute('href') || ''
      try {
        const u = new URL(href, location.href)
        // Bing's own redirect: the address is in "u", as "a1" + base64url.
        const code = u.hostname.endsWith('bing.com') ? u.searchParams.get('u') : null
        if (code && code.startsWith('a1')) { const b = code.slice(2).replace(/-/g, '+').replace(/_/g, '/'); href = decodeURIComponent(escape(atob(b + '='.repeat((4 - (b.length % 4)) % 4)))) }
        else href = u.href
      } catch { continue }
      if (!href.startsWith('http') || new URL(href).hostname.endsWith('bing.com')) continue
      const title = clean(a.innerText) || clean(li.querySelector('cite')?.innerText)
      out.push({ i: mark(a), title: title.slice(0, 160), href: href.slice(0, 500), snippet: clean(li.querySelector('.b_caption p, .b_lineclamp2, .b_lineclamp3, .b_lineclamp4, p')?.innerText).slice(0, 300) })
      i++
      if (out.length >= 10) break
    }
  } else {
    for (const r of document.querySelectorAll('.result, .web-result')) {
      const a = r.querySelector('a.result__a, h2 a')
      if (!a) continue
      let href = a.getAttribute('href') || ''
      try {
        const u = new URL(href, location.href)
        const real = u.searchParams.get('uddg')
        href = real ? decodeURIComponent(real) : u.href
      } catch { continue }
      if (!href.startsWith('http')) continue
      if (href.includes('duckduckgo.com/y.js') || r.classList.contains('result--ad')) continue   // ads
      out.push({ i: mark(a), title: clean(a.innerText).slice(0, 160), href: href.slice(0, 500), snippet: clean(r.querySelector('.result__snippet')?.innerText).slice(0, 300) })
      i++
      if (out.length >= 10) break
    }
  }
  doc.setAttribute('data-kivo-next', String(next))
  return { url: location.href, title: document.title, results: out, challenge: challenge && !out.length }
}

/**
 * Finds, anywhere on the page (not only the part the model was shown), the
 * elements whose accessible name or text holds the words asked for, and the
 * passages of text that hold them. Each element found is numbered like any
 * other (data-kivo-agent), so the agent can act on it at once. An element
 * that exists but is hidden or disabled is reported as such: "there is a
 * Cancel button, hidden" is not the same as "there is none".
 */
export function findOnPage(query, max) {
  const limit = max || 12
  const clean = t => (t || '').replace(/\s+/g, ' ').trim()
  const words = clean(query).toLowerCase().split(' ').filter(w => w.length > 1)
  if (!words.length) return { elements: [], passages: [], total: 0 }
  const has = t => { const l = (t || '').toLowerCase(); return words.every(w => l.includes(w)) }
  const doc = document.documentElement
  let next = Number(doc.getAttribute('data-kivo-next') || '0')
  const mark = node => { let n = node.getAttribute('data-kivo-agent'); if (n === null) { n = String(next++); node.setAttribute('data-kivo-agent', n) } return Number(n) }
  const shown = node => {
    if (node.hidden || node.closest('[hidden], [inert], [aria-hidden=true]')) return false
    const st = getComputedStyle(node)
    if (st.display === 'none' || st.visibility === 'hidden') return false
    const r = node.getBoundingClientRect()
    return r.width > 0 || r.height > 0 || node.matches('input[type=checkbox], input[type=radio]')
  }
  const nameOf = el => {
    const label = el.getAttribute('aria-label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText) || el.closest('label')?.innerText || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('value') || el.getAttribute('alt') || ''
    return clean(label).slice(0, 140)
  }
  const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=menuitem], [role=option], [role=row], [role=treeitem], [onclick]:not(body):not(html)'
  const elements = []
  let total = 0
  const vh = window.innerHeight
  for (const el of document.querySelectorAll(SEL)) {
    if (el.closest('#__kivo_overlay')) continue
    const name = nameOf(el)
    if (!has(name) && !has(el.getAttribute('href') || '')) continue
    total++
    if (elements.length >= limit) continue
    const visibleNow = shown(el)
    const r = el.getBoundingClientRect()
    const role = el.getAttribute('role') || (el.tagName === 'A' ? 'link' : el.tagName === 'SELECT' ? 'menu' : el.tagName === 'INPUT' ? (el.getAttribute('type') || 'textbox') : el.tagName.toLowerCase())
    let href = null
    if (el.tagName === 'A') { try { href = new URL(el.getAttribute('href'), location.href).href.slice(0, 500) } catch { href = null } }
    const states = []
    if (!visibleNow) states.push('hidden')
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') states.push('disabled')
    if (visibleNow && !(r.bottom > 0 && r.top < vh)) states.push('off screen (scrolled to when used)')
    elements.push({ i: mark(el), role, name, ...(href ? { href } : {}), ...(states.length ? { state: states.join(', ') } : {}) })
  }
  const passages = []
  for (const block of document.querySelectorAll('p, li, td, dd, pre, blockquote, h1, h2, h3, h4, h5, h6, figcaption, label')) {
    if (passages.length >= 6) break
    if (block.closest('#__kivo_overlay, nav, footer')) continue
    const text = clean(block.innerText)
    if (!text || !has(text)) continue
    if ([...block.children].some(c => has(c.innerText))) continue  // the innermost block that holds it
    let heading = ''
    for (let at = block; at && !heading; at = at.previousElementSibling || at.parentElement) { if (/^H[1-6]$/.test(at.tagName) && at !== block) heading = clean(at.innerText).slice(0, 100); if (at === document.body) break }
    passages.push({ text: text.slice(0, 300), heading, visible: shown(block) })
  }
  doc.setAttribute('data-kivo-next', String(next))
  return { elements, passages, total }
}

/**
 * Kivo's own Knowledge Map, asked through its bridge ([data-kivo-map-bridge],
 * apps/web map-agent.ts): a request by node id, answered by the map's own
 * actions. Text in, text out. The node's own element is numbered so the
 * watch-mode pointer goes to where it really is now. absent: not the map.
 */
export async function mapRequest(req) {
  const bridge = document.querySelector('[data-kivo-map-bridge]')
  if (!bridge) return { absent: true }
  const rid = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  bridge.dispatchEvent(new CustomEvent('kivo-map:request', { detail: JSON.stringify({ ...req, rid }) }))
  let answer = null
  for (let i = 0; i < 80; i++) {
    try { const r = JSON.parse(bridge.dataset.response || 'null'); if (r && r.rid === rid) { answer = r; if (r.final) break } } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 100))
  }
  if (!answer) return { ok: false, result: 'The map did not answer.' }
  return answer
}

/** A map node's element as drawn now, numbered for the pointer; null when it is not drawn. */
export function mapLocate(id) {
  const el = document.querySelector(`[data-node-id="${CSS.escape(String(id))}"]`)
  if (!el) return { index: null }
  const doc = document.documentElement
  let next = Number(doc.getAttribute('data-kivo-next') || '0')
  let n = el.getAttribute('data-kivo-agent')
  if (n === null) { n = String(next++); el.setAttribute('data-kivo-agent', n); doc.setAttribute('data-kivo-next', String(next)) }
  const r = el.getBoundingClientRect()
  return { index: Number(n), visible: r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth }
}

/** What an element is, before the agent acts on it (for the approval rules). */
export function inspectTarget(index) {
  const el = document.querySelector(`[data-kivo-agent="${index}"]`)
  if (!el) return { exists: false }
  const clean = t => (t || '').replace(/\s+/g, ' ').trim()
  const form = el.closest('form')
  const type = (el.getAttribute('type') || '').toLowerCase()
  const ac = (el.getAttribute('autocomplete') || '').toLowerCase()
  const hint = `${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase()
  const label = clean(el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || (el.matches('button, input[type=submit], input[type=button]') ? el.getAttribute('value') : '') || el.name || el.getAttribute('title') || '').slice(0, 120)
  const searchy = s => /search|query|^q$|find/i.test(s || '')
  const isField = el.matches('input, textarea, [role=textbox], [role=searchbox], [contenteditable=""], [contenteditable=true]') && !['checkbox', 'radio', 'submit', 'button', 'reset', 'image', 'file', 'range'].includes(type)
  const isSearchBox = isField && (type === 'search' || el.getAttribute('role') === 'searchbox' || searchy(el.name) || searchy(el.id) || searchy(el.getAttribute('aria-label')) || searchy(el.getAttribute('placeholder')) || (form && (form.getAttribute('role') === 'search' || searchy(form.getAttribute('action')))))
  const formRisk = form ? {
    hasPassword: Boolean(form.querySelector('input[type=password]')),
    hasPayment: Boolean(form.querySelector('[autocomplete^=cc-], input[name*=card i], input[name*=cvv i], input[name*=cvc i]')),
    method: (form.getAttribute('method') || 'get').toLowerCase(),
    isSearch: form.getAttribute('role') === 'search' || Boolean(form.querySelector('input[type=search]')) || searchy(form.getAttribute('action')),
    fields: form.querySelectorAll('input:not([type=hidden]), select, textarea').length,
  } : null
  let href = null
  const link = el.closest('a[href]')
  if (link) { try { href = new URL(link.getAttribute('href'), location.href).href } catch { href = null } }
  const secret = type === 'password' ? 'password' : ac.startsWith('cc-') || ['cardnumber', 'card-number', 'cvv', 'cvc', 'iban'].some(w => hint.includes(w)) ? 'payment' : ac === 'one-time-code' ? 'code' : null
  return {
    exists: true, tag: el.tagName.toLowerCase(), type, role: el.getAttribute('role') || '', label, href,
    opensNewTab: Boolean(link && link.getAttribute('target') === '_blank'),
    isField, isSearchBox: Boolean(isSearchBox), secret,
    isSubmit: Boolean(form) && (el.matches('button[type=submit], input[type=submit], input[type=image]') || (el.tagName === 'BUTTON' && !el.getAttribute('type'))),
    form: formRisk, download: Boolean(link && link.hasAttribute('download')),
  }
}

/**
 * Does one thing to one element and says what is true after it:
 *   click, fill {text, submit}, select {option}, check {checked}, press {key}.
 * The events are the ones a page listens for (pointer and mouse, input and
 * change, key events), so frameworks see the change. Never a password or
 * payment field; never reads what was there before.
 */
export function actOn(index, op, args) {
  const clean = t => (t || '').replace(/\s+/g, ' ').trim()
  const el = index === null || index === undefined ? (document.activeElement || document.body) : document.querySelector(`[data-kivo-agent="${index}"]`)
  if (!el) return { ok: false, stale: true, reason: 'That element is not on the page any more.' }
  const type = (el.getAttribute('type') || '').toLowerCase()
  const ac = (el.getAttribute('autocomplete') || '').toLowerCase()
  if (op !== 'click' && op !== 'press' && (type === 'password' || ac.startsWith('cc-') || ac === 'one-time-code')) return { ok: false, never: true, reason: 'Nova never types into password, payment or code fields.' }
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return { ok: false, kind: 'disabled', reason: 'That element is on the page but disabled: something else must happen first (a required field, an earlier step).' }
  // Present but hidden (a collapsed menu, a closed tab panel): not the same as absent.
  const hiddenNow = () => { if (el.closest('[hidden], [inert]')) return true; const st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden') return true; const r = el.getBoundingClientRect(); return r.width === 0 && r.height === 0 && !el.matches('input[type=checkbox], input[type=radio]') }
  if (op !== 'press' && hiddenNow()) {
    const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : el.closest('label')
    if (!(label && !label.hidden && label.getClientRects().length)) return { ok: false, kind: 'hidden', reason: 'That element is on the page but hidden: open the menu, tab or section that holds it first.' }
  }
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }) } catch { /* not scrollable */ }
  // Something drawn over it (a cookie banner, an overlay): named, so it can be dealt with.
  let covered = null
  try {
    const r = el.getBoundingClientRect()
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    if (top && top !== el && !el.contains(top) && !top.contains(el) && !top.closest('#__kivo_overlay') && !(top.closest('label') && top.closest('label').contains(el))) covered = clean(top.getAttribute('aria-label') || top.innerText || top.tagName).slice(0, 80)
  } catch { /* no layout */ }
  const pointer = target => {
    const r = target.getBoundingClientRect()
    const at = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 }
    for (const t of ['pointerover', 'pointerenter', 'mouseover', 'pointerdown', 'mousedown']) target.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { ...at, pointerId: 1, isPrimary: true }))
    if (typeof target.focus === 'function') target.focus({ preventScroll: true })
    for (const t of ['pointerup', 'mouseup']) target.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { ...at, pointerId: 1, isPrimary: true }))
    target.click()
  }
  const isOn = node => node.tagName === 'INPUT' ? node.checked : node.getAttribute('aria-checked') === 'true'

  if (op === 'click') {
    pointer(el)
    return { ok: true, covered }
  }
  if (op === 'fill') {
    const text = String(args?.text ?? '')
    if (el.isContentEditable) {
      el.focus()
      document.execCommand('selectAll', false)
      if (!document.execCommand('insertText', false, text)) el.textContent = text
      el.setAttribute('data-kivo-filled', '1')
      const now = clean(el.innerText)
      return { ok: now.includes(clean(text).slice(0, 60)), value: now.slice(0, 200), reason: now.includes(clean(text).slice(0, 60)) ? '' : 'The text did not appear in the field.' }
    }
    if (!el.matches('input, textarea')) return { ok: false, reason: 'That is not a text field.' }
    if (['checkbox', 'radio', 'submit', 'button', 'file', 'image', 'range', 'reset'].includes(type)) return { ok: false, reason: 'That is not a text field: use check, select or click.' }
    el.focus()
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
    if (setter) setter.call(el, text); else el.value = text
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.setAttribute('data-kivo-filled', '1')
    el.setAttribute('data-kivo-touched', '1')
    el.dispatchEvent(new FocusEvent('blur', { bubbles: false }))
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    const value = String(el.value)
    const valid = el.validity ? el.validity.valid : true
    if (args?.submit) {
      const down = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true })
      const handled = !el.dispatchEvent(down)
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
      const form = el.closest('form')
      if (!handled && form && el.tagName === 'INPUT' && typeof form.requestSubmit === 'function') form.requestSubmit()
    }
    // A field may format what is typed (a phone number, a date): close is fine.
    const same = value === text || clean(value).toLowerCase() === clean(text).toLowerCase() || (text.length > 3 && value.replace(/\D/g, '') === text.replace(/\D/g, '') && /\d/.test(text))
    return { ok: same, value: value.slice(0, 200), valid, message: valid ? '' : clean(el.validationMessage).slice(0, 120), reason: same ? '' : `The field now shows "${value.slice(0, 80)}".` }
  }
  if (op === 'select') {
    const want = clean(args?.option).toLowerCase()
    if (el.tagName !== 'SELECT') return { ok: false, reason: 'That is not a menu (a <select>): click it, then click the option.' }
    const opts = [...el.options]
    const found = opts.find(o => clean(o.text).toLowerCase() === want) || opts.find(o => clean(o.value).toLowerCase() === want) || opts.find(o => clean(o.text).toLowerCase().includes(want))
    if (!found) return { ok: false, reason: `No option "${args?.option}". Options: ${opts.map(o => clean(o.text)).filter(Boolean).slice(0, 15).join(', ')}` }
    el.focus()
    if (el.multiple) found.selected = true
    else el.value = found.value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.setAttribute('data-kivo-touched', '1')
    const chosen = [...el.selectedOptions].map(o => clean(o.text))
    return { ok: chosen.includes(clean(found.text)), value: chosen.join(', ') }
  }
  if (op === 'check') {
    const want = args?.checked !== false
    const input = el.tagName === 'INPUT' ? el : el.querySelector('input[type=checkbox], input[type=radio]') || el
    const role = input.getAttribute('role') || (input.tagName === 'INPUT' ? (input.getAttribute('type') || '').toLowerCase() : '')
    if (!['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio', 'option'].includes(role) && !(input.tagName === 'INPUT' && ['checkbox', 'radio'].includes(input.type))) return { ok: false, reason: 'That is not a checkbox, radio button or switch.' }
    if (isOn(input) !== want) {
      // A real input under a styled label is clicked through its label when it is not visible itself.
      const r = input.getBoundingClientRect()
      const label = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : input.closest('label')
      pointer(r.width < 2 && label ? label : input)
    }
    if (input.tagName === 'INPUT' && isOn(input) !== want && !(input.type === 'radio' && !want)) {
      // Some pages stop the click: set it the way the browser would and say so.
      input.checked = want
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    input.setAttribute('data-kivo-touched', '1')
    const now = isOn(input)
    return { ok: now === want, checked: now, reason: now === want ? '' : (input.type === 'radio' && !want ? 'A radio button is turned off by choosing another one.' : 'It did not change.') }
  }
  if (op === 'press') {
    const key = String(args?.key || '')
    const KEYMAP = { Enter: ['Enter', 13], Escape: ['Escape', 27], Tab: ['Tab', 9], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], PageDown: ['PageDown', 34], PageUp: ['PageUp', 33], Home: ['Home', 36], End: ['End', 35], Space: [' ', 32], Backspace: ['Backspace', 8] }
    const k = KEYMAP[key]
    if (!k) return { ok: false, reason: 'Nova does not press that key.' }
    if (index !== null && index !== undefined && typeof el.focus === 'function') el.focus({ preventScroll: true })
    const target = document.activeElement || document.body
    const opts = { key: k[0], code: key === 'Space' ? 'Space' : key, keyCode: k[1], which: k[1], bubbles: true, cancelable: true, composed: true }
    const allowed = target.dispatchEvent(new KeyboardEvent('keydown', opts))
    if (k[0].length === 1) target.dispatchEvent(new KeyboardEvent('keypress', opts))
    target.dispatchEvent(new KeyboardEvent('keyup', opts))
    // What the browser would do by itself, which synthetic keys do not.
    if (allowed) {
      if (key === 'Enter' && target.matches('input') && target.form && typeof target.form.requestSubmit === 'function') target.form.requestSubmit()
      else if (key === 'Enter' && target.matches('a[href], button, [role=button], summary')) target.click()
      else if (key === 'Space' && target.matches('button, [role=button], input[type=checkbox], input[type=radio], [role=checkbox], summary')) target.click()
      else if (key === 'Tab') {
        const focusable = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter(n => !n.disabled && n.getClientRects().length)
        const at = focusable.indexOf(target)
        focusable[(at + 1) % focusable.length]?.focus()
      } else if (['PageDown', 'PageUp', 'Home', 'End'].includes(key) && !target.matches('input, textarea, select')) {
        const h = window.innerHeight * 0.9
        window.scrollBy({ top: key === 'PageDown' ? h : key === 'PageUp' ? -h : key === 'Home' ? -1e7 : 1e7, behavior: 'instant' })
      }
    }
    return { ok: true, focused: clean(document.activeElement?.getAttribute('aria-label') || document.activeElement?.innerText || document.activeElement?.tagName || '').slice(0, 80) }
  }
  return { ok: false, reason: `Nova cannot ${op}.` }
}

/** Waits until the page stops changing (or the text appears), at most `ms`. */
export function settleDom(ms, text) {
  const want = (text || '').toLowerCase()
  return new Promise(resolve => {
    const start = Date.now()
    let last = Date.now()
    const done = found => { observer.disconnect(); clearInterval(timer); resolve({ ok: true, found, waited: Date.now() - start }) }
    const observer = new MutationObserver(() => { last = Date.now() })
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
    const timer = setInterval(() => {
      const has = want ? (document.body?.innerText || '').toLowerCase().includes(want) : false
      if (want && has) return done(true)
      if (!want && Date.now() - last > 400) return done(false)
      if (Date.now() - start > ms) return done(has)
    }, 100)
  })
}

export function scrollPage(direction) {
  const before = window.scrollY
  window.scrollBy({ top: (direction === 'up' ? -1 : 1) * Math.round(window.innerHeight * 0.9), behavior: 'instant' })
  return { ok: true, moved: window.scrollY !== before, atEnd: window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 }
}

/**
 * What the learner sees while Nova works on a tab (watch mode): a small bar
 * at the bottom saying what Nova is doing, and, before an action, a pointer that
 * moves to the element with a ring round it and a label. Drawn in a closed
 * shadow root on one host element (aria-hidden, no pointer events), which
 * observePage skips: Nova never reads its own overlay.
 */
export function showAction(index, label) {
  const HOST = '__kivo_overlay'
  let host = document.getElementById(HOST)
  if (!host) {
    host = document.createElement('div')
    host.id = HOST
    host.setAttribute('aria-hidden', 'true')
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
    const root = host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = `
      .bar{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;max-width:min(560px,calc(100vw - 32px));padding:7px 14px;border:1px solid rgba(52,209,168,.45);border-radius:999px;background:rgba(13,14,19,.92);color:#eef0f4;font:500 12.5px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .dot{width:8px;height:8px;border-radius:50%;background:#34d1a8;animation:p 1.2s ease-in-out infinite}
      .ring{position:fixed;border:2px solid #34d1a8;border-radius:8px;box-shadow:0 0 0 4px rgba(52,209,168,.25);transition:all .35s cubic-bezier(.22,1,.36,1);opacity:0}
      .tag{position:fixed;padding:3px 8px;border-radius:6px;background:#34d1a8;color:#052019;font:600 12px/1.3 system-ui,sans-serif;white-space:nowrap;transition:all .35s cubic-bezier(.22,1,.36,1);opacity:0}
      .cursor{position:fixed;left:50%;top:50%;width:18px;height:18px;opacity:0;transition:all .45s cubic-bezier(.22,1,.36,1)}
      @keyframes p{50%{opacity:.35}}
      @media (prefers-reduced-motion: reduce){.ring,.tag,.cursor{transition:none}.dot{animation:none}}`
    const node = (tag, cls) => { const n = document.createElement(tag); n.className = cls; return n }
    const bar = node('div', 'bar')
    bar.append(node('span', 'dot'), node('span', 'what'))
    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('class', 'cursor'); svg.setAttribute('viewBox', '0 0 24 24')
    const path = document.createElementNS(NS, 'path')
    path.setAttribute('d', 'M4 2l16 9-7 2-3 7z'); path.setAttribute('fill', '#34d1a8'); path.setAttribute('stroke', '#052019'); path.setAttribute('stroke-width', '1.5')
    svg.append(path)
    root.append(style, bar, node('div', 'ring'), node('div', 'tag'), svg)
    host.__root = root
    document.documentElement.append(host)
  }
  const root = host.__root
  if (!root) return { ok: false }
  root.querySelector('.what').textContent = `Nova: ${label}`
  const ring = root.querySelector('.ring'), tag = root.querySelector('.tag'), cursor = root.querySelector('.cursor')
  const el = index === null || index === undefined ? null : document.querySelector(`[data-kivo-agent="${index}"]`)
  if (!el) { ring.style.opacity = '0'; tag.style.opacity = '0'; cursor.style.opacity = '0'; return { ok: true } }
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }) } catch { /* not scrollable */ }
  const r = el.getBoundingClientRect()
  ring.style.cssText = `left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;opacity:1`
  tag.textContent = label
  tag.style.cssText = `left:${Math.max(4, r.left)}px;top:${r.top > 60 ? r.top - 30 : r.bottom + 8}px;opacity:1`
  cursor.style.left = `${r.left + Math.min(r.width / 2, 40)}px`
  cursor.style.top = `${r.top + r.height / 2}px`
  cursor.style.opacity = '1'
  return { ok: true }
}

/** Takes the watch-mode overlay off the page. */
export function clearOverlay() {
  document.getElementById('__kivo_overlay')?.remove()
  return { ok: true }
}
