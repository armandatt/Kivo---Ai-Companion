# Nova browser extension

Save the page you are reading to Nova, or start a study session on it. The extension is a bridge for what the learner explicitly asks for; it understands nothing and decides nothing.

## What it can and cannot do

| Permission | Why |
|---|---|
| `activeTab` | Read the address and title of the tab you are on, at the moment you click the Nova icon on it. No other tab, and not before you click. |
| `storage` | Keep this browser connected (the extension's own credential, in `chrome.storage.local`). |

That is the whole list. There are no host permissions, no content scripts and no background script, so the extension:

- cannot read inside any page (text, forms, passwords, cookies);
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

## Connecting

1. Click the Nova icon → **Get a code from Nova**. Nova opens on its Saved page.
2. **Connect a browser** shows a one-time code (ten minutes, single use).
3. Type it into the extension.

The extension receives a credential of its own. It is not your web session: it can list your subjects, send a learning event and disconnect itself, and nothing else. It stops working when you disconnect (from the popup or from Saved) or after thirty days without use.

## What a click sends

```jsonc
{
  "eventType": "resource_saved",        // or "study_requested"
  "clientEventId": "…",                 // made up per action; a retry repeats it
  "url": "https://…", "title": "…",
  "capturedAt": "2026-10-06T12:00:00.000Z",
  "subjectId": "…", "topicName": "…"   // optional; the subject must be one of yours
}
```

Nothing about who you are is in it: Nova knows that from the credential. Saving a page tells Nova it matters to you. It does not tell Nova you know it; only a finished study session does.

## Adding a site later

`src/lib/page.js` turns a tab into `{ url, title, domain, kind }` through a list of adapters. V1 has one, for any web page. A site-specific adapter is another entry in `ADAPTERS` with its own `matches(url)`; anything it wants to read from inside a page would need a new permission, and a new line in the table above.
