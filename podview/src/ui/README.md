# PodView's kit (`podview/src/ui`)

The kit is a 1:1 React port of the design canvas »PodView Retninger« (Kit-Tokens, K-Widget, K-Btn, K-Switch,
K-Notice, K-Fresh, K-ActionTile, A-Topbar, A-Player, A-Stemme). Screens only compose these components; a pattern a
screen needs twice becomes a kit component here. React Aria Components carry behaviour and accessibility; Tailwind
utilities on the tokens in `styles/tokens.css` carry the look; motion is motion/react on `lib/motion/tokens.ts`.
The spec, the decisions and the gates are in `docs/PODVIEW-PARITY.md`.

| Component | Canvas | Use |
|---|---|---|
| `Widget` | K-Widget, W-* | `kind` (vejr, robot, lys, tesla, musik, radio, opskrift, timer, svar) × `state` (`WIDGET_STATES`), `size` S/M/L (the grid cell gives the box), `tone` farve/hvid, `more` (»+N«), `prim`, `ctx`, `alert`, `big` + `hours` (Vejr), `level` (Tesla), `steps` (recipe), `cover`/`logo`/`tile`/`ring`, `action` (a direct press of its own), `opens` (prewarm). One press. |
| `CloudMaterial`, `ArcsMaterial`, `BulbMaterial`, `CarMaterial` | K-Widget | The dot-matrix materials, computed from the canvas algorithm (deterministic SVG, dots snapped to whole pixels as the canvas painted them). Static states never move; running ones breathe (`animate-pv-*`), stilled by reduced motion. |
| `Button` | K-Btn | `variant` primaer, sekundaer, kant, fare, lys, moerk, alarm; `size` 56 or 44; `icon` (a glyph; alone it is a round key). The older variants (secondary, primary, quiet, danger) remain until every screen is on the kit. |
| `SwitchMark`, `Switch` | K-Switch | `SwitchMark` is the 56×34 look (the knob travels on the quick spring); `Switch` is the row that owns the press. |
| `Notice`, `NoticeSlot` | K-Notice | Levels fejl, handling, info, ok; full or `compact`. `NoticeSlot` is the lifecycle: one at a time, in 280 ms (12 px + fade, content pushed softly), out 220 ms (fade + collapse), info has ×, ok goes after 3 s. |
| `Fresh` | K-Fresh | »Opdateret …« for data older than 30 minutes; never »Sidst kendt«. |
| `ActionTile` | K-ActionTile | `tone` calm, attention, busy (fills from the left, dots), done (✓ pops), error. |
| `Topbar` | A-Topbar, Kit-Topbar, A-Stemme | Ro or back + title, Svar with the voice grille (`voice` rest/ripple/sweep/voice/chat), weather, clock and date, the running-timer chip and the red alert badge (they drop in). |
| `Player` | A-Player, Player-* | `mode` mine, away, other, radio, idle, offline; the room key on top (`picker`); the cover's tone drifts behind it while it plays; `takeOver` for Player-Optaget. Presentational: every press is the caller's. |
| `Glyph` | (all) | The canvas's own line and filled glyphs (`GLYPH`, `FILLED`). |

## Seeing it

`src/ui/gallery/KitGallery.tsx` shows every widget state, every player mode, the topbar variants, the voice
phases, the keys, switches, notices and action surfaces with the canvas's own sample content. The panel shows it at
`/podview/_kit` (the test host: `tests/browser/ha_panel/host.html?kit=1&safeTop=0px&safeBottom=0px`).
`tests/browser/ha_panel_screens.cjs` holds every piece to its baseline (`ha_panel/screens/kit-*.png`); the canvas's
own pictures of the same pieces are in `tests/browser/ha_panel/reference/` (G1).

## Rules

- Colours, radii, shadows and motion come from the tokens (`bg-pv-*`, `rounded-pv-*`, `shadow-pv-*`,
  `animate-pv-*`); a new colour is a new token named after the canvas.
- Nothing animates on first paint; a press answers at once (`pressable`: scale .97/.98, brightness .92 on the
  kit keys, 2 px down on the topbar keys); reduced motion stills every loop and turns moves into fades.
- Texts are the product's own; a component never invents a state.
