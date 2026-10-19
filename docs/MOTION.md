# PodView · interaktion og bevægelse

Gældende kildeoversigt19.oktober2026. Produktmålet er DenverPFF-1082,1280×800; Mac bruges til udvikling og tests i samme format. Komponentbiblioteket og registrerede ejere er fortsat den eneste UI-kilde. Dette dokument forklarer deres fælles adfærd og aktuelle implementation; det vælger ingen ny billedretning eller komponentfamilie. Kode, browserkontrol, Green-installation og fysisk accept er særskilte beviser.

## Samme betydning → samme feedback

- **Tryk:** den faktiske kontrol reagerer lokalt. Bibliotekets `.pv-button` bruger `--pv-screen-fast`120ms og `--pv-screen-ease`cubic-bezier(.2,.7,.2,1) til baggrundsfarve, tekstfarve og transform. Aktiv tryktilstand er scale(.985), samme som den generiske produktknap. Det flytter ikke layoutets målramme. Fokus vises straks; adgang ændres straks og venter aldrig på motion.
- **Stort billedkort:** billedets farver/lysstyrke og størrelse ændres ikke som tryk- eller loadingfeedback. Den eksisterende Play-markør har sin lokale, finite acknowledgement. Ingen dækkende overlay eller hover-zoom.
- **Annulleret touch:** drag-away, scroll, pointercancel, lostpointercapture, blur eller tilbagekaldt adgang sender ingen handling. attachTouchIntent bevarer native tastatur-/tilgængelighedsaktivering. Native ranges beholder deres eget greb.
- **Uændret refresh:** ingen ny animation, placeholder eller gentaget statusannonce. Bevar samme noder, attributværdier, cover, fokus, scroll og aktiv slider. En ny observation er ikke en ny scene. Et urelateret render må heller ikke afbryde en gyldig ressourceovergang.
- **Ny data:** opdater berørte blade. Animation kan forklare nyt indhold; countdown/måleværdier skal ikke gennem en dekorativ tælleanimation. Kun faktisk flyttede layoutnoder må få en positionsanimation.
- **Loading:** behold den aktuelle widget og brugbart indhold. Første læsning bruger dens ærlige tomme anatomi og reserverede plads. `aria-busy` knyttes til den faktiske ventende del. Ingen generisk Henter-/Starter-prosa eller tidsstyret vente-toast.
- **Resultat:** pending, accepteret anmodning, observeret effekt, afvist, UNKNOWN og fysisk bekræftet er forskellige tilstande. UNKNOWN gentages aldrig automatisk. En læsefejl giver ikke en ny mutationsadgang.

## Navigation, dialog og tilbage

| Input | Forløb | Stabilt indhold |
|---|---|---|
| Tap foto | Åbn Lige nu | Musik/timer/robot fortsætter; ingen automatisk effekt. |
| Åbn widget/detalje | Skift eksisterende venstre fokusflade | Playerens rum og betjening bevares; fokus flyttes, hvis den tidligere fokuserede del skjules. |
| Tilbage/venstrekant-swipe | Ét faktisk historietrin; fra overblik til Ro | Gendan tidligere scroll/valg. Ingen autoplay eller ny billedgenerering. |
| Lodret scroll | Kun det aktuelle indhold scroller | Ingen vandret panorering af aktivitetssiden. |
| Højre swipe fra venstrekant | Historietrin efter afstands-/retningsgrænse | Knapper, inputs, ranges, dialoger og vandret vejrscroll er undtaget. |
| Escape | Luk den aktuelle native modal; ellers appnavigation | Afbryder ikke tale eller hjemmets aktiviteter. |
| Dialog/disclosure | Brug eksisterende native opgave-/kildevisning | Fokus vender til en stadig gyldig åbner, ellers eksisterende overskrift. Statusopdateringer åbner ingen modal. |
| Svarhistorik | Eksisterende ikke-modale venstre historikflade | Playeren forbliver tilgængelig. Historiske svar giver ingen nye actiongrants. |

