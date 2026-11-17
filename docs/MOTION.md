# PodView — motion-system

Status: forslag. Forfattet 2026-11-16. Ingen produktkode er ændret.
Mål: bevægelse på niveau med en native iPadOS-app på vægskærmen (iPad Air 5, 1180×820, HA Companion,
WKWebView). Bevægelsen skal bygges af **få, faste dele**, der bruges ens overalt, som et UI-kit.

Dokumentet har fem afsnit:
1. Referenceanalyse af, hvordan iOS/iPadOS faktisk bevæger sig, med tal.
2. Detailanalyse af PodView i dag: lager af bevægelser, dom over hver og huller.
3. Motion-systemet: tokens og otte primitiver med præcis specifikation og API.
4. Katalog over mikrointeraktioner pr. skærm.
5. Implementeringsplan, teststrategi og risici.

Udstillingseksemplet er swipe i Opskrifter-kataloget. Det behandles som primitiv P9 i §3.10 og som
mikrointeraktion i §4.

## 0. Stakken (2026-11-17) — gælder før resten af dokumentet

Al bevægelse kører på compositoren; JavaScript må ikke skrive stil pr. frame eller skrive klasser/attributter ved et
tryk (stylesheetet har flere hundrede `:has()`-regler, så en klasse-skrivning kan restyle hele siden).

| Hvad | Hvordan | Hvor |
|---|---|---|
| Fjedre | Motions `spring()` (npm `motion`, MIT, `motion.source.txt`) giver CSS `linear()` + varighed til Web Animations. Kun `ui/native-motion.js` importerer Motion, og kun bundlet kode må bruge den | `ui/native-motion.js` |
| Tryk (P3) | Én delegeret capture-listener; Web Animations på den trykkede kontrol. Kort og fliser: kun skala .97 (ingen overlay, skygge eller farve; reduced: opacity .8). Knapper: skala .98 og 12 % overlay; dæmpning for stille kontroller; cirkel for flader. Ingen klasse, attribut eller inline-stil. Ned på `--pv-dur-tap` ease-out, afbrydelig fra aktuel skala; slip fjedrer kritisk dæmpet på `SPRING.quick` (ingen overshoot) efter resten af touch-down. I en scroller venter trykket som UIScrollView (`delaysContentTouches`, 150 ms, 10 px slop); hvilke forfædre der kan scrolle, læses én gang pr. kontrol | `ui/pressed-state.js` |
| Geometri-lås | Et tryk beder kun om låsen; næste `render()` måler og fryser | `SceneMotion.deferHold` |
| Udforsk (P9) | Native scroll-snap; hvert cover følger sin slots view timeline (`animation-range: cover 50% ± 3,5·430px`); keyframes = `exploreFrame` samplet (`exploreKeyframes`). JS kun ved skift af nærmeste cover og ved `scrollend`. Uden `animation-timeline`: flad snap-karrusel | `recipe-view.js`, `ui-kit.css` |
| Lister (P4) | FLIP: alle mål før alle skrivninger, Web Animations på `translate` med Motions fjedre | `ui/list-motion.js` |
| Sider (P1/P7) | Levende lag som UINavigationController (Ionic `ios.transition.ts`), ingen View Transition: den gamle side bevæger sig i næste frame (compositor), den nye renderes én gang to frames senere uden for skærmen, billeder afkodes, og den glider ind. Push: ny 100 % → 0 over den gamle, der går til −33 % under 10 % dæmpning; pop omvendt. 500 ms `cubic-bezier(.32,.72,0,1)`. Den gamle side forbliver monteret og malet (ude af flowet) til slut; en papirplade følger den øverste side. Et tryk fuldfører straks. Reduced: ny side toner ind i 200 ms. Hjems kort er egne lag (`will-change`), så et tryk ikke omlagrer siden. Hero (P7) bruger stadig View Transition | `ui/page-motion.js`, `SceneMotion.hero` |
| Ro ↔ aktiv | To levende lag, ingen View Transition: Ro-fotoet er et vedvarende dække i værten (`.pv-ro-cover`), en rund maske der skaleres (transform) med fotoet modskaleret indeni (WebKit compositer ikke clip-path). Hjem → Ro: cirklen vokser fra månen over Hjem i 560 ms `cubic-bezier(.45,0,.2,1)`; Hjem tegnes ikke om før dækket dækker; så renderes Ro under det, fotoet afkodes, og ur/player toner ind (200 ms). Ro → Hjem: Ros indhold toner ud (120 ms), Hjem renderes under fuldt dække, og en frame senere krymper cirklen ind i fingeren (480 ms). Reduced: dækket cross-fader i 200 ms | `ui/ro-motion.js` |
| Reduced | `:root[data-pv-motion=reduced]`: kun fades. Udforsks covers står fladt (scrollen flytter dem, ikke en animation) | |
| Global | `html{touch-action:manipulation}`; touch-intent læser kontrollens rect én gang pr. tryk | |

iOS-reference pr. interaktion (2026-11-17). Hvor PodView afviger, står det i kolonnen.

| Interaktion | iOS / afprøvet web-reference | PodView |
|---|---|---|
| Tryk i scroller | UIScrollView `delaysContentTouches` (~150 ms), `touchesShouldCancel` annullerer ved scroll | 150 ms hold, 10 px slop, annulleret tryk slutter uden fjeder |
| Tryk ellers | UIButton highlight / UICollectionViewCell, SwiftUI press | Kort: kun skala .97; knapper .98 + overlay; kritisk dæmpet fjeder ved slip |
| Side push/pop | UINavigationController; Ionic `ios.transition.ts`: 540 ms, `cubic-bezier(.32,.72,0,1)`, ny side ind fra 99,5 %, gammel ud til −33 % | Samme kurve, 500 ms; ingen fade (uigennemsigtige sider) |
| Ro ↔ aktiv | Ingen UIKit-pendant; krusning fra berøringspunktet (Material-ripple / iOS-kontrolcenterets »bloom«) | Cirkel fra månen (ind) og ind i fingeren (ud) som skaleret maske; begge skærme lever |
| Sheets | UISheetPresentationController; vaul/react-modal-sheet: fjeder uden bounce | P2 som §3.3 (`SPRING.smooth` ind, `--pv-dur-quick` ud) |
| Listeændring | UICollectionView batch updates (fjeder, ingen bounce) | P4 FLIP på `SPRING.smooth` |
| Fjedre | SwiftUI `spring(duration:bounce:)`; `.smooth` (bounce 0), `.snappy` (lille bounce), `.bouncy` | `SPRING.quick/smooth/snappy/flick` med samme duration/bounce-model |
| Scroll | Native momentum og rubber-band | Browserens egen scroll; intet JS pr. frame |

