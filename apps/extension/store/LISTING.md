# Chrome Web Store listing: Nova extension

Text and assets for the store's forms. Everything here describes what the extension in this repository does (`apps/extension/src`). The listing is live (https://chromewebstore.google.com/detail/nova/eddopegjkjiadejiocfbhoecjlbfcjba, version 1.2.0 on 12 Nov 2026). Paste the text below into the Developer Dashboard; nothing here is submitted by the repository. Items marked **DECIDE** or **CONFIRM** need the developer.

## Title

The store shows the manifest's `name`: **Nova**. Kept: the listing, its users and its ratings are under that name.

- **DECIDE (later):** "Nova by Kivo" would say whose it is. It needs `name` and `action.default_title` changed in `src/manifest.template.json` and a release.

## Short description (132 characters max)

From the manifest's `description` (116 characters), shipped with the next release:

> Capture passages as you read and ask Nova about the page beside it. Nova sees a page only when you click its button.

## Detailed description

Plain text: the store prints Markdown symbols (`**`) as they are, so the live description shows asterisks. Replace it with this when 1.3.0 is published (the line about description tags is true from 1.3.0).

> Save what you discover. Continue learning in Kivo.
>
> Nova is Kivo's browser extension. When something is worth keeping, click it and the page goes into your Kivo workspace, filed under your subject and topic.
>
> WHAT YOU CAN DO
>
> • Save a page: articles, YouTube videos, research papers, documentation. It lands in Saved pages in Kivo, ready to search, tag and sort.
> • Capture a passage: select text and press Capture. Passages from one sitting collect in a draft in Kivo, each with the page it came from, until you put them in a note.
> • Study this: start a focus session on the page in Kivo, under its topic.
> • Ask Nova: a conversation beside the page, with follow-up questions, short answers by default (More detail when you want it), and maths, tables and code drawn properly. Add a screenshot, or select an area, to ask about a diagram.
>
> IN KIVO
>
> Saved pages sit with your notes on your Knowledge Map, under the subjects you study. Open one, write a note from it, and study it with Nova.
>
> PRIVATE BY DESIGN
>
> • Nova sees a page only when you click its button. There is no background tracking and no content script.
> • It reads the address, the title, the text you selected and the page's public description tags (title, image, author, date). Nothing else on the page.
> • It never sees your other tabs or your history.
>
> GETTING STARTED
>
> 1. Add Nova to Chrome and pin it from the puzzle icon.
> 2. In Kivo, open Browser Extension and press Get a code.
> 3. Type the code into the extension. That's it.
>
> You need a free Kivo account: thekivo.in

**CONFIRM** before pasting: "free Kivo account" matches the plans on the pricing page.

## Category

Education (current). Alternative: Workflow & Planning.

## Language

English.

## Graphics

Made in this repository from genuine captures of the app and the extension (researcher demo workspace, local server): `design/store/` (see its `README.md`).

| Asset | Size | File |
|---|---|---|
| Store icon | 128×128 PNG, 96 px artwork + 16 px clear | Built by `scripts/build.mjs` (`icons/128.png` in the ZIP). The Kivo mark on a white tile, replacing the old plain teal square |
| Screenshots (5) | 1280×800 PNG, full bleed | `screenshot-1-save.png` … `screenshot-5-focus.png` |
| Small promo tile | 440×280 PNG, no text | `promo-small-440x280.png` |
| Marquee promo tile | 1400×560 PNG, no text | `promo-marquee-1400x560.png` |

Screenshot order and captions:

1. Save what you discover: the popup on a research paper.
2. Everything you save, in one place: Saved pages in Kivo.
3. See how your ideas connect: the Knowledge Map, one subject explored.
4. Study it with Nova: a paper's note with Nova beside it.
5. Turn reading into progress: Study this, on the Focus screen.

The people and workspace in them are Kivo's demo personas, not a user's data.


## "Privacy practices" tab

### Single purpose

> Bring the web page the user is currently viewing into their Nova study list when they click the extension's button: save the page or a passage they selected on it, start a study session on it, or ask Nova a question about it.

**CONFIRM** that asking a question still reads as the same single purpose to the store; it was added after this statement was first written.

### Permission justifications

| Permission | Justification |
|---|---|
| `activeTab` | When the user clicks the extension's icon, the popup reads the address and title of that one tab so the user can save it. It is the only tab the extension asks about (`chrome.tabs.query({ active: true, currentWindow: true })`), and only after the click. If the user presses **Screenshot**, the popup also captures that tab's visible area (`chrome.tabs.captureVisibleTab`) so they can ask about a diagram; it is shown to them first and sent only with their question. |
| `scripting` | On that one tab, after that click, the popup runs one small function that returns the text the user has selected and the page's canonical link, so the user can save a passage they highlighted. It reads no other page content, runs once, and is part of the package (no remote code). The selection is sent only if the user presses **Save selection**. |
| `sidePanel` | Ask Nova opens a conversation in the browser's side panel beside the page, for that one tab, only when the user presses Ask Nova. It reads nothing from any page and grants no site access. |
| `storage` | Stores the extension's own access credential in `chrome.storage.local` after the user pairs the browser with a one-time code, so they stay connected. The open conversation with Nova about an article is kept in `chrome.storage.session` (memory only, cleared when the browser closes or the user presses New conversation) so follow-up questions have context. Only if the user presses Keep on a conversation is it saved in `chrome.storage.local` on this device, with that article's address and title, until they unlock it, start a new conversation, or leave it unused for 14 days (at most 10 kept). Nothing else is stored: no browsing history. |

Host permissions: **none requested.** Remote code: **No, the extension does not use remote code.** All scripts are in the package; `popup.html` loads only `popup.js` and `popup.css`.

### Data usage

Which boxes to tick is the developer's declaration to Google. This is a reading of the code, not legal advice. **CONFIRM** before submitting.

| Store category | Applies? | Why |
|---|---|---|
| Web history | **Likely yes** | The address and title of a page are sent when the user saves or studies it. It is one page at a time, at the user's request, and not a browsing log, but this is the category that describes page addresses and titles. |
| Authentication information | **Likely yes** | The extension holds a credential issued by Nova and sends it with its requests. It never sees the user's password. |
| Personally identifiable information | Likely no | The extension receives the user's first name to show "Connected · Name"; it does not collect or send it. |
| Website content | **Yes** | The text the user has selected on the page is read when the popup opens, and sent when the user presses **Save selection** or asks a question. A screenshot of the visible tab is taken only when the user presses **Screenshot** and is sent only with a question. Nothing else from inside a page is read. |
| User activity, location, health, financial, personal communications | No | Not accessed. |

The three certifications the form asks for: data is not sold or transferred to third parties outside the approved use cases, not used for purposes unrelated to the single purpose, and not used for creditworthiness or lending. **CONFIRM the first one before submitting:** a saved passage, a page title and a question are sent by Kivo's server to its AI model provider to suggest topics and to answer the question. Whether that counts as an approved use (providing the extension's single purpose through a service provider) is the developer's judgement, and the privacy policy must say it.

### Privacy policy URL

The form requires a public URL. **TO DO:** `PRIVACY.md` in this folder is a draft; it has to be reviewed, completed and published on the Kivo site. No privacy page exists in the web app today.

## Distribution

**DECIDE:** Public, or Unlisted for a first round (installable by link only, same review).
