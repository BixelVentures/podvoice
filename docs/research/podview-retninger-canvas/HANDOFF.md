# Overdragelse: PodView UI-ombygning (Codex eller Claude)

Status 11. nov. 2026: design og UI-kit er færdige på lærredet (v122, 108 tavler uden fejl). Ingen
produktkode er ændret. Beslutning: **ombygning, ikke ny hud.** Vi skifter direkte uden flag.
Denne fil er den gældende plan; `CODEX-PLAN.md`s flag-/CSS-model er erstattet.

## Mål (ejerkrav 11. nov. 2026)
1. **Produktet ender 100 % som det godkendte lærred:** layout, farver, typografi, tilstande, tekster,
   animationer, transitioner, timing og alle spor C-funktioner. Afvigelser kræver ejerens godkendelse;
   uspecificeret adfærd opfindes ikke, men løftes som spørgsmål.
2. **Bedre kode og ét system, ingen levn:** ét UI-kit, ét token-sæt, ét bibliotek; ikke klippe-klister.
3. **Ingen funktionsfejl:** alle brugerhistorier virker som før, bevist af tests.

## Målarkitektur
Pr. side tre adskilte dele:
- **Tilstand:** henter og normaliserer data fra HA/gatekeeper. Ingen DOM.
- **Handlinger:** sender kommandoer. **Genbruges uændret** fra nuværende kode (flyttes, omskrives ikke),
  så kommandoer og fejlhåndtering bevares.
- **Visning:** ren funktion af tilstand → DOM, bygget **kun** med kit-komponenter fra `ui/kit.js`.
  Ingen kommandoer, ingen fetch, ingen håndskrevne styling-ID'er.

Fælles:
- **Ét token-sæt** `--pv-*` (fra `Kit-Tokens`): eneste kilde til farve, skrift, afstand, radius, skygge, bevægelse.
- **Ét komponentlag:** hver kit-komponent har én implementering (markup + CSS + bevægelse). Kittet udvides
  med de typer lærredet bruger og kittet mangler i dag (afspiller, widget/kort, segment, hero, ark, beskedlinje m.fl.).
- **`index.html` er en tom skal**; al UI tegnes af visningslaget.
- **Ét bibliotek:** `library.html` viser præcis produktets komponenter (AGENTS.md). Lærredets kit-tavler og
  produktets kit er samme sandhed.
- Ved slut er `ui/legacy-components.css`, `widget-redesign.css`, `frame-layout.css`, `widget-view.css`,
  `live-music.css`, `timer-notice.css` og den gamle `ui-kit.css`-masse væk eller opløst i kit/tokens.

## Teknisk fundament (lead-beslutning 11. nov. 2026)
- **Udseendet er afgjort af lærredet.** Lærredets kit-tavler *er* UI-kittet: tokens, komponenter, tilstande, bevægelse.
- **Under motorhjelmen** bygges kittet på en lille, etableret komponentmotor (Lit eller Preact), bundtet lokalt
  i add-on'et (ingen CDN). Det erstatter håndskrevet DOM og den hjemmelavede `ui/kit.js`-mekanik.
- **Ikke** et færdigt stylet kit (Shoelace/Material/Ionic): det ville kæmpe mod lærredets udseende.
- **Første skridt i fase 1:** mål Frameoens browser (lille testside åbnes én gang på Frameo og iPad).
  Resultatet afgør Lit vs. Preact og hvilke CSS-/JS-funktioner kittet må bruge.

## Læs først
1. `AGENTS.md` i repo-roden (proces, review, bevis, udgivelse).
2. Lærredets side *UI-kit og principper*: `Kit-Tokens`, `Kit-Migrering`, `Kit-Kontroller` m.fl.

## Regler (minimum af funktionsfejl)
- **Én side pr. PR** (eller én kit-komponent / én funktion). Den gamle kode for siden slettes i samme PR.
- **Handlinger flyttes, omskrives ikke.** Ændret kommando-adfærd = egen beslutning og egen PR.
- **Grænsevagt i CI:** visningsmoduler må ikke importere fetch/kommando-kode; handlingsmoduler må ikke
  røre DOM; ingen rå farver/skrifter/varigheder uden for tokens; ingen nye CSS-filer uden for kittet;
  ingen `!important` uden begrundelse.
- **Tekster kommer fra produktet.** Lærredets `.dc.html` er reference og kopieres ikke ind.
- **Tilbagerulning** = udgiv forrige version igen.
- **Udgivelse** kun via normal proces (version + dansk CHANGELOG i samme commit, push til `main`), og kun
  når `docs/STATUS.md` ikke har en åben hovedfejl.

