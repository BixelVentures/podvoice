# Overdragelse: PodView UI-ombygning (Codex eller Claude)

Status 11. nov. 2026: design og UI-kit er færdige på lærredet (v122; ≈94 skærmtavler på siden *Skærme*,
resten er arkiv/principper). Ingen produktkode er ændret. Beslutning: **ombygning, ikke ny hud**, direkte
skift uden flag. Planen dækker kun kodearbejdet. Denne fil er den gældende plan; `CODEX-PLAN.md`s
flag-/CSS-model er erstattet. Revideret efter tre Fable 5.2-audits (se Historik).

## Mål
1. **100 % som det godkendte lærred:** layout, farver, typografi, tilstande, tekster, animationer,
   transitioner, timing og alle spor C-funktioner. Afvigelser kræver ejerens godkendelse; uspecificeret
   adfærd opfindes ikke, men løftes som spørgsmål.
2. **Bedre kode, ét system, ingen levn:** ét UI-kit, ét token-sæt, ét bibliotek.
3. **Ingen brudte brugerhistorier**, bevist af tests.

## Målarkitektur
Pr. side:
- **Tilstand:** henter og normaliserer data. Ingen DOM.
- **Handlinger:** sender kommandoer; flyttes uændret fra nuværende kode.
  **Undtagelse:** `live-control-view.js` (ejer næsten alle kommandoer; stale-command-værn bundet til
  DOM-identitet) bevares som den er bag en tynd adapter og er undtaget fra grænsevagtens DOM-regel.
  En senere opdeling er en egen beslutning.
- **Visning:** ren funktion af tilstand → DOM, kun med kit-komponenter. Ingen kommandoer, ingen fetch.

Fælles:
- **Kit:** lærredets kit-tavler *er* kittet. Implementeres som Preact-komponenter (vendoret i `dist/`,
  bundtet lokalt, konservativt build-target fx es2017). Erstatter den håndskrevne DOM og `ui/kit.js`-mekanikken;
  `ui/kit.js` udfases. Ikke et færdigt stylet kit.
- **Ét token-sæt** `--pv-*` (fra `Kit-Tokens`) for farve, skrift, afstand, radius, skygge, bevægelse.
- **Skrift:** Schibsted Grotesk + IBM Plex Mono, self-hosted med licens/proveniens som Inter i dag
  (`assets/fonts`); Inter fjernes.
- **`index.html` er en tom skal.** `library.html` viser præcis produktets komponenter (AGENTS.md).
- **Ved slut slettet eller opløst i kit/tokens:** `ui-kit.css`, `ui/components.css`, `ui/legacy-components.css`,
  `ui/library/library.css`, `widget-redesign.css`, `frame-layout.css`, `widget-view.css`, `live-music.css`,
  `timer-notice.css`.

## Læs først
1. `AGENTS.md` (proces, review, bevis, udgivelse).
2. Lærredets side *UI-kit og principper*: `Kit-Tokens`, `Kit-Migrering`, `Kit-Kontroller` m.fl.

## Regler
- **Integrationsgren:** alt arbejde merges til `podview-rebuild` (ikke `main`). Hvert push til `main` udgiver
  (`.github/workflows/ci.yml` `publish-addon`) og kræver kandidat-scope-admission (`scripts/candidate_scope_admission*.py`).
  Derfor præcis **to** merges til `main`, hver med egen admission, version og dansk CHANGELOG.
- **PR-størrelse:** én kit-komponentgruppe, én side eller én spor C-funktion pr. PR. Parallelle spor laver flere PR'er
  efter hinanden, ikke flere sider i én PR.
- **Genererede filer** (`podview.css`, `podview.bundle.js`, `library.bundle.js`, `asset-manifest.json`, asset-pins)
  committes kun af lead ved merge; spor 2/3 committer dem aldrig.
- **Grænsevagt i CI:** visning må ikke importere fetch/kommando-kode; handlingsmoduler må ikke røre DOM
  (undtagen `live-control-view.js`); ingen rå farver/skrifter/varigheder uden for tokens; ingen nye CSS-filer uden
  for kittet; ingen `!important` uden begrundelse. Ingen eksisterende gate slækkes; komponent-gaten
  (`scripts/check-component-library.mjs`) omlægges én gang i fundamentet.
- **Tekster kommer fra produktet.** Lærredets `.dc.html` er reference og kopieres ikke ind.
- **Tilbagerulning** = udgiv forrige version igen.
- **Første merge til `main`** først når `docs/STATUS.md` ikke har åbne blokeringer (pt. Robot-UI visuel accept,
  Candidate140 CI/publicering).

## Testmodel
- **Kontrakt = netværk + synlig tekst:** hver handling → kommando; hver tilstand → synligt indhold; pr.
  handlingselement: synligt, ikke `disabled`, tryk i midten rammer det. Ingen ID-/klasse- eller host-internals-
  assertions. Rolle-/navnselektorer kommer først efter a11y-PR'en (se trin 0c).
- **Playwright 1.62** mod fake-servere i `tests/browser/`; udvides med bil (lås/oplås), egen robot-server, vejr.
  Tidsafhængigt (nat-skærm, karrusel, »Senest brugt« 6 t) med `page.clock` (ny infrastruktur).
