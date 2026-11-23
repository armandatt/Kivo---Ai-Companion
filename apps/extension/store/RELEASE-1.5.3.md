# Nova extension 1.5.3

## What changed

- **A browser task is counted once, even when its start is lost on the way.** Starting a task now sends a key made for that start. If the answer does not arrive (a timeout or a dropped connection), the extension sends the same start once more with the same key, and Kivo returns the task it already started instead of counting a second one. An answer from Kivo, including "this month's browser tasks are used", is never retried.
- No permission, host, file or behaviour changes otherwise.

## Compatibility

- Needs no server change to work: older Kivo servers ignore the key; the current API (usage accounting) uses it.
- Older extension versions keep working against the new API (they send no key; each start is its own task, as before).

## Store listing text ("What's new")

> Browser tasks are counted once even on a slow connection.

## Checks before uploading

1. `npm test --workspace nova-extension`: all tests pass.
2. `NOVA_URL=https://www.thekivo.in npm run package --workspace nova-extension`: prints `release/nova-extension-1.5.3.zip`, its size and SHA-256.
3. Load the unzipped build unpacked in Chrome, connect with a code from the production Browser Extension page, run one agent task end to end, and check Settings → Plan and billing shows one browser task used (once accounting is in `shadow` or `enforce`).
