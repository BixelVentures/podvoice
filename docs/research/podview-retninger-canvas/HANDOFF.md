# Overdragelse: PodView UI-migrering (Codex eller Claude)

Status 11. nov. 2026: design og UI-kit er færdige (lærred v122, 108 tavler uden fejl). Ingen
produktkode er ændret. Beslutning: **vi skifter UI direkte, uden flag.** Detaljer i `CODEX-PLAN.md`,
`AUDIT-2026-11-11.md` og `README.md`.

## Mål (ejerkrav 11. nov. 2026)
**Produktet skal ende 100 % som det godkendte lærred:** layout, farver, typografi, tilstande, tekster,
**animationer, transitioner og timing**, og alle spor C-funktioner. Intet er »færdigt«, før lærredsmatricen
er grøn. Afvigelser kræver ejerens godkendelse; uspecificeret adfærd opfindes ikke, men løftes som spørgsmål.

**Slutbillede: ét UI-kit og ét design system, ingen levn.** I dag ligger styling spredt i 13 CSS-kilder
(bl.a. `ui-kit.css` 2 776 linjer, `widget-redesign.css` 1 255, `ui/components.css`, `ui/legacy-components.css`,
`frame-layout.css`, `widget-view.css`, `live-music.css`, `timer-notice.css`; `podview.css` er bygget output).
Ved målet findes:
- **Ét token-sæt** (`--pv-*`, fra `Kit-Tokens`) som eneste kilde til farve, skrift, afstand, radius, skygge og bevægelse.
- **Ét komponentlag** pr. kit-komponent, og sidelayout der kun bruger komponenter og tokens.
- **Ét bibliotek:** `library.html`/`setup.html` viser præcis de samme komponenter som produktet (AGENTS.md).
- **Lærredets kit-tavler og produktets kit er samme sandhed**; ændres det ene, ændres det andet.

## Lærredsmatrix (kilde til »100 %«)
Genereres af script fra lærredets `.dc.html` + `canvas.json` (få tokens). Én række pr. tavle × tilstand:
tavle → produktskærm + tilstand → Playwright-test → skærmbillede ved tavlen → status (match / afvigelse godkendt).
- **Bevægelseskatalog:** scriptet udtrækker alle `transition`, `@keyframes`/`animation` og
  `prefers-reduced-motion` fra tavlerne (48 tavler har bevægelse, fx tryk `.12s`, indgang `.42s`,
  ark `.28s`, bekræftelse `.4s`, karrusel 20 s / 1,2 s). Hver post får en Playwright-test med styret ur:
  rigtigt element, varighed, kurve, slutstilstand, og `animation:none` ved reduceret bevægelse.
- Matricen er en del af beviset ved hver PR og ved den endelige udgivelse.

## Læs først
1. `AGENTS.md` i repo-roden (proces, review, bevis, udgivelse).
2. Lærredets side *UI-kit og principper*: `Kit-Tokens`, `Kit-Migrering`, `Kit-Kontroller`.

## Regler (minimum af funktionsfejl)
- **Spor A/B er kun CSS.** Ingen ændring i JS-logik, kommandoer, tekster eller DOM, der bærer en handling.
  Vi retter direkte i den nuværende CSS (`ui-kit.css`, `widget-redesign.css`, `frame-layout.css` m.fl.;
  `podview.css` genereres af `scripts/build-assets.mjs`). Selektorer: `data-kit*`, `data-tone`, `aria-*`,
  `--pv-*` og eksisterende ID'er/klasser. Ny markup eller adfærd = spor C.
- **Brugerhistorierne beskyttes af adfærdskontrakten og tryk-gennemløbet**, ikke af et flag.
- **Vagt:** et script i CI afviser en spor A/B-PR, der ændrer andet end CSS-filer og testreferencer.
- **Hvor CSS ikke kan nå lærredet** (fx manglende kroge i `index.html`), flyttes punktet til spor C med
  ny markup + tests. Det besluttes i matricen, ikke undervejs.
- **Tekster kommer fra produktet.** Lærredets `.dc.html` er reference og kopieres ikke ind.
- **Tilbagerulning** = udgiv forrige version igen (normal udgivelsesproces).
- **Udgivelse** kun via normal proces (version + dansk CHANGELOG i samme commit, push til `main`), og kun
  når `docs/STATUS.md` ikke har en åben hovedfejl.

