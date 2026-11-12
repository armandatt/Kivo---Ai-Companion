// Can this browser add Kivo's extension from the Chrome Web Store? Asked only
// to word a note beside the install button: the button itself is always
// there, because a guess about the browser must never hide the way in.
//
// Chromium browsers report themselves in navigator.userAgentData (brands and
// whether the device is a phone). Firefox and Safari have no userAgentData,
// so for them the user-agent string is read for a phone or tablet only.
// Nothing here claims the extension is installed: a web page cannot know.

export type BrowserSupport =
  | 'chrome'        // Google Chrome on a computer: the tested browser
  | 'chromium'      // another Chromium browser on a computer: not tested
  | 'mobile'        // a phone or tablet: no browser there takes Chrome extensions
  | 'other'         // Firefox, Safari on a Mac, and the rest
  | 'unknown'       // not asked yet (the server render)

export interface UaData { brands?: Array<{ brand: string }>; mobile?: boolean }

const MOBILE_WORDS = ['iPhone', 'iPad', 'iPod', 'Android', 'Mobile']

export function browserSupport(uaData: UaData | null | undefined, userAgent: string | null | undefined, touchMac = false): BrowserSupport {
  if (uaData && Array.isArray(uaData.brands)) {
    if (uaData.mobile) return 'mobile'
    return uaData.brands.some(b => b.brand === 'Google Chrome') ? 'chrome' : 'chromium'
  }
  if (typeof userAgent !== 'string') return 'unknown'
  // An iPad asks for the desktop site and says "Macintosh"; it has touch.
  if (touchMac || MOBILE_WORDS.some(w => userAgent.includes(w))) return 'mobile'
  return 'other'
}

// In the browser: what this one is. 'unknown' on the server.
export function currentBrowserSupport(): BrowserSupport {
  if (typeof navigator === 'undefined') return 'unknown'
  const nav = navigator as Navigator & { userAgentData?: UaData }
  const touchMac = nav.userAgent.includes('Macintosh') && (nav.maxTouchPoints ?? 0) > 1
  return browserSupport(nav.userAgentData, nav.userAgent, touchMac)
}
