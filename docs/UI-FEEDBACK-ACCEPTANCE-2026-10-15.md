# Samlet visuel acceptliste · 15. oktober 2026

Ejer: GPT-6.1 Sol (`ui_feedback_acceptance_sol`). Dette er den samlede sporbarhed for brugerens UI-input, ikke en ny designretning. Læs sammen med `CODEX-HANDOFF.md`, `UI-GREEN-GAPS-2026-10-14.md`, `UI-DEMO-LIVE-MAPPING-2026-10-15.md` og `TASK-ASSIGNMENTS-2026-10-15.md`. De ældre statusfelter i disse filer er historiske; nedenstående skelner mellem implementering, gemte lokale browserbeviser og endnu manglende accept.

**Ingen af de 50 oprindelige punkter er her erklæret samlet accepteret på Green.** Installeret PodVoice 2.0.30 er ikke lig med den nyere 2.0.31-kandidat. Dette dokument er lavet ved kilde- og dokumentinspektion; agenten har ikke selv udført nye browser-, Green-, iPad- eller lydprøver.

## Låst ramme for næste visuelle rettelse

- Bevar demoens layout, tre musikkort, fire faner under kortene, fotografisk Ro, selvstændig højre player og danske tekster. Fyld samme komponenter med faktiske data; datamangler giver ærlige tilstande i samme geometri.
- Alle eksplicitte fejlrettelser nedenfor skal være med i næste samlede visuelle kontrol. Ingen alternativ live-CSS, permanent søge-/konto-/teknikflade eller skjult layoutændring må opfindes.
- Visuelle PodVoice-svar har **endnu ingen endelig brugergodkendelse**. De skal vises som et konkret forslag med et faktisk relevant svar. Den gemte NASA-prøve og `/flow`-knapper er ikke dette bevis.
- **Humør** er et åbent valg. Brugeren foreslog Stemning · Humør · Topsange · Senest og afviste Playlister som fanenavn; der foreligger ikke en endelig erstatningsgodkendelse. Bevar nuværende faner indtil afklaring.
- Robot/lys har allerede ikonbaggrund i demoen, men forskellen i højde, padding, ikonstørrelse og komposition i forhold til vejr/find musik er et nyt, uafsluttet harmonipunkt. Vis en konkret samlet sammenligning før ny anatomi vedtages.

## U01–U24: oprindelig accept

