# Nova browser extension: privacy statement (DRAFT)

> **Draft.** Written from the extension's code and the server code it talks to, at version 1.0.0. It is not published and has not had legal review. Lines marked **CONFIRM** are facts the code cannot establish and the developer must fill in or check before this is published.

**Who provides it:** **CONFIRM** (legal name of the developer or company, and a contact email).

## What the extension is for

The Nova extension lets you save the web page you are reading to your Nova study list in Kivo, or start a study session on it. It acts only when you click its icon and press a button.

## What it can access

- **The page you are on, when you click the icon:** its address and its title. The extension uses the browser's `activeTab` permission, which gives access to that one tab, after your click.
- **Nothing inside the page.** It does not read text, forms, passwords or cookies. It has no content script and no permission for any website.
- **No other tabs, and no browsing history.**
- It does nothing while its popup is closed. There is no background script.

## What is sent to Kivo, and when

All requests go to one address, the Kivo web app the extension was built for, over HTTPS. Cookies are never sent.

| When | What is sent |
|---|---|
| You connect the browser | The one-time code you typed, and a label for the browser such as "Chrome on macOS" so you can recognise it later. |
| You open the popup while connected | The extension's credential. Kivo returns your first name, your subjects and the names of topics under them, so the popup can offer them. The page you are on is **not** sent at this point. |
| You press **Save to Nova** or **Study this** | The page's address (without any fragment or login in it), its title as shown or as you edited it, the subject and topic you chose, the time, and a random identifier for that click so a retry is not stored twice. |
| You press **Disconnect** | The credential, so the server can cancel it. |

Before an address is stored, the server removes any login it contains and query parameters that look like credentials (for example `token` or `password`).

## What Kivo stores

- **For a saved or studied page:** the address, the site's domain, the title, the subject and topic you filed it under, and the time. Nothing from the page itself. The server does not open or fetch the page.
- **For a connected browser:** the label, when it was connected and last used, and a one-way hash of the credential. The credential itself is not stored and cannot be read back.

A saved page is a bookmark. It is not treated as evidence that you studied anything: it does not change your progress, mastery or study record.

## What the extension stores in your browser

One item, in the extension's own storage (`chrome.storage.local`): its credential and the time you connected. No addresses, titles or history are kept in the browser. This storage is not synced to other devices and web pages cannot read it.

## How it is used and shared

- The data is used to show your saved pages in Kivo and to let you start a study session from them.
- The extension contains no analytics, advertising or tracking code and contacts no third party.
- **CONFIRM:** that Kivo does not sell this data or share it with third parties, other than the service providers that host it.
- **CONFIRM:** the service providers and where data is held. From the repository's deployment files: web app on Vercel, API on Render, database on Neon. Confirm these and their regions for production.
- **CONFIRM:** whether those providers' request logs record IP addresses and for how long. The application code does not store IP addresses for the extension, but hosting logs are outside the code.

## Keeping and deleting

- A credential stops working when you disconnect that browser (from the popup or from Kivo's Saved page), or after 30 days without use. An account keeps at most five connected browsers; connecting a sixth closes the oldest.
- You can remove any saved page from the Saved page.
- Deleting your Kivo account deletes your saved pages and connected browsers.
- **CONFIRM:** how long backups are kept, and how a user asks for deletion if they cannot sign in.

## Children

**CONFIRM:** the minimum age for Kivo accounts.

## Changes and contact

**CONFIRM:** how changes to this statement are announced, and the contact address for privacy questions.
