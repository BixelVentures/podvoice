# Overdragelse: PodView UI-migrering (Codex eller Claude)

Status 11. nov. 2026: design og UI-kit er færdige og gennemgået (lærred v122, alle 108 tavler
gengivet uden fejl). Ingen produktkode er ændret endnu. Denne fil er startpunktet; detaljer står i
`CODEX-PLAN.md`, `MIGRATION-PLAN.md`, `AUDIT-2026-11-11.md` og `README.md`.

## Læs først
1. `AGENTS.md` i repo-roden (proces, review, bevis, udgivelse).
2. `CODEX-PLAN.md` → »Migreringsmodel« og »Den mest skånsomme vej«.
3. Lærredets side *UI-kit og principper*: `Kit-Tokens`, `Kit-Migrering` (komponent → `data-kit`), `Kit-Kontroller`.

## Ufravigelige regler (minimum af funktionsfejl)
- **Ét spor pr. PR:** tokens, én komponent eller én funktion. Aldrig blandet.
- **Spor A/B rører ikke JS-logik, kommandoer, tekster eller DOM**, der bærer en handling.
  Kun CSS. Kroge: `data-kit*`, `data-tone`, `aria-*`, `--pv-*`, og hvor de mangler (index.html har ingen
  `data-kit`; widget-/layout-CSS er ID-baseret) de **eksisterende ID'er/klasser**. Ny markup = spor C.
- **v1-filer røres ikke.** `podview.css`, `ui-kit.css` m.fl. forbliver byte-identiske. Al v2 ligger i en
  separat `podview-v2.css`, som kun indlæses når flaget er sat. **Ingen `@layer`** (v1 har hundredvis af
  `!important`, som et senere lag ikke kan slå, og ældre WebViews dropper lag-blokke). v2 skal derfor matche
  eller overgå v1's specificitet og selv bruge `!important` hvor v1 gør.
- **Flag:** URL-parameter `ui=v2` (samme mønster som `room`/`kiosk`) sætter `data-ui="v2"` og indlæser
  `podview-v2.css` før første tegning (ingen v1→v2-blink). iPad og Frameo får hver deres adresse.
  Tilbagerulning = fjern parameteren.
- **Tekster kommer fra produktet.** Ny kopi eller ny adfærd = spor C med egen beslutning.
- **Lærredets `.dc.html` er reference** (mål, farver, tilstande, tider) og kopieres ikke ind.
- **Udgivelse** kun via den normale proces (version + dansk CHANGELOG-post i samme commit, push til `main`).

## PR-rækkefølge
| # | PR | Spor | Indhold | Bevis før merge |
|---|---|---|---|---|
| 0 | Beslutningspost | 0 | aktiv post i `docs/STATUS.md` (krav i AGENTS.md) | ejer-OK |
| 0a | Adfærdskontrakt | 0 | hver handling → kommando, kortlagt fra lytterne i `widget-view.js`, robot-, bil-, live-kontrol- og afspillervisning (ikke `preview-scenes.js`, som kun har tilstande); plus pr. handlingselement: `hidden`, `disabled` og tryk-træf i midten | grøn på nuværende kode |
| 0b | Baseline-skærmbilleder | 0 | 1280×800 pr. tilstand, gemt som reference | — |
| 0c | Flag + v2-fil | 0 | `ui=v2`-parameter, tidlig indlæsning af tom `podview-v2.css`; byggescript og bibliotekssider (`setup.html`, `library.html`) får samme v2-fil så bibliotek og produkt ikke skilles; `!important`-oversigt over v1-selektorer, v2 rører | v1-filer byte-identiske, pixel-identisk uden flag |
| 1 | Tokens | A | værdier fra `Kit-Tokens` i v2-filen; skrift Schibsted Grotesk + IBM Plex Mono. Tests for palet (`check-ui-palette`) og typografi (`root-typography-contract`) udvides med en v2-gren, ikke slækkes. Tjek ur-placering (`measureText`) og `ui/motion.js`-højder med ny skrift | kontrakt grøn, v1 uændret |
| 2–10 | Komponenter | B | i rækkefølge: knap, kontakt, segment/chip, skyder, listerække, sektionstitel, kort/widget, hero, topbar, dialog, afspiller | én komponent pr. PR, visuel diff kun på den |
| 11+ | Sider | B | layout pr. side efter tavlen (Overblik → Foto-Ro → Vejr → Robot → Lys → Tesla → Musik → Radio → Opskrifter → Timer → Svar) | skærmbillede pr. tilstand ved siden af tavlen |
| C1… | Funktioner | C | én ad gangen, først »Markér trin færdigt« | egen beslutning, test og live-bevis |