SceneMotion ejer scene-/ressourcemotion. Den gemmer scroll, fanger synlig position før en faktisk retarget, og har højst én animationsejer pr. node. En ny navigation afbryder gammel motion frem for at stable den. Uændret rå layoutgeometri bevarer en kørende ressourceovergang; dens egen FLIP-transform tæller ikke som ny layoutdata.

## Aktuelle tider · ingen påstand om fuld ensretning

Fælles tokens ejes af dist/ui/components.css: fast120ms, normal240ms og fælles easing. Bibliotekets knapper og lokale `--pv-ease`-alias forbruger dem nu. De øvrige ejere har fortsat nedenstående eksplicitte tider; de må ikke beskrives som allerede tokenensrettede.

| Eksisterende ejer og udløser | Faktisk tid/easing | Hvornår den ikke må starte |
|---|---|---|
| Library `.pv-button` baggrund/farve/tryk |120ms / fælles easing | Disabled, annulleret touch eller reduced motion. |
| Library disclosure/måler | Normal240ms / fælles easing via `--pv-ease` | Uændret værdi; reduced slår overgangen fra, men bevarer den statiske åbne/data-tilstand. |
| SceneMotion almindelig scene |220ms fade +6px / cubic-bezier(.22,1,.36,1) | Samme fokus eller reduced. |
| SceneMotion faktisk playerflytning |320ms; Ro-skift380ms / samme sceneeasing | Uændrede bounds. |
| SceneMotion Ro-skift |380ms frame-introduktion med eksisterende scale/blur / samme sceneeasing | Ingen auto-idle; reduced giver direkte navigation. |
| SceneMotion ny ressource / flyttede søskende |160ms opacity /240ms translation / samme sceneeasing | Samme layout; efter viewchange; reduced. |
| Spotify-art decoded |180ms opacity / cubic-bezier(.16,1,.3,1) | Samme decoded identitet; gammel request; reduced eller fjernet node. |
| VoiceSurface ankomst / tekstfase / faseack / exit |220/160/220/140ms / cubic-bezier(.16,1,.3,1) | Samme faktiske faseidentitet; reduced; gammel session/turn; disconnect. |
| Native dialog |160ms opacity +240ms transform / eksisterende dialogeasing | App/OS reduced. Native fokus-/inerthed ændres straks. |
| Musik-Play / Andre forslag acknowledgement |180ms / fælles easing | Ingen ny faktisk pendingtilstand; reduced. |

Lokale mock-forløbs200ms listfade,520ms artworkflight og1900ms auto-Ro er historisk fixtureadfærd i flow-controller.js, ikke et løfte om samme liveforløb. De må ikke bruges som bevis for faktisk afspilning eller som skjult produktregel. Resterende rolleensretning på tværs af disse ejere skal reviewes af deres ejere; dette stylesheetarbejde ændrer dem ikke.

## Billeder, afspiller og timer

`renderRetainedArtwork` ejer probe → decode → reveal og annullering. Ny URI må aldrig vise forrige cover under ny titel; samme URI og korrekte cover beholdes uden flash. Metadata/room/account/ny generation fencer sene svar. Spotify-covers er providerdata; modeller opfinder dem ikke. Hele motivet og proportionerne bevares af den kanoniske coverstyling. Validerings-/renderstøtte er ikke bevis for, at backend eller Green leverer et bestemt cover.

PlayerView ejer player, detail og kø. Bekræftet paused beholder titel/cover og Play; playing viser Pause. Transient readfejl kan beholde præcis samme room-bound observation som Sidst kendt uden gammel kontroladgang. Null/unavailable er ikke bevis for pause eller Senest spillet; eksplicit revocation/ugyldig scope kan rydde. Knappladser må gerne bevares deaktiveret uden opdigtet volumen/option-ID. Current-status kan følge uafhængig frisk afspilningsobservation, mens den oprindelige UNKNOWN-anmodning stadig er UNKNOWN og spent.

