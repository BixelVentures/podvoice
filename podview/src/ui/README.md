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
| `ActionTile` | K-ActionTile | `tone` calm, attention, busy (fills from the left, dots), done (✓ pops), error; `height` (A-Tesla's 196), `isDisabled`. |
| `Topbar` | A-Topbar, Kit-Topbar, A-Stemme | Ro or back + title (`onClock` makes the clock the key to Skærm og enhed), Svar with the voice grille (`voice` rest/ripple/sweep/voice/chat), weather, clock and date, the running-timer chip and the red alert badge (they drop in). |
| `Player` | A-Player, Player-* | `mode` mine, away, other, radio, idle, offline; the room key on top (`picker`); the cover's tone drifts behind it while it plays; `takeOver` for Player-Optaget. Presentational: every press is the caller's. |
| `Segment` | Kit-Kontroller | One choice among a few: `options` ({id, label}), `value`, `onChange`, `size` 44 or 56, `fill` (full width, equal parts), `weights` (A-Robot's Type 1.6/1/1), `dense` (narrow parts, 14 px). A radiogroup in a grey pill; the dark pill glides to the choice (quick spring). Named by `aria-label` or `aria-labelledby`. |
| `Slider` `variant="kit"` | Kit-Kontroller, A-Lys | The track 8 px in the domain's `tone` (ink, lys, robot, tesla, vejr), a white 28 knob (`compact`: 24, the level in 15 px mono), `showLabel` puts the label left (96). 44 hit area. A drag follows the finger 1:1 and sends once at the end; a change from outside glides the knob (quick spring). `value` null shows »—«. `min`/`max`/`format`/`onCommit` as the other variants. |
| `ListRow` `tone="line"`, `ListValue` | Kit-Kontroller | The 48 list row on a hairline, the label 17 and its value 15 grey. |
| `SectionTitle`, `SectionLabel` | Kit-Kontroller, A-Lys | A section's title 24/800 (`as` h2/h3/span) and its quiet 15/600 label (»Scener«). |
| `IconKey` | Kit-Kontroller | A round 44 key with one glyph (`icon`); it must name itself (`aria-label`). |
| `SwitchKey` | K-Switch, K-Kit »Kontakt« | The switch as its own control: the 56×34 mark in a 44+ hit area. `aria-label` says what a press does, `isSelected`, `onChange`, `isDisabled` (.4), `dim` (a source that is not current). |
| `Dialog` | Kit-Kontroller »Dialog (bekræft)« | An alertdialog: `title` (the question), `description`, `cancelLabel`, `confirmLabel`, `confirmVariant` primaer/fare, `confirmDisabled` (no link: the key dims), `onConfirm`, `onCancel`. K-Btn 56 keys right-aligned; Escape cancels; never pulled away. |
| `Modal` | Kit-Kontroller | The overlay under `Dialog` and `Sheet` (React Aria focus, inert page, Escape; a dismissable dialog is pulled down to close). Its look is the kit's dialog: radius 26, a 24/800 title; `variant="sheet"` is the sheet's. |
| `Sheet` | A-Skaerm, »Afspil på«, the sticky line's »Mere ▾« | 560 wide, a 28/800 title with a quiet line under it (`description`), its own round »Luk« (`closeLabel`), pulled down to close. Children are the content. |
| `Hero` | A-Lys »Ikke forbundet« | A domain that is not there: its tint (`tone`), the dot glow, `eyebrow`, `title`, `text`, one `action` at its foot; `size` S 221 or L 458. |
| `ToggleCard` | A-Lys rooms | A 128 card: a tap chooses it (`onSelect`, `isSelected` = 3 px ink ring), its `power` (SwitchKey props) powers it; `on` tints it. `tag`, `name`, `status` are the product's words. |
| `ChoiceTile` | A-Lys scenes | 72 high: `title` 19/800 and `meta` in mono (none when unknown); `isSelected` is dark; `isPending` (on its way) pulses the meta. |
| `DeviceRow`, `DeviceNote` | A-Lys lamps | A 48 row (`dot` on/off/unknown, `name`, `status`, `power`) with its own control under it (`children`, e.g. a compact kit slider); `DeviceNote` is the quiet line when there is no control. |
| `FoldRow` | A-Lys »Lamper ⌄« | A 56 row with a line above: `icon`, `title`, mono `count`, a chevron that turns; controlled `isExpanded`/`onExpandedChange`. |
| `GlowMaterial` | A-Lys hero | The hero's dot glow, in the text colour. |
| `StatusHero`, `HeroBig`, `HeroMetrics`, `ProgressCells` | A-Robot, A-Tesla | A domain page's hero: `variant` robot/tesla, `surface` (robot, robotActive, tesla, teslaLive), `size` S 221 or L 458, its `art`, `eyebrow`, `corner` (K-Fresh or the model), the big `title` (`titleTone` ink, danger, muted, teslaOn), `sub` or a compact `notice`, Tesla's `big` number and the `footer` (Robot: primary + »Mere ▾« + `ProgressCells`; Tesla: `HeroMetrics`). |
| `HeroArcs`, `HeroCar` | A-Robot, A-Tesla | The heroes' dot art at full size: the robot's arcs (`broken` on a fault, `running` breathes; colour by a fill class) and the car (`level` fills the body, `tone`; charging flows and only then, `warm` glows the cabin orange). |
| `MoreKey`, `ActionDrawer`, `ActionMenu` | A-Robot »Mere ▾«, Robot-Mere, Robot-Sticky-Mere | »Mere ▾« (56 ringed, white when open; 44 kant on the sticky line) and what it opens: `groups` of `MenuAction` (plain, fare, amber; an icon) as the fold under the hero (in 280 ms) or the menu under the sticky line. |
| `StickyLine` | Robot-Sticky* | The 72 line under the topbar when the hero has scrolled out (down 240 ms ease-out, radius 0/20): a dot, the hero's title and sub, its primary (K-Btn 44) and »Mere ▾«. Robot, Timer, Tesla and Opskrift (`surface` recipe). |
| `DotChip` | A-Robot rooms | A 64 room chip with its dot; chosen: the robot's tint and a 2 px ring. `isStatic` for »Denne tur«. |
| `OptionsCard`, `SettingRow` | A-Robot »Rengøringsvalg« | The options card and its rows: `main` (Type: 20/800, Segment 56) or fine-tuning (15/600 grey, 44). |
| `Stepper` | A-Tesla »Temperatur«, A-Opskrift | Round 48 −/+ in a grey pill around the value in mono; `muted`, `isPending`; `tone="recipe"` is A-Opskrift's portions (56 keys on the recipe's key colour in a ringed white field, 34 px number). |
| `MeterRow`, `EventRow` | A-Robot »Vedligehold«, »Seneste hændelser« | A counter with its 6 px bar (`due` is red), and an event (time in mono, title, detail, an `action`). |
| `RecipePhoto`, `ResumeBand`, `ResumeLine`, `RecipeCard` | A-Opskrifter | The source's photo (fades in once decoded, over the recipe ground); the 96 »I gang« band (one press, a dark »Fortsæt madlavning«); the 64 line on a recipe page while another is in progress (»Gå til«); the photo card on fixed lines (photo 150, title 2 lines 44, meta 20, the publisher badge and »I gang« on the photo). |
| `CoverFlow` | Opskrifter-Bog | Udforsk: the chosen cover flat (720×460), neighbours turned 55° (`coverPose`); a swipe follows the finger and settles with its momentum, a tap on a neighbour chooses it, on the chosen one opens it, arrow keys move; kicker/title/meta fixed under it (cross-fade), at most 7 dots in a sliding window (`coverDots`). |
| `RecipeHero`, `PortionStepper`, `RecipeTextKey` | A-Opskrift | The 221 hero (photo 160, label, title 40/800, facts) with its keys at the right; the portions (the kit `Stepper` in its recipe tone with the unit under it); the quiet »Nulstil opskrift«. |
| `CheckRow`, `StepRow`, `StepTimer` | A-Opskrift, Opskrift-TimerKoerer | An ingredient's 48 check row (box, amount in mono, brown when `scaled`, struck when found); a step (mark and words both press it done/back; current on the tint with a ring); a step's timer key (dark 56 »Start timer · 30 min« on the current step, grey 48 elsewhere) and its running chip (the topbar's chip). |
| `tapOnly`, `wasDrag`, `installTapGuard` | (all) | A press is a tap, never a drag's release: every kit press (Button, ToggleButton, Switch, Widget and the controls above) ignores a release that travelled more than 10 px. Use `tapOnly(handler)` for a press of your own. |
| `WeatherHero`, `WeatherDays`, `WeatherArt` | A-Vejr, Vejr-Ukendt | The full-colour hero (place, K-Fresh, 150-px temperature, condition, advice slot: pending/AI/plain, »Højst · Lavest«, compact notice, the hours with rain and wind under a fade), »De næste dage« with range bars, and the weather-type dot art. |
| `RadioHero`, `StationTile` | A-Radio, Radio-* | The L hero over the station scale (the red needle only while live, amber while starting; grey scale without a needle when unavailable; logo pop and needle growth on a later pick), and the station tiles ringed in the station colour. |
| `PhotoCarousel`, `RestClock`, `RestWeather`, `GlassCard`, `useRipples`/`Ripples`, `NightFace` | A-FotoRo, Foto-Nat | Ro's carousel (20 s, 1.2-s crossfade, newest first then random), the 168-px clock, the weather, the glass cards (a key only for music and radio), the tap ripple and the night screen. |
| `Shelf`, `ShelfTile`, `QuickPick`, `SearchBox` | Hylder | Find musik's shelves, cover tiles, the six quick picks and the 56-px search field. |
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
