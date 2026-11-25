# PodView design parity: spec, decisions, gates (lead: Claude, 2026-11-25)

The design of record is the canvas "PodView Retninger" (`retninger/`). Find musik follows `find-musik/Hylder.dc.html` (B). The old wall page (`/private/tmp/pv-old`, :5199) is the reference implementation. Where the old page and the canvas disagree, the canvas wins.

## Architecture
- **`podview/src/ui` is the kit:** a 1:1 React port of `Kit-Tokens`, `K-Widget`, `K-Btn`, `K-Switch`, `K-Notice`, `K-Fresh`, `K-ActionTile`, `A-Topbar`, `A-Player`, the `Kit-Kontroller` controls (segment, slider, listrow, section title, icon key, dialog) and `A-Stemme` (the voice grille).
- **Screens only compose kit components.** A screen never builds its own look out of utilities. If a screen needs a pattern twice, it becomes a kit component.
- **Tokens** live in the Tailwind theme under the canvas names.
- **Motion** uses motion/react with the spring tokens, at the durations the canvas states.

## Decisions on what the design leaves open (lead decisions)
1. **Room choice:** it sits at the top of the player (»Stuen ⌄«). A tap opens a sheet in the »Afspil på« style that lists the rooms. The panel's multi-room screen »Højttalere i hjemmet« becomes that sheet, so the separate screen and the Hjem chip row go away.
2. **No page card:** the panel's extra page card with its own H1 is removed. The topbar title is the screen's title, as on the canvas.
3. **Titles follow the design:** Robotstøvsuger, Tesla, Afspiller, Opskrifter, and so on.
4. **Robot confirmation:** »Kør til basen?« uses the Kit-Kontroller dialog, which is already designed.
5. **Find musik search:** it stays, because it is a function. It is a 56 px kit search field above the shelves. The search design itself is parked on the canvas until the keyboard question is settled.
6. **Screen and device (A-Skaerm):** it is ported, because it exists in the design and is missing from the panel.
7. **Voice:** the Svar pill shows the grille phases (rest, listening, thinking, answering, follow-up) when the add-on exposes the phase. If it doesn't yet, the add-on gets a phase sensor.
8. **Topbar:** the running-timer chip and the red cross-domain alert badge are added, as on Kit-Topbar.
9. **Sizes:** the stage is 1180×820 and scales to fit. On a wider screen it is centred on the background colour, with no stray strip.

## Owner decisions on challenges (2026-11-25)
- Hjem keeps the weather in the topbar as well as in the Vejr widget, as on the canvas.
- **Changed:** while music plays, the Musik widget on Hjem shows a Find musik shortcut: today's AI pick (e.g. »Regnvejrs-jazz«) with its cover, and a tap opens Find musik. With nothing playing, it reads »Vælg musik« as before.
- **Changed:** the current song in the queue is shown in bold dark ink with the three animated sound bars, with no orange/coral accent. Coral is reserved for the timer.
- The full player stays on every sub-screen, including the empty state (Player-Tom).

## Quality gates (nothing reaches Green before all are green)
- **G1 visual parity:** every screen and every state, rendered with matched fixtures at 1180×820, is compared to the reference (the old page, or the canvas where the old page has none). The diff must be visually nil. Pairs and diff images are saved, and the reference PNGs are committed as test baselines, so drift can never return unnoticed.
- **G2 states:** every state listed below is reachable in the kit gallery or a fixture and has a screenshot.
- **G3 interactions:** every interaction listed below works and has a test or a recorded frame trace.
- **G4 motion and response:** a tap answers within 100 ms, nothing animates on first paint, there is no blink or layout jump, reduced motion is respected, and frames are measured.
- **G5 CI and Green:** CI is green before a merge (never merge on red), and the Green check is green after install.

## Checklist per area
### Kit
- [ ] Tokens: colours, type, radii, sizes S/M/L/player
- [ ] Widget × domain × state: vejr 3, robot 6, lys 4, tesla 5, musik 2(+playing), radio 4, opskrift 3, timer 5, svar 2. Also the live/rest/last-known/unavailable/error rules, »+N« and tone.
- [ ] Button: 7 variants × 56/44 × icon
- [ ] Switch
- [ ] Notice: full/compact × error/action/info, plus its lifecycle
- [ ] Fresh
- [ ] ActionTile: 5 tones (busy fill, done ✓)
- [ ] Controls: segment, slider (domain colour), listrow 48, section title 24/800, icon key 44, dialog
- [ ] Topbar: Ro / back + title / Svar / weather / clock / timer chip / alert badge
- [ ] Player: mine / radio / tom / anden konto / anden enhed / andet sted / optaget / offline; room chip; cover drift
- [ ] Voice grille: 5 phases

### Screens (the audit verdict is in brackets; source boards follow)
- [ ] Hjem / Overblik (different): Main, Overblik-Aktiv
- [ ] Ro (different): A-FotoRo, FotoRo-Aktiv, Foto-Nat
- [ ] Afspiller / Musik + kø + Afspil på (different): A-Player, Musik-Koe, A-MusikHjem
- [ ] Find musik (minor): Hylder
- [ ] Radio (different): A-Radio, Radio-Starter/Spiller/IkkeTilg
- [ ] Lys (different): A-Lys, Lys-Taendt/Slukket/Ukendt
- [ ] Vejr (different): A-Vejr, Vejr-Ukendt
- [ ] Timer (different) + alarm (minor): A-Timer, Timer-pause/faerdig, Timer-Alarm
- [ ] Robotstøvsuger (different): A-Robot, Robot-Rengoer/Pause/TilBasen/Fejl/Ukendt/Mere/Basen-*/Sticky*
- [ ] Tesla (moderate): A-Tesla, Tesla-Lader/Klima/Parkeret, Tesla-Handling-*
- [ ] Opskrifter + Opskrift (different): A-Opskrifter, Opskrifter-Bog, A-Opskrift, Opskrift-TimerKoerer
- [ ] Svar (different): A-Svar, A-SvarKort, Svar-*, SvarK-*, Svar-Historik
- [ ] Skærm og enhed (missing): A-Skaerm

## Order
1. Kit + Hjem + topbar + player (running).
2. Four parallel tracks on the kit:
   - (a) Robot + Tesla
   - (b) Lys + Radio + Vejr + Ro
   - (c) Afspiller/kø/Afspil på + Timer/alarm + Find musik polish
   - (d) Opskrifter + Svar + Skærm
3. Motion pass on top.
4. One release, installed on Green, followed by the Green check.
5. Robot gaps.
