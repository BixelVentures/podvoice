# PodView — bevægelse

PodView er et React 19-panel i Home Assistant (`/podview`), vist på væg-iPad'en (iPad Air 5, 1180×820, HA Companion,
WKWebView). Bevægelse skal føles som en native iPadOS-app og bygges af få, faste dele, der bruges ens overalt.
Dette dokument beskriver opsætningen, som den er i koden nu (2.1.43). Den gamle vægside og dens egne
bevægelsesmoduler (`ui/page-motion.js`, `ui/ro-motion.js`, `ui/pressed-state.js`, `ui/list-motion.js`,
`ui/native-motion.js`, `recipe-view.js` m.fl.) er fjernet; deres historik står i git.

## 1. Stakken

| Hvad | Hvordan | Hvor |
|---|---|---|
| Bibliotek | `motion/react` (npm `motion`) er det eneste animationsbibliotek. Ingen hjemmelavede animationsløkker, ingen `requestAnimationFrame`-stil pr. frame, ingen View Transitions | `package.json` |
| Tokens | Fire varigheder, tre easings og fire fjedre (`DUR`, `EASE`, `SPRING`) og de samme som motion/react-transitions (`TRANSITION.quick`, `.smooth`, `.tick(ms)`, `.reduced`, `.tap`). `scripts/gen-motion-tokens.mjs` skriver dem som CSS-variabler (`--pv-dur-*`, `--pv-ease-*`, `--pv-spring-*`) | `podview/src/lib/motion/tokens.ts`, `podview/src/styles/motion-tokens.css` |
| Fjedre på WebKit | En fjeder køres som sin tilpassede `cubic-bezier` over fjederens indsvingningstid, ikke som samplet `linear()`: WebKit/Core Animation accelererer ikke `linear()` med punkter. Derfor er alle transitions i koden `TRANSITION.*`, aldrig rå tal | `tokens.ts` (`spring()`, `waapiTiming`) |
| Reduceret bevægelse | `<MotionConfig reducedMotion="user">` omkring hele panelet; komponenter, der vælger transition selv, læser `useReducedMotion()` og bruger `TRANSITION.reduced` (kort og lineær, ingen bevægelse, kun opacity) | `podview/src/app/Providers.tsx` |
| Sideskift (P1) | Skærmstakken i Zustand (`nav.ts`); hver monteret skærm er en `motion.div` med varianterne `center`/`before`/`after`. Push glider ind fra højre, tilbage fra venstre, 48 px og opacity, på `TRANSITION.smooth`. Kun `transform` (som hel `translate3d`, så det kører som Web Animation på compositoren) og `opacity`. Et tryk midt i et skift retter målet straks. Hjem, den aktuelle og den forrige skærm forbliver monteret; en skærm bygges, når fingeren lander på dens flise (`data-opens`, prewarm), så glidet aldrig venter på en kold montering | `podview/src/panel/Shell.tsx`, `nav.ts` |
| Tryk (P3) | React Aria (`useButton` i `KitButton`, `Checkbox*`, `SearchField`) ejer tryk, tastatur og hjælpemidler; den synlige trykreaktion er CSS (`:active`/`[data-pressed]`) på `--pv-dur-tap`. Ingen JS skriver klasser ved et tryk | `podview/src/lib/ui/KitButton.tsx`, kit-CSS |
| Dialoger og ark (P2) | `AnimatePresence` + `motion.div` med opacity og en kort forskydning på `TRANSITION.quick`; fokus og modalitet er React Aria's | `robot-confirm.tsx`, `music-speakers.tsx`, `TimerAlarm.tsx` |
| Lister (P4) | `motion`-elementer med `layout="position"` (FLIP i motion/react) på `TRANSITION.smooth`; slået fra ved reduceret bevægelse | `music-queue.tsx` |
| Værdier (P5) | `RollingDigits` ruller de ændrede cifre (ny fra 30 % under på `quick`); `useProgress` driver en rings `--progress` som motion value: et nedtællingstik lineært over sekundet, alt andet på `smooth` | `podview/src/lib/motion/value.tsx`, `TimerCard.tsx` |
| Ro ↔ aktiv | `AnimatePresence` om Ro; fotoet og uret toner ind/ud på tokens; Ro lægger sig over skallen, så Hjem aldrig tegnes om under skiftet | `podview/src/panel/Rest.tsx` |
| Indhold, der ankommer | Et afkodet billede toner ind med opacity (CSS på `--pv-dur-quick`); handlinger, der skifter (fx Opskrifters Start/Fortsæt/Afslut), cross-fader med `AnimatePresence mode="popLayout"`; afkrydsede trin dæmpes med `animate={{opacity}}` | `FindMusic.tsx`, `Recipes.tsx` |