## Rækkefølge
| # | Indhold | Bevis før merge |
|---|---|---|
| 0 | Beslutningspost i `docs/STATUS.md` (krav i AGENTS.md) | ejer-OK |
| 0a | **Adfærdskontrakt ved grænsen:** (a) hver handling → kommando, kortlagt fra lytterne i `widget-view.js`, robot-, bil-, live-kontrol- og afspillervisning; (b) hver tilstand → synligt indhold. Pr. handlingselement: synligt, ikke `disabled`, tryk i midten rammer det. Testene finder elementer via rolle/tilgængeligt navn, ikke ID/klasse, så de overlever ombygningen. Huller lukkes med Playwright-tests | grøn på nuværende kode; dækningsliste uden huller |
| 0b | **Lærredsmatrix + bevægelseskatalog** (script, se nedenfor) og baseline-skærmbilleder af i dag | — |
| 1 | **Fundament:** tokens + skrift (Schibsted Grotesk + IBM Plex Mono), udvidet `ui/kit.js` med alle lærredets komponenttyper inkl. bevægelse, biblioteket opdateret, grænsevagt i CI. Palet- og typografitests omskrives til tokens | kit-tests + bibliotek mod kit-tavlerne |
| 2 | **Sider, én ad gangen** (Overblik → Foto-Ro → Vejr → Robot → Lys → Tesla → Musik → Radio → Opskrifter → Timer → Svar): tilstand / handlinger / visning, gammel kode slettes. Sidens spor C-funktioner bygges i egne PR'er lige efter siden | kontrakt grøn, matrix grøn for siden |
| 3 | **Udgivelse 1** efter de første sider (fx Overblik, Foto-Ro, Vejr, Robot) + 24 t live på iPad og Frameo | ingen regression |
| 4 | Resten af siderne og spor C | som 2 |
| 5 | **Slutoprydning:** CSS-coverage over hele suiten, slet døde selektorer/filer/tokens | matrix og kontrakt uændret grønne; ingen levn |
| 6 | **Udgivelse 2** + 24 t live på iPad og Frameo | matrix 100 % grøn |

Spor C-funktioner (bygges med deres side): kompakt beskedlinje i hero, friskhedsmærke, handlingsflade,
rødt domænemærke i topbar, Robot »Mere ▾« + sticky-linje, nat-skærm 21–7, Foto-Ro-karrusel, timer fra trin
+ timerchip, Cover Flow, −/+ antal, tom afspiller med forslag, »Markér trin færdigt«.

## Lærredsmatrix (kilde til »100 %«)
Genereres af script fra lærredets `.dc.html` + `canvas.json` (få tokens). Én række pr. tavle × tilstand:
tavle → produktskærm + tilstand → Playwright-test → skærmbillede ved tavlen → status (match / afvigelse godkendt).
- **Bevægelseskatalog:** scriptet udtrækker alle `transition`, `@keyframes`/`animation` og
  `prefers-reduced-motion` fra tavlerne (48 tavler har bevægelse, fx tryk `.12s`, indgang `.42s`,
  ark `.28s`, bekræftelse `.4s`, karrusel 20 s / 1,2 s). Hver post bliver en kit-bevægelse med Playwright-test
  på styret ur: element, varighed, kurve, sluttilstand og `animation:none` ved reduceret bevægelse.

## Testmodel (deterministisk, Playwright 1.62)
- Tryk → kommando og tilstand → skærm for alle handlinger, mod fake-servere i `tests/browser/`
  (lys, musik, radio, opskrift, robot, svar, hjem). Uafhængigt af bil, robot eller Spotify.
- Tidsafhængigt (nat-skærm, karrusel, »Senest brugt« 6 t) med styret ur.
- Køres på Mac/CI, ikke på HA Green. Live-døgnene dækker de rigtige enheder.
- Eksisterende tests med ID-/klasse-selektorer flyttes til rolle/navn i 0a; skærmbillede-referencer
  opdateres bevidst pr. side, aldrig ved at slække testen.
- Ingen computer use til verifikation; agenter læser kun testfejl.

## Fart
- 0a og 0b parallelt; fundamentet (1) kan starte, når 0a er grøn.
- Sider i egne worktrees parallelt (2–3 ad gangen), aldrig samme filer; merges én ad gangen bag kontrakten.
- Billigere modeller til mekanisk arbejde (kortlægning, matrix, tokens); arkitektur, review og samling ejes af lead.
- Ét uafhængigt review pr. PR. Ejeren er klar ved live-start.

**Estimat:** ≈30–50 t kode i alt + 2 × 24 t live.

## Besluttede værdier
Musik koral #F6DCCB · Schibsted + Plex (ingen Fraunces) · nat-skærm 21–7 · »Senest brugt« på timer
i 6 t uden hop · Foto-Ro: delt iCloud-album (HA-konfiguration) · karrusel 20 s / overtoning 1,2 s ·
hvide indgangswidgets (musik, radio, opskrift, svar).

## Historik
- Plan 1 (flag + `@layer`) underkendt af Fable 5.2-audit: v1's mange `!important` slår senere lag, ingen
  flag-krog pr. skærm, ingen kommandoer i `preview-scenes.js`.
- Plan 2 (kun CSS, direkte skift) forkastet af ejeren: giver samme arkitektur som i dag.
- Plan 3 (denne): ombygning med adskilt tilstand/handlinger/visning og ét kit.
