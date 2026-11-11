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
  Kun CSS på de eksisterende kroge: `data-kit`, `data-kit-variant`, `data-kit-identity`, `data-tone`, `aria-*`, `--pv-*`.
- **Alt nyt bag flaget** `<html data-ui="v2">`; nuværende CSS i `@layer pv-v1`, nyt i `@layer pv-v2`.
  Uden flag skal produktet være pixel-identisk med i dag. Tilbagerulning = sluk flaget.
- **Tekster kommer fra produktet.** Ny kopi eller ny adfærd = spor C med egen beslutning.
- **Lærredets `.dc.html` er reference** (mål, farver, tilstande, tider) og kopieres ikke ind.
- **Udgivelse** kun via den normale proces (version + dansk CHANGELOG-post i samme commit, push til `main`).

## PR-rækkefølge
| # | PR | Spor | Indhold | Bevis før merge |
|---|---|---|---|---|
| 0a | Adfærdskontrakt | 0 | test pr. side: hver handling → kommando, ud fra `preview-scenes.js` | grøn på nuværende kode |
| 0b | Baseline-skærmbilleder | 0 | 1280×800 pr. tilstand, gemt som reference | — |
| 0c | Flag + lag | 0 | `data-ui`-flag (sættes pr. skærm i HA), `@layer pv-v1` omkring nuværende CSS, tom `pv-v2` | pixel-identisk uden flag |
| 1 | Tokens | A | værdier fra `Kit-Tokens` i `pv-v2`; skrift Schibsted Grotesk + IBM Plex Mono | kontrakt grøn, v1 uændret |
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
  og aldrig på samme filer. Review i bundter af 3–4 PR'er.
- Spor C er ikke omfattet og tages én ad gangen bagefter.
- Fase 0 (kontrakt, baseline, flag + lag) beskæres ikke.
