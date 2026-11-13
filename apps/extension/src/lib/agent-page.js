// What the research agent runs inside a page it opened (chrome.scripting.
// executeScript with `func`). Each function here is self-contained: it is
// serialised into the page, so it may use nothing from outside itself.
//
// What they read: the page's visible text, headings, links and buttons.
// What they never read: form values, password fields, hidden elements,
// cookies or storage. Elements are numbered with data-kivo-agent so a later
// click or type names the same element; numbers are given again on each read.
//
// Untrusted: everything they return is page content. The model sees it
// marked as such (server: research-agent-rules.ts) and code decides what any
// action may do (lib/agent-tools.js).

/** The page as the agent reads it. */
export function observePage(limits) {
  const max = limits?.textMax ?? 60000
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'NAV', 'FOOTER', 'ASIDE', 'FORM', 'HEADER'])
  const visible = node => {
    if (!(node instanceof Element)) return true
    if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false
    const s = getComputedStyle(node)
    return s.display !== 'none' && s.visibility !== 'hidden'
  }
  const clean = t => (t || '').replace(/\s+/g, ' ').trim()
  for (const old of document.querySelectorAll('[data-kivo-agent]')) old.removeAttribute('data-kivo-agent')

  // Where the writing is: the element holding the most paragraph text (its
  // parent counts half), not whatever is tagged main (which often holds the
  // site's tools too). An <article> wins outright.
  const score = new Map()
  // Paragraphs, and blockquotes (an arXiv abstract is one).
  for (const p of document.querySelectorAll('p, blockquote')) {
    const n = (p.innerText || '').trim().length
    if (n < 60 || !p.parentElement) continue
    score.set(p.parentElement, (score.get(p.parentElement) ?? 0) + n)
    const gp = p.parentElement.parentElement
    if (gp) score.set(gp, (score.get(gp) ?? 0) + n / 2)
  }
  let dense = null, best = 0
  for (const [node, n] of score) if (n > best && node !== document.body) { best = n; dense = node }
  // Writing split into many sections (documentation): widen to the block that
  // holds most of it, while the next one up holds clearly more.
  const prose = el => { let n = 0; for (const p of el.querySelectorAll('p, blockquote')) { const t = (p.innerText || '').trim().length; if (t >= 60) n += t } return n }
  if (dense) for (let up = dense.parentElement; up && up !== document.body && up !== document.documentElement; up = up.parentElement) {
    if (prose(up) > prose(dense) * 1.3) dense = up
    else break
  }
  const root = document.querySelector('article') || (best > 400 ? dense : null) || document.querySelector('main, [role=main]') || document.body
  const blocks = []
  const BLOCK = new Set(['P', 'LI', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'DD', 'DT', 'FIGCAPTION', 'CAPTION'])
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
      walk(child)
    }
  }
  walk(root)
  let text = blocks.join('\n').trim()
  if (text.length < 200) text = clean(root.innerText).slice(0, max)   // pages built from divs only

  const headings = [...root.querySelectorAll('h1, h2, h3')].filter(visible).map(h => clean(h.innerText)).filter(Boolean).slice(0, 30)

  const links = []
  const seen = new Set()
  let i = 0
  for (const a of document.querySelectorAll('a[href]')) {
    if (links.length >= 60) break
    if (!visible(a)) continue
    let href
    try { href = new URL(a.getAttribute('href'), location.href) } catch { continue }
    if (href.protocol !== 'https:' && href.protocol !== 'http:') continue
    href.hash = ''
    const label = clean(a.innerText || a.getAttribute('aria-label') || a.title).slice(0, 120)
    if (!label || seen.has(href.href)) continue
    seen.add(href.href)
    a.setAttribute('data-kivo-agent', String(i))
    links.push({ i: i++, text: label, href: href.href.slice(0, 500), inMain: root.contains(a) })
  }
  links.sort((x, y) => Number(y.inMain) - Number(x.inMain))

  const controls = []
  for (const c of document.querySelectorAll('button, input, select, textarea, [role=button], [role=searchbox]')) {
    if (controls.length >= 25) break
    if (!visible(c)) continue
    const type = (c.getAttribute('type') || '').toLowerCase()
    if (c.tagName === 'INPUT' && ['hidden', 'password', 'file'].includes(type)) continue
    if (c.tagName === 'INPUT' && (type === 'checkbox' || type === 'radio')) continue   // toggles: nothing to research with
    const kind = c.tagName === 'INPUT' || c.tagName === 'TEXTAREA' || c.getAttribute('role') === 'searchbox' ? (type === 'search' || c.getAttribute('role') === 'searchbox' ? 'search box' : 'text field') : c.tagName === 'SELECT' ? 'menu' : 'button'
    // A button's own label; never a field's value (what the learner typed).
    const label = clean(c.getAttribute('aria-label') || c.getAttribute('placeholder') || c.innerText || (kind === 'button' ? c.getAttribute('value') : '') || c.name || c.title).slice(0, 100)
    if (!label) continue
    c.setAttribute('data-kivo-agent', String(i))
    controls.push({ i: i++, kind, label })
  }

  const fingerprint = `${location.href}|${text.length}|${headings.length}`
  return { url: location.href, title: clean(document.title).slice(0, 300), headings, text: text.slice(0, max), links: links.slice(0, 40).map(({ inMain, ...l }) => l), controls, fingerprint, isPdf: document.contentType === 'application/pdf' }
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
      a.setAttribute('data-kivo-agent', String(i))
      const title = clean(a.innerText) || clean(li.querySelector('cite')?.innerText)
      out.push({ i: i++, title: title.slice(0, 160), href: href.slice(0, 500), snippet: clean(li.querySelector('.b_caption p, .b_lineclamp2, .b_lineclamp3, .b_lineclamp4, p')?.innerText).slice(0, 300) })
      if (out.length >= 10) break
    }
    return { url: location.href, title: document.title, results: out, challenge: challenge && !out.length }
  }
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
    a.setAttribute('data-kivo-agent', String(i))
    out.push({ i: i++, title: clean(a.innerText).slice(0, 160), href: href.slice(0, 500), snippet: clean(r.querySelector('.result__snippet')?.innerText).slice(0, 300) })
    if (out.length >= 10) break
  }
  return { url: location.href, title: document.title, results: out, challenge: challenge && !out.length }
}