Grundregler:

- Kun `transform` og `opacity` animeres (compositor). Ingen animation af `box-shadow`, `left/top/width/height`,
  `background-size` eller filtre; et tilpasset CSS-property (`--progress`) kun hvor kun ét lille lag males.
- Logik venter aldrig på en animation (`onAnimationComplete`, `transitionend`): fjederhalen er lang, og et tryk
  skal virke med det samme.
- Ingen blink: indhold, der ikke har ændret sig, tegnes ikke om, og en skærm viser sine data i første billede
  (data hentes, når panelet starter, og holdes varme i TanStack Query-cachen).
- Nye transitions bruger `TRANSITION.*` fra `tokens.ts`; CSS bruger `--pv-dur-*`/`--pv-ease-*`/`--pv-spring-*`.

## 2. Tokens

| Token | Værdi | Brug |
|---|---|---|
| `DUR.tap` / `--pv-dur-tap` | 100 ms | trykreaktion, ciffer-fade ved reduceret bevægelse |
| `DUR.quick` / `--pv-dur-quick` | 160 ms | exit, fades, farveskift på små flader, billede ind |
| `DUR.base` / `--pv-dur-base` | 240 ms | indgang uden fjeder, crossfade |
| `DUR.ambient` / `--pv-dur-ambient` | 1400 ms | puls og skeleton (én fælles periode) |
| `DUR.reduced` / `--pv-dur-reduced` | 150 ms | alt ved reduceret bevægelse (lineært) |
| `EASE.out` | `cubic-bezier(.2,0,0,1)` | indgang og tilstandsskift |
| `EASE.in` | `cubic-bezier(.4,0,1,1)` | exit |
| `EASE.inout` | `cubic-bezier(.45,0,.55,1)` | ambiente løkker |
| `SPRING.quick` | 0,30 s, bounce 0 | slip, toggles, små skift (`TRANSITION.quick`) |
| `SPRING.smooth` | 0,45 s, bounce 0 | sider, lister, værdiændringer (`TRANSITION.smooth`) |
| `SPRING.snappy` | 0,40 s, bounce 0,15 | ankomster og snap |
| `SPRING.flick` | 0,50 s, bounce 0,20 | kun efter en gestus med momentum |

Fjedrene følger Apples duration/bounce-model (masse 1, k = (2π/duration)², ζ = 1 − bounce). Den perceptuelle
varighed er `duration`; CSS-varigheden er indsvingningstiden til 0,1 % (fx 441 ms for `quick`).

## Måling på iPad'en

`podview/src/lib/diagnostics/frame-meter.ts` måler på selve skærmen. Hvert tryk åbner en session fra fingeren ned,
til bevægelsen er faldet til ro (højst 1,5 s efter slip): kun `requestAnimationFrame`-deltaer. Bevægelse ses
generisk (Web Animations via `document.getAnimations`, CSS-transition/animation-events, scroll); arten udledes af
den viste skærm før og efter. I tomgang koster måleren intet, og den læser aldrig geometri. Panelet samler
sessionerne i sin sundhedsrapport (»frames«, `podview/src/panel/health.ts`), som integrationen modtager over
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
| **Sheet / formSheet** (iPad) | Glider ind nedefra på en kritisk dæmpet fjeder på ca. 0,5 s. Backdrop dæmpes samtidig. Sheetet kan trækkes 1:1 og lukkes med et kast. Et halvt træk fjedrer tilbage med fingerens hastighed. | Dialog ind: translateY + opacity på `smooth`. Træk ned for at lukke med velocity-projektion (§3.3). |
| **Navigation push** | Ny side kommer ind fra højre i fuld bredde. Den gamle side går ca. 30 % til venstre (parallax) og dæmpes. Bevægelsen er fjeder-agtig og ca. 0,35–0,5 s. | En kortere version: ny side +48 px → 0 med opacity. Gammel side −24 px og fade (§3.2). |
| **Interaktiv pop** | Kant-swipe fra venstre trækker siden 1:1. Ved slip afgør position og hastighed, om man fuldfører eller annullerer, og bevægelsen fortsætter med fingerens hastighed. | PodViews kant-swipe har kun en 24 px »hint«-preview i dag. Det opgraderes til 1:1 (§3.2, PR 6). |
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
| `matchedGeometryEffect` / zoom-transition (iOS 18) | Et element flyver fra kilde til mål, og alt andet cross-fader. | View Transitions API med `view-transition-name` på kilde og mål (Safari 18+). Fallback: FLIP-klon som `flyArtwork`. |
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