- **Kun de 24 Playwright-filer** skrives om til netværk + tekst.
- **Slet-regel for node-tests:** en test i `tests/podview` må kun slettes i en PR, hvor dækningslisten mapper
  netop den fil til en navngiven kontrakttest, der er grøn på den gamle kode og fejler når adfærden brydes.
  Findes en sådan ikke, porteres eller skrives den først. Reviewer kontrollerer mappingen.
  Særligt: udløb, genopretning, stale intent og fornyelse.
- Køres på Mac/CI, ikke på HA Green. Ingen computer use til verifikation; agenter læser kun testfejl.

## Lærredsmatrix
Script fra `.dc.html` + `canvas.json`, kun skærmtavler. Én række pr. tavle × tilstand:
tavle → produktskærm + tilstand → Playwright-test → skærmbillede ved tavlen → status (match / afvigelse godkendt).
Tavler uden produktmodstykke i dag (`Foto-Nat`, `Opskrifter-Bog`/Cover Flow, `Opskrift-TimerKoerer`,
`Vejr-Shadere`, Foto-Ro-karrusel) er spor C.
**Bevægelseskatalog:** alle `transition`, `@keyframes`/`animation`, `prefers-reduced-motion` fra tavlerne
(48 tavler). Hver post bliver en kit-bevægelse (token) med Playwright-test på styret ur: element, varighed,
kurve, sluttilstand, `animation:none` ved reduceret bevægelse.

## Rækkefølge og parallelle spor
| Bølge | Spor 1 (lead) | Spor 2 | Spor 3 | Bevis |
|---|---|---|---|---|
| 0 | Beslutningspost i `docs/STATUS.md`: integrationsgren, PR-model, parallelle worktrees, nye scripts, Preact, `live-control-view.js`-undtagelse | — | — | ejer-OK |
| A | 0a kontrakt (netværk + tekst) + dækningsliste | 0b matrix, bevægelseskatalog, `page.clock` | fake-servere: bil, robot, vejr | kontrakt grøn på nuværende kode |
| A2 | 0c a11y-PR: dublerede navne (»Luk«, »Forrige nummer« …), `aria-checked` uden rolle | — | — | kontrakt grøn |
| B | Fundament: Preact vendoret, build-target, komponent-gate, grænsevagt | tokens + skrift (self-hosted) | kit-komponenter fra kit-tavlerne | kit-tests, bibliotek mod kit-tavlerne |
| C | Skabelon: Overblik, derefter Lys (seriel) | — | — | kontrakt + matrix grøn for siden |
| D | review + merge | Foto-Ro, Vejr, Robot, Tesla | Musik, Radio, Opskrifter, Timer, Svar | pr. side: kontrakt + matrix grøn |
| E | **Udgivelse 1** til `main` (alle sider, uden spor C) | spor C del 1 | spor C del 2 | admission + fuld suite grøn |
| F | Slutoprydning (CSS-coverage, slet døde filer/tokens) + **udgivelse 2** | — | — | matrix 100 % grøn, ingen levn |

Spor C-funktioner (én PR hver, med tests og bevægelse): kompakt beskedlinje i hero, friskhedsmærke,
handlingsflade, rødt domænemærke i topbar, Robot »Mere ▾« + sticky-linje, nat-skærm 21–7, Foto-Ro-karrusel,
timer fra trin + timerchip, Cover Flow, −/+ antal, tom afspiller med forslag, »Markér trin færdigt«.

Spor 2/3 kører i egne worktrees på billigere modeller; kun lead merger, én PR ad gangen bag kontrakten.

## Estimat
≈50–75 t kode; ≈25–40 t kalendertid med 2–3 parallelle spor. Største usikkerhed: triage af 309 node-tests
(slet-reglen), ≈94 tavletilstande + 48 bevægelsestests, og seriel lead-tid ved merge/admission.
(Tidligere estimat 35–50 t blev underkendt i audit 3 som for optimistisk.)

## Besluttede værdier
Musik koral #F6DCCB · Schibsted + Plex (ingen Fraunces, Inter udfases) · nat-skærm 21–7 · »Senest brugt«
på timer i 6 t uden hop · Foto-Ro: delt iCloud-album (HA-konfiguration) · karrusel 20 s / overtoning 1,2 s ·
hvide indgangswidgets (musik, radio, opskrift, svar).

## Frameo
Ikke købt/rootet (tænkt model Denver PFF-1037W, 10,1"). Uden for denne plan. Kittets konservative
build-target gør, at den ikke er en forudsætning.

## Historik
- Plan 1 (flag + `@layer`) underkendt af audit 1: v1's `!important` slår senere lag, ingen flag-krog pr.
  skærm, ingen kommandoer i `preview-scenes.js`.
- Plan 2 (kun CSS, direkte skift) forkastet af ejeren: samme arkitektur som i dag.
- Plan 3 (ombygning) justeret efter audit 2: `live-control-view.js` bag adapter, kontrakt på netværk + tekst,
  build/gates, matrix-afgrænsning, AGENTS/STATUS.
- Audit 3: selvmodsigelser ryddet; integrationsgren + to admissions (hvert push til `main` udgiver);
  genererede filer kun af lead; self-hostede skrifter; slet-regel for tests; estimat hævet.
