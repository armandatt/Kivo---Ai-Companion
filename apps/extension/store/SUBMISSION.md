# Publishing the Nova extension to the Chrome Web Store

What is ready in this repository, and what only the developer can do. Nothing has been submitted, and none of this is a claim that Google will approve it.

## Ready (generated here)

| Deliverable | Where |
|---|---|
| Release build and upload ZIP | `npm run package --workspace nova-extension` → `apps/extension/release/nova-extension-<version>.zip` |
| Listing text, category, permission justifications, data-usage reading | `apps/extension/store/LISTING.md` |
| Privacy statement draft | `apps/extension/store/PRIVACY.md` |
| Checks that the extension is what the listing says | `npm test --workspace nova-extension` |

## Needs the developer

Each of these needs an account, a decision or a fact that is not in the code.

1. **The production address of the Kivo web app.** It is not in the repository. It is built into the extension, so the ZIP cannot be made without it.
2. **Decisions in `LISTING.md`:** the title, the icon, public or unlisted.
3. **Graphics:** screenshots and the 440×280 promo tile, taken from the real product.
4. **The privacy statement:** fill in every CONFIRM in `PRIVACY.md`, have it reviewed, and publish it at a public URL.
5. **A Chrome Web Store developer account** (one-time US$5 registration fee, paid to Google) and the submission itself.

## Steps

### 1. Production must be ready first

The extension is useless until the server it talks to has these, so check them before building:

- The API is deployed from a commit that includes the extension routes (`/api/nova/extension/*`, `/api/nova/learning-events`), and the database has the `NovaLearningEvent` and `NovaExtensionConnection` tables (`prisma db push`).
- The web app's Saved page shows **Connect a browser**.

### 2. Build the ZIP

From `my-turborepo/`, with the real web app address (the site people sign in to, not the API):

```sh
npm test --workspace nova-extension
NOVA_URL=https://<your web app> npm run package --workspace nova-extension
```

It prints the ZIP's path, size and SHA-256. Running it again with the same address gives the same SHA-256. It refuses `http`, `localhost` and any build whose permissions or files differ from the audited set.

### 3. Try the exact build before uploading

1. Unzip it, open `chrome://extensions`, turn on Developer mode, **Load unpacked**, choose the unzipped folder.
2. Connect with a code from the production Saved page.
3. Save a page and check it appears in Saved; use **Study this** and check Focus opens; disconnect and check the popup returns to "Connect Nova".

This has **not** been done against production. In this repository the extension has only been exercised by its own tests and by server tests, not in a real browser on real sites.

### 4. Register and create the item

1. Sign in at <https://chrome.google.com/webstore/devconsole> with the Google account that should own the listing, accept the developer agreement and pay the registration fee. Consider a shared company account rather than a personal one; ownership is awkward to move later.
2. **New item** → upload the ZIP.

### 5. Fill in the forms

- **Store listing:** description, category, language, screenshots, promo tile, icon (from `LISTING.md`).
- **Privacy practices:** single purpose, the two permission justifications, "no remote code", the data-usage boxes, and the privacy policy URL.
- **Distribution:** visibility and countries.
- **Account tab:** a verified contact email is required before publishing.

### 6. Submit for review

Press **Submit for review**. Review time is Google's and varies; an extension with two narrow permissions and no host access usually avoids the longer in-depth review, but that is not guaranteed. If it is rejected, the email names the policy; fix, bump the version and resubmit.

Choose whether it publishes automatically on approval or waits for you (the "Publish automatically" checkbox at submission).

### 7. After approval

- Install it from the store listing in a clean browser profile and repeat step 3.
- Note the extension's ID. The API answers cross-origin requests from any `chrome-extension://` origin today (`apps/api/lib/nova/extension-access.ts`); it could be narrowed to this ID afterwards, but that would also block unpacked development builds.
- Add the store link to the web app (Saved page and Guide), which currently assume the extension is already installed.

## Releasing an update

1. Raise `version` in both `apps/extension/package.json` and `src/manifest.template.json` (the package step refuses a mismatch).
2. Run the tests and the package step, upload the new ZIP to the existing item, submit for review.

## Other browsers

Edge, Brave and Arc install from the Chrome Web Store. Edge also has its own store, which takes the same ZIP. Safari needs a separate Xcode conversion and an Apple Developer account, and has not been attempted.