| ID | Brugerkrav | Faktisk kilde/lokalt bevis | Resterende accept |
|---|---|---|---|
| U01 | Ren UI uden teknisk PodVoice-/adgangsstøj | Fælles `dist/widget-view.js`, `podvoice-view.js`; `current-overview-after-answer-fix-20261015.png` | Gennemgå alle rigtige Green-scener og opsætning adskilt fra produktet. |
| U02 | Lang venstrejusteret pil, stort trykfelt, ét faktisk tilbage-trin; swipe uden scrollkonflikt | `widget-redesign.css` `#show-photo img` 40×24; `widget-view.js` dispatch `back`; `tests/gestures.test.js` | Flere oprindelser, fokusretur, afbrudt navigation og fysisk touch. |
| U03 | Overview og player flugter fra første frame | Fast 64px aktiv header i `widget-redesign.css`; tidligere lokale mål i STATUS | Mål start/mellem/slut overblik→musik→vejr→robot→timer på 1024×600 og 1280×800, også med nyt vejr og forbindelsesstatus. |
| U04 | Player samme top/højde, tom/fyldt; intet ur-induceret hop | Samme header-slot og fælles `player-view.js`; lokale `layout-confirm-*` og `player-offline-layout-fixed-20261015.png` | Faktisk Green med alle tilstande; ingen højdeanimation maskeret som sideskift. |
| U05 | Én aktiv/færdig timer; nederste genvej erstattes | `timer-view.js`, `timer-overview`/`timer-model` tests | Native timer fra PodVoice på Green; andre ejerposter må ikke slettes. |
| U06 | Charcoal timer, koral handling, harmoniske mellemrum | `widget-redesign.css`, `timer-complete-current-20261015.png` | Ens reelle mellemrum vejr/musik→robot/lys→timer i alle relevante viewports. |
| U07 | Umiddelbar visuel færdig-alarm på Ro og Lige nu | `timer-rest-complete-current-20261015.png`, `timer-complete-current-20261015.png` | Native overgang uden gammel 0:01/Tæller ned, stale eller dobbelt repræsentation. |
| U08 | Ingen dobbelt timer-toast | `timer-notice.js` skjuler besked når samme timer allerede repræsenteres; `tests/timer-notice.test.js` | Samme faktiske alarm på Ro, overblik, timerdetalje og anden detalje. |
| U09 | Besked udløber, swipe/luk, sekundær Timere | `TimerNotice` har 7s udløb, swipe/dismiss og separat åbning | Faktisk beskedkvittering skal være adskilt fra native lyd/alarm; fysisk swipe. |
| U10 | Toasts dækker ikke faner, player, robot/lys eller dialoger | `timer-notice.css`, lokale dokumenterede scenekontroller | Samtidig timer + musikfeedback, dialog, voicefase og offline på Green. |
| U11 | Bevar voice-typer; frisk lyttende puls | `voice-surface.js`; listening-breath i CSS, reduceret motion slår den fra | Rigtig phase-lifecycle; puls er ikke dokumentation for faktisk lydreaktivitet. |
| U12 | Voice på Ro/aktiv uden ur/vejr-/foto-overlap | `voice-surface.js`, `voice-*` captures | Reel samtale på flere viewports med fyldte ressourcewidgets. |
| U13 | Tom→lytter→arbejder→relevant svar; indhold bevares | `live-answer-view.js`, `tests/live-answer-view.test.js` | Rigtig PodVoice-kæde med afbrydelse, langsomt svar, fejl og hurtig overgang uden hop. |
| U14 | Gennemarbejdet visuel svarwidget, diskrete kilder, ingen formatstøj | Fælles svarrenderer og `visual-answer-factual-current-20261015.png` | Konkret visuelt review fra brugeren og ægte relevant svar mangler. |
| U15 | AI vælger visuelt svar kun når nyttigt | 2.0.31 `podview_enrichment.py`/receipt-kæde under samlet arbejde | Nyttigt/ikke-nyttigt eksempel fra rigtig PodVoice; korrekt ejer og revision. |
| U16 | Reelle kildebundne opslag/berigelse når nødvendigt | Completed-tool receipt-kilder og eksisterende værktøjsejer; finit vælger er kun deltrin | Bevis faktisk kilde/indhold og manglende-data-adfærd; ingen opdigtet research eller nye uautoriserede kald. |
| U17 | Sammenhængende motion, cleanup og reduced motion | `dist/ui/motion.js`, `tests/motion.test.js`, page lifecycle | Ro↔Lige nu, detaljer, dialogs og afbrudte animationer; bevægelse må forklare sideskift, ikke layoutfejl. |
| U18 | Robot med rigtige rum, gentagelser, indstillinger og betjening | `robot-control-panel.js`, `robot-observation.js`, ældre Green robotcapture | Friske Green-felter, reelle udstedte valg/grants, start/pause/stop/base/rum og ukendt udfald uden replay. |
| U19 | Rengøringsanimation også kompakt på Ro | `dist/ui/robot-motion.js`, `tests/robot-motion.test.js` | Observeret cleaning starter; pause/base/stale/offline stopper på faktisk Green. |
| U20 | Vejr når lokal informationsgrad med ægte data | Fælles `weather-view.js`/`weather-observation.js`; dualforecast i 31 under arbejde | Næste timer+dage, afrunding, by, kun reelle kilder/råd; se nye V-punkter. |
| U21 | Musik: kort, covers, faner, kø, start/transport | Fælles `music-results.js`, `player-view.js`, `live-music-view.js`, native kontroladapter | Faktisk konto/enhed/rum, play/queue/volumen/autoplay og matching artwork på Green; ingen fixturefyld. |
| U22 | Lys synligt, ærlig manglende integration | `unconfiguredLight()` og `live-light-unconfigured.png` | Green skal sige Ikke tilsluttet endnu og ikke vise falsk on/off eller aktive kommandoer. |
| U23 | Samlet installeret version og reelt testklart link | 30-installationskvittering findes; 31 er kandidat | Permanent autentificeret `/view` skal faktisk vise PodView; korrekt samlet artifact og data/betjening kontrolleres først. |
| U24 | Tydelig restliste og visuel terminologi | Denne liste, U/N-lister, `dist/ordbog.html` | Hold status/model/ejer/konkret accept ajour; reference må ikke blive teknisk produktstøj. |

