# Nova browser extension

Save the page you are reading to Nova, save a passage you selected on it, or start a study session on it. The extension is a bridge for what the learner explicitly asks for; it understands nothing and decides nothing.

## What it can and cannot do

| Permission | Why |
|---|---|
| `activeTab` | Read the address and title of the tab you are on, at the moment you click the Nova icon on it. No other tab, and not before you click. |
| `scripting` | On that same tab, at that same moment, read two things: the text you have selected, and the page's canonical link. One function (`probePage` in `src/lib/browser.js`), run once. |
| `storage` | Keep this browser connected (the extension's own credential, in `chrome.storage.local`). |

That is the whole list. There are no host permissions, no content scripts and no background script, so the extension:

- reads nothing inside a page except your selection and its canonical link (no other text, no forms, passwords or cookies), and sends the selection only when you press **Save selection**;
- cannot see your other tabs or your history;
- does nothing while its popup is closed;
- talks to one address only: the Nova web app it was built for.

`test/extension.test.mjs` fails if any of this stops being true.

## Build and load

```sh
NOVA_URL=https://your-nova.example npm run build --workspace nova-extension   # writes apps/extension/dist
npm test --workspace nova-extension
```

`NOVA_URL` is the address of the Nova **web app** (not the API). It must be `https`, or `localhost` for development (the default is `http://localhost:3000`). Then in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → choose `apps/extension/dist`.

## Safari (macOS)

Safari runs the same extension. It does not load one from a folder: it loads one that is inside a Mac app, so `safari/Nova/` holds a small Xcode project that wraps `dist/`. The project refers to `dist/` by relative path and holds no copy of the extension, so there is still one source. It was generated with `xcrun safari-web-extension-converter` and contains no code written for Nova: the app only shows how to turn the extension on.

```sh
NOVA_URL=https://your-nova.example npm run build:safari --workspace nova-extension
```

That builds `dist/` for the address and then the app. `dist/` must exist before Xcode can build, which is why the script does both; `NOVA_URL` works exactly as above. Xcode prints where it put `Nova.app` (its DerivedData folder). To run it from Xcode instead, build `dist/` first, open `safari/Nova/Nova.xcodeproj` and press Run.

Then, in Safari:

1. Settings → Advanced → **Show features for web developers**.
2. Settings → Developer → **Allow unsigned extensions** (asks for your password or Touch ID). Safari turns this off again every time it quits, and Nova then leaves the Extensions list until you turn it back on.
3. Open `Nova.app` once, so macOS registers the extension.
4. Settings → Extensions → tick **Nova**.

If Nova is missing from the Extensions list, turn on step 2 and then build again: Safari drops an unsigned extension it saw while the setting was off, and has only been seen to look again once the extension is re-registered, which a build does. The Nova button does not appear in Private Browsing windows.

What this is and is not:

- **Signing.** The project has no development team, so Xcode signs the app to run on this Mac only ("Sign to Run Locally"). That is why step 2 is needed. This locally signed build is the only one that has been run. A build signed with an Apple Developer team should not need step 2, going by Apple's documentation; that has not been tried, because the project has no team.
- **Distribution.** Nothing here is ready for the App Store or TestFlight: that needs Apple Developer Program membership, a team and a final bundle identifier in the project (it is `app.kivo.Nova` today, a placeholder), a real app icon (the current one is the toolbar's plain teal square, drawn at each size) and Apple's review.
- **Platforms.** macOS only, 12 or later for both the app and the extension. It has been built and run on one Mac, on macOS 27; no earlier macOS has been tried. There is no iOS target.
- **Versions.** The project's version is the manifest's, and a test holds them together: change `MARKETING_VERSION` in the project when `package.json` and the manifest change.
- **The server** must answer Safari's extension origin, `safari-web-extension://<id>`. It does: see `EXTENSION_ORIGINS` in `apps/api/lib/nova/extension-access.ts`.

## Releasing

```sh
NOVA_URL=https://your-nova.example npm run package --workspace nova-extension   # writes apps/extension/release/nova-extension-<version>.zip
```

The ZIP is what the Chrome Web Store takes. It is reproducible (same sources and address, same bytes; the SHA-256 is printed), and the step refuses an address that is not https or is local, and any build that asks for more than the two permissions. Listing text, the privacy statement draft and the submission steps are in `store/`.

## Connecting

1. Click the Nova icon → **Get a code from Nova**. Nova opens on its Saved page.
2. **Connect a browser** shows a one-time code (ten minutes, single use).
3. Type it into the extension.

The extension receives a credential of its own. It is not your web session: it can list your subjects, send a learning event and disconnect itself, and nothing else. It stops working when you disconnect (from the popup or from Saved) or after thirty days without use. **Disconnect** in the popup always makes this browser forget the credential. If Nova could not be reached to close its side, the popup says so and points at Saved, where the browser is still listed and can be disconnected.

## What a click sends

```jsonc
{
  "eventType": "resource_saved",        // or "selection_saved", "study_requested"
  "clientEventId": "…",                 // made up per action; a retry repeats it
  "url": "https://…", "title": "…",
  "capturedAt": "2026-10-06T12:00:00.000Z",
  "subjectId": "…", "topicName": "…",  // optional; the subject must be one of yours
  "canonicalUrl": "https://…",          // the page's own canonical link, or null
  "excerpt": "…"                        // "selection_saved" only: the passage you selected
}
```

Nothing about who you are is in it: Nova knows that from the credential. Saving a page tells Nova it matters to you. It does not tell Nova you know it; only a finished study session does.

## Saving a passage

Select text on a page, then click the Nova icon. The popup shows the selection and a **Save selection** button; it goes to Nova as a `selection_saved` event with the page's address and title, and appears on Saved as a quote under the page it came from. Nova keeps up to 2,000 characters; a longer selection is refused with a message, never cut. On a page the browser will not let an extension into, the popup says so and the page can still be saved.

## One adapter for every browser

`src/lib/browser.js` is the only file that calls the browser's extension API: storage, the active tab, opening a tab, and the one read of the page. Chrome, Edge, Brave, Arc and Safari all provide these under `chrome`, so there is no per-browser branch and both browsers run the same `dist/`. `chrome.scripting` needs Safari 16.4 or later; on an older Safari the popup offers no selection and everything else works.

## Adding a site later

`src/lib/page.js` turns a tab into `{ url, title, domain, kind }` through a list of adapters. V1 has one, for any web page. A site-specific adapter is another entry in `ADAPTERS` with its own `matches(url)`; anything it wants to read from inside a page would need a new permission, and a new line in the table above.
