# PodView — bevægelse

PodView er et React 19-panel i Home Assistant (`/podview`), vist på væg-iPad'en (iPad Air 5, 1180×820, HA Companion,
WKWebView). Bevægelse skal føles som en native iPadOS-app og bygges af få, faste dele, der bruges ens overalt.
Dette dokument beskriver opsætningen, som den er i koden nu. Den gamle vægside og dens egne
bevægelsesmoduler (`ui/page-motion.js`, `ui/ro-motion.js`, `ui/pressed-state.js`, `ui/list-motion.js`,
`ui/native-motion.js`, `recipe-view.js` m.fl.) er fjernet; deres historik står i git.

## 1. Stakken

| Hvad | Hvordan | Hvor |
|---|---|---|
| Bibliotek | `motion/react` (npm `motion`) er det eneste animationsbibliotek. Ingen hjemmelavede animationsløkker, ingen rå Web Animations, ingen CSS-keyframes eller -transitions ud over trykreaktionen | `package.json` |
| Tokens | Seks fjedre (`SPRING`: `page`, `nav`, `quick`, `smooth`, `snappy`, `flick`) som rigtige motion/react-fjedre (`TRANSITION.page` …: `type: 'spring'` med stivhed og dæmpning udregnet fra Apples duration/bounce), korte tweens kun til opacity og farve (`TRANSITION.fade`, `.reduced`, `.tap`, `.tick(ms)`, `.ambient(n)`). CSS får kun varigheder og easings til trykreaktionen (`scripts/gen-motion-tokens.mjs` → `--duration-pv-*`, `--ease-pv-*`) | `podview/src/lib/motion/tokens.ts`, `podview/src/styles/motion-tokens.css` |
| Fysik, ikke tid | Fjedrene angives som fysik (stiffness/damping, masse 1), ikke som motions `visualDuration`: en tidsdefineret fjeder i motion smider den hastighed væk, den arver. En fjeder, der får nyt mål midt i flugten (et tryk under et skift, slip efter et swipe), fortsætter med sin aktuelle hastighed | `tokens.ts` (`spring()`) |
| Global opsætning | `<MotionConfig reducedMotion="user" transition={TRANSITION.smooth}>` omkring hele panelet: systemets »Reducer bevægelse« og standardfjederen for alt, der ikke selv vælger (fx layout-animationer). Komponenter, der vælger selv, læser `useReducedMotion()` og bruger `TRANSITION.reduced` | `podview/src/app/Providers.tsx` |
| Sideskift (P1) | Skærmstakken i Zustand (`nav.ts`); hver monteret skærm er et lag med én motion value, `p` (hvor meget den vises). Et skift fjedrer de to berørte lag til nyt `p` på samme fjeder i samme øjeblik, så tilbage er præcis den samme bevægelse baglæns, og et tryk midt i et skift giver nyt mål med den aktuelle hastighed. **Widgetten vokser:** åbnes en skærm fra en Hjem-widget, vokser en flade i widgettens farve fra widgettens præcise rect til skærmens område (736-kolonnen, eller 1132 uden afspilleren); en kopi af widgetten følger fladens hjørne og toner ud i de første 40 %, skærmen toner ind over fladen med 8 px sætning i de sidste 40 % (når fladen næsten fylder området), resten af Hjem viger til .1 og .98 (opacity på p², så den viger tidligt og vender sent tilbage). Tilbage krymper fladen ind i widgettens rect, som den er da. **Alt andet** (Find musik, Afspiller, Svar, en listerække) er en ren krydstoning af den øverste skærm. Hvert lag er klippet til sit område: intet passerer afspillerkolonnen. Alt på `TRANSITION.nav`, kun `transform` og `opacity` (fladens hjørneradius korrigeres for skaleringen). Hjem, den aktuelle og den forrige skærm forbliver monteret; en skærm bygges, når fingeren lander på dens flise eller på Tilbage (`data-opens`, prewarm), og en skærm, der er bygget i forvejen (billederne afkodet, første billede tegnet), skubbes ind i første billede efter trykket; kun en skærm, der stadig bygges, venter på det. Fjederen hviler ved .3 % (≈ 0,5 s). Et lag tager kun tryk, når det er den viste skærm og tegnet mindst halvt (opacity ≥ .5, `hits()` i `stack.tsx`): et usynligt lag er aldrig et mål. Låsevagten (`lib/diagnostics/hit-guard.ts`) melder et tryk på et usynligt lag, der stadig er et mål 0,7 s senere, som konsolfejl. Fingeren på »Tilbage« bygger den krympende flade i forvejen | `podview/src/panel/stack.tsx`, `Shell.tsx`, `nav.ts` |
| Tilbage | Ingen swipe tilbage: væggen betjenes med tryk, og »Tilbage« i toppen går tilbage med `SPRING.nav`. Et vandret træk er skærmens eget (hylder, skydere) | `Shell.tsx`, `stack.tsx` |
| Skjulte skærme | En skærm uden for syne tegnes ved opacity .001 (WebKit beholder lagets pixels, så den aldrig males om ved næste skift), tager ingen tryk og er skjult for hjælpemidler (`aria-hidden`, aldrig `inert`). Dens ambiente løkker står stille: `useShown()` er falsk i alt andet end den viste skærm | `stack.tsx`, `podview/src/lib/motion/shown.ts` |
| Tryk (P3) | React Aria Components (`Button`, `ToggleButton`, `Switch` …) ejer tryk, tastatur og hjælpemidler; den synlige trykreaktion er utilities på `[data-pressed]` over `duration-(--duration-pv-tap)`. Det er den eneste CSS-transition | `podview/src/ui/` |
| Dialoger og ark (P2) | `AnimatePresence` + `motion` med opacity (`fade`) og en kort skalering på `quick`; fokus og modalitet er React Aria's. En dialog, der kan lukkes, kan trækkes ned som et iPad-ark: en finger på dens flade (ikke på en kontrol) trækker den 1:1; slippes den over 120 px nede eller hurtigere end 600 px/s, kastes den ud nedad med fingerens hastighed, ellers fjedrer den tilbage på `flick`. En alertdialog skal besvares og trækkes aldrig | `podview/src/ui/Modal.tsx`, `TimerAlarm.tsx` |
| Valg (fælles element) | En gruppe chips (`Choices`) har ét mørkt valgfelt, et `layoutId` i gruppens egen `LayoutGroup`: et nyt valg flytter feltet derhen på `quick` som en segmenteret kontrol (rum på Hjem, kategorier i Find musik og Opskrifter, højttaler, robot, bil, endepunkt) | `podview/src/ui/Choices.tsx` |
| Lister og tilstedeværelse (P4) | `AnimatePresence` + `layout="position"` på standardfjederen: timerkort kommer ind og går ud (`popLayout`, de øvrige glider på plads, også »Start en timer«); kørækker kommer nedefra, en spillet række løftes ud (`popLayout`); svarrækker glider ned, når et nyt svar lægger sig øverst (uden fade, så et live-svar, der gemmes, aldrig blinker); en besked (`Notice`) lægger sig ind ovenfra; et afkrydset opskriftstrin skifter tal til flueben med et lille pop (`snappy`). Skærmlagene og svarlisten er `layoutScroll`, så målingen tåler scroll | `Timers.tsx`, `TimerCard.tsx`, `music-queue.tsx`, `Answers.tsx`, `panel/ui.tsx`, `Recipes.tsx` |
| Værdier (P5) | `RollingDigits` ruller de ændrede cifre: det nye ind fra 30 % under, det gamle ud opad (`AnimatePresence mode="popLayout"`), på `quick`; `useProgress` driver en timerrings fremdrift som motion value, som cirklens `strokeDashoffset` læser (kun cirklen males om): et nedtællingstik lineært over sekundet, alt andet på `smooth` | `podview/src/lib/motion/value.tsx`, `TimerCard.tsx` |
| Ro ↔ aktiv | Ro er et almindeligt fuldskærmslag, der kun er monteret, mens Ro vises (ingen usynlig ventende kopi, ingen `useShown`). Det toner ind på `TRANSITION.nav` (opacity, WAAPI, så det ikke afhænger af requestAnimationFrame) og ud igen ved et tryk, og afmonteres, når udtoningen slutter. Fra det øjeblik det begynder at gå, tager det ingen tryk (`pointer-events: none`, `inert`), uanset om udtoningen bliver færdig; mens det vises, vækker et tryk hvor som helst panelet: det kan aldrig låse. Det første foto er afkodet på forhånd (`new Image()` + `decode()`, fra albummets cache; Ro åbner på det foto, det viste sidst), og det næste foto i karusellen ligeså. Uret er et `setInterval` justeret til minuttet; karusellen et 20-s-trin med 1,2 s krydstoning. Glaskortene har ingen levende blur, mens Ro bevæger sig (`data-moving`) | `podview/src/panel/Rest.tsx` |
| Indhold, der ankommer | Et afkodet billede toner ind med opacity; handlinger, der skifter (fx Opskrifters Start/Fortsæt/Afslut), cross-fader med `AnimatePresence mode="popLayout"`; afkrydsede trin dæmpes med `animate={{opacity}}` | `FindMusic.tsx`, `Recipes.tsx` |

