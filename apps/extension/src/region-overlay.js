// Drawn on the page when the learner presses "Select area" in the popup, and
// only then: the popup injects this one file into that one tab (activeTab).
// It reads nothing from the page. The learner drags a rectangle, then Capture,
// Retry or Cancel. It takes itself off the page before the picture is taken, so
// it is not in it, and tells the background worker the rectangle in viewport
// coordinates. Scroll position doesn't matter: the picture is of the viewport.
(() => {
  const FLAG = '__novaRegionOpen'
  if (window[FLAG]) return
  window[FLAG] = true

  const host = document.createElement('div')
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647;'
  const root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `
    * { box-sizing: border-box; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
    .veil { position: fixed; inset: 0; cursor: crosshair; background: rgba(5, 8, 12, .35); touch-action: none; user-select: none; -webkit-user-select: none; }
    .veil.chosen { cursor: default; background: transparent; }
    .box { position: fixed; display: none; border: 2px solid #34d1a8; border-radius: 3px; box-shadow: 0 0 0 100vmax rgba(5, 8, 12, .45); pointer-events: none; }
    .tip, .bar { position: fixed; display: flex; align-items: center; gap: 6px; padding: 6px 8px; color: #eef0f4; background: #15161c; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.45); }
    .tip { top: 16px; left: 50%; transform: translateX(-50%); padding: 8px 12px; pointer-events: none; }
    .bar { display: none; }
    button { appearance: none; height: 30px; padding: 0 12px; color: #eef0f4; background: transparent; border: 1px solid rgba(255,255,255,.16); border-radius: 8px; cursor: pointer; font-weight: 500; }
    button:hover { background: rgba(255,255,255,.08); }
    button:focus-visible { outline: 2px solid #5fe0bd; outline-offset: 1px; }
    button.go { color: #052019; background: #34d1a8; border-color: transparent; font-weight: 600; }
    button.go:hover { background: #5fe0bd; }
  `
  const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node }
  const veil = make('div', 'veil'), box = make('div', 'box')
  const tip = make('div', 'tip', 'Drag over the part you want Nova to see. Esc cancels.')
  tip.setAttribute('role', 'status')
  const bar = make('div', 'bar')
  bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Your selection')
  const button = (className, text, action) => { const b = make('button', className, text); b.type = 'button'; b.dataset[action] = ''; return b }
  const captureButton = button('go', 'Capture', 'capture'), retryButton = button('', 'Retry', 'retry'), cancelButton = button('', 'Cancel', 'cancel')
  bar.append(captureButton, retryButton, cancelButton)
  veil.dataset.veil = ''; box.dataset.box = ''; bar.dataset.bar = ''
  root.append(style, veil, box, tip, bar)
  const MIN_SIDE = 8

  let from = null, rect = null

  function close() {
    window.removeEventListener('keydown', onKey, true)
    host.remove()
    delete window[FLAG]
  }
  function cancel() {
    close()
    void chrome.runtime.sendMessage({ type: 'nova-region-cancel' }).catch(() => {})
  }
  function retry() {
    rect = null; from = null
    box.style.display = 'none'; bar.style.display = 'none'; tip.style.display = ''
    veil.classList.remove('chosen')
  }
  function draw(r) {
    Object.assign(box.style, { display: 'block', left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` })
  }
  function placeBar(r) {
    bar.style.display = 'flex'
    const b = bar.getBoundingClientRect()
    const below = r.y + r.h + 8 + b.height <= window.innerHeight
    bar.style.top = `${below ? r.y + r.h + 8 : Math.max(8, r.y - b.height - 8 > 0 ? r.y - b.height - 8 : r.y + 8)}px`
    bar.style.left = `${Math.min(Math.max(8, r.x + r.w - b.width), window.innerWidth - b.width - 8)}px`
    captureButton.focus()
  }
  function onKey(event) {
    if (event.key !== 'Escape') return
    event.preventDefault(); event.stopPropagation()
    cancel()
  }
  function toast(text) {
    const note = document.createElement('div')
    note.style.cssText = 'all: initial; position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 2147483647; padding: 10px 14px; color: #eef0f4; background: #15161c; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; font: 13px/1.4 system-ui, sans-serif;'
    note.textContent = text
    document.documentElement.append(note)
    setTimeout(() => note.remove(), 5000)
  }

  veil.addEventListener('pointerdown', event => {
    if (rect || event.button !== 0) return
    event.preventDefault()
    veil.setPointerCapture(event.pointerId)
    from = { x: event.clientX, y: event.clientY }
    tip.style.display = 'none'
  })
  veil.addEventListener('pointermove', event => {
    if (!from || rect) return
    draw({ x: Math.min(from.x, event.clientX), y: Math.min(from.y, event.clientY), w: Math.abs(event.clientX - from.x), h: Math.abs(event.clientY - from.y) })
  })
  veil.addEventListener('pointerup', event => {
    if (!from || rect) return
    const r = { x: Math.min(from.x, event.clientX), y: Math.min(from.y, event.clientY), w: Math.abs(event.clientX - from.x), h: Math.abs(event.clientY - from.y) }
    from = null
    // A click, or a slip of the hand, is not a selection.
    if (r.w < MIN_SIDE || r.h < MIN_SIDE) return retry()
    rect = r
    veil.classList.add('chosen')
    draw(r); placeBar(r)
  })
  veil.addEventListener('pointercancel', () => retry())
  retryButton.addEventListener('click', retry)
  cancelButton.addEventListener('click', cancel)
  captureButton.addEventListener('click', () => {
    const chosen = rect
    const viewport = { w: window.innerWidth, h: window.innerHeight }
    close()
    // Two frames, so the page is drawn without the overlay before the picture.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      chrome.runtime.sendMessage({ type: 'nova-region', rect: chosen, viewport })
        .then(res => {
          if (res?.error) toast(res.error)
          else if (!res?.opened) toast('Captured. Click the Nova icon to ask about it.')
        })
        .catch(() => toast("Nova couldn't capture that. Try again from the Nova icon."))
    }))
  })
  window.addEventListener('keydown', onKey, true)
  document.documentElement.append(host)
})()