/** What an element is, before the agent acts on it. */
export function inspectTarget(index) {
  const el = document.querySelector(`[data-kivo-agent="${index}"]`)
  if (!el) return { exists: false }
  const form = el.closest('form')
  const type = (el.getAttribute('type') || '').toLowerCase()
  const label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || (el.matches('button, input[type=submit], input[type=button]') ? el.getAttribute('value') : '') || el.name || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const searchy = s => /search|query|^q$|find/i.test(s || '')
  const isSearchBox = el.matches('input, textarea, [role=searchbox]') && (type === 'search' || el.getAttribute('role') === 'searchbox' || searchy(el.name) || searchy(el.id) || searchy(el.getAttribute('aria-label')) || searchy(el.getAttribute('placeholder')) || (form && (form.getAttribute('role') === 'search' || searchy(form.getAttribute('action')))))
  const formRisk = form ? {
    hasPassword: Boolean(form.querySelector('input[type=password]')),
    hasPayment: Boolean(form.querySelector('[autocomplete^=cc-], input[name*=card i]')),
    method: (form.getAttribute('method') || 'get').toLowerCase(),
    isSearch: form.getAttribute('role') === 'search' || Boolean(form.querySelector('input[type=search]')) || searchy(form.getAttribute('action')),
  } : null
  let href = null
  if (el.tagName === 'A') { try { href = new URL(el.getAttribute('href'), location.href).href } catch { href = null } }
  return { exists: true, tag: el.tagName.toLowerCase(), type, label, href, isPassword: type === 'password', isSearchBox: Boolean(isSearchBox), isSubmit: el.matches('button[type=submit], input[type=submit], button:not([type])') && Boolean(form), form: formRisk, download: el.hasAttribute('download') }
}

export function clickTarget(index) {
  const el = document.querySelector(`[data-kivo-agent="${index}"]`)
  if (!el) return { ok: false, reason: 'That element is not on the page any more.' }
  el.scrollIntoView({ block: 'center' })
  el.click()
  return { ok: true }
}

export function typeInto(index, text, submit) {
  const el = document.querySelector(`[data-kivo-agent="${index}"]`)
  if (!el || !el.matches('input, textarea, [role=searchbox]')) return { ok: false, reason: 'That is not a text field.' }
  if ((el.getAttribute('type') || '').toLowerCase() === 'password') return { ok: false, reason: 'Kivo never types into password fields.' }
  el.focus()
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
  if (setter) setter.call(el, text); else el.value = text
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  if (submit) {
    const form = el.closest('form')
    if (form && typeof form.requestSubmit === 'function') form.requestSubmit()
    else { for (const type of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })) }
  }
  return { ok: true }
}

export function scrollPage(direction) {
  const before = window.scrollY
  window.scrollBy({ top: (direction === 'up' ? -1 : 1) * Math.round(window.innerHeight * 0.9), behavior: 'instant' })
  return { ok: true, moved: window.scrollY !== before, atEnd: window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 }
}