Grundregler:

- Kun `transform` og `opacity` animeres, plus en timerrings `strokeDashoffset` (ét lille SVG-lag). Ingen animation af
  `box-shadow`, `left/top/width/height`, `background-size`, filtre eller custom properties, der arves af et træ.
- Rumlig bevægelse er en fjeder; opacity og farve er korte tweens. Ambiente løkker (puls, ånding, vejrkunst) er tweens
  med `TRANSITION.ambient()` og står stille ved reduceret bevægelse og uden for syne.
- Logik venter aldrig på en animation (`onAnimationComplete`, `transitionend`): fjederhalen er lang, og et tryk
  skal virke med det samme.
- Ingen blink: indhold, der ikke har ændret sig, tegnes ikke om, og en skærm viser sine data i første billede
  (data hentes, når panelet starter, og holdes varme i TanStack Query-cachen).
- Nye transitions bruger `TRANSITION.*` fra `tokens.ts`; CSS bruger `duration-(--duration-pv-*)` og `ease-pv-*`.

Test: Vitest (happy-dom) ser hver animations slutning med det samme (`MotionGlobalConfig.skipAnimations` i
`src/test/setup.ts`); selve bevægelsen bevises i WebKit af panelrejsen (`tests/browser/ha_panel_actual_e2e.cjs`:
ingen swipe tilbage, reduceret bevægelse uden glid, frames pr. skift). Skærmbillederne
(`tests/browser/ha_panel_screens.cjs`) tages med systemets reducerede bevægelse, så de bedømmes i hvile.