TimerView ændrer kun faktisk ændrede tal, progress og nødvendige status-/adgangsblade. Aktiv komposition ændres én gang ved reel tilstandsændring, ikke ved hvert tick. Progress kræver konsistent native totalvarighed. Annuller, Stop alarm og Færdig har forskellige betydninger. Stop-request er ikke bevis for stilhed; pauseknapper fra workshop er ikke en gældende livefunktion.

Vejr og kø beholder keyed perioder/forekomster samt læseposition. Ingen pludselig udskiftning med tomt indhold ved en tilladt transient læsefejl. Opdatering af et enkelt tal flytter ikke knapper. Afviste/ukendte mutationsresultater bevarer opgave og konkret status.

## Mindre bevægelse og livscyklus

OS `prefers-reduced-motion:reduce` og appens `data-motion=reduced` har samme CSS-betydning **indenfor library.css' eksisterende komponenter**: ingen valgfri animation/transition eller smoothscroll, også på komponentrødder og pseudo-elementer. Aktivt biblioteksknaptryk bruger ikke scale i reduced; farve/fokusring er stadig læsbar. Semantiske statiske transforms, fx en åbnet chevron eller urskivens rotation, bevares. En blanket transform:none på hele biblioteket er forkert.

SceneMotion lytter på OS-præferencen, mens den ejer aktive animationer. Skift til reduced annullerer straks dens egne animationer; sidste afslutning, eksplicit cancel, pagehide og disconnect fjerner lytteren. Tilbage til normal bevægelse genafspiller ikke gamle overgange. Øvrige WAAPI-ejere, herunder cover-fades, har fortsat deres egne preference-/cleanupmekanismer; dette er ikke en global annullering af alle animationer. En komponentgate alene beviser ikke browser- eller enhedsaccept.

Pagehide/disconnected host afmelder vindueslisteners, gestures, observers, transport, probes og ejede timere/animationer. PlayerView.cleanup afslutter cover/detail/kø-probes; MusicResults.cleanup afslutter kortenes. En fjernet host må ikke reconnecte på pageshow. Gamle callbacks må ikke commite efter room/session/task/revision/generation er erstattet.

RobotMotion har i nuværende kilde4200ms gentagen glyphbevægelse kun under frisk observeret cleaning, synlig node og normal motion; den stopper ved stale, offline, skjult side, reduced eller cleanup. Det er en udtrykkelig aktuel kildeadfærd, ikke et bevist fysisk rengøringsforløb eller en ubetinget tilladelse til dekorative loops. Om den erstattes med én finite acknowledgement er fortsat et separat produkt-/ejerreview.

VoiceSurface følger PodVoices faktiske LISTENING → THINKING → AI_SPEAKING → LOUNGE_WINDOW med Lytter/Tænker/Svarer/Klar til mere. Den ejer ingen mikrofon eller tale, viser ingen falsk waveform og flytter ikke kort/player. Ny fase afbryder gammel finite acknowledgement; IDLE/inaktiv/disconnect skjuler samtalestatus. Genereret lyd er ikke bevis for hørbar afspilning.

## Beviser og historik

Den tidligere14okt-tekst angav bl.a.300/280ms voice, generisk venteprosa efter1,5sek, skjulte unsupported controls og gamle1024/iPad-acceptmål. De beskrivelser er supersederet af ovenstående faktiske ejere og nyere brugerbeslutninger. Historiske testtal og /flow-fiksturer er ikke aktuelle leverance-/acceptbeviser. Aktuel kilde, privat reviewlog, browserresultat og Green-assetpins skal følges særskilt; se docs/STATUS.md og integration/ui-direction-reset-20261019/interaction-motion-review.md.

Denne rettelse ensretter kun bibliotekets trykregler og app/OS-CSSreduce samt dokumenterer de faktiske øvrige tider. Den hævder ikke, at alle motionfund, hele UI-kittet, Green eller fysisk Denver er færdigtestet.