Kilder: [SwiftUI Animation](https://developer.apple.com/documentation/swiftui/animation),
[WWDC23 Animate with springs](https://wwdcnotes.com/documentation/wwdc23-10158-animate-with-springs/),
[Ionic ios.transition.ts](https://github.com/ionic-team/ionic-framework/blob/main/core/src/utils/transition/ios.transition.ts),
[UIScrollView-forsinkelse](https://coderwall.com/p/ojlywq/fix-touch-delay-on-controls-in-scroll-views).

Afløst og fjernet: `Spring`-klassen, `attachSwipeTrack`/`swipeTarget`/`swipeVelocity`, `rubberBand`/`project`,
`.is-pressed`/`data-pv-pointer-focus`/`data-pv-circle`, `SceneMotion.list`. `springCurve` lever videre kun til at
generere CSS-tokens (`scripts/gen-motion-tokens.mjs`). `@formkit/auto-animate` blev vurderet og fravalgt: den måler
hver række hvert 2. sekund i baggrunden og lytter globalt på scroll. Afsnit 2–5 nedenfor beskriver forslaget fra
2026-11-16 og er historik, hvor de strider mod tabellen.

---

## 1. Referenceanalyse: sådan bevæger iOS/iPadOS sig

### 1.1 Springs er standarden, ikke kurver

Siden iOS 17 beskriver Apple fjedre med to tal, som designere kan ræsonnere om:
**duration** (perceptuel varighed) og **bounce** (-1…1). Kilde: WWDC23 »Animate with springs«.

Omregningen til fysik (masse = 1), som brugt i dette dokument:

| | formel |
|---|---|
| stivhed | k = (2π / duration)² |
| dæmpningsforhold | ζ = 1 − bounce (for bounce ≥ 0) |
| dæmpning | c = 4π·(1 − bounce) / duration |

De vigtigste pointer fra sessionen:

- **bounce 0 er standarden.** Det er det, man får, når bounce ikke angives. Apple kalder det den mest
  alsidige fjeder.
- **Bounce omkring 0,15 føles endnu ikke hoppende. Bounce omkring 0,3 er tydeligt hoppende.** Apple
  advarer mod værdier over ca. 0,4 til UI-elementer.
- **Perceptuel varighed adskiller sig fra settling-tid.** `duration` er det tidspunkt, hvor
  bevægelsen *ser* færdig ud. Den matematiske ro-tilstand kommer senere, og man skal ikke vente på
  den med brugerrettet logik.
- **Springs er den eneste animationstype, der bevarer kontinuitet,** både fra hvile og med
  begyndelseshastighed. En fjeder, der retargetes midt i flugten, beholder sin aktuelle hastighed
  som begyndelseshastighed mod det nye mål. Det kaldes **velocity handoff**. SwiftUI sporer selv
  hastigheden, når en gesture ændrer en værdi.

**SwiftUI-presets.** Alle tre har duration 0,5 s og adskiller sig kun i bounce:

| preset | duration | bounce | overshoot (beregnet) | settling til 0,1 % (beregnet) |
|---|---|---|---|---|
| `.smooth` | 0,5 s | 0 | 0 % | 734 ms |
| `.snappy` | 0,5 s | 0,15 | 0,6 % | 696 ms |
| `.bouncy` | 0,5 s | 0,3 | 4,6 % | 818 ms |

`extraBounce:` lægger relativt til presetets bounce.

Kendte ældre værdier:
- `.spring()` før iOS 17: response 0,55 og dampingFraction 0,825.
- `.interactiveSpring()`: response 0,15, dampingFraction 0,86 og blendDuration 0,25. Den bruges til
  1:1-sporing under en finger.

UIKit bruger den samme model fra iOS 17: `UIView.animate(springDuration:bounce:initialSpringVelocity:)`.
Klassisk UIKit havde `usingSpringWithDamping:initialSpringVelocity:`, hvor damping svarer til ζ.

> Verifikation: værdierne i preset-tabellen er Apples dokumenterede defaults (duration 0,5) kombineret
> med bounce-værdierne fra SwiftUI-headerne. Overshoot og settling har jeg selv regnet ud med
> formlen ovenfor (scratchpad `spring.py`). Bekræft gerne `.snappy`/`.bouncy` i Xcode Quick Help,
> før tallene bruges som facit i en test.

**Systemets egne valg** (WWDC18 »Designing Fluid Interfaces«):
- **Tryk for at udvide** Music-minibaren bruger 100 % dæmpning, altså bounce 0.
- **Swipe for at lukke** bruger 80 % dæmpning, altså bounce 0,2. Princippet: *har gesten momentum, så
  belønnes det med lidt overshoot; uden overshoot føles et kast »i stykker«.*
- **Hysterese før et swipe** er »normalt 10 punkter i iOS«.

### 1.2 Præsentation: sheet, modal, push/pop

| overgang | adfærd i iOS/iPadOS | det vi kopierer |
|---|---|---|
| **Sheet / formSheet** (iPad) | Glider ind nedefra på en kritisk dæmpet fjeder på ca. 0,5 s. Backdrop dæmpes samtidig. Sheetet kan trækkes 1:1 og lukkes med et kast. Et halvt træk fjedrer tilbage med fingerens hastighed. | Dialog ind: translateY + opacity på `smooth`. Træk ned for at lukke med velocity-projektion (§3.3). |
| **Navigation push** | Ny side kommer ind fra højre i fuld bredde. Den gamle side går ca. 30 % til venstre (parallax) og dæmpes. Bevægelsen er fjeder-agtig og ca. 0,35–0,5 s. | En kortere version: ny side +48 px → 0 med opacity. Gammel side −24 px og fade (§3.2). |
| **Interaktiv pop** | Kant-swipe fra venstre trækker siden 1:1. Ved slip afgør position og hastighed, om man fuldfører eller annullerer, og bevægelsen fortsætter med fingerens hastighed. | PodViews kant-swipe har kun en 24 px »hint«-preview i dag. Det opgraderes til 1:1 (§3.2, PR 6). |
| **Afbrydelse** | Alle de nævnte kan afbrydes midt i flugten. Et nyt tryk eller en ny gesture overtager fra den aktuelle *præsentationsværdi* med den aktuelle hastighed. | Én ejer pr. element. Retarget fra den synlige værdi, aldrig fra modelværdien. `SceneMotion` gør allerede det første. |

### 1.3 Tryktilstande

Observeret adfærd (Apple Home-fliser, Music-knapper, kontrolcenter):

- **Ved touch-down reagerer UI'et straks.** Highlight sættes i den første frame uden ind-animation,
  eller med højst ca. 80–100 ms til scale. Det er det, der får knappen til at føles »fysisk«.
- **Fliser og kort skalerer til ca. 0,96–0,97.** Små ikonknapper bruger ingen scale, men en
  highlight-flade, så ikonet ikke »svømmer«.
- **Release er langsommere end down:** en fjeder på ca. 0,25–0,35 s uden bounce tilbage til 1.
  Asymmetrien (hurtig ind, blød ud) er hele hemmeligheden.
- **Glider fingeren væk (mere end ca. 10 pt), annulleres trykket.** Highlight går tilbage, og der
  sker intet klik.
- Et langt tryk (≈ 0,5 s) i Apple Home forstørrer flisen til et kontrol-sheet (hero, se §1.5).

### 1.4 Værdiændringer, og hvad web-view'et ikke har

| native | hvad det gør | WKWebView-substitut |
|---|---|---|
| `contentTransition(.numericText())` | Ændrede cifre ruller lodret og blur-fader. Uændrede cifre står stille, og retningen følger værdien (op/ned). | Ciffer-spans (som `updateClock`). Kun ændrede cifre animerer: translateY ±30 % og opacity 0→1 på `quick`. Retningen følger fortegnet. Ingen blur (filter er dyrt). |
| List insert/delete (`List`, diffable data source) | Nye rækker folder ind, mens naboer glider på fjeder. Slettede rækker kollapser. | FLIP på naboer plus `@starting-style` til den nye række (§3.5). |
| `matchedGeometryEffect` / zoom-transition (iOS 18) | Et element flyver fra kilde til mål, og alt andet cross-fader. | View Transitions API med `view-transition-name` på kilde og mål (Safari 18+). Fallback: FLIP-klon som `flyArtwork`. |
| SF Symbols `symbolEffect` (`.bounce`, `.pulse`, `.replace`) | Ikonet giver kontekstuel feedback. | `.replace` bliver cross-fade plus scale .8→1 på ikonet. `.bounce` bliver én scale 1→1,12→1 på `snappy`. `.pulse` bliver opacity-puls (kun for live-tilstande). |
| Haptik (`UIImpactFeedbackGenerator`, `.sensoryFeedback`) | Mærkbart »klik« ved snap, toggle og succes. | **Findes ikke**: `navigator.vibrate` understøttes ikke i iOS WebKit, og en vægskærm har ingen hånd på kroppen. Det visuelle tick erstatter den: et kort 1→0,98→1 »tap« på det element, der snappede, og en farveovergang på toggles. Haptikkens rolle (bekræftelse ved diskrete trin) skal bæres af et *synligt diskret trin*. |

### 1.5 Reduce Motion

Apples HIG (Motion og Accessibility) siger: når Reduce Motion er slået til, erstattes **slide, zoom,
dybde og parallax med cross-dissolve**. Systemet gør selv følgende:

- Det åbner apps med fade i stedet for zoom.
- Det fjerner parallax.
- Det dæmper fjedre.

Direkte manipulation (scroll eller at trække noget 1:1 under fingeren) bevares, fordi bevægelsen
*er* brugerens egen. Løbende eller automatisk dekorativ bevægelse stoppes. Væsentlig feedback
(farve, highlight, fade) bevares.

PodViews regel følger dette (§3.0): **bevægelse → opacity 120–150 ms; ambient → statisk; finger 1:1 →
uændret; fjeder efter slip → `quick` uden bounce og uden 3D.**

### 1.6 Tre referenceapps for et hjem-dashboard

**Apple Home (iPadOS 18/26)**
- Ved tryk på en flise skifter flisens tilstand *straks* (ikon og fyldfarve) med en blød
  farveovergang (≈ 200–250 ms). Der er ingen spinner. Uvished vises som »Opdaterer…« i
  undertekst, ikke som en låst knap. PodView har samme regel: tryk < 100 ms, aldrig låst.
- Et langt tryk åbner kontrol-sheetet ved at flisen **forstørres** ind i et stort lodret
  pille-slider-kort, mens baggrunden blurres og dæmpes. Ved luk krymper kortet tilbage til flisen.
- Den store lysdæmper er en fyldt pille, hvor fyldet følger fingeren 1:1. Ved slip er der ingen
  animation; værdien er der allerede. Glider man ud over min/max, strækkes pillen let (rubber-band).
- Grid-omarrangering: naboer glider på fjeder (FLIP).

**Apple Music, Now Playing og minibar**
- Ved tryk på minibaren udvides den til fuldskærm. **Omslaget er hero**: det flyver fra minibarens
  thumbnail til det store omslag, mens resten cross-fader (100 % dæmpning, jf. WWDC18).
- Ved at trække Now Playing ned følger kortet fingeren 1:1. Slippes det med fart, lukker det med
  80 % dæmpning (let overshoot). Slippes det langsomt over halvvejs, lukker det også; ellers fjedrer
  det tilbage.
- Når musikken pauses, **skrumper omslaget** (scale ≈ 0,8, fjeder med lidt bounce), og når den
  spiller, vokser det igen. Det er en stærk, billig tilstandsindikator, som PodView kan genbruge
  i Musik.
- Scrubberen bliver tykkere ved touch-down (højde ≈ 7→ ca. 12 pt) og følger 1:1. Lydstyrken gør
  det samme.
- Kø: rækker flyttes med drag-handle. Naboer glider på fjeder.

**Ur-appen, timere**
- Cifrene skifter med numeric-text-overgangen: kun det ændrede ciffer ruller.
- Fremdriftsringen tæller **kontinuerligt** (lineært), ikke i hop pr. sekund.
- Ved +1 min hopper ringen ikke; den animerer til sin nye andel på en fjeder (`smooth`).
- Alarm: den fulde visning kommer ind med scale/opacity. Selve »ringen« er en rolig puls, ikke
  blink, og stopper ved Stop/Slumre.
- Live Activity / Dynamic Island: den »vågner« ved at udvide sig med en tydelig fjeder (bounce ≈
  0,2–0,3). Det er tilladt, fordi det er en *ankomst*, der skal fange blikket. Det svarer til
  Svar-pillen i PodView.

---

## 2. Detailanalyse af PodView i dag

### 2.1 Hvor bevægelse lever

| kilde | rolle |
|---|---|
| `ui-kit.css` (22 @keyframes, 42 transitions) | kittet og de fleste skærme |
| `widget-redesign.css` (3 / 27) | Hjem, musikresultater |
| `ui/components.css` (0 / 15) | tokens og topbar |
| `frame-layout.css` (1 / 8) | rammen, kant-preview |
| `live-music.css` (1 / 2) | kø-pladsholder |
| `timer-notice.css` (2 / 0) | alarm |
| `widget-view.css` (0 / 10) | global `animation:none` / `transition:none` under reduced |
| `podview.css` | **genereret** af `scripts/build-assets.mjs` fra kilderne ovenfor. 30 unikke @keyframes og 116 `transition:`-erklæringer, hvoraf 55 er `transition:none` (overrides). |

JS-ejere:
- `ui/motion.js` (`SceneMotion`)
- `ui/gestures.js`
- `ui/pressed-state.js`
- `ui/robot-motion.js`
- `voice-surface.js`
- `flow-controller.js` (`flyArtwork`)
- `music-results.js`
- `spotify-artwork.js`
- `vehicle-view.js`
- `widget-view.js` (header-ur)
- `ui/components.js` (`animateChange`, kun workshop)
- `recipe-view.js` (cover flow, via CSS-transition)

**Tokens i dag** (`ui-kit.css`):
- `--pv-d-press:120ms`
- `--pv-d-switch:240ms`
- `--pv-d-in:400ms`
- `--pv-ease:cubic-bezier(.2,0,0,1)`

Disse er aliaseret til 8 andre navne: `--pv-screen-motion`, `--pv-screen-fast`,
`--pv-motion-feedback`, `--pv-ease-enter`, `--pv-ease-press`, `--pv-screen-ease`, `--pv-press-in` og
`--pv-press-out`.

Ved siden af tokens findes hårdkodede værdier. Optælling i `podview.css` (transitions):
- easing: `var(--pv-screen-ease)` ×46, `ease` ×21, `var(--pv-ease)` ×14, `cubic-bezier(.2,.9,.3,1)`
  ×3, `cubic-bezier(.16,1,.3,1)` ×1 samt `ease-out`/`linear`
- varighed: 90, 120, 160, 180, 200, 220, 240, 250, 300, 350, 500 og 600 ms (**12 forskellige**)

### 2.2 Lager af @keyframes (alle 30)

Dom: **B** = behold (evt. med token); **P** = flet ind i primitiv (navngivet); **F** = fjern.

| keyframes | hvor / trigger | varighed · easing | dom |
|---|---|---|---|
| `pv-press-circle` | `.pv-widget`/`[data-pv-press=flat]` ved `data-pv-circle=down` (pressed-state.js) | `--pv-d-press` 120ms · `--pv-ease` | **P** press (flad variant). Bevares som Material-agtig »ink« kun på widgets. Se §3.4: overvej at erstatte med overlay-fade, som iOS gør. |
| `pv-button-busy-reveal` | `.pv-kit-button[aria-busy]::after` | 120ms · ease | **P** state (busy-ind) |
| `pv-control-pending` | progress-ring på kit-knap/chip/toggle/tile og niveau-legend | 900ms linear ∞ | **P** state (busy-loop) |
| `pv-music-play-pending` | `.result-play::before` og `#queue .queue-track[aria-busy]::after` | 1s linear ∞ | **P** state. Det er den samme spinner som `pv-control-pending` med en anden periode, så de flettes. |
| `music-control-ack` | `.result[data-pending] .result-play` | 180ms · `from{none}to{none}` | **F**. En no-op-keyframe, der kun eksisterer for at genstarte noget, og den gør intet synligt. |
| `music-refresh-ack` | `#music-refresh[aria-busy]>img` | 900ms linear ×8 | **P** state. Rotation ×8 = 7,2 s og derefter stilstand, mens den stadig er busy. Det er inkonsistent; en ∞-loop, der stopper på state, er korrekt. |
| `player-read-ack` | `#player-empty[aria-busy]>img` | 240ms | **P** state (busy-ind) |
| `pv-advice-pending` | ingen brug (`content:none` på selektoren) | – | **F** død kode |
| `pv-advice-ready` | hero-body `data-advice-state=ready` | 200ms | **P** value/content-swap |
| `pv-connecting-sheen` | Hjem-kort `::before` under `connecting`, hero-advice pending | 1200ms ×3 | **P** state (skeleton). ×3 = 3,6 s og derefter død overflade. Skeleton skal loope, indtil indholdet kommer. |
| `pv-svar-skeleton` | Svar `.answer-visual[data-state=loading]` | 1.4s ∞ | **P** state (skeleton). Samme som ovenfor; fælles periode 1,4 s. |
| `pv-queue-placeholder` | `#queue>.queue-track[data-placeholder]::before` | 1.4s ∞ (background-position) | **P** skeleton. Animationen af background-position repainter hver frame; skift til en transform-shimmer eller opacity-puls. |
| `pv-live-pulse` | radio-live-prik, `move-here`-prikker (player) | .9s ∞ | **P** ambient (live-puls) |
| `pv-radio-live` | radio-nål | 2.4s ∞ | **P** ambient (live-puls, langsom variant) |
| `pv-music-eq` | »afspiller«-equalizer på resultat-`::after` | 1s ∞ (background-size) | **P** ambient. Background-size repainter, så den skal skifte til 3 `<i>` med `scaleY` (som `pv-queue-eq`, men med transform). |
| `pv-queue-eq` | kø-equalizer `>i` | .9s ∞ (`height`) | **P** ambient. `height` er en **layout-animation**: 3×60 relayouts/s. Den skal skifte til `transform:scaleY`. |
| `pv-music-pend` | resultat pending-puls | .9s ∞ | **P** state (busy) |
| `pv-music-fade` | resultat-`::after` ind | .32s ease | **P** state-ind |
| `pv-queue-rise` | `#music-detail .detail-queue` ind | .32s `cubic-bezier(.2,.9,.3,1)` | **P** sheet/section-ind |
| `pv-sheet-open` | `.pv-sheet[open]` (library-katalog) | 220ms `cubic-bezier(.2,.7,.2,1)` | **P** sheet |
| `pv-svar-pill` | `#svar-today>.svar-today-new` | .36s `cubic-bezier(.2,.9,.3,1)` | **P** arrival (en `snappy`-variant af sheet-ind). Se §4 Svar-pille. |
| `pv-topbar-in` | `#header-timer` i topbar dukker op | .32s `cubic-bezier(.2,.9,.3,1)` | **P** arrival |
| `pv-timer-material` | kørende timerpanel `::before` | 2.4s ∞ | **B→P** ambient (åndedræt). Den er acceptabel, men *to* samtidige loops på timer-skærmen er for meget. |
| `pv-timer-ring` | færdig timer `.timer-progress`, `#timer-alert[data-pulse]::before` | 1.6s ∞ | **P** alarm-puls |
| `timer-alarm-ring` | `#timer-alert[data-pulse] .notice-icon::before` | 1s ×60 | **P** alarm-puls. Konflikt: alarmen kører **to** pulser med perioderne 1 s og 1,6 s på samme tid, så de beats'er mod hinanden. De flettes til én. |
| `timer-alarm-enter` | `#timer-alert[open]` | 240ms ease-out · scale .96 | **P** sheet-ind (alert-variant) |
| `pv-weather-drift` / `-glow` / `-flash` / `-mist` | vejr-hero `::before` efter tone | 3–7 s ∞ | **B** som ambient. De er fine og stemningsbærende. Se §3.9: kun når Vejr er synlig, stop ved Ro. `-flash` bruger `steps(1)`-blink: behold, men max opacity .45 er ok. |
| `ack` (legacy-components.css) | workshop | – | **F** sammen med legacy |

### 2.3 Lager af transitions, grupperet

| gruppe | eksempler (selektor → værdi) | dom |
|---|---|---|
| **Press** | `.is-pressed{scale:.97!important;filter:brightness(.92)!important;transition:scale/filter var(--pv-d-press)}` og konkurrerende `button:is(:active,.is-pressed){scale:1;filter:brightness(.985)}` samt `body button:not(.is-pressed){transition-property:filter!important}` | **P** press. Der er tre regler, der kæmper med `!important`. Release animerer kun `filter`, ikke `scale`, så knappen **hopper** tilbage fra .97 til 1 uden transition. Det er den mest synlige »web«-fornemmelse i dag. |
| **Press-kvittering (JS)** | `pressed-state.js acknowledge()`: inset `box-shadow` 999px overlay 90 ms | **P** press. Box-shadow-animation repainter. Den skal skifte til en overlay-pseudo med opacity. |
| **Dialog** | `dialog{opacity:0;transform:translateY(10px);transition:opacity 120ms, transform 240ms, display/overlay 240ms allow-discrete}`, `@starting-style{dialog[open]{…}}` og backdrop | **B→P** sheet. Den er moderne (allow-discrete og @starting-style) og korrekt i princippet. Men opacity på 120 ms og transform på 240 ms er afkoblede, og exit er lige så lang som enter. |
| **Kit-knap farve** | `.pv-kit-button{transition:background-color/color/box-shadow var(--pv-d-fast)}` | **P** state |
| **Widget-baggrund** | `.pv-widget{transition:background-color var(--pv-d-in)}` (400ms) | **P** state (tint-skift, `base`) |
| **Toggles** | `power`-thumb `transform 160ms ease-out`. Lys: `.light-room-power::before{transition:right .25s ease}`, `#screen-device-auto-dim::after{transition:left .25s ease}` og `::after background .3s ease` | **P** state (toggle). To toggles animerer **`left`/`right`, som er layout-egenskaber**. Alle tre skal bruge den samme thumb: `transform:translateX` på `snappy`. |
| **Kø** | `#queue>.queue-track{transition:opacity .18s ease}` plus `@starting-style{opacity:0}`; cover `box-shadow .25s`; titel `color .25s` | **P** list og state |
| **Radio** | hero `background-color .5s ease`, nål `left .5s cubic-bezier(.2,.9,.3,1)` | **P** value. Nålen animerer `left` (layout) og skal bruge `translateX`. |
| **Lys-række** | `background-color .5s ease`, power `transform .12s ease`, lampe-niveau `opacity .2s` | **P** state |
| **Robot sticky** | `.robot-sticky{transform .24s cubic-bezier(.2,.9,.3,1), opacity .24s, visibility 0s .24s}` | **P** sheet (bundbjælke-variant) |
| **Opskrift cover flow** | `[data-recipe-cover]{transition:transform .6s cubic-bezier(.2,.9,.3,1), opacity .5s, filter .5s}`; prikker `width .3s ease` | **erstattes** af P9 (§3.10). Prikkernes `width` er layout og skal bruge `scaleX`. |
| **Svar-række** | `transform .12s ease, filter .12s ease` | **P** press |
| **Foto-Ro ur-drift** | `.photo-time{translate 2s var(--pv-screen-ease)}` | **B** ambient (burn-in-drift) |
| **Kant-preview** | `.frame{translate:calc(var(--edge-progress)*24px);scale:calc(1 - p*.015);transition 220ms}` | **P** page (interaktiv). I dag er det et *hint*, ikke 1:1 (se §3.2). |
| **Feed** | `.responses{transition:translate 180ms cubic-bezier(.16,1,.3,1)}` | **P** page |
| **Expandable** | `grid-template-rows` + opacity `var(--duration)` | **B**. Det er layout-animation, men den eneste robuste måde at folde højde på uden at måle. Brug den kun på få små elementer. |
| **Dial** | `.pv-dial-progress{stroke-dasharray 240ms linear}` | **P** value (progress) |

### 2.4 Lager af JS-bevægelser

| ejer | hvad | varighed · easing | dom |
|---|---|---|---|
| `SceneMotion.animate` | Fælles WAAPI-indgang. Én animation pr. node, `fill:backwards`. Ved reduced: kun opacity, 120 ms. | 280 default · `cubic-bezier(.2,0,0,1)` | **B** som kerne. Den udvides med spring-curves og tokens (§3.11). |
| `SceneMotion.enter` | Sektionsskift: indgående pane `translateX(±16px)`→0 med **opacity 1→1** (ingen fade). Ro ↔ aktiv: opacity .65→1, og playeren FLIP'er mellem positioner. | 200ms | **P** page. 16 px uden fade er så lidt, at det opleves som et ryk, ikke som en overgang. Udgående side har ingen animation. |
| `SceneMotion.settleResources` | FLIP på Hjem-kort ved layoutændring; timer-kort resize med scale | 240ms | **P** list/reorder. Godt fundament. Scale-FLIP forvrænger tekst; brug crossfade-scale-mønstret (§3.5). |
| `SceneMotion.updateClock` | Ændrede ciffer-spans: opacity .25→1 | 180ms | **P** value (numericText) |
| `SceneMotion.feedback` | Feedback-linje: ind translateY 4px + opacity 160 ms, ud opacity 120 ms | 120/160 | **P** sheet (toast-variant) |
| `SceneMotion.holdGeometry` | Fryser højder | – | **F**. Den kaldes ingen steder; kun `releaseGeometry` bruges. |
| `transitionContent` (gestures.js) | Indholdsskift ±14 px | 240 | **F**. Den er eksporteret, men ubrugt. |
| `attachGestures` | kant-back (36 px zone, 55–90 px tærskel), bund-swipe, træk-ned-for-tilbage, trackpad-wheel; preview via `--edge-progress` | – | **B** genkendelse; flyt preview til P1 |
| `attachPressedState` | `.is-pressed`-klasse ved pointerdown, flad cirkel, kvittering ved release; `lite`-gren til Frameo | 90/120 | **P** press. **F** for lite-grenen, fordi Frameo er droppet (2026-11-13). |
| `RobotMotion` | Robot-glyph vrikker: ×1 på 480 ms ved ny rengøring, ∞ på 3,2 s i Ro-rail | 480/3200 | **B** ambient. Den er velbegrundet. |
| `VoiceSurface` | Mark-loop pr. fase (720/1200/1400 ms ∞), position-FLIP 240, ind/ud 120 | – | **P** ambient og sheet |
| `flyArtwork` (flow-controller) | Omslag-klon flyver fra resultat til `#cover` | – | **P** hero |
| `music-results.js` | Rækkeindhold cross-fader: .65→1 200 ms, kunst-lag | 200 | **P** value/content-swap |
| `spotify-artwork.js` | Billede ind opacity 0→1 | 120 | **P** media-load |
| `vehicle-view.js` | Ladekvittering på meter: opacity .65→1 | 120 | **P** value |
| `widget-view.js` header-ur | Hele uret opacity 0→1 | 200 ease-out | **P** value. Det er inkonsistent med Foto-Ro-uret, som animerer pr. ciffer. Begge skal bruge `motion.value()`. |
| `recipe-view.js explore()` | Cover flow: pointerdown/up, ±1 ved \|dx\|≥40 px, ingen sporing, klik-suppression via 600 ms timestamp | CSS .6s | **erstattes** af P9 |

### 2.5 Huller (det, der mangler for »native«)

1. **Ingen ægte sektions- og sideovergang.** Hjem → Musik/Lys/Robot/... får 16 px glid uden fade, og
   den udgående side forsvinder i frame 0. Tilbage er spejlet. Native push/pop har to lag i
   bevægelse.
2. **Kant-swipe er ikke 1:1.** Preview'et er højst 24 px og skalerer .985. iOS trækker hele siden med
   fingeren og fuldfører eller annullerer med velocity.
3. **Press release hopper** (§2.3). Down og up deler kurve, og scale animerer ikke tilbage.
4. **Ingen fjedre.** Alt er `cubic-bezier`. Der er **fem forskellige** »emphasized«-kurver og 12
   varigheder.
5. **Ingen velocity-handoff nogen steder.** Gestures er tærskel-genkendere: cover flow ±1 ved 40 px,
   kant-back ved 55–90 px.
6. **Dialoger og sheets**: ingen træk-ned-for-at-lukke. Exit er lige så lang som enter. Opacity og
   transform er afkoblet. Skærm-dialogen (`#quick-sheet`) har toggles på `left`.
7. **Kø**: rækker fader kun ind (opacity .18s). Ingen FLIP ved omrokering, sletning eller »næste
   nummer«. Afspillende række skifter uden bevægelse.
8. **Mini player → Musik**: ingen hero. `flyArtwork` findes kun i *musikvalg → cover*-flowet, ikke
   for minibar → Musik.
9. **Kort → detalje**: ingen hero fra Hjem-kort til detaljevisning.
10. **Værdiændringer**: lysstyrke, lydstyrke og timer-tid hopper. Kun ure animerer, og de gør det
    forskelligt.
11. **Loops, der dør**: `connecting-sheen` ×3, `music-refresh-ack` ×8 og `timer-alarm-ring` ×60
    stopper, før tilstanden gør.
12. **Layout-animationer**: `left`/`right` på toggles og radio-nål, `height` i kø-EQ,
    `background-size`/`-position` i EQ og pladsholder, `width` i opskrift-prikker.
13. **Reduced-motion kontrolleres 9 steder** med lidt forskellige udtryk:
    `matchMedia(...)`, `host.dataset.motion`, `documentElement.dataset.motion` og
    `closest('[data-motion=reduced]')`. Der skal være én kilde.

### 2.6 WebKit-forudsætninger (WKWebView = systemets WebKit)

HA Companion bruger systemets WebKit. Funktioner følger derfor **iPadOS-versionen**, ikke appen.
Alt nedenfor skal feature-detectes; mangler noget, falder vi tilbage til WAAPI/FLIP.

| feature | Safari/iPadOS | brug i PodView |
|---|---|---|
| Web Animations API inkl. `animation.finished`, `getAnimations()`, `commitStyles()` | 13.1+ | Kernen i `SceneMotion`. JS-fjedre bruges til gesture-slip, WAAPI med `linear()` til fire-and-forget. |
| CSS `linear()` easing | 17.2+ | Fjeder-approksimationer som CSS-variabler (§3.0). |
| `transition-behavior: allow-discrete` | 17.4+ | `display`/`overlay` for dialog ud. Bruges allerede. |
| `@starting-style` | 17.5+ | Indgang for dialog og nye kø-rækker. Bruges allerede. |
| **View Transitions (same-document)** `document.startViewTransition` | **18.0+** | Sektionsskift og hero (§3.2, §3.8). |
| `view-transition-class`, `view-transition-name: match-element` | 18.2+ | Klasse-baseret styling af grupper. |
| Scroll-driven animations (`animation-timeline: scroll()/view()`) | 26.0+ (fejlrettelser i 26.5) | Valgfrit: parallax på opskriftsfoto og fade af topbar-skygge. Feature-detect med `CSS.supports('animation-timeline: scroll()')`. |
| `overflow: auto` scroll | Alle. Siden iOS 13 er hver composited overflow-scroller en **native UIScrollView** (`WKChildScrollView`) i UI-processen. `-webkit-overflow-scrolling: touch` er en no-op. | Lodret og vandret scroll får ægte iOS-fysik gratis (§3.10). |
| CSS scroll-snap | 11+ | Snap ligger i UIScrollViews egen deceleration (se §3.10). |
| Haptik / `navigator.vibrate` | ikke understøttet | Visuel substitut (§1.4). |

Begrænsninger ved View Transitions, som man skal kende:
- Under en overgang tegnes gammel og ny tilstand som **snapshots**: video, ure og spinnere fryser i
  overgangens varighed. Hold den under 400 ms.
- Dokumentet modtager ikke pointer-events, mens `::view-transition` ligger øverst. Et nyt tryk
  skal derfor kalde `transition.skipTransition()` (afbrydelse), ellers føles UI'et dødt i
  overgangen.
- Én overgang ad gangen. En ny overgang afbryder den forrige ved at springe til slut, uden
  retarget. Derfor bruges VT kun til diskrete skift (sektion, hero), aldrig til noget, en finger
  trækker.

**Hardware:** iPad Air 5 (2022) har **M1** (ikke A15; A15 sidder i iPad mini 6) og en **60 Hz**
skærm (ingen ProMotion). Frame-budgettet er altså 16,7 ms. GPU'en har rigeligt kræfter. Flaskehalsen
er **main-thread-arbejde** (style recalc på store `:has()`-selektorer, layout, JS i rAF) og
**repaint** af store lag. Jf. kommentaren i `pressed-state.js`: en klasse, der rammes af mange
`:has()`-regler, restylede hele siden.

---

## 3. Motion-systemet: tokens og primitiver

### 3.0 Grundregler

1. **Fire varigheder og tre fjedre. Ikke flere.** Nye tal kræver en ændring i dette dokument.
2. **Kun `transform` og `opacity` animeres.** Undtagelser (farve på små flader, `grid-template-rows`
   i expandable) er navngivne og begrænsede. Aldrig `left`, `right`, `top`, `width`, `height`,
   `box-shadow`, `filter` eller `background-*` i en løbende animation.
3. **Hurtig ind, blød ud.** Feedback på touch-down har ingen animation (eller ≤ 100 ms). Alt, hvad
   der følger efter, bruger fjedre.
4. **Én ejer pr. element og egenskab.** Afbrydelse starter fra den *synlige* værdi. Når en finger er
   involveret, bevares også hastigheden (JS-fjeder). CSS og WAAPI bruges kun til fire-and-forget.
5. **Bevægelse har retning og betydning.** Dybere i hierarkiet = fra højre / nedefra. Tilbage =
   spejlet. Ankomst udefra (Svar, alarm) = ovenfra/skala.
6. **Reduced motion har én kilde:** `motion.reduced` (system-preference eller
   `pv-widget-host[data-motion=reduced]`). CSS spørger kun `:root[data-pv-motion=reduced]`, som JS
   sætter.
7. **Tilgængelighed og produktregler går forud.** Ingen bevægelse må forsinke visning af eget valg
   (< 300 ms) eller låse en knap.

### 3.1 Tokens

**Varigheder** (til opacity, farve og WAAPI uden fjeder):

| token | værdi | bruges til |
|---|---|---|
| `--pv-dur-tap` | 100ms | highlight ind, ciffer-fade ved reduced |
| `--pv-dur-quick` | 160ms | exit, fades, farveskift på små flader |
| `--pv-dur-base` | 240ms | indgang uden fjeder, crossfade, reduced-motion fallback = 150ms |
| `--pv-dur-ambient` | 1400ms | periode for skeleton og puls (én fælles) |

Reduced fallback er en separat token: `--pv-dur-reduced: 150ms`.

**Easing:**

| token | værdi | bruges til |
|---|---|---|
| `--pv-ease-out` | `cubic-bezier(.2,0,0,1)` | indgang og state-skift (den eksisterende `--pv-ease`, beholdes) |
| `--pv-ease-in` | `cubic-bezier(.4,0,1,1)` | exit (accelererer væk, kort) |
| `--pv-ease-inout` | `cubic-bezier(.45,0,.55,1)` | ambient loops |
| `linear` | – | fremdrift (timer-ring, progress) |

**Fjedre.** Kurvens form afhænger *kun* af bounce; duration skalerer den lineært. Derfor er der én
`linear()` pr. bounce, og CSS-varigheden = settling-tiden (til 0,1 %).

| token | duration (perceptuel) | bounce | ζ | stivhed k | dæmpning c | CSS-varighed (settle 0,1 %) | overshoot |
|---|---|---|---|---|---|---|---|
| `quick` | 0,30 s | 0 | 1,00 | 438,6 | 41,89 | **441 ms** | 0 |
| `smooth` | 0,45 s | 0 | 1,00 | 195,0 | 27,93 | **661 ms** | 0 |
| `snappy` | 0,40 s | 0,15 | 0,85 | 246,7 | 26,70 | **557 ms** | 0,6 % |
| `flick` (kun efter gesture med momentum) | 0,50 s | 0,20 | 0,80 | 157,9 | 20,11 | JS only | ≈ 1,5 % |

Begrundelse:
- `quick` bruges til release, toggles og små skift.
- `smooth` er Apples default i en lidt hurtigere version, fordi en vægskærm ses på afstand, og
  0,5 s føles langsomt ved 60 Hz.
- `snappy` bruges til ankomster og snap.
- `flick` svarer til Music-swipe-dismiss (80 % dæmpning, WWDC18).

Beregnede `linear()`-kurver (fejl < 0,004; genereret med `spring.py`, se §5):

```css
:root{
  /* bounce 0 (quick, smooth) */
  --pv-spring-0: linear(0, 0.005 1.2%, 0.02 2.3%, 0.083 5.2%, 0.164 7.8%, 0.46 16.8%, 0.555 20.2%,
    0.638 23.5%, 0.708 26.8%, 0.766 30.2%, 0.816 33.7%, 0.86 37.5%, 0.899 42%, 0.929 46.8%,
    0.953 52.3%, 0.971 58.5%, 0.991 73.7%, 1);
  /* bounce 0.15 (snappy) */
  --pv-spring-15: linear(0, 0.006 1.3%, 0.024 2.7%, 0.054 4.2%, 0.097 5.8%, 0.187 8.7%, 0.516 18.2%,
    0.612 21.3%, 0.695 24.5%, 0.766 27.7%, 0.824 30.8%, 0.873 34.2%, 0.913 37.7%, 0.946 41.5%,
    0.971 45.8%, 0.989 50.5%, 1 55.8%, 1.006 68%, 1);

  --pv-spring-quick: 441ms var(--pv-spring-0);
  --pv-spring-smooth: 661ms var(--pv-spring-0);
  --pv-spring-snappy: 557ms var(--pv-spring-15);

  --pv-dur-tap:100ms; --pv-dur-quick:160ms; --pv-dur-base:240ms; --pv-dur-ambient:1400ms;
  --pv-dur-reduced:150ms;
  --pv-ease-out:cubic-bezier(.2,0,0,1); --pv-ease-in:cubic-bezier(.4,0,1,1);
  --pv-ease-inout:cubic-bezier(.45,0,.55,1);
}
```

Brug: `transition: transform var(--pv-spring-smooth), opacity var(--pv-dur-base) var(--pv-ease-out);`.

Fjederkurven har en lang hale (de sidste 1,5 % tager ca. 40 % af tiden). Det er korrekt adfærd.
`transitionend` og `finished` kommer derfor sent, og **logik må aldrig vente på dem**. Det følger
Apples råd om perceptuel varighed. Har logik brug for et »færdig«-tidspunkt, bruges `duration`
(f.eks. 450 ms), ikke settle.

Aliaserne (`--pv-screen-motion`, `--pv-screen-ease` og så videre) peger på de nye tokens i én
overgangs-PR og fjernes derefter. `scripts/check-ui-tokens.mjs` udvides til at afvise rå
`ms`/`s`/`cubic-bezier`/`ease` i `transition`/`animation` uden for token-blokken.

### 3.2 P1 · Section/page-overgang

**Hvornår:**
- *Push*: Hjem → detalje, katalog → opskrift.
- *Pop*: tilbage, kant-swipe og træk ned.
- *Lateral* (cross-fade): Ro ↔ aktiv, segmentskift Katalog/Udforsk, Svar-historik.

**Spec, push (ikke-interaktiv):**

| lag | egenskaber | timing |
|---|---|---|
| indgående side | `translateX(48px)→0`, `opacity 0→1` | transform `smooth` (661 ms CSS / perceptuelt 450); opacity `--pv-dur-base` `--pv-ease-out` |
| udgående side | `translateX(0→-24px)`, `opacity 1→0` | `--pv-dur-quick` `--pv-ease-in` |
| topbar-titel | cross-fade + `translateX(8px→0)` | `--pv-dur-base` |
| persistent player og topbar-chrome | står stille (er ikke i snapshot-gruppen) | – |

Pop er spejlet: ind fra −48 px, ud til +24 px. Lateral har ingen translate: opacity
`--pv-dur-base`, og playeren FLIP'er som i dag.

**Mekanik:**
- Brug `document.startViewTransition` (Safari 18+), når den findes. Giv `.responses` `view-transition-name: pv-page`,
  topbar-titlen `pv-title` og playeren `pv-player`, og style
  `::view-transition-old(pv-page)` / `::view-transition-new(pv-page)` med keyframes ovenfor. Retning
  sættes via `document.documentElement.dataset.pvNav = 'push'|'pop'|'lateral'`.
- Uden VT bruges den nuværende `SceneMotion.enter`, nu med fade og et udgående lag: klon den gamle
  `section` som `inert`, `position:absolute`, og fjern den på `finished` eller ved næste nav.

**Interaktiv pop (kant-swipe, PR 6):**
- Fra 10 px horisontal bevægelse i 36 px-zonen følger den aktuelle side fingeren 1:1:
  `translateX(dx)`. Den forrige side ligger under med `translateX(-30% + dx·0,3)` og en dæmpning
  `opacity .9→1`.
- Ved slip projiceres positionen: `x_proj = x + v·0,099` (rate `fast` 0,99, se §3.10). Er
  `x_proj > 0,5·bredde` eller `v > 500 px/s`, fuldføres pop med JS-fjeder `smooth` og
  begyndelseshastighed v. Ellers annulleres den med `quick`.
- Det kræver, at den forrige sektion forbliver renderet under swipet. PodView har allerede sektioner
  som søskende i `.responses`, så den forrige vises `inert` under gesten.

**Afbrydelse:**
- Nyt nav-tryk under en VT kalder `skipTransition()`, og den nye overgang starter.
- Under en WAAPI-overgang annulleres den med `commitStyles()` fra den synlige værdi.
- Under en interaktiv fjeder fanger et nyt touch-down den, og hastigheden sættes til 0.

**Reduced:** Kun opacity, `--pv-dur-reduced`. Kant-swipe følger stadig fingeren 1:1, men uden
parallax-laget, og fuldfører med opacity i stedet for glid.

### 3.3 P2 · Sheet/dialog ind/ud

Varianter: `sheet` (Skærm-dialog, højttalerliste, Svar-detalje), `alert` (timer-alarm), `toast`
(feedback-linje) og `bar` (robot-sticky).

| variant | ind | ud |
|---|---|---|
| sheet | `translateY(24px)→0` `smooth`; `opacity 0→1` `--pv-dur-base`; backdrop `opacity 0→1` `--pv-dur-base` | `translateY(0→16px)` + `opacity→0` `--pv-dur-quick` `--pv-ease-in`; backdrop samme |
| alert | `scale(.94)→1` `snappy`; `opacity` `--pv-dur-quick` | `opacity→0` + `scale(.98)` `--pv-dur-quick` |
| toast | `translateY(8px)→0` `snappy`; opacity `--pv-dur-quick` | opacity `--pv-dur-quick` |
| bar | `translateY(100%)→0` `smooth` | `translateY(100%)` `--pv-dur-quick` `--pv-ease-in` |

**Mekanik:** Ren CSS med `@starting-style` og `transition-behavior: allow-discrete` på `display` og
`overlay`. Det er allerede mønstret i `dialog`; kun tal og exit-asymmetri ændres.

**Træk ned for at lukke (sheet):**
- Efter 10 px lodret bevægelse følger sheetet fingeren 1:1. Over toppen gives rubber-band
  (formlen i §3.10).
- Ved slip: projiceret `y + v·0,099 > 40 % af højden` eller `v > 800 px/s` → luk med JS `flick` med
  begyndelseshastighed v. Ellers tilbage med `quick`.
- Gesten må kun starte, når sheetets indhold er scrollet til toppen. Det er samme regel som
  `atScrollTop` i `gestures.js`.

**Afbrydelse:** Et tryk på backdrop under ind-animation lukker fra den aktuelle værdi. CSS-transitions
retargeter selv fra den aktuelle værdi; det er godt nok, fordi der ikke er nogen finger-hastighed.

**Reduced:** opacity `--pv-dur-reduced`, ingen translate eller scale.

### 3.4 P3 · Press feedback

Én regel for alt trykbart. Den erstatter de tre konkurrerende regler og `acknowledge()`.

| fase | egenskaber | timing |
|---|---|---|
| down (pointerdown, i samme frame) | `scale: .97` for fliser og kort; `.98` for knapper ≥ 64 px; **ingen scale** for ikonknapper < 64 px. Overlay-pseudo `::after{opacity: 0→1}` med `background: currentColor` ved 10–12 % (`color-mix`; Safari 16.2+ har det, så JS-fallbacken fra Chrome < 111 kan fjernes, da Frameo er væk). | scale `--pv-dur-tap` `--pv-ease-out`; overlay **0 ms** |
| up (release eller click) | `scale → 1`, overlay `→ 0` | scale `quick` (441 ms `--pv-spring-0`); overlay `--pv-dur-quick` |
| cancel (bevægelse > 10 px, scroll, pointercancel) | samme som up, ingen click | samme |

**Implementering:**
- `pressed-state.js` sætter fortsat `.is-pressed` uden at læse style.
- CSS: `[data-pv-press]:is(.is-pressed){scale:var(--pv-press-scale);transition:scale var(--pv-dur-tap) var(--pv-ease-out)}`
  og i hviletilstand `transition: scale var(--pv-spring-quick)`. Så får down og up hver sin kurve
  automatisk, fordi transition læses fra *destinationstilstanden*.
- Overlay: en fast `::after` med `opacity`, aldrig `box-shadow` og aldrig `filter: brightness` (filter
  på et kort med billede/backdrop-filter tvinger repaint).
- Den flade cirkel (`pv-press-circle`) beholdes kun på `.pv-widget`, men med samme opacity-kurve.
- **Klassen `is-pressed` må ikke matches af `:has()`-regler** (performance; jf. kommentaren i
  `pressed-state.js`). Den tjekkes i CI.

**Reduced:** Behold overlay, men drop scale. Highlight er væsentlig feedback (HIG).

### 3.5 P4 · Liste: enter/leave/reorder

Bruges i kø, Hjem-grid, Svar-historik, opskriftskatalog-filter og lampeliste.

| hændelse | egenskaber | timing |
|---|---|---|
| enter | `opacity 0→1`, `translateY(8px)→0` (`@starting-style`) | `snappy`; stagger 30 ms pr. række, max 5 rækker (150 ms), resten samtidigt |
| leave | `opacity→0`, `scale(.98)`. Naboerne lukker hullet med FLIP. | `--pv-dur-quick` `--pv-ease-in`; FLIP `smooth` |
| reorder / layoutskift | FLIP: mål før, mutér, mål efter, `translate(dx,dy)→0` | `smooth` |
| størrelsesændring | **ingen scale-FLIP på tekst**. Containeren FLIP'er med `clip-path: inset()` eller en baggrunds-pseudo med scale. Indholdet cross-fader `--pv-dur-quick`. | `smooth` |

**Mekanik:** `motion.list(container, mutate)`. Det er en generalisering af `settleResources`, som
allerede gør det vigtigste rigtigt:
- alle læsninger før skrivninger
- én ejer pr. node
- retarget fra synlig position

`timerResize`-scale-FLIP erstattes af størrelsesmønstret ovenfor.

**Afbrydelse:** En ny mutation under FLIP måler den *synlige* position (getBoundingClientRect
inkluderer transform), annullerer og starter forfra fra dér. Det er implementeret i dag.

**Reduced:** enter og leave er opacity `--pv-dur-reduced`. Reorder sker øjeblikkeligt (ingen glid).

### 3.6 P5 · Værdiændring (tal, ur, fremdrift)

| type | spec |
|---|---|
| **cifre** (ur, timer-nedtælling, °C, %, lydstyrketal) | Ciffer-spans. Kun ændrede cifre animerer: den gamle værdi går `translateY(0→-30%)` + `opacity→0`, og den nye kommer fra `translateY(30%)→0` + `opacity 0→1` (retning omvendt, når værdien falder). `quick`. Bredde: `font-variant-numeric: tabular-nums`, så intet flytter sig. Én implementering for header-ur, Foto-Ro-ur, timer og vejrtal. |
| **sekundtælling** | Sekunder animerer **ikke** (de skifter hvert sekund, og bevægelse dér er støj). Kun minut- og timeskift ruller. Timer-nedtælling < 60 s: sekunder skifter uden animation. |
| **progress** (timer-ring, dial, ladning, afspilning) | Kontinuerlig. Server-tick → `linear` over tick-intervallet, så ringen aldrig står stille eller hopper. Bruger-ændring (+1 min, ny lydstyrke fra en anden app) → `smooth` til ny værdi. Egenskab: `transform: rotate`/`scaleX` på en maske eller `stroke-dashoffset` (SVG; billigt på små ringe). |
| **slider under finger** | 1:1, ingen animation (§4). Ekstern ændring bruger `smooth`. Ved et eget tryk (tap-to-position) sker der intet glid, men fyldet springer, fordi brugeren *pegede* dér. |
| **indholdsbytte** (Svar-tekst, rådsboks, resultatrække) | Cross-fade `--pv-dur-base`. Højdeændring via expandable, ikke via måling. |

**Reduced:** Cifre skifter med opacity `--pv-dur-tap`. Progress forbliver lineær og kontinuerlig.
Det er information, ikke dekoration.

### 3.7 P6 · State change for knapper og kontroller (idle → busy → done → error)

Dette er den mest brugte primitiv: robot-start, musikafspil, lys, Tesla og opdater.

| overgang | hvad brugeren ser | timing |
|---|---|---|
| idle → **selected** (straks ved tryk, < 100 ms) | Knappen viser det *valgte* udfald. Ikonet skifter (`.replace`-substitut: gammelt ikon `opacity→0, scale→.8`, nyt `scale .8→1, opacity 0→1`). Flade og farve skifter. | ikon `snappy`; farve `--pv-dur-quick` |
| selected → **busy** (kun hvis kommandoen tager > 400 ms) | Progress-ring i hjørnet (`::after`) fader ind og roterer. Knappen forbliver trykbar; et nyt tryk sættes i kø. | ind `--pv-dur-quick` efter **400 ms forsinkelse**; rotation 900 ms linear ∞ |
| busy → **done** | Ringen fader ud. Én visuel »tick«: knappen gør `scale 1→1.04→1` (`snappy`). | `--pv-dur-quick` + `snappy` |
| busy → **error / ukendt** | Ringen fader ud. Knappen falder tilbage til den faktiske tilstand med en farveovergang. Fejlteksten kommer som toast (P2) eller undertekst-crossfade. **Ingen rystelse** (iOS-»shake« bruges kun til forkert kode og ville virke alarmerende på en vægskærm). | `--pv-dur-base` |

De 400 ms forsinkelse for spinneren er den vigtigste enkeltbeslutning. Hurtige kommandoer (de fleste
lys) viser aldrig en spinner; det er sådan Apple Home føles. Forsinkelsen implementeres i CSS:
`[aria-busy=true]::after{animation: pv-busy-in var(--pv-dur-quick) 400ms both, pv-spin 900ms linear 400ms infinite}`.

Skeletons (Svar-indlæsning, kø-pladsholder, Hjem connecting, rådsboks) bruger **én** keyframe
`pv-skeleton` (opacity .5↔1, `--pv-dur-ambient`, `--pv-ease-inout`, ∞), indtil tilstanden skifter.
Ingen tællinger (×3, ×8).

**Reduced:** Spinneren er statisk: en ring med et fast segment plus teksten »Sender…«. Skeleton er
statisk med .7 opacity. Tick er droppet. Farveskift bevares.

### 3.8 P7 · Hero/expand

Bruges til mini player → Musik, Hjem-kort → detalje, musikresultat → afspilleromslag
(`flyArtwork`) og opskriftskort → opskrift.

**Spec:**
- Det fælles element (omslag, kortflade) flyver fra kildeboks til målboks: `translate` + `scale`
  på `smooth`. **Hjørneradius** interpoleres via `clip-path: inset(0 round r)` (animerbar og
  composited-venlig), ikke `border-radius` på et skaleret element.
- Alt andet cross-fader: kildeskærmen `--pv-dur-quick`, målskærmens øvrige indhold
  `opacity 0→1` `--pv-dur-base` med 60 ms forsinkelse.
- Tekst skaleres aldrig. Titel og kunstner cross-fader på deres to positioner.
- Mekanik: VT med `view-transition-name: pv-hero` sat *kun* på kilde og mål i det øjeblik, de skal
  matches. To elementer med samme navn samtidig aborterer overgangen; den fejl skal fanges i test.
  Fallback: FLIP-klon som i dag i `flyArtwork`, flyttet ind i `motion.hero()`.
- **Tilbage (collapse):** spejlet. Mini player → Musik kan også lukkes med *træk ned* på Musik's
  hero-område: 1:1 + `flick` som Apple Music (§1.6).

**Afbrydelse:** Tilbage under ekspansion kalder `skipTransition()` og kollapser derefter fra den
synlige værdi.

**Reduced:** Kun cross-fade `--pv-dur-reduced`.

### 3.9 P8 · Ambient (Foto-Ro, live-puls, vejr)

| element | spec |
|---|---|
| **Foto-Ro cross-fade** (når der kommer flere billeder; i dag ét fast billede) | Gammelt og nyt billede stables; `opacity` på det nye 0→1 over **1200 ms** `--pv-ease-inout`. Ingen Ken Burns, fordi det er en vægskærm, der skal være rolig. Hvis Ken Burns ønskes: højst `scale 1→1.04` over hele visningstiden, linear. |
| **Ur-drift** (burn-in) | Behold: `translate` 2 s `--pv-ease-out`, nye mål hvert N minut. |
| **Ro ind/ud** | Lateral-overgang (P1): opacity `--pv-dur-base` på panes, og playeren FLIP'er `smooth`. Dæmpning af lysstyrke er **ikke** motion; den ejes af skærmindstillinger. |
| **Live-puls** (radio-live, »flyt hertil«-prikker, lytte-mark) | Én keyframe `pv-pulse`: `scale .6↔1` + `opacity .4↔1`, periode **1400 ms**, `--pv-ease-inout`. Radio-nålen bruger samme keyframe med periode ×2. |
| **Equalizer** | 3 bjælker, `transform: scaleY(.3↔1)` med `transform-origin: bottom`, perioderne 900/1100/1300 ms (bjælkerne går ude af takt, hvilket ser organisk ud). Erstatter `height`- og `background-size`-varianterne. |
| **Vejr** | Behold de fire stemnings-keyframes, men flyt dem til `transform`/`opacity` (det er de allerede). De kører kun, mens `#weather-view` er synlig (`animation-play-state: paused` ellers), så ingen loops kører i baggrunden. |
| **Robot-glyph** | Behold `RobotMotion`. |

**Regel:** Højst **én** ambient loop pr. synlig zone. Timer-skærmen har i dag `pv-timer-material` og
`pv-timer-ring` samtidig, og alarmen har to pulser. Én skal vælges.

**Reduced:** Alle loops er statiske. Billedskift bruger opacity `--pv-dur-reduced`.

### 3.10 P9 · Swipe og scroll med native fysik (udstillingseksempel: Opskrifter)

Denne primitiv har to spor:
- **Spor A: native scroll.** Alt, der kan være en scroll-container, skal være det.
- **Spor B: JS-fysik.** Bruges kun hvor scroll ikke kan udtrykke bevægelsen. Cover flow
  »Udforsk« er det primære eksempel.

#### 3.10.1 Giver native overflow-scroll ægte UIScrollView-fysik i WKWebView?

**Ja, med én nuance.** Siden iOS 13 er hver composited `overflow:auto/scroll`-container i WebKit på
iOS backet af en rigtig `UIScrollView` (`WKChildScrollView`), og scrolling sker i UI-processen.
`-webkit-overflow-scrolling: touch` er dermed en no-op og skal ikke tilføjes. Man får følgende
gratis og uden main-thread-arbejde:

- 1:1-sporing
- iOS' deceleration (`decelerationRate` normal = 0,998/ms)
- rubber-band ved kanterne
- afbrydelse (fang den i flugten)
- akselås
- scroll-indikator

Det **slår enhver JS-implementering**, fordi det kører uden for JS-tråden. En `render()` eller GC
midt i et kast kan derfor ikke hakke scrollen. JS-fysik skal konkurrere med al vores egen
main-thread-trafik.

Nuancen er **CSS scroll-snap**: WebKit på iOS løser snap ved at justere UIScrollViews
`targetContentOffset` i `scrollViewWillEndDragging`. Det betyder, at snap lander med native
deceleration og velocity.
- Med `scroll-snap-type: x mandatory` kan et hurtigt kast springe flere sider over. Brug
  `scroll-snap-stop: always`, hvis der skal pagineres én ad gangen.
- Efter min læsning af WebKit-kilden (`ScrollingTreeScrollingNodeDelegateIOS`) skifter WebKit til
  `fast` deceleration (0,99), når der er snap-punkter. Det giver den kortere, paging-agtige
  udløbning. Bekræft det på enheden i PR 9; det ændrer ikke anbefalingen.

**Native scroll kan ikke:**
1. ikke-lineær mapping fra scroll-position til *3D*-transform (cover flow)
2. egne snap-regler, der afhænger af indhold (f.eks. »spring til kategori«), ud over snap-punkter
3. hero/kort-stak, hvor elementet skal forlade scroll-containeren
4. træk-for-at-lukke, hvor *hele* sheetet flytter sig

Det kan delvist afhjælpes med scroll-driven animations (Safari 26), der binder `transform` til
`scroll()`/`view()`-tidslinjer. Det kunne i teorien drive cover flow fra native scroll. Men
`view()`-timeline på 3D-kort er ikke testet i WKWebView, iPadOS-versionen på væggen er ikke
garanteret ≥ 26, og 26.5 fiksede stadig fejl i view-timeline-progress nær 0/100 %. Derfor vælges
JS til cover flow og scroll-driven til **eksperiment** (§5, PR 10).

#### 3.10.2 Spor A: katalog, kategorier og lister (native)

| flade | spec |
|---|---|
| **Katalogliste** (`[data-recipe-layout=catalog]>div`, lodret) | Behold `overflow-y:auto; overscroll-behavior:contain`. Det er allerede native, og momentum og rubber-band er gratis. **Ingen** `scroll-snap` på lodrette lister (iOS snapper ikke lister). Alfabet-indekset (`nav`, `touch-action:none`) sætter fortsat `scrollTop` direkte; det er korrekt iOS-adfærd (sectionIndex hopper uden animation). |
| **Kategori-segment** (`.pv-kit-choice-options`, `overflow-x:auto`) | Native vandret scroll. Tilføj `scroll-snap-type:x proximity` + `scroll-padding-inline: var(--pv-s3)`, så et kast lander pænt på en chip-kant uden tvang. Valgt chip scrolles i syne med `scrollIntoView({inline:'nearest',behavior:'smooth'})`. |
| **Hylder** (vandrette kortrækker, `.pv-hscroll`, vejrtimer) | `scroll-snap-type:x mandatory` og `scroll-snap-align:start`. `scroll-snap-stop:normal` tillader kast over flere kort, ligesom App Store-hylder. |
| **Parallax/scale under swipe på native hylder** | Kun med scroll-driven animations (Safari 26+, feature-detect): `animation-timeline: view(inline)` → `scale .94→1→.94` på kort. Uden support: intet. Statisk er bedre end en JS-scroll-lytter. |

**Akselås mellem lodret liste og vandret hylde** klares af UIScrollView selv: en indlejret vandret
scroller får vandrette træk, og den lodrette forælder får lodrette. `touch-action` skal **ikke** sættes
på dem.

#### 3.10.3 Spor B: »Udforsk« cover flow (JS: Pointer Events og fjeder)

Koden findes: `recipe-view.js explore()` (linje 923–1043) svarer til canvasset `Opskrifter-Bog`:
- 720×460 valgt
- naboer `translateX ±(430+(a−1)·110)`, `translateZ −260−(a−1)·60`, `rotateY ∓55°`, `brightness(.82)`
- `perspective:1600px`
- 7-prik vindue
- `transition .6s cubic-bezier(.2,.9,.3,1)`

I dag er det en **diskret** genkender (±1 ved |dx| ≥ 40 px på pointerup). Der er ingen sporing,
intet momentum og ingen rubber-band, og klik dæmpes med et 600 ms timestamp.

**Model.** Én kontinuerlig værdi `p` (fraktionelt indeks, 0…n−1). Alt tegnes som en ren funktion af
`p`. Der er ingen CSS-transition på covers; JS skriver `style.transform` i rAF.

```
for hvert cover k:  d = k − p,  a = |d|,  s = sign(d)
  hvis a ≤ 1:   x = d·430           z = −260·a              ry = −s·55·ease(a)   shade = .18·a
  ellers:       x = s·(430+(a−1)·110)  z = −260−(a−1)·60     ry = −s·55            shade = .18
  ease(a) = a·a·(3−2a)   (smoothstep, så rotationen ikke knækker ved d=0)
  transform = translate3d(x, 0, z) rotateY(ry)
  overlay::after opacity = shade           (erstatter filter: brightness(.82))
  synlig hvis a ≤ 3.5, ellers visibility:hidden (ikke opacity 0, som stadig composites)
  z-index = 20 − round(a)
```

Ved heltals-`p` giver det præcis canvassets positioner. Den eneste ændring er, at det nu er
kontinuerligt (i dag springer x fra 0 til 430 ved d = ±1).

**Gesture-tilstandsmaskine:**

| fase | regel |
|---|---|
| **down** | Optag `p0 = p`, `x0`, tid. Kører en fjeder, **stoppes den straks**: `p` beholdes, og hastigheden sættes til 0 (fang i flugten). Et tryk, der fanger, er aldrig et klik. Ignorér down i de yderste 36 px til venstre (kant-tilbage ejer dem). |
| **slop** | Ingenting, før bevægelsen er ≥ 10 px (iOS-hysterese). Så låses aksen: `|dx| > |dy|·1,2` → vandret (vi ejer, `setPointerCapture`); ellers lodret. Lodret overlades til browseren; `touch-action: pan-y` på flowet gør det allerede. Browseren sender `pointercancel` → fjeder tilbage til `round(p)` med `quick`. |
| **drag** | 1:1: `p = p0 − (x − x0)/430`. 430 px = afstand mellem centrum og første nabo, så fingeren »holder« det cover, den greb. Uden for [0, n−1] gives rubber-band: `over = rubber(overPx, d = flowbredde)`, hvor `rubber(x,d) = (1 − 1/(x·0,55/d + 1))·d` (iOS-formlen, c = 0,55). Hastighed estimeres af de sidste ~80 ms pointer-samples (lineær regression), ikke af sidste delta, der støjer. Brug `getCoalescedEvents()` når det findes. |
| **up (tap)** | Bevægelse < 10 px og ikke fanget: tap. Tap på centrum åbner opskriften. Tap på en nabo animerer til den (`snappy`). Det erstatter 600 ms-timestamp-hacket; covers forbliver `<button>`, og klik via tastatur går som i dag. |
| **up (kast)** | Projektion med UIScrollView-raten: `p_proj = p + (v_px_s/1000)·(0,998/(1−0,998))/430 = p + v·0,499/430`. Mål = `clamp(round(p_proj), 0, n−1)`, begrænset til `±6` covers fra start. Eksempel: et kast på 2000 px/s giver ≈ 2,3 covers frem, og et let skub på 300 px/s giver 0,35, som afrundes til samme eller næste. Fjeder fra `p` mod mål med begyndelseshastighed `v/430` (indeks/s): `flick` (bounce 0,2) når `|v| > 300 px/s`, ellers `snappy`. Den lille overshoot er WWDC18's »belønning for momentum«. |
| **fra rubber-band** | Mål = 0 eller n−1, `snappy`, med hastigheden bevaret. |
| **tastatur ←/→** | Mål ±1, `snappy`, kan gentages under flugt (retarget med bevaret hastighed). |

**Fjederen** er en analytisk dæmpet oscillator, ikke en Euler-integration. Den løses lukket for
(position, hastighed) med ζ og ω fra tokens, så den er frame-rate-uafhængig og deterministisk i test.
Den stopper, når `|p − mål| < 0,001` og `|v| < 0,01 indeks/s`. Det er samme `Spring`-klasse som i
§3.11.

**Afledt UI (alt fra `p`, ingen egne animationer):**
- **Titel, kategori og meta** viser `recipes[round(p)]`. Opacity = `|2·frac(p) − 1|` (1 ved heltal,
  0 ved krydsningen 0,5). Teksten byttes præcis ved 0,5-krydsningen. Det giver en cross-fade, der er
  kontinuerlig og reversibel under fingeren. `aria-live`-opdatering sker kun, når fjederen er faldet
  til ro (ikke ved hvert kryds).
- **Position »3 af 42«** opdateres ved krydsning, uden animation.
- **Prikker:**
  - Hver prik har vægt `w = max(0, 1 − |k − p|)`. Bredden er `scaleX(1 + 2·w)` på en 8 px prik (den
    aktive ≈ 24 px), og opacity er `.35 + .65·w`.
  - Vinduets start = `clamp(round(p) − 3, 0, n − 7)`. Når starten skifter, glider prik-strippen én
    prik-pitch med `quick`.
  - Kantprikker skalerer `.6` efter samme regel som i dag.
  - Ingen `width`-animation.
- **Parallax inde i covers:** billedet i hvert cover forskydes `translateX(−d·24px)` inden for
  coverets `overflow:hidden`. Det giver dybde billigt og passer til cover flow. Det droppes under
  reduced.

**Gesture-konflikter:**

| konkurrent | regel |
|---|---|
| **Kant-tilbage** (`gestures.js`, 36 px) | Flowet ignorerer pointerdown med `clientX − flowRect.left < 36`. `gestures.js` behandler i dag `button` som `interactive` og blokerer derfor allerede på covers, men *ikke* i mellemrummene mellem covers. Tilføj `[data-pv-gesture-owner]` til `interactive`-selektoren i `gestures.js` og sæt attributten på flowet. Så ejer flowet alt inden for sig selv, undtagen kantzonen, hvor flowet selv giver slip. |
| **Træk ned for tilbage** (`detailDown`, `recipes` er en detail-fokus) | Lodret akselås inden for flowet overlades til browseren, men `gestures.js` `touchDown` returnerer tidligt for `[data-pv-gesture-owner]`. Træk ned uden for flowet (på titel og prikker) går stadig tilbage. Det er bevidst, fordi det er en tom flade. |
| **Topbar** | Ligger uden for flowet. Ingen konflikt. Tryk på topbar under en fjeder: fjederen stopper (pointerdown på dokumentet stopper ikke automatisk; topbar-nav kalder `motion.cancel()` via P1). |
| **Segment Katalog/Udforsk** | Ligger i toolbar over flowet med egen vandret scroll (native). Skift er en lateral P1-overgang (cross-fade). Ved skift mens fjederen kører, snappes `exploreIndex = round(p)` straks og gemmes, så Katalog → Udforsk lander samme sted. |
| **Lodret side-scroll** | `#recipe-view[data-recipe-mode=explore]` har `overflow:visible`. Ved 820 px højde er der ingen lodret scroll i Udforsk. Får siden en gang lodret scroll, er `touch-action:pan-y` allerede korrekt. |

**Performance (60 Hz, 16,7 ms):**
- Pr. frame kun skrivninger: 7 synlige covers × `style.transform` + `::after` opacity via custom
  property + 3 tekst-opacities + 7 prikker. **Ingen læsninger i rAF.** `flowRect` og bredde caches
  ved down og resize.
- `will-change: transform` på covers **kun** under drag og fjeder (sat ved down og fjernet ved hvile).
  Permanent `will-change` på 42 covers à 1440×920 px@2x ≈ 5,3 MB hver ville spise ~220 MB
  GPU-hukommelse. Med `visibility:hidden` for `a > 3,5` er højst 8 lag aktive (≈ 42 MB).
- **Ingen `filter`-animation.** `brightness(.82)` erstattes af en sort `::after` med `opacity .18·a`.
  WebKit kan accelerere visse filtre, men et filter på et 3D-transformeret lag med billede risikerer
  re-rasterisering pr. frame. Overlay-opacity er altid composited.
- `transform-style: preserve-3d` kun på flowet, ikke på covers' børn. `backface-visibility: hidden` på
  covers.
- Billeder har `decoding="async"` (findes allerede). Forudindlæs ±3 fra `round(p)`.
- Måling i PR: Safari Web Inspector → Timelines → Frames på enheden; krav: ingen frame > 16,7 ms
  under et 3-covers-kast.

**Reduced motion:**
- Covers står fladt (`rotateY 0`, `z 0`) som en vandret karrusel. Fingeren følger stadig 1:1 (direkte
  manipulation).
- Ved slip: `quick`, uden bounce, uden projektion over 1 cover. Parallax er droppet.
- Tekst skifter med opacity `--pv-dur-reduced`.

**Konkrete ændringer i koden:**

`recipe-view.js explore()`:
- `choose(k)` bliver `render(p)` (ren funktion af fraktionelt `p`, formlerne ovenfor) plus `settle(k)`
  (opdaterer `exploreIndex`, `aria-current`, `tabIndex`, `aria-hidden`, `aria-live`-tekst og
  forudindlæsning).
- `pointerdown`/`pointerup`-tærsklen (`Math.abs(dx) >= 40`) erstattes af tilstandsmaskinen ovenfor
  (down/slop/drag/up). Den bruger en ny `attachSwipeTrack(flow, {pitch:430, count, onFrame, onSettle, onTap})`
  i `ui/gestures.js`.
- `this.exploreTouchAt` og 600 ms-klikfilteret fjernes. Tap afgøres i tilstandsmaskinen, og `click`
  fra et pointer-tap undertrykkes med `event.preventDefault()` på `click` efter en drag/catch
  (flag pr. gesture, ikke tid).
- `cover.style.filter` fjernes og erstattes af `--shade` custom property pr. cover.
- Prikker: `dots.replaceChildren(...)` ved hver ændring erstattes af en fast pulje på 7 `<i>`, der
  kun får `transform`/`opacity` skrevet.

CSS:
- `[data-recipe-cover]{transition:…}` fjernes.
- Tilføj `[data-recipe-cover]::after{background:#000;opacity:var(--shade,0)}`.
- `[data-recipe-explore-dots]>i{transition:width}` fjernes.
- `[data-recipe-layout=explore]` får `touch-action: pan-y` (har det) + `data-pv-gesture-owner`.

`ui/gestures.js`:
- Ny eksport `attachSwipeTrack()` (1D-track: akselås, hastighedsestimat, rubber-band, projektion,
  `Spring`).
- `interactive`-selektoren får `[data-pv-gesture-owner]`.
- `touchDown` returnerer for samme.
- `gestureIntent` er uændret.

`ui/motion.js`:
- Ny eksport `Spring`, `rubberBand(x, d, c=0.55)` og `project(v, rate=0.998)`.

Den samme `attachSwipeTrack` + `Spring` genbruges til interaktiv pop (P1), træk-for-at-lukke (P2),
lys- og lydstyrke-rubber-band og en mulig kø-swipe-for-at-fjerne.

### 3.11 API: `ui/motion.js` og CSS custom properties

```js
// ui/motion.js — offentlig flade (eksisterende SceneMotion bevares og bygger på dette)
export const DUR = {tap:100, quick:160, base:240, ambient:1400, reduced:150};
export const SPRING = {
  quick:  {duration:.30, bounce:0},
  smooth: {duration:.45, bounce:0},
  snappy: {duration:.40, bounce:.15},
  flick:  {duration:.50, bounce:.20},
};
export const EASE = {out:'cubic-bezier(.2,0,0,1)', in:'cubic-bezier(.4,0,1,1)', inout:'cubic-bezier(.45,0,.55,1)'};

export function springParams({duration, bounce}) {/* → {k, c, zeta, omega} */}
export function springCurve(spec, {tolerance=.004}={}) {/* → {easing:'linear(...)', ms:settle} til WAAPI */}
export function rubberBand(x, dimension, c=.55) {return (1 - 1/(x*c/dimension + 1))*dimension;}
export function project(velocityPxPerS, rate=.998) {return velocityPxPerS/1000 * rate/(1-rate);}
export const isReduced = host => /* én kilde */ ...;

// Analytisk fjeder med velocity handoff; frame-rate-uafhængig, testbar uden DOM.
export class Spring {
  constructor(spec, {value=0, velocity=0, onFrame, onRest, raf=requestAnimationFrame, now=performance.now}){}
  to(target, {velocity}={}) {/* retarget fra aktuel value/velocity */}
  stop() {/* behold value, velocity=0 (fang i flugten) */}
  get value(){} get velocity(){} get resting(){}
}

// Primitiver på SceneMotion (host-bundne, kender reduced og ejerskab):
class SceneMotion {
  page({from, to, kind:'push'|'pop'|'lateral'}) {}          // P1, VT når muligt
  sheet(node, open, {variant:'sheet'|'alert'|'toast'|'bar'}) {} // P2
  list(container, mutate, {stagger=30}) {}                 // P4 (generaliseret settleResources)
  value(node, text, {kind:'digits'|'swap'}) {}             // P5 (erstatter updateClock)
  progress(node, fraction, {source:'tick'|'user', interval}) {} // P5
  state(control, 'idle'|'selected'|'busy'|'done'|'error') {}   // P6 (sætter data-pv-state; CSS gør resten)
  hero({source, target, mutate}) {}                        // P7
  ambient(node, on) {}                                     // P8 (play/pause pr. synlighed)
  cancel() {}                                              // eksisterende
}
```

CSS-kontrakt (attributter, som primitiverne sætter, og som skærme kun *stylerer*, ikke animerer
selv):

| attribut | betydning |
|---|---|
| `data-pv-press="tile|button|icon|flat"` | P3-variant (scale .97 / .98 / 0 / cirkel) |
| `data-pv-state="selected|busy|done|error"` | P6 |
| `data-pv-enter`, `data-pv-leave` | P4-faser (sat i én frame) |
| `data-pv-ambient="pulse|eq|skeleton|drift"` | P8 med fælles keyframes |
| `data-pv-gesture-owner` | P9: `gestures.js` holder sig væk |
| `:root[data-pv-motion=reduced]` | én reduced-kilde for CSS |

Fælles keyframes (erstatter de 30): `pv-spin`, `pv-busy-in`, `pv-skeleton`, `pv-pulse`, `pv-eq`,
`pv-tick`, `pv-enter-up`, `pv-page-in`, `pv-page-out` og de fire vejr-keyframes. **13 i alt.**

---

## 4. Katalog over mikrointeraktioner

Kolonnen »primitiv« henviser til §3.

### Hjem (forside, kort)
| interaktion | primitiv | detalje |
|---|---|---|
| tryk på et kort | P3 `tile` → P1 push eller P7 hero | Scale .97 på down. Kort → detalje er hero med kortfladen som `pv-hero`. |
| kort ændrer størrelse/rækkefølge (aktivitet kommer/går) | P4 reorder | FLIP `smooth`. Størrelse via clip-path, tekst cross-fader. |
| kortets tilstand skifter (tint, ikon, undertekst) | P6 / P5 swap | Tint `--pv-dur-base`, tekst-crossfade. |
| connecting-skeleton | P6 skeleton | Loop indtil forbundet (ikke ×3). |
| robot-glyph rengør | P8 | `RobotMotion` uændret. |

### Topbar
| interaktion | primitiv | detalje |
|---|---|---|
| **Ro**-genvej ind | P1 lateral | Panes cross-fader, playeren FLIP'er til Ro-positionen `smooth`. |
| Ro ud (tryk hvor som helst) | P1 lateral | Spejlet. Tryk-feedback på fotoet: ingen (bevidst; hele fladen). |
| **Svar-pille ankommer** | P2 toast (ovenfra) | `translate(-50%,-12px)→0` + scale .96→1 `snappy`, opacity `--pv-dur-quick`. Skyggen fader ind efter 120 ms. Pillen skubber aldrig layout. Reduced: opacity. |
| Svar-pille forsvinder | P2 ud | opacity + `translateY(-6px)` `--pv-dur-quick` `--pv-ease-in`. |
| header-timer dukker op | P2 toast | Erstatter `pv-topbar-in`. |
| titelskift ved navigation | P1 | Titel cross-fade + 8 px. |
| header-ur minutskift | P5 cifre | Samme implementering som Foto-Ro. |

### Musik
| interaktion | primitiv | detalje |
|---|---|---|
| **tryk play/pause** | P3 `button` + P6 | Ikon `.replace` (pause↔play) `snappy` straks. Omslaget skalerer `1↔.9` på `smooth` (Apple Music-mønstret: pauset = mindre). Spinner kun efter 400 ms. |
| næste/forrige | P3 + P5 swap | Omslag cross-fade `--pv-dur-base` med `translateX(∓16px)` i retningen. Titel og kunstner cross-fader. Hvert tryk er en handling (ingen sammenlægning). |
| **lydstyrke-slider** | P9-track (1D) | Down: sporet bliver tykkere (`scaleY 1→1.6`, `--pv-dur-tap`). Drag 1:1. Over min/max: rubber-band på fyldet (`rubberBand`, d = 40 px). Release: tykkelse tilbage `quick`, værdien står. Ekstern ændring: `smooth`. |
| resultat-række tryk | P3 `tile` → P7 hero (`flyArtwork`) | Omslag flyver til `#cover`. |
| resultat afspiller-indikator | P8 eq | Tre `scaleY`-bjælker. |
| **højttaler-chip** | P3 `button` + P2 sheet | Chip-tryk åbner højttalerlisten som sheet. Valg i listen: rækken får check med `snappy`-tick. Chippens navn swappes med P5 swap. Sheetet bliver stående, indtil brugeren lukker det. |
| opdater (`#music-refresh`) | P6 | Rotationen looper, indtil den ikke længere er busy, og tick ved done. |

### Kø
| interaktion | primitiv | detalje |
|---|---|---|
| kø åbner | P2 sheet (eller P1 push) | Erstatter `pv-queue-rise`. |
| **tryk på kø-element** | P3 `tile` + P6 | Rækken bliver straks »valgt« (afspiller-indikator flytter med FLIP fra gammel til ny række `smooth`, som ét element). Rækkerne over glider op (P4 leave) når serveren bekræfter. |
| nyt nummer øverst | P4 enter/leave | Den spillede række forlader, resten FLIP'er op. |
| pladsholder-rækker | P6 skeleton | Opacity-loop, ikke background-position. |

### Mini player
| interaktion | primitiv | detalje |
|---|---|---|
| tryk → Musik | P7 hero | Omslag og flade udvides til Musik. Resten cross-fader. |
| træk ned på Musik-hero → mini | P9-track (lodret) + P7 | 1:1, `flick` ved kast (Apple Music). |
| »flyt hertil«-prikker, radio-live | P8 pulse | Én fælles puls. |
| træk-sporet (scrub) | P9-track | Som lydstyrke. |

### Lys
| interaktion | primitiv | detalje |
|---|---|---|
| **rum-toggle** | P3 + P6 | Thumb: `translateX` `snappy` (ikke `right`). Track-farve `--pv-dur-quick`. Rækkebaggrund `--pv-dur-base` (fra 500 ms). Ingen spinner < 400 ms. |
| **lysstyrke-slider** | P9-track | Som Apple Home-pillen: fyld 1:1, rubber-band ud over 0/100 %, intet glid ved release. Værdi-tal: P5 cifre (kun hele 10'ere animerer under drag, ellers ville det blinke). |
| lampeliste fold ud | expandable + P4 enter | Stagger 30 ms. |
| lampe-niveau dukker op | P5 swap | |

### Skærm-dialog (`#quick-sheet`)
| interaktion | primitiv | detalje |
|---|---|---|
| åbne/lukke | P2 sheet | Træk ned for at lukke. |
| auto-dæmp-toggle | P6 toggle | `translateX`, ikke `left`. |
| lysstyrke | P9-track | |

### Opskrifter (katalog og Udforsk), udstillingseksemplet
| interaktion | primitiv | detalje |
|---|---|---|
| **swipe i Udforsk** | P9 spor B | Kontinuerlig scrub 1:1 (fraktionelt `p`, x/z/rotateY interpoleret), velocity-projektion (0,998) kan springe flere covers over, `flick`-fjeder til snap, rubber-band før første og efter sidste, fang i flugten, tekst cross-fader ved 0,5-krydsning, prikker følger kontinuerligt, billed-parallax i cover. |
| tap på nabo-cover | P9 → `snappy` | Animerer til den. Ikke åbne. |
| tap på centrum-cover | P3 `tile` → P7 hero | Coveret (720×460) bliver opskriftens hero-foto. |
| Katalog ↔ Udforsk (segment) | P1 lateral | Position bevares (`round(p)` ↔ katalogrække). |
| kategori-chips | P9 spor A | Native vandret scroll, `proximity`-snap. Valgt chip: P6 selected. Listen filtreres med P4 (leave og enter, stagger). |
| katalog-scroll | P9 spor A | Native. Alfabet-scrub sætter `scrollTop` direkte (iOS-adfærd), og markøren følger fingeren uden animation. |
| »I gang«-række | P4 | Står øverst, ankommer med enter. |

### Opskrift
| interaktion | primitiv | detalje |
|---|---|---|
| **opskriftsfoto loader** | P5 swap (media) | Pladsholder i opskriftens tint. Billedet fader ind 0→1 `--pv-dur-base` når `decode()` er færdig (ikke på `load`, som kan give et halvt-dekodet blink). Ingen scale. Cachet billede: ingen animation. |
| trin markeres færdigt | P6 + P3 | Check-ikon `.replace` `snappy`. Trinnummerets baggrund `--pv-dur-quick`. |
| ingredienser fold ud/ind | expandable | |
| timer fra trin | P2 toast + P5 | Header-timer ankommer (topbar). |
| parallax på hero-foto ved scroll | P9 A (scroll-driven, Safari 26+) | `translateY` ½ hastighed. Kun hvis det er understøttet. |

### Robot
| interaktion | primitiv | detalje |
|---|---|---|
| **start-knap busy** | P6 | Tryk: knappen viser »Starter« og pause-ikon straks (selected). Spinner efter 400 ms. Bekræftet rengøring: tick + glyph-vrik (`RobotMotion`). Ukendt: falder tilbage med farveovergang og forklarende undertekst. Knappen er aldrig låst. |
| sticky bundbjælke | P2 bar | `smooth` ind, `--pv-dur-quick` ud (fra .24 s symmetrisk). |
| valg (rum, styrke, gentag) | P6 selected | Choice-baggrund `--pv-dur-quick`. Niveau-legend-ring = P6 busy. |

### Tesla
| interaktion | primitiv | detalje |
|---|---|---|
| lås/klima-handling | P6 | Samme forløb som robot (sender → bekræftet/ukendt). |
| ladeniveau ændres | P5 progress | `smooth` til ny værdi (fra opacity-blink). Tal: P5 cifre. |

### Vejr
| interaktion | primitiv | detalje |
|---|---|---|
| **vejr-opdatering** | P5 swap | Temperatur: P5 cifre (retning op/ned). Ikon: `.replace`. Stemnings-baggrund: cross-fade mellem toner `--pv-dur-ambient` (en tone-ændring er en ambient begivenhed, ikke feedback). |
| timeliste | P9 A | Native vandret scroll, `proximity` (findes). |
| stemnings-loops | P8 | Pause, når de ikke er synlige. |

### Timer
| interaktion | primitiv | detalje |
|---|---|---|
| nedtælling | P5 cifre + progress | Minutter ruller. Sekunder skifter uden animation. Ringen er lineær og kontinuerlig. |
| **+N min** | P3 + P5 | Tryk-scale, ringen animerer til ny andel `smooth`, minut-cifre ruller op. Knappen viser kortvarigt »+1« (P2 toast lokalt, 600 ms). Hvert tryk lægger til. |
| pause/fortsæt | P6 | Ikon `.replace`. Ringen fryser eller fortsætter (ingen animation på selve frysningen). |
| **»Start igen«** | P3 + P5 | Ringen fylder fra 0 til fuld med `smooth` (ikke hop), og cifrene ruller til starttiden. |
| timer færdig | P8 | Én langsom puls på ringen (1400 ms), ikke to loops. |
| **alarm ringer** | P2 alert + P8 | Alarmen kommer med `scale .94→1` `snappy`. Én puls på ikonet (1400 ms, `--pv-ease-inout`) som looper, indtil Stop. Ingen 60-gangs-tæller. Stop: P2 ud `--pv-dur-quick`. Reduced: statisk ikon med fuld kontrast (alarmens *lyd* bærer budskabet). |
| ekstra timere tilføjes | P4 enter | Kortet ankommer, naboer FLIP'er. |

### Svar (stemmesvar)
| interaktion | primitiv | detalje |
|---|---|---|
| svar ankommer, mens man står på en anden skærm | P2 toast (Svar-pille) | Se Topbar. |
| svar åbnes | P1 push (eller P7 hero fra pillen) | |
| indlæsning | P6 skeleton | |
| svar-tekst opdateres (streaming) | P5 swap | Ingen fade pr. token. Tekst tilføjes uden animation, og højden vokser uden animation (læsbarhed først). |
| historik-række tryk | P3 `tile` | Fra `transform .12s ease, filter .12s` til standard P3. |
| lytte-mark (voice surface) | P8 pulse | Fasebestemt periode beholdes, men bruger fælles keyframe. |

### Foto-Ro
| interaktion | primitiv | detalje |
|---|---|---|
| ur minutskift | P5 cifre | |
| ur-drift | P8 | Uændret. |
| billedskift (fremtid) | P8 cross-fade | 1200 ms. |
| ressource-rail (robot, timer i Ro) | P4 | Ankomst og afgang. |

---

## 5. Implementeringsplan

### 5.1 PR-rækkefølge (små og hver for sig grønne)

| # | PR | indhold | risiko |
|---|---|---|---|
| 1 | **Tokens** | Nye `--pv-dur-*`, `--pv-ease-*`, `--pv-spring-*` i `ui-kit.css`. Gamle aliaser peger på nye. `motion.js`: `DUR`, `SPRING`, `EASE`, `springParams`, `springCurve`, `rubberBand`, `project`, `Spring`, `isReduced`. Intet visuelt skifter endnu. | lav |
| 2 | **Én reduced-kilde** | `SceneMotion` sætter `:root[data-pv-motion]`. De 9 checks peger på `isReduced`. | lav |
| 3 | **Press (P3)** | Ret release-hoppet (scale animeres tilbage på `quick`). Overlay-pseudo i stedet for box-shadow/filter. Fjern lite-grenen. | mellem: rører alle knapper; kør visual-sweep |
| 4 | **Rydning** | Fjern `pv-advice-pending`, `music-control-ack`, `holdGeometry`, `transitionContent`, legacy `ack`. Flet spinnere, skeletons og pulser til fælles keyframes. Loops til ∞ med state. Layout-egenskaber (`left`/`right`/`height`/`width`/`background-*`) til transform. | lav-mellem |
| 5 | **Sheet (P2) og State (P6)** | Asymmetrisk exit, 400 ms spinner-forsinkelse, done-tick, toggles på translateX. | mellem |
| 6 | **Page (P1)** | VT med fallback. Udgående lag. Push/pop/lateral. Derefter interaktiv kant-pop med `Spring`. | **høj**: navigation er kernen; kræver browserrejser |
| 7 | **Værdi (P5)** | `motion.value` (cifre med retning) og `motion.progress` (lineær tick, fjeder ved bruger). Header-ur, Foto-Ro, timer og vejr. | lav |
| 8 | **Liste (P4)** | `motion.list` generaliseret fra `settleResources`. Kø-FLIP og afspiller-indikator. | mellem |
| 9 | **Udforsk-swipe (P9 B)** | `attachSwipeTrack` og `explore()`-omskrivning. Udstillingseksemplet; gør det på enheden. | mellem |
| 10 | **Hero (P7)** | Mini player → Musik, kort → detalje, opskrift-cover → opskrift. Træk ned for at lukke. | høj (VT-navnekollisioner) |
| 11 | **Native-scroll-finpudsning (P9 A)** og scroll-driven eksperiment | Snap på chips og hylder, parallax bag feature-detect. | lav |

Hver PR følger `AGENTS.md`:
- et brugerresultat, f.eks. »Når jeg slipper en knap, vender den tilbage blødt inden for 450 ms og
  hopper ikke«
- en test, der fejler før
- `npm run build:assets` og en opdateret `asset-manifest.json`
- Green-check efter installation

### 5.2 Teststrategi

**Unit (node, `tests/podview/`):**
- `motion-tokens.test.mjs`:
  - `springParams({duration:.45,bounce:0})` giver k = 195,0 ± 0,1 og c = 27,93.
  - `springCurve` reproducerer `--pv-spring-0` og `--pv-spring-15` fra `ui-kit.css` byte for byte. CSS
    og JS kan altså ikke glide fra hinanden.
  - Settle-ms er 441/661/557.
  - `rubberBand(0)=0`, er monoton og har `rubberBand(∞)→d`.
  - `project(1000, .998) ≈ 499`.
- `motion-spring.test.mjs`:
  - `Spring` med fake `raf` og `now`: når målet ved bounce 0 uden overshoot.
  - Retarget midt i flugten bevarer hastigheden (kontinuert derivat).
  - `stop()` beholder værdien.
  - Rammeuafhængighed: 30 og 60 Hz giver samme position ved t.
- `swipe-track.test.mjs`:
  - Akselås ved 10 px.
  - Vandret ved `|dx|>|dy|·1,2`.
  - Hastighed fra regression.
  - Kast 2000 px/s fra p=3 giver mål 5.
  - Rubber-band ved p<0.
  - Catch giver ikke tap.
  - Pointercancel giver snap til nærmeste.
- `explore-render.test.mjs`: `render(p)` ved heltal er **identisk** med canvassets formler (x, z,
  rotateY, shade), kontinuerlig ved d=±1, og tekst-opacity er 0 ved .5.
- Udvid `root-motion.test.mjs` og `root-pressed-state.test.mjs` til de nye primitiver.

**Token-lint:**
- `scripts/check-ui-tokens.mjs` afviser rå `ms`/`s`/`cubic-bezier`/`ease(-in|-out)?` i
  `transition`/`animation` uden for token-blokken.
- Den afviser animation af `left|right|top|width|height|box-shadow|filter|background-position|background-size`.
- Den afviser `:has(` + `.is-pressed`.

**Reduced motion:**
- For hver primitiv en test med `matchMedia` → reduced. Den forventer kun opacity-keyframes og
  varighed ≤ 150 ms.
- Ingen uendelige animationer (`document.getAnimations().filter(a=>a.effect.getTiming().iterations===Infinity)`
  er tom).
- P9 B fladt (rotateY 0).

**Browserrejser (`tests/browser/*_actual_e2e.cjs`):**
- Kør med `reducedMotion: 'reduce'` og normal.
- Navigation: efter tryk er den nye pane synlig < 100 ms, og den gamle er væk ≤ 300 ms.
  Interaktion under VT virker (skip).
- Press: `scale` er tilbage til 1 i ≤ 500 ms efter `pointerup` og aldrig et spring. Sample
  `getComputedStyle(...).scale` hver frame og assert monotoni.

**`scripts/visual-sweep.mjs`:**
1. Tilføj `--motion` (en ny flag): for hver skærm fanges kontaktark-billedet **efter**
   `document.getAnimations()` er tom eller kun består af ∞-loops. Det fjerner falske diffs fra
   halvt-animerede billeder.
2. Tilføj `--reduced`: hele sweepet med `reducedMotion:'reduce'`.
3. Tjek pr. side, efter 5 s hvile:
   - alle ikke-ambient-animationer er færdige
   - antal kørende ∞-animationer ≤ 1 pr. zone
   - intet element har `will-change` i hvile
4. Udforsk: skærmbilleder ved p = 2, 2,25, 2,5 og 2,75 via en test-hook (`?stage=recipes-explore&p=2.5`),
   så kontinuiteten kan ses i arket.

Sweepet kører i dag Chromium. WebKit-specifikke ting (VT-snapshots, native scroll-snap) skal derfor
verificeres med Playwright `webkit` i de relevante browserrejser og manuelt på væg-iPad'en (Safari
Web Inspector via kabel → Timelines → Frames).

### 5.3 Risici

| risiko | hvorfor | modtræk |
|---|---|---|
| **Main-thread-jank på M1 ved 60 Hz** (briefen nævner A15; Air 5 har M1. GPU'en er ikke problemet) | Style recalc fra brede `:has()`-regler (målt ~0,6 s pr. tryk på Frameo; på iPad mindre, men stadig reel). `render()` i samme frame som en overgang. | Animér via egne attributter på målnoden, aldrig klasser der matcher `:has()`. Planlæg tunge `render()`-kald efter overgangens første frame (`requestAnimationFrame` → `setTimeout 0`). JS-fjedre kun under gesture. |
| **Layout thrash** | FLIP læser og skriver geometri. Interleaving giver tvungne layouts (kommentaren i `settleResources` viser, at det er set før). | Alle læsninger i én fase, så alle skrivninger. `motion.list` håndhæver det. Ingen `getBoundingClientRect` i rAF under drag (cache ved down). Lint mod `offsetWidth` i animation-loops. |
| **Repaint-tunge egenskaber** | `filter`, `box-shadow`, `backdrop-filter` under transform (jf. `scenePlayerMoving`-workaroundet for playerens backdrop-filter, der splittes i tiles). | Overlay-opacity i stedet for filter. Backdrop-filter slås fra under bevægelse (findes for playeren og skal generaliseres). |
| **GPU-hukommelse** | `will-change` permanent på mange store billeder (cover flow, hylder). | `will-change` kun under bevægelse. `visibility:hidden` uden for synsfelt. |
| **View Transitions i WKWebView** | iPadOS < 18 har ingen VT. Snapshots fryser live-indhold. Navnekollision aborterer. Ingen input under overgang. | Feature-detect plus WAAPI-fallback. Varighed ≤ 450 ms perceptuelt. Navne sættes kun på kilde og mål lige før. `skipTransition()` ved nyt input. Test i Playwright WebKit. |
| **Fjeder-hale og logik** | CSS-varighed = settle (661 ms), men UI skal reagere ved perceptuel tid. | Ingen logik på `transitionend` eller `finished` for brugerrettet tilstand. Brug modelstate straks. Det følger AGENTS.md (»visning af eget valg < 300 ms«). |
| **Bevægelse skjuler sandhed** | En done-tick ved ukendt udfald ville lyve. | P6 tick kun ved *bekræftet* tilstand. Ukendt viser ingen tick (jf. »intet opdigtet«). |
| **Gesture-konflikter** | Kant-back, træk-ned-tilbage, native scroll og P9 B på samme flade. | `data-pv-gesture-owner` som eneste mekanisme, 10 px akselås og tests pr. kombination i `swipe-track.test.mjs` og `root-gestures.test.mjs`. |
| **Natteregel** | Visuelle tests af musik/timer kan udløse lyd på Green. | Motion-PR'er testes lokalt med fixtures. Green-sweep kun læsende (`--green`), og ingen lydprøver kl. 18–08. |

---

### Kilder

- Apple, WWDC23 »Animate with springs« (duration/bounce-model, perceptuel varighed, velocity
  preservation, presets): https://developer.apple.com/videos/play/wwdc2023/10158/
- Apple, WWDC18 »Designing Fluid Interfaces« (projektion med decelerationRate, rubber-band,
  afbrydelse, 10 pt hysterese, Music 100 %/80 % dæmpning): https://developer.apple.com/videos/play/wwdc2018/803/
- Apple HIG, Motion (Reduce Motion: erstat slide, zoom og parallax med dissolve):
  https://developer.apple.com/design/human-interface-guidelines/motion
- Apple, SwiftUI `Animation.snappy(duration:extraBounce:)` m.fl.:
  https://developer.apple.com/documentation/swiftui/animation/snappy(duration:extrabounce:)
- Apple, Safari 26.0 Release Notes (scroll-driven animations):
  https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes
- WebKit, »WebKit Features in Safari 26.0«: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- WebKit, »WebKit Features for Safari 26.5« (fejlrettelser i scroll-driven animations):
  https://webkit.org/?p=17938
- Safari 17.2 (`linear()`), 17.4 (`transition-behavior`), 17.5 (`@starting-style`), 18.0
  (same-document View Transitions) og 18.2 (`view-transition-class`): de respektive Safari
  Release Notes på developer.apple.com/documentation/safari-release-notes.
- Rubber-band-formlen `(1 − 1/(x·c/d + 1))·d` med c = 0,55 er den bredt citerede rekonstruktion af
  UIScrollViews adfærd. Den er ikke offentliggjort af Apple.

Egne beregninger: fjederparametre, `linear()`-punkter, settle-tider og overshoot er regnet med
`spring.py`. Scriptet ligger i sessionens scratchpad og flyttes ind i
`scripts/gen-motion-tokens.mjs` i PR 1, så tokens genereres og testes i stedet for at kopieres.
