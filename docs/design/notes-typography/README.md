# Notes typography (bug batch 28 Nov, item 10): proposal

Shipped as its own commit so it can be dropped on its own.

| | Before | After (default) |
|---|---|---|
| Face | serif (ui-serif/Georgia) by default | system-ui (Inter where installed) |
| Size | 17px | 16.5px (S 15, M 16.5, L 18) |
| Line height | 1.8 | 1.65 |
| Measure | the column's width | at most 70ch |

- **Reading setting**: the "T" button on a note opens Font (Sans / Serif / Mono) and Size (S / M / L). Saved on the learner's profile (`NovaAcademicProfile.noteReading`, `GET/PUT /api/nova/notes/reading`) and remembered in the browser for the first paint.
- **Paste from ChatGPT**: rich clipboard HTML becomes Markdown (headings, bold/italic, lists, code, quotes, links, tables); inline fonts, sizes and colours are dropped. Plain text pastes as before.
- Headings keep their serif face as contrast.

Screenshots (1440×900, local test note): `before-serif-17.png`, `after-sans-m.png`, `after-serif-l.png`.