## N01–N26: senere bestillinger

| ID | Brugerkrav | Faktisk kilde/lokalt bevis | Resterende accept |
|---|---|---|---|
| N01 | Localhost = Green, samme UI/tilstande/motion | Fælles root `dist/` og kandidatens `static/podview/`; manifestarbejde | Endelig bytekontrol efter alle 31-ændringer + samme kildeformede payload rendret i begge miljøer. Tidligere manifest er ikke final. |
| N02 | Gode household-mockdata med mere bredde lokalt | `music-fixture.js`, `preview-scenes.js`, `local-real-music-fixture-20261015.png` | Mock er tydeligt lokalt; samme datakontrakt/komponenter, ingen fake Green-data. |
| N03 | Tre muligheder fra fire faner nedenunder | `music-results.js`, `widget-model.js`, fælles markup | Green uden ekstra søge-/kontoflade eller fjernet fane. |
| N04 | ↻ Andre forslag med ikon+tekst og hentefedback | `#music-refresh` 48px, pending `aria-busy`; `music-refresh-feedback.test.js` | Vis loading, fejl, annullering, tomt svar og bevarede gamle kort i faktisk live-kæde. |
| N05 | Ingen horisontal scroll i højre player | `min-width:0;overflow-x:hidden`; tidligere lokalt 299=299-mål | Nyt endeligt snapshot måler scrollWidth≤clientWidth; klip må ikke skjule reelt nødvendige kontroller. |
| N06 | Fast fælles header/player uden højdehop | 64px slot i CSS; U03/U04 | Ur/vejr/overskriftsstørrelse må ikke ændre player-offset under navigation eller dataload. |
| N07 | Pænt overflow med reel afslutning alle steder | `ui/scroll-edges.js`, positionbundne masker, `scroll-edges.test.js` | Start/midt/slut: kun faktisk resterende kant fader; vejr får synlig opdagelig næste time, intet permanent blindt fade. |
| N08 | Køoverskrift uden mærkelig baggrund ved scroll | `#queue-title` uden for `#queue` scroll; CSS `position:static` | Scroll lang kø i endelig modal; ingen covers/tekst bag overskriften og ingen klip af sidste række. |
| N09 | Længere linje på tilbagepilen | `#show-photo img` 40×24, native hitområde | Faktisk visuelt review i sammenhæng, inkl. venstrekantsflugt. |
| N10 | Tryk Lige nu går til Ro | `#now-rest` click-handler i `widget-view.js` | Touch/keyboard og fokus, uden stop af timer/musik. |
| N11 | Global PodConnect fast startvolumen, aldrig særskilt cap | `dist/live-music-view.js`, `tests/native-music-controls.test.js` | Faktisk startpolicy, ikke hardcoded 35%; manuel lydstyrke/pause/resume i samme session bevares. |
| N12 | Fast PodView-rum og korrekt standardhøjttaler | Serverens stabile rum-/målkobling under samlet 31-kæde | Faktisk HA/PodConnect/native-ID-kæde og valg ved flere enheder; ingen navne- eller første-enheds-gæt. |
| N13 | iPad/kiosk/fullscreen og brugbar åbning | `ingress-kiosk.js`, `tests/ingress-kiosk.test.js`; kausal routingrettelse i 31 | Green-entry, reload/BFCache, auth og faktisk iPad A2HS/fullscreen separat. |
| N14 | Padding på output-touchbaggrund | Aktiv `.output` har 8×12px og balanceret negativ margin; `local-output-padding-20261015.png` | Hover/touch/fokus på endelig Ro/aktiv/modal, ikke kantklippet. |
| N15 | Modal topmargin, closeafstand, scroll | `#music-detail` padding28, header48; `local-modal-padding-20261015.png` | Frisk render med lange titler: titel/close må ikke kollidere, fokusretur, viewportkanter. |
| N16 | Forklar konkret AI-logik for Andre forslag | Live Stemning vælger egne temaer→rigtige playlistesøgninger; andre faner bruger deres kilder | Vis hvad der ændres og hvad der bevares; ingen AI-påstand om fixture-rotation eller autoplayændring. |
| N17 | iPhone-lignende cancel når fingeren forlader trykfelt | `ui/touch-intent.js`, `tests/touch-intent.test.js` | Fysisk drag-away, scroll, pointercancel, blur, disabled-under-press; tastatur/mus/slider uberørt. |
| N18 | Lidt lavere modal så tre hele køsange ses | Kort landskab: 208px art, 56px rækker, 228px køområde; `modal-long-title-refined-20261015.png` | Tre **hele** rækker inkl. titel/kunstner/play ved 1024×600, både kort/lang titel; kun kø scroller. |
| N19 | Volume langt nok fra play/pause | Modaltransport har 24px bundmargin før output/volume; tidligere mål26px er historisk | Mål faktiske hitrektangler på nuværende endelige layout, ikke kun visuel afstand; ingen utilsigtet play/pause. |
| N20 | Tidsafhængig AI-Stemning med passende skiftende billeder | 31 Stemning/tema-kæde og `assets/morning-acoustic.png` | Rigtige morgen/aftenvalg og matchende motiv; billeder må ikke være generiske eller foregive aktuelt trackomslag. |
| N21 | Stemning starter rigtig playliste; autoplay næste+passende mere | Control13 playlist-context-kandidat og eksisterende native autoplay | Faktisk speakerforløb gennem mindst næste nummer + playlisteslut; top/recent starter valgte nummer og fortsætter. |
| N22 | Kort skifter kun ved Andre forslag; bevar navigation | `music-cache.test.js`, `collection-selection.test.js`; scopebundet cache | Første åbning Stemning; retur sidste fane/præcis tre kort; reload Stemning. Tid/status/poll må ikke rotere. |
| N23 | Fjern Navn og præcis tid fra timer | `timer-without-custom-entry-20261015.png` | Endelige Green-assets uden indgangen, eksisterende timerforløb bevares. |
| N24 | Begge players: tom/henter/offline/fejl/manglende cover | `player-view.js`; fem `player-active-*-current-20261015.png` og `empty-audit-*` | Ro+aktiv+modal, real retry/stale, ukendt volumen —; ingen opdigtet cover/titel eller layoutskift. |
| N25 | Mulig Stemning/Humør/Topsange/Senest | Beslutning **åben**, Playlister-navn afvist | Afklar konkret Humør-adfærd og datakilde før udskiftning; behold fire eksisterende faner nu. |
| N26 | Custom-enhed: lysstyrke/sensor/genstart/sluk | `DEVICE-SCREEN-CONTROLS-FUTURE.md` | Dokumenteret senere spor, **swipe ned fra toppen → Skærm**. Gesture åbner kun; powerhandling bekræftes. Ikke del af nuværende implementering. |