## 2. Tokens

| Token | Værdi | Brug |
|---|---|---|
| `SPRING.page` / `TRANSITION.page` | 0,35 s, bounce 0 (k ≈ 322, c ≈ 35,9) | et ark eller en skinne, der falder på plads |
| `SPRING.nav` / `TRANSITION.nav` | 0,38 s, bounce 0 (k ≈ 273, c ≈ 33,1): iOS' response, kritisk dæmpet | sideskift, topbjælkens titel, afspillerkolonnen, Ro, og noget fingeren slap, der lægger sig på plads med fingerens fart (Udforsks Cover Flow) |
| `SPRING.quick` / `TRANSITION.quick` | 0,25 s, bounce 0 (k ≈ 632, c ≈ 50,3) | små skift: valgmarkør, dialog, ciffer |
| `SPRING.smooth` / `TRANSITION.smooth` | 0,40 s, bounce 0 (k ≈ 247, c ≈ 31,4) | lister, layout, værdier; standard i `MotionConfig` |
| `SPRING.snappy` / `TRANSITION.snappy` | 0,35 s, bounce 0,15 (k ≈ 322, c ≈ 30,5) | ankomster (alarmen, nyt svar) |
| `SPRING.flick` / `TRANSITION.flick` | 0,45 s, bounce 0,20 (k ≈ 195, c ≈ 22,3) | kun efter en gestus med momentum |
| `TRANSITION.fade` | 160 ms tween, `EASE.out` | opacity og farve |
| `TRANSITION.dissolve` | 400 ms tween, `EASE.out` | en rolig, hel krydstoning (ikke længere Ro, som følger `nav`) |
| `TRANSITION.reduced` | 150 ms lineær | alt ved reduceret bevægelse |
| `TRANSITION.ambient(n)` | n × 1400 ms, `EASE.inout`, uendelig | puls og ånding |
| `DUR.tap` / `--duration-pv-tap` | 100 ms | trykreaktion (CSS) |
| `DUR.quick` / `--duration-pv-quick` | 160 ms | fades |
| `DUR.base` / `--duration-pv-base` | 240 ms | (reserve) |
| `DUR.ambient` / `--duration-pv-ambient` | 1400 ms | ambient periode |
| `DUR.reduced` / `--duration-pv-reduced` | 150 ms | reduceret bevægelse |
| `EASE.out` | `cubic-bezier(.2,0,0,1)` | indgang og tilstandsskift |
| `EASE.in` | `cubic-bezier(.4,0,1,1)` | exit |
| `EASE.inout` | `cubic-bezier(.45,0,.55,1)` | ambiente løkker |

Fjedrene følger Apples duration/bounce-model (masse 1, k = (2π/duration)², ζ = 1 − bounce, c = 2ζ√k). `duration` er
den oplevede varighed; fjederen falder helt til ro lidt senere (sideskiftet er under en halv pixel efter ca. 0,5 s).

## Måling på iPad'en

