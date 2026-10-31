# Chrome Web Store listing: Nova extension

Draft text and checklists for the store's forms. Everything here describes what the extension in this repository does (`apps/extension/src`, version 1.0.0). Items marked **DECIDE** or **CONFIRM** need the developer; nothing below has been submitted or reviewed by Google.

## Title

The store shows the manifest's `name`. It is currently **Nova**.

- **DECIDE:** "Nova" alone is a common name and says nothing about Kivo. Suggested: `Nova by Kivo`. Changing it means editing `name` and `action.default_title` in `src/manifest.template.json` and rebuilding; the popup's own heading can stay "Nova".

## Short description (132 characters max)

Used from the manifest's `description` (119 characters):

> Save what you're reading to Nova, or study it. Nova sees a page only when you click its button on that page.

## Detailed description

> Nova is the study companion inside Kivo. This extension is the quickest way to get a page you are reading into it.
>
> Click the Nova icon on any web page and choose:
>
> • Save to Nova: keeps the page's address and title in your Saved list, filed under one of your subjects and a topic if you like.
> • Study this: does the same, then opens Nova's Focus screen so you can start a timed study session on it.
> • Save selection: select a passage first, and Nova keeps that passage with the page it came from.
> • Ask Nova about this page: type a question and get an answer in the popup.
>
> What it does not do
>
> • It does not read the page. It sees the address, the title and the text you have selected, and sends them only when you press a button. With no selection, Nova answers a question from the title alone and says so.
> • It does not see your other tabs or your browsing history.
> • It does nothing in the background. There is no background script and no content script; when the popup is closed, the extension is not running.
> • Saving a page does not count as studying it. Your progress in Nova changes only when you finish a study session.
>
> Getting started
>
> 1. You need a Kivo account with Nova set up.
> 2. Click the Nova icon and choose "Get a code from Nova". Nova opens on its Saved page.
> 3. Press "Connect a browser" there and type the one-time code into the extension.
>
> You can disconnect a browser at any time from the extension or from the Saved page.

## Category

**Suggested:** Education (the store lists it under Productivity). Alternative: Workflow & Planning.

## Language

English.

## Graphics checklist

Nothing here exists yet. The store requires the first three.

| Asset | Size | Status |
|---|---|---|
| Store icon | 128×128 PNG | The build draws a plain teal rounded square (`scripts/build.mjs`). It is valid, but it is a placeholder. **DECIDE:** replace with the Kivo/Nova mark before listing. |
| Screenshots (1 to 5) | 1280×800 or 640×400 | **TO DO.** Take them from the real extension against production. Suggested set below. |
| Small promo tile | 440×280 | **TO DO.** |
| Marquee promo tile | 1400×560 | Optional. |

Suggested screenshots, all of real screens:

1. The popup on an article, connected: title, subject, topic, "Save to Nova" and "Study this".
2. The popup after a save, showing where the page was filed.
3. Nova's Saved page listing saved pages.
4. The "Connect Nova" popup beside the Saved page showing a pairing code. Use a code that has already expired.
5. Nova's Focus screen opened from "Study this".

Do not show a real person's data: use a test account.

## "Privacy practices" tab

### Single purpose

> Bring the web page the user is currently viewing into their Nova study list when they click the extension's button: save the page or a passage they selected on it, start a study session on it, or ask Nova a question about it.

**CONFIRM** that asking a question still reads as the same single purpose to the store; it was added after this statement was first written.

### Permission justifications

| Permission | Justification |
|---|---|
| `activeTab` | When the user clicks the extension's icon, the popup reads the address and title of that one tab so the user can save it. It is the only tab the extension asks about (`chrome.tabs.query({ active: true, currentWindow: true })`), and only after the click. If the user presses **Screenshot**, the popup also captures that tab's visible area (`chrome.tabs.captureVisibleTab`) so they can ask about a diagram; it is shown to them first and sent only with their question. |
| `scripting` | On that one tab, after that click, the popup runs one small function that returns the text the user has selected and the page's canonical link, so the user can save a passage they highlighted. It reads no other page content, runs once, and is part of the package (no remote code). The selection is sent only if the user presses **Save selection**. |
| `storage` | Stores the extension's own access credential in `chrome.storage.local` after the user pairs the browser with a one-time code, so they stay connected. Nothing else is stored: no page addresses, no history. |

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