## Nyeste visuelle og datamæssige input, som ikke må forsvinde

| ID | Bindende input | Status og næste konkrete kontrol |
|---|---|---|
| V01 | Vejr tilbage øverst til højre ved ur/dato | `header-weather-restored-20261015.png` findes. Kontroller faktiske Green-data på Ro, overblik og alle detaljer uden player-hop. |
| V02 | Ens mellemrum mellem timer og robot/lys som resten | Ældre screenshot viser forskel. Mål alle tre vertikale mellemrumsrelationer på endelige overview; én delt spacingrolle, ingen tilfældig særmargin. Dette er ikke lukket af et tidligere screenshot. |
| V03 | Robot/lys må ikke bytte plads ved opdateringer | `home-model.js` `orderHomeDevices` bruges i både homepoll og `podvoice-view.js` liveScene. Regression følger home→flere SSE→cleaning/pause/base/stale. Endelig browser/Green-sekvens mangler; vac først, lys dernæst uanset aktivitet. |
| V04 | Robot/lys komposition harmonerer med vejr/find musik | Fortsat **designpunkt åbent**: ikonbaggrund findes i demo, så fjern ikke bare cirkler. Sammenlign fire widgets ved samme viewport og vis fælles padding/typografi/ikon/højde-forslag. |
| V05 | Temperaturer hele grader og pæne enheder | `weatherTemperature` afrunder kun visningen, rå præcision bevares. Kontroller nu, timer, høj/lav, dage, negative værdier og ukendte felter. |
| V06 | Næste timer sammen med reelle dagsrækker | 31 dualforecast-kæde findes; rå HA hourlyfixture dokumenteret. Green skal levere faktisk hourly gennem deklareret MCP-kontrakt, friskhed og datadækning; daily må ikke opfinde timer. |
| V07 | By fra HA-adresse, fx Mårslet, ikke hjemmet | Åbent: faktisk HA-script hardcoder hjemmet; intet verificeret byfelt. Brug kun faktisk/coarset godkendt bykilde; ingen skjult adresse-/koordinatoverførsel eller navnegæt. |
| V08 | Fast diskret Kilde: Met.no / Kilder: … | `weatherSourceLabel` + permanent footer erstatter collapse/Om vejrudsigten. Kun faktisk brugte udbydere, ingen Home Assistant eller DMI hvis ikke brugt. Kontroller efter Green-payload. |
| V09 | Rain/wind og mere opdageligt time-overflow | Godkendt i koordination: kompakte rigtige mm/km/t i eksisterende komposition; enheder/tid skal være sande. Root implementerer; næste start/midt/slut-capture skal vise reel kant/fade og slut uden fade. |
| V10 | Høj fidelity fra AI uden opdigtede fakta | Råd/børnelinje skal bruge reelle kendte forhold og perioder; manglende vind/regn må ikke blive 0. AI ændrer formulering/valg, ikke vejrgrundlaget. |
| V11 | Lynhurtige AI-kort og visuelle svar | Vis første nyttige indhold hurtigt, bevar kort under hentning; ingen blokering af tale/transport, ingen evig aktivitet. Mål faktisk request→første nyttige render og færdig render på Green; kilde-parallelisme er ikke målt latency. |
| V12 | Løbende AI-Stemning, ikke engangsdemo | Bruger godkendte 20/dag +200/måned, dansk kalender, samme bounded Luna. Implementering/aktivering/visuel kontrol adskilles; navigationscache bevares. Visuel faktavælgers særskilte20 ændres ikke. |
| V13 | Alle visuelle svar inkl. loading/faktuelle typer opdateret | `/flow` skal vise nuværende forslag og faktisk relevant sourceform, ikke gammel knapdemo som godkendt widget. Brugeren skal se hele tilstandsserien og konkret svar før designaccept. |
| V14 | Hvis private Site bruges, skal /flow være absolut opdateret | Sidste publicerede Site er ældre end nye rootændringer. Opdater eksisterende owner-private projekt og verificér faktisk publiceret version før det igen deles som aktuelt review. Site er aldrig Green-proof. |
| V15 | Alt UI-input med i næste samlede visuelle rettelse | Denne liste er release-reviewets dækning. Ingen U/N/V-række forsvinder fordi én anden test eller installation er grøn. Senere enhedsspor og uafklaret Humør mærkes eksplicit. |

