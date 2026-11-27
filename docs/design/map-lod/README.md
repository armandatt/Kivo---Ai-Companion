# Knowledge Map: level-of-detail labels (28 Nov 2026)

Tiers from a topic card's width on screen (180 map units × zoom), `apps/web/components/nova/knowledge-map/lod.ts`:

| Tier | Card on screen | Zoom | What shows |
|---|---|---|---|
| Far | under 44px | under ~0.24 | Plain pills. Only the area names (region plates: dot + name; stats hidden); click flies in as before. A pill's name is its hover/focus tooltip. |
| Mid | 44–140px | ~0.24–0.78 | Every card's name **inside** it, one line at 10px, cut to the card. Plate stats return. |
| Close | 140px and up | ~0.78 and up | The full card (two-line name, status, counts). |

- Entered at 1.0× a threshold, left under 0.85×; names fade in over 120ms.
- The selected card, its connections and Find hits are named (inside their card) at every tier, also over the highlight layer.
- Nothing is drawn beside a card any more (the old placement is deleted).
- The 150-note draw cap is gone (`MAP_NOTES_MAX` 5000, a guard only).

## Frame time (local, Chrome, 1440×900; scripted zoom in/out + pan)

| Map | Cards drawn | p50 | p95 | worst | frames > 20 ms |
|---|---|---|---|---|---|
| Before (150-note cap) | 642 | 16.7 ms | 17.6 ms | 17.7 ms | 0 |
| After (all notes, every box named) | 1,032 | 16.7 ms | 17.0–17.5 ms | 17.7–17.8 ms | 0 (3 runs) |

1,032 cards is five times the 202-note account. Screenshots: `1-far.png`, `2-mid.png`, `3-close.png` (synthetic local account).
