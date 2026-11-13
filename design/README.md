# Browser extension experience: redesign record

Scope: the Browser Extension page (`/saved`), the Nova Chrome extension popup and icon, and the Chrome Web Store listing. Nothing else in Kivo was changed.

- `review/before/` and `review/after/`: the page (`saved/` not connected, `saved-connected/` connected; `1440-*` desktop, `390-*` phone), the popup (`popup/`), and the live store listing as it was (`before/store/`).
- `store/`: the Chrome Web Store screenshots and promo tiles, with how they are made (`store/README.md`).

All captures are from a local server with Kivo's demo personas (no user data), taken with Playwright.

## What was wrong

**The page (`/saved`)**

1. The saved pages, which are the part used every day, began about 2,250 px down when no browser was connected. Above them sat:
   - a marketing-style banner;
   - the connect panel;
   - three "How it works" cards;
   - seven "What you can save" cards.
2. Connecting was explained three times: in the steps, in the panel and in the FAQ.
3. The connect panel stretched to the bookmark panel's height and was mostly empty.
4. The bookmark panel showed five lines of instructions before you could use it.
5. Each saved-page card carried, all at the same weight:
   - a grey placeholder band, and "WEB PAGE" on every card;
   - two dropdowns, Tag and More.
   - "Study this" was hidden under More.
6. On a phone, the library's side rail (statuses and collections) filled the first screen before any card.
7. The nine FAQ questions ran full width at the bottom.

**The popup**

1. The mark was a generic "N", and the toolbar icon in the shipped 1.2.0 ZIP was a plain teal square.
2. With a passage selected, the popup was 737 px tall. Chrome caps popups at 600 px, so it scrolled.
3. An explanation paragraph sat above Ask Nova. The chips under the box already say what is sent.
4. Some wording was chatty ("Future-you can deal with it").

**The store listing**

1. Three raw, small, dark captures that can't be read at the store's 640×400 display size.
2. The description uses `**`, which the store prints literally, and makes generic claims ("Get unstuck, understand difficult concepts").

## What changed

| | Before | After |
|---|---|---|
| Page height, desktop, not connected | 3,564 px | 1,949 px |
| Page height, phone | 6,248 px | 3,165 px |
| Words on the page | 744 | 433 |
| Where the saved pages start (desktop, not connected) | about 2,250 px | inside the first screen |
| Popup, passage selected | 737 px (scrolls) | 600 px (fits) |
| Popup words: not connected / connected / passage / saved | 49 / 87 / 108 / 60 | 39 / 58 / 84 / 45 |

**The page's structure**

- Header: the title, one line, the connection status and Add to Chrome.
- While no browser is connected: a "Set up in a minute" band. It has three steps (add it, get a code, save) beside a real capture of the popup, and the code appears inline.
- The saved pages, with "Paste a link to save it" as one slim field.
- Once connected: "Connected browsers", folded, with Disconnect and Connect another.
- Other ways to save: the Save to Kivo bookmark, with the phone steps folded.
- Help: seven short questions, folded, with "What Nova keeps" beside them.

**The saved-page cards**

- No band when there is no picture.
- The kind label only when it says something.
- Study is on the card.
- The collection picker appears only once there are collections.

**On a phone,** the library's filters are one row of chips that scrolls sideways.

## QA (Playwright, local server)

All passed on the final build.

**The page**

- Not connected:
  - status reads "Not connected";
  - Add to Chrome opens the live listing in a new tab, with `noopener`.
- Get a code shows a code, and redeeming it as the extension does turns the page to "Connected · 1 browser" by itself. The setup band goes and Connected browsers appears.
- Disconnect returns the page to not connected.
- Save a link adds the page to the library.
- A reading status change persists after a reload.
- Study opens `/focus?study=<id>`.
- Help questions open.
- The bookmark's Copy code copies.
- `?connect` (the popup's "Get a code from Nova"):
  - when connected, opens the browsers panel, in view;
  - when not connected, shows the setup.
- Phone: one row of filters, a collection can be created, and the link field is full height.
- No sideways page scroll at 1440, 1280, 768 or 390, in light or dark.

**The popup**

- It is the extension's own popup code run against the local API: connect, connected, passage selected, and saved (a real save).
- Each fits 420×600.
- The toolbar icon was checked at 16, 48 and 128 px.

**Store images**

- The exact sizes, and each screenshot read at 640×400.

**Tests**

- Web: type check, and 330 of 330 tests.
- Extension: 49 of 49 tests, run on a copy without the stray `src/lib 2` folder.