## Prioriteret næste visuelle acceptpakke

1. **Blokerer reelt testlink:** fungerende Green-entry; identisk endelig UI-pakke; ægte musik/robot/timer/voice-data og faktisk udstedt adgang. Modelfixtures må ikke dække manglerne.
2. **Vis samlet screenshotserie:** overblik med stabil robot/lys-rækkefølge, harmoniske mellemrum og headervejr; musik med tre kort/faner; langtitlet modal med tre hele kønumre, separat volume og behagelig close/topafstand; vejr med afrundede værdier, timeudsigt, diskret kilde og reelle scrollkanter.
3. **Vis tilstande/overgange:** Ro/aktiv tom, henter, offline, fejl, missingart; relevant PodVoice-svar med hentning/afbrydelse/fejl; timerfærdig på Ro/Lige nu uden dobbelt toast; frisk rengøring/pause/base/stale.
4. **Interaktionsaccept:** samme kort efter frem/tilbage, kun Andre forslag fornyer, global startvolumen og faktisk autoplay; cancel ved drag-away, slider fri af navigation, fokusretur og reduced motion.
5. **Særskilte åbne designvalg:** visuelt svar er ikke godkendt; robot/lys-anatomi kræver konkret harmonisering uden ny retning; Humør afventer afklaring; skærmhardwarefunktioner er senere dokumenteret spor.

