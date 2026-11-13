// The background worker, for one job: taking the picture when the learner
// presses Capture on an area they selected. The popup has closed by then (it
// closes as soon as they click the page), and a page can't take a picture of
// itself. It wakes for that one message and does nothing else: it reads no tab,
// and listens for no navigation, no timer and no site.
//
// The picture is held in session storage (memory, gone when the browser quits)
// until the popup picks it up. It goes to Nova only with a question.

import { REGION_SHOT_KEY, cropArea } from './lib/region.js'

const CANNOT = "Nova couldn't capture this page. Some pages don't allow it."

async function capture(windowId, rect, viewport) {
  const shot = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
  const encoded = atob(shot.slice(shot.indexOf(',') + 1))
  const png = Uint8Array.from(encoded, ch => ch.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }))
  const area = cropArea(rect, viewport, bitmap)
  if (!area) throw new Error('empty selection')
  const canvas = new OffscreenCanvas(area.sw, area.sh)
  canvas.getContext('2d').drawImage(bitmap, area.sx, area.sy, area.sw, area.sh, 0, 0, area.sw, area.sh)
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { src: `data:image/jpeg;base64,${btoa(binary)}`, width: area.sw, height: area.sh }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const tab = sender.tab
  // Only our own overlay, in a tab, can send this; nothing from a web page reaches it.
  if (sender.id !== chrome.runtime.id || !tab?.id) return false
  if (message?.type === 'nova-region-cancel') {
    void chrome.storage.session.remove(REGION_SHOT_KEY).then(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }))
    return false
  }
  if (message?.type !== 'nova-region') return false
  ;(async () => {
    try {
      const picture = await capture(tab.windowId, message.rect, message.viewport)
      await chrome.storage.session.set({ [REGION_SHOT_KEY]: { ...picture, tabId: tab.id, at: Date.now() } })
      // Asked for from Nova's side panel on this tab: the panel takes it from
      // storage itself, so the popup is not opened.
      const { novaPanelRegion } = await chrome.storage.session.get('novaPanelRegion')
      if (novaPanelRegion === tab.id) { reply({ opened: true }); return }
      // Back to the popup with it. A browser that won't open it from here shows
      // a mark on the icon, and the page says to click it.
      let opened = false
      try { await chrome.action.openPopup({ windowId: tab.windowId }); opened = true } catch { /* not allowed here */ }
      if (!opened) {
        await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#34d1a8' })
        await chrome.action.setBadgeText({ tabId: tab.id, text: '1' })
      }
      reply({ opened })
    } catch {
      reply({ opened: false, error: CANNOT })
    }
  })()
  return true
})
