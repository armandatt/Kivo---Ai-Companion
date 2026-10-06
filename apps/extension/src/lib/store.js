// The one thing the extension keeps: its own Nova credential, in the
// browser's extension storage (chrome.storage.local), which web pages cannot
// read. Never localStorage, never a cookie, never synced to other devices.
// Nothing about pages visited is stored, here or anywhere.

const KEY = 'nova.connection'

/** @param {{ get: Function, set: Function, remove: Function }} area chrome.storage.local, or a stand-in */
export function createStore(area) {
  return {
    async token() {
      const stored = await area.get(KEY)
      const token = stored?.[KEY]?.token
      return typeof token === 'string' && token ? token : null
    },
    save:  token => area.set({ [KEY]: { token, connectedAt: new Date().toISOString() } }),
    clear: () => area.remove(KEY),
  }
}