Alle screenshots nævnt ovenfor ligger under `docs/visual/`. Filernes eksistens og kildernes indhold er inspiceret her; tidligere browsermålinger er rapporterede historiske beviser, ikke udført på ny af denne agent. Der er bevidst ingen samlet PASS-procent eller automatisk lukning af punkter.

## Frisk samlet browserrunde · 15. oktober kl. 14.08–14.14

Efter den første dokumentrunde er følgende **faktisk** kontrolleret af samme agent. IAB var utilgængelig efter restart (`Browser is not available: iab`); en ny, separat Chrome-fane blev derfor brugt efter Product Designs fallbackregel. Ingen eksisterende Green-fane eller konto blev betjent. Preview-serveren blev genstartet på localhost:4173. Alle nedenstående data er lokale fixtures, ikke Home Assistant-/Spotify-/lydbevis. Ingen runtimefiler blev redigeret.

| Kontrol | Faktisk browserresultat |
|---|---|
| Player, 1024×600, musik→tilbage→overblik | Top84.71875, bund584, bredde299.078; clientWidth=scrollWidth299. Header64px. Headervejr synligt. |
| Overview, 1024×600 | Vejr/musik bund200.71875; robot/lys top224.71875/bund360.71875; timer top384.71875. **Begge vertikale gaps24px**. Robot venstre, lys højre. Vejr/musik højde116, robot/lys136: anatomiforskellen er stadig reel. |
| Get Lucky med fuld lang titel, 1024×600 | Modal x152/y16/720×568; clientHeight=scrollHeight568. Titel to linjer,48px høj; close48×48 med28px topinset. |
| Tre kønumre og afstand, 1024×600 | Køområde y341.5→564; tre hele56px rækker ender401.5/461.5/521.5. Fjerde er bevidst delvis. Transport-hitbox bund238; volume-hitbox top262 = **24px fri afstand**. |
| Andre forslag | Faktisk pending Henter… med eksisterende kort stående/inaktive; derefter nye kort. Heartless/title/player bevaret under fetch. Kun lokalt simuleret forløb. |
| Vejr vandret scroll, 1024×600 | Start: scrollLeft0, højrefade48px. Native scroll til544.5 af max≈545: kun venstrefade48px; højrefade fjernet ved reel slutning. |
| Player, 1280×800, musik→overblik→vejr | Top104.375, bund784, bredde374.148; clientWidth=scrollWidth374 på musik og vejr. Målt i færdige scener; dette er ikke frame-for-frame bevis for alle afbrudte animationer. |
| Overview, 1280×800 | Vejr bund220.375; robot/lys top244.375/bund388.375; timer top412.375. **Begge gaps24px**. Robot/lys144px mod vejr116px; harmonipunkt stadig åbent. |
| Modal, 1280×800 | Ingen egen overflow: clientHeight=scrollHeight726. Tre hele64px kønumre; transport→volume ca.68px afstand. Målt lige efter åbning under dens tilladte finite overgang, derfor kun indhold/overflow accepteret her, ikke endelig topkoordinat. |
| Browserfejl | Ingen aktuelle error/warn i den nye lokale fanes log. |

