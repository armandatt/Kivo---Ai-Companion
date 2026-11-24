# Landing page value section: research (founder review #06)

Researched **25 November 2026** from each tool's official pricing page.

| Tool | What it overlaps with in Kivo | Official price shown | Notes |
|---|---|---|---|
| Notion ([notion.com/pricing](https://www.notion.com/pricing)) | Notes, workspace | Plus **$10** per member a month (USD; monthly/yearly toggle, "save up to 20% with yearly") | **Plus is free for students and educators** with a school email (FAQ). No INR shown. Taxes not stated. |
| Xmind ([xmind.com/pricing](https://xmind.com/pricing)) | Mind maps (the Knowledge Map) | Pro **US $4.92/month**, Premium US $8.25/month | Appears to be yearly billing shown per month (links carry `duration=yearly`; "up to 50% off"); not confirmed. No INR. Taxes not stated. |
| Readwise ([readwise.io/pricing](https://readwise.io/pricing)) | Saving and revisiting web reading (the extension and Saved pages) | Full **$9.99/month billed yearly**; Reader only $7.99/month billed yearly | **50% student discount** on request. Monthly-billed prices not shown. No INR. |

## Why the section shows no competitor prices and claims no saving

- **Kivo's audience pays nothing for Notion.** Bennett students get Notion Plus free, so adding its $10 to an "alternative cost" would be untrue for exactly the people the page is for.
- **No INR prices exist** on any of the three pages, and some show annual billing per month. A rupee total would need conversions and assumptions that the brief rules out.
- **Kivo does not fully replace any of them.** Xmind and Readwise do far more in their own field. Kivo's value is that one place knows what you study and connects the map, notes, reading, planning, focus and your AI assistant.

## What was built instead

`ValueSection` (`apps/web/components/landing/sections.tsx`, between Journey and Pricing):
- Seven things Kivo does today, each with the kind of tool it stands in for. It names no product and gives no price.
- What Plus adds, read from `plans.ts`: the price via `formatPrice`, the features from `PLANS.plus_monthly`. While Plus isn't on sale it shows "coming soon".
- It says Free covers all seven with smaller allowances, says no plan is unlimited, and states that Plus is charged in rupees.
- `landing.test.ts` holds it to no hard-coded prices, no competitor names and no saving claims.

## If the owner wants a priced comparison later

Use INR prices from each vendor's Indian checkout (inc. GST), dated, and the student prices (Notion free, Readwise −50%). Compare only one-to-one capabilities, and recheck before each release.
