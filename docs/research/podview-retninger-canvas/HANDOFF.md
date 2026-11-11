# Overdragelse: PodView UI-migrering (Codex eller Claude)

Status 11. nov. 2026: design og UI-kit er færdige (lærred v122, 108 tavler uden fejl). Ingen
produktkode er ændret. Beslutning: **vi skifter UI direkte, uden flag.** Detaljer i `CODEX-PLAN.md`,
`AUDIT-2026-11-11.md` og `README.md`.

## Læs først
1. `AGENTS.md` i repo-roden (proces, review, bevis, udgivelse).
2. Lærredets side *UI-kit og principper*: `Kit-Tokens`, `Kit-Migrering`, `Kit-Kontroller`.

## Regler (minimum af funktionsfejl)
- **Spor A/B er kun CSS.** Ingen ændring i JS-logik, kommandoer, tekster eller DOM, der bærer en handling.
  Vi retter direkte i den nuværende CSS (`ui-kit.css`, `widget-redesign.css`, `frame-layout.css` m.fl.;
  `podview.css` genereres af `scripts/build-assets.mjs`). Selektorer: `data-kit*`, `data-tone`, `aria-*`,
  `--pv-*` og eksisterende ID'er/klasser. Ny markup eller adfærd = spor C.
- **Brugerhistorierne beskyttes af adfærdskontrakten og tryk-gennemløbet**, ikke af et flag.
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
| 5 | **Én samlet udgivelse**, derefter 24 t live på iPad og Frameo | ingen regression i brugerhistorier |
| C… | Spor C-funktioner én ad gangen bagefter, først »Markér trin færdigt« | egen beslutning |

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
- **Spor C** leverer nye Playwright-tests i samme PR som ny markup.
- **Ingen computer use** til verifikation; agenter læser kun testfejl.

## Fart
- 0a og 0b køres parallelt; en billig agent forbereder token-CSS imens.
- Før merge: kontrakt kun for berørte sider; fuld suite én gang før udgivelse.
- Billigere modeller til mekanisk arbejde; kontrakt, review og samling ejes af lead.
- Parallelle sessioner kun i egne worktrees og aldrig på samme filer. Ét uafhængigt review pr. PR.
- Ejeren er klar ved live-start (genindlæser iPad og Frameo).

**Estimat:** ≈2½–4 t kode + 24 t live.

## Besluttede værdier
Musik koral #F6DCCB · Schibsted + Plex (ingen Fraunces) · nat-skærm 21–7 · »Senest brugt« på timer
i 6 t uden hop · Foto-Ro: delt iCloud-album (HA-konfiguration) · karrusel 20 s / overtoning 1,2 s ·
hvide indgangswidgets (musik, radio, opskrift, svar).

## Historik
Første plan (flag + `@layer`) blev underkendt af Fable 5.2-audit 11. nov.: v1's mange `!important`
slår senere lag, ingen flag-krog pr. skærm, ingen kommandoer i `preview-scenes.js`. Ejeren valgte
derefter at droppe flaget og skifte direkte.