**Konkret resterende mockdatafejl fundet:** den almindelige lokale vejrfixture viser ved faktisk torsdag15okt kl.14.13 stadig timerne Nu→16→17 og dagene I dag→Torsdag→Fredag. Den har hverken regn/vind eller kilde som de nyere rigtige forecastprojektioner. Det er ikke acceptabelt som endelig realistisk localhost-paritet; en eksplicit kildeformet, tidsmæssigt korrekt preview skal bruges til regn/vind/kilde-kontrollen. Dette er meldt til root; ingen skjult browserstate er injiceret for at fremstille data som leveret.

Friske screenshots: `qa-round1-top-1024-20261015.png`, `qa-round1-overview-1024-20261015.png`, `qa-round1-long-modal-1024-20261015.png`, `qa-round1-weather-start-1024-20261015.png`, `qa-round1-weather-end-1024-20261015.png`, `qa-round1-modal-1280-20261015.png`, `qa-round1-overview-1280-20261015.png`, `qa-round1-weather-1280-20261015.png`.

## Bekræftelsesrunde 2 · kl. 14.17–14.20

Vejrfixture-ejeren rettede data og sendte freeze: `weather-view.js` SHA256 `4205e4977e6c98b3718accf5c9ed65abbc62c95f51c06a37ad6f4b6bc2a21229`. Browserens faktiske DOM viser nu 14.00–01.00, ingen fejlagtig Nu på den første fremtidige time, regn0mm, vind22,3km/t, hele temperaturer, I dag/Fredag/Lørdag samt fast **Kilde: Met.no**. Dette er dokumenteret genafspilning af captured hourly forecast med kurateret current/daily/by, ikke et aktuelt HA-opslag.

Player ved1024 er fortsat top84.71875/bund584 og clientWidth=scrollWidth299. Time-stribens start har kun48px højrefade; efter et rigtigt piletasttryk har den begge kanter, som forventet ved mellemposition. Screenshot `qa-round2-weather-start-1024-20261015.png` og `qa-round2-weather-mid-1024-20261015.png`.

To konkrete rester blev meldt til root og fixture-ejeren:

1. Headeren viser fortsat16°/Let skyet, mens den rettede vejrdetalje viser15°C/Skyet. De lokale visninger skal bruge samme fixturegrundlag. Endelig rettelse er ikke browserbekræftet her.
2. Ved1024×600 skubber den nye metricslinje plus den bevarede rådgivning hele time-striben til y481.5–639.9, mens detaljens synlige slutning er584. Timer/temp/regn kræver derfor lodret scroll ved første åbning. Det er en funktionel scrollflade, men ikke fuld umiddelbar timeoversigt; en eventuel compact-rettelse skal bevare den låste retning.

Rettet vejr-DOM ved1280 er læst, men måling og screenshot blev afbrudt af Chrome/CDP deadline **før kommando-dispatch**. Ingen rain/wind1280-billedaccept eller nyt scrollslutbevis påstås. Den tidligere faktiske slutkant fra runde1 er stadig afgrænset til dens daværende bytes. Der køres ikke en tredje poleringsrunde. Ingen fysisk touch-, Green-, kilde- eller lydaccept følger af denne kontrol.