## Rækkefølge
| # | Indhold | Bevis før merge |
|---|---|---|
| 0 | Beslutningspost i `docs/STATUS.md` (krav i AGENTS.md) | ejer-OK |
| 0a | **Adfærdskontrakt:** hver handling → kommando, kortlagt fra lytterne i `widget-view.js`, robot-, bil-, live-kontrol- og afspillervisning (`preview-scenes.js` har kun tilstande). Pr. handlingselement også: ikke `hidden`, ikke `disabled`, tryk i midten rammer det. **Hver handling uden dækning i `tests/browser/` (Playwright 1.62) får en Playwright-test her**, så al senere verifikation er scriptet og aldrig computer use | grøn på nuværende kode; dækningsliste handling → test uden huller |
| 0b | **Baseline-skærmbilleder** 1280×800 pr. tilstand (sammenligning, ikke krav om uændret) | — |
| 1 | **Tokens + skrift** (Schibsted Grotesk + IBM Plex Mono). Opdatér palet- og typografitests (`check-ui-palette`, `root-typography-contract`) bevidst. Tjek ur (`measureText`) og `ui/motion.js` | kontrakt grøn |
| 2 | **Komponenter, 3 PR'er:** kontroller (knap, kontakt, chip, skyder) · flader (listerække, sektionstitel, kort/widget, hero) · topbar, dialog, afspiller | kontrakt grøn, review |
| 3 | **Sider, 2 PR'er.** Særskilt layout kun for Overblik, Foto-Ro, Robot og Svar; resten følger komponenterne | kontrakt grøn, skærmbillede pr. side ved tavlen |
| 4 | **Tryk-gennemløb = eksisterende browser-suite** (`tests/browser/*_actual_e2e.cjs` med fake-servere for lys, musik, radio, opskrift, robot, svar, hjem; via `scripts/browser_gate.py`). Scriptet, ingen agent-klik eller skærmbilleder i kontekst; kun fejl læses. Mangler en handling, tilføjes den til suiten | alle grønne |
| 5 | **Udgivelse 1** (UI-skift), derefter 24 t live på iPad og Frameo | ingen regression i brugerhistorier; matrix grøn for spor A/B |
| 6 | **Spor C, alle funktioner (del af målet):** én PR pr. funktion med Playwright-tests og bevægelsestests i samme PR, først »Markér trin færdigt« | kontrakt + matrix grøn for funktionen |
| 7 | **Oprydning: ét kit.** Slet døde selektorer (Playwright CSS-coverage over hele suiten viser hvad der aldrig bruges), fjern gamle tokens og palet, fjern `!important` hvor kittet nu ejer reglen, læg `legacy-components.css`, `widget-redesign.css` og de små side-filer ind i kit-/side-lagene og slet dem. Ingen visuel ændring | matrix uændret grøn, kontrakt grøn |
| 8 | **Vogtere mod nye levn** (i CI): ingen rå farver/skrifter/varigheder uden for tokens, ingen nye CSS-filer uden for kittet, ingen `!important` uden begrundelse, ingen ubrugte selektorer | grøn |
| 9 | **Udgivelse 2** (spor C + oprydning) + 24 t live på iPad og Frameo | matrix 100 % grøn, ingen levn |

Spor C-listen: kompakt beskedlinje i hero, friskhedsmærke, handlingsflade, rødt domænemærke i topbar,
Robot »Mere ▾« + sticky-linje, nat-skærm 21–7, Foto-Ro-karrusel, timer fra trin + timerchip, Cover Flow,
−/+ antal, tom afspiller med forslag.

## Testmodel (deterministisk, Playwright)
- **Dækker:** tryk → kommando for alle handlinger, mod fake-servere i `tests/browser/` (lys, musik, radio,
  opskrift, robot, svar, hjem). Samme resultat hver gang, uafhængigt af bil, robot eller Spotify.
- **Tidsafhængigt** (nat-skærm 21–7, karrusel, »Senest brugt« 6 t) testes med styret ur (Playwright clock);
  manglende dækning tilføjes i 0a.
- **Køres på Mac/CI, ikke på HA Green** (ARM, Alpine, lidt hukommelse; Chromium hører ikke hjemme der).
  HA Green får kun den færdige udgivelse.
- **Ikke dækket af tests:** at de rigtige enheder udfører kommandoen. Det dækker 24 t live på iPad og Frameo.
- **Holder med nyt UI:** testene finder elementer via ID'er (≈340) og roller (≈60), som CSS-skiftet ikke rører.
  ≈40 klassebaserede selektorer gennemgås i 0a. Skærmbillede-referencer (fx `daily_ui.cjs`) opdateres
  bevidst pr. side-PR, aldrig ved at slække testen.
- **Spor C** leverer nye Playwright-tests (inkl. bevægelse) i samme PR som ny markup.
- **Ingen computer use** til verifikation; agenter læser kun testfejl.

## Fart
- 0a og 0b køres parallelt; en billig agent forbereder token-CSS imens.
- Før merge: kontrakt kun for berørte sider; fuld suite én gang før udgivelse.
- Billigere modeller til mekanisk arbejde; kontrakt, review og samling ejes af lead.
- Parallelle sessioner kun i egne worktrees og aldrig på samme filer. Ét uafhængigt review pr. PR.
- Ejeren er klar ved live-start (genindlæser iPad og Frameo).

**Estimat:** spor A/B ≈2½–4 t + 24 t live; spor C ≈12–20 t + 24 t live; matrix + bevægelseskatalog ≈1–2 t; oprydning + vogtere ≈3–5 t.

## Besluttede værdier
Musik koral #F6DCCB · Schibsted + Plex (ingen Fraunces) · nat-skærm 21–7 · »Senest brugt« på timer
i 6 t uden hop · Foto-Ro: delt iCloud-album (HA-konfiguration) · karrusel 20 s / overtoning 1,2 s ·
hvide indgangswidgets (musik, radio, opskrift, svar).

## Historik
Første plan (flag + `@layer`) blev underkendt af Fable 5.2-audit 11. nov.: v1's mange `!important`
slår senere lag, ingen flag-krog pr. skærm, ingen kommandoer i `preview-scenes.js`. Ejeren valgte
derefter at droppe flaget og skifte direkte.