Spor C-listen (kræver ny markup/logik, se `Kit-Migrering`): kompakt beskedlinje i hero, friskhedsmærke,
handlingsflade, rødt domænemærke i topbar, Robot »Mere ▾« + sticky-linje, nat-skærm 21–7,
Foto-Ro-karrusel, timer fra trin + timerchip, Cover Flow, −/+ antal, tom afspiller med forslag.

## Besluttede værdier
Musik koral #F6DCCB · skrift Schibsted + Plex (ingen Fraunces) · nat-skærm 21–7 ·
»Senest brugt« på timer i 6 t uden hop · Foto-Ro-kilde: delt iCloud-album (i HA-konfiguration) ·
karrusel 20 s / overtoning 1,2 s · hvide indgangswidgets (musik, radio, opskrift, svar).

## Definition af færdig pr. fase
Adfærdskontrakt grøn · `npm test` grøn · v1 pixel-identisk · v2 matcher tavlen · ingen ændring i
handlingstjeklisten.

## Beslutning 11. nov. 2026: komprimeret forløb (spor A/B)
Ejeren har valgt ét samlet live-døgn til sidst i stedet for et døgn pr. fase (≈26 dage).
- Hver PR kræver stadig: kontrakt grøn, `npm test` grøn, v1 pixel-identisk uden flag.
- PR'er merges løbende på arbejdsgrenen; **én samlet udgivelse** til `main` til sidst.
- Flaget tændes først i 24 t på iPad og Frameo (de skærme, ejeren bruger); alle andre skærme kører v1. Fejl = sluk flaget.
- Mekanisk arbejde (kortlægning, baseline, token-CSS) må køre på billigere modeller;
  kontrakt, lag, review og samling ejes af lead. Parallelle sessioner kun i egne worktrees
  og aldrig på samme filer. Ét uafhængigt review pr. PR (AGENTS.md); PR'erne er bundtet, så antallet er lille.
- Spor C er ikke omfattet og tages én ad gangen bagefter.
- Fase 0 (beslutningspost, kontrakt, baseline, flag + v2-fil) beskæres ikke.

## Fartplan (vedtaget 11. nov. 2026, ≈2½–4 t kode + 24 t live)
Bundtning: komponenter i 3 PR'er (kontroller · flader · topbar/dialog/afspiller), sider i 2 PR'er,
tokens lige efter 0c, ét adfærdsfokuseret review pr. PR, v2 tjekkes visuelt pr. side.
1. **Parallel fase 0:** 0b baseline og 0c flag + v2-fil køres samtidig med 0a kontrakt.
2. **Tokens ved siden af:** billig agent oversætter `Kit-Tokens` til v2-CSS mens 0a skrives.
3. **Berørt-kun før merge:** kontrakt + pixel-diff kun for de sider PR'en rører; fuld suite én gang til sidst.
4. **Ejer klar ved live-start:** lead melder tidspunkt; ejeren sætter flag/genindlæser iPad og Frameo.
5. **Layout følger komponenterne:** særskilt sidelayout kun for Overblik, Foto-Ro, Robot og Svar.
6. **v2 tjekkes mod tilstande, HA Green faktisk viser;** v1-baselinen dækker stadig alle tilstande.
7. **Tryk-gennemløb i rigtig browser** (1280×800, flag tændt): hver handling trykkes én gang og giver samme kommando som v1; fanger geometri-, berørings- og animationsfejl (`ui/touch-intent.js`, `ui/motion.js`, `ui/scroll-edges.js`), som kontrakt og »berørt-kun« ikke ser. Køres før live-døgnet.
8. **Udgivelse** kun når STATUS ikke har en åben hovedfejl (AGENTS.md); ellers venter den samlede udgivelse.
Uændret: adfærdskontrakt for alle handlinger, v1 pixel-identisk uden flag, kun CSS, flaget som nødbremse, 24 t live.
Revideret estimat efter audit: ≈3½–5½ t kode + 24 t live.

## Audit 11. nov. 2026 (Fable 5.2, snæver, statisk)
Underkendte den første version: `@layer` mod v1's `!important`, ingen flag-krog pr. skærm, ingen
kommandoer i `preview-scenes.js`, manglende `data-kit` i index.html, skrift/tokens rammer JS-målinger og
eksisterende tests, review-bundter i strid med AGENTS.md. Alle punkter er indarbejdet ovenfor.