`podview/src/lib/diagnostics/frame-meter.ts` måler på selve skærmen. Hvert tryk åbner en session fra fingeren ned,
til bevægelsen er faldet til ro (højst 1,5 s efter slip): kun `requestAnimationFrame`-deltaer. Bevægelse ses
generisk (Web Animations via `document.getAnimations`, CSS-transition/animation-events, scroll); arten udledes af
den viste skærm før og efter; bevægelse, der kører som JavaScript (motion/react-fjedre på motion values), holder
måleren (`holdMeter`), til den er faldet til ro. I tomgang koster måleren intet, og den læser aldrig geometri.
Panelet samler sessionerne i sin sundhedsrapport (»frames«, `podview/src/panel/health.ts`), som integrationen modtager over
heartbeat'en. Ved 60 Hz er 16,7 ms en frame; over 34 ms er to tabte.

## 3. Reference: sådan bevæger iOS/iPadOS sig

### 3.1 Springs er standarden, ikke kurver

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

### 3.2 Præsentation: sheet, modal, push/pop

| overgang | adfærd i iOS/iPadOS | det vi kopierer |
|---|---|---|
| **Sheet / formSheet** (iPad) | Glider ind nedefra på en kritisk dæmpet fjeder på ca. 0,5 s. Backdrop dæmpes samtidig. Sheetet kan trækkes 1:1 og lukkes med et kast. Et halvt træk fjedrer tilbage med fingerens hastighed. | PodView: kittets `Sheet` er forankret til bundkanten og glider op nedefra på `TRANSITION.nav` og ned igen (kastet: med fingerens fart); det svæver aldrig midt på skærmen. Træk ned for at lukke med velocity-projektion (§3.3). |
| **Navigation push** | Ny side kommer ind fra højre i fuld bredde. Den gamle side går ca. 30 % til venstre (parallax) og dæmpes. Bevægelsen er fjeder-agtig og ca. 0,35–0,5 s. | Ejerens valg (27. nov.): som når iOS åbner en app fra sit ikon. Widgetten vokser til skærmen og krymper tilbage; andre skift krydstoner (§1), på `nav`. |
| **Interaktiv pop** | Kant-swipe fra venstre trækker siden 1:1. Ved slip afgør position og hastighed, om man fuldfører eller annullerer, og bevægelsen fortsætter med fingerens hastighed. | PodView har ingen swipe tilbage; »Tilbage« i toppen (§1). |
| **Afbrydelse** | Alle de nævnte kan afbrydes midt i flugten. Et nyt tryk eller en ny gesture overtager fra den aktuelle *præsentationsværdi* med den aktuelle hastighed. | Én ejer pr. element. Retarget fra den synlige værdi, aldrig fra modelværdien. `SceneMotion` gør allerede det første. |

### 3.3 Tryktilstande

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

### 3.4 Værdiændringer, og hvad web-view'et ikke har

| native | hvad det gør | WKWebView-substitut |
|---|---|---|
| `contentTransition(.numericText())` | Ændrede cifre ruller lodret og blur-fader. Uændrede cifre står stille, og retningen følger værdien (op/ned). | Ciffer-spans (som `updateClock`). Kun ændrede cifre animerer: translateY ±30 % og opacity 0→1 på `quick`. Retningen følger fortegnet. Ingen blur (filter er dyrt). |
| List insert/delete (`List`, diffable data source) | Nye rækker folder ind, mens naboer glider på fjeder. Slettede rækker kollapser. | FLIP på naboer plus `@starting-style` til den nye række (§3.5). |
| `matchedGeometryEffect` / zoom-transition (iOS 18) | Et element flyver fra kilde til mål, og alt andet cross-fader. | motion/react `layoutId` (fx chipsenes valgfelt). Hjem-flise → skærmens hero er ikke lavet: skærmstakken holder både Hjem og skærmen monteret, så et delt element skulle monteres betinget (en strukturændring). |
| SF Symbols `symbolEffect` (`.bounce`, `.pulse`, `.replace`) | Ikonet giver kontekstuel feedback. | `.replace` bliver cross-fade plus scale .8→1 på ikonet. `.bounce` bliver én scale 1→1,12→1 på `snappy`. `.pulse` bliver opacity-puls (kun for live-tilstande). |
| Haptik (`UIImpactFeedbackGenerator`, `.sensoryFeedback`) | Mærkbart »klik« ved snap, toggle og succes. | **Findes ikke**: `navigator.vibrate` understøttes ikke i iOS WebKit, og en vægskærm har ingen hånd på kroppen. Det visuelle tick erstatter den: et kort 1→0,98→1 »tap« på det element, der snappede, og en farveovergang på toggles. Haptikkens rolle (bekræftelse ved diskrete trin) skal bæres af et *synligt diskret trin*. |

### 3.5 Reduce Motion

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

### 3.6 Tre referenceapps for et hjem-dashboard

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
