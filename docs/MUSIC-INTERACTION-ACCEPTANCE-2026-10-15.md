# Musik: adfærd og accept · 15. oktober 2026

Ansvarlig: music_behavior_acceptance_sol. Model: GPT-6.1 Sol. Afgrænset læsende audit af runtime og eksisterende tests; ingen Green-handlinger, runtimeændringer eller fysisk accept i denne audit.

## Resultat

Den fælles musikvisning har de fleste krævede klientegenskaber. Den er **ikke samlet accepteret på Green**. Et konkret hul er fundet: initial Stemning kan hentes, inden musikvisningen åbnes. Native afspilning, startvolumen, fast rum og autoplay er fortsat faktiske acceptkrav.

| Brugerkrav | Evidens i aktuelle kilder | Status / resterende |
|---|---|---|
| Første åbning og fuld genindlæsning starter på Stemning | `initialWidgetState().collection='mood'`; `LiveMusicCatalogueView.selected='mood'`; ingen persisteret fane | Implementeret. Initial hentning sker dog for tidligt, se fejl nedenfor. |
| Gå væk og tilbage bevarer sidste fane og præcis samme kort | `collectionPages`, live `entries` pr. boot/rum/konto/fane; `music-cache.test.js` afprøver gentagne round trips og ID/rækkefølge/omslag | 8 fokuserede cachetests består; ingen Green-accept her. |
| Kun Andre forslag udskifter det viste udvalg | Live `pendingRead.reason`, ignorerer uopfordrede samples; lokal refresh-result kræver request/revision; navigation, klokke og pause roterer ikke | Implementeret; initial første hentning undtaget. Udløbet afspilningsautoritet kan fornyes uden at erstatte kort. |
| Loading beholder kort; fejl beholder indhold; musik og kø fortsætter | `MusicResults` bruger samme beholdte noder; `Henter…`/`Henter musik…`; refreshtests bevarer playback-reference og manuel volumen/pause | Implementeret i klient; fysisk musikfortsættelse skal kontrolleres på Green. |
| Stemning er rigtige playlister; Topsange/Senest er numre | `collectionSample` accepterer Spotify-playliste-URI kun for mood og track-URI for andre; backend finder playlistedata; ingen modelopfundne URI'er | Implementeret kandidat, ikke faktisk installeret/afspillet her. |
| Matchende stemningsbilleder, faktisk sangomslag i player | Seks faste kildevaliderede tema/art-par; `sourceMusicCards` bruger stemningsillustration for mood; `PlayerView` bruger faktisk track-artwork | Kildekontrakt implementeret. Morgenbillede særskilt; aften/rolig bruger samme søfoto. Endelig visuel relevans og Green-data skal ses. |
| Tom/henter/offline/fejl/manglende omslag | Fælles `PlayerView`; 10 Ro/Aktiv-fixtures; no-active skelnes fra ukendt; offline bevarer sidste omslag; billedfejl får neutral node uden evige retries | Fokuserede tests består. Denne audit er ikke browser- eller enhedstest. |
| Touch annulleres, når fingeren glider væk | `attachTouchIntent` monteret på fælles host, native click først ved gyldig release; cancel/lost capture/scroll/blur; range undtaget | 9 tests består, fysisk iPad/touch stadig acceptkrav. |
| Én eksisterende PodConnect-startvolumen, ingen ny 35 %-grænse | Live sender opaque tilbud/handlinger og bruger serverens procent; `start_volume` vælger native fresh_start-policy eller same_session-volumen. 35 er kun eksplicit lokal fixturepolitik | Ingen frontend hardcoded live 35 %-cap fundet. Aktuelle servergrants og faktisk reset/pause/resume skal verificeres på Green; lokal værdi er ikke live evidens. |
| Fast rum/højttaler for skærmen | Target vælger kun faktiske tilbud; aktuel observeret target kan genbruges; ellers viser vælger | Fast rumtilknytning ikke bevist af denne audit; kræver faktisk parring/native kontrol. |
| Autoplay: næste nummer og lignende efter afslutning | Frontend tilføjer ingen alternativ afspilningsmotor; bruger native PodConnect | **Åbent acceptkrav**, ingen fysisk slut-på-playliste-prøve her. |
| Købetjening og tre synlige kønumre | Lokal kø er interaktiv; `liveQueueModel` er udtrykkeligt `selectable:false`, fordi observation ikke giver handlingsautoritet | Live kø er læsende. Hvis afspilning af en køposition er del af samlet krav, mangler en owner-udstedt handlingskontrakt; må ikke genbruge lokal handling. Tre synlige rækker er layout-QA, ikke bevist af disse tests. |

## Konkrete fejl / beslutninger til root

**Initial AI kald før musik åbnes.** `dist/widget-view.js` i `liveMusicAccountChanged()` kalder `liveCatalogue.select('mood')`, når en konto opdages. `connectPodVoice.onSnapshot` starter `liveMedia.refresh()` på alle visninger, også Ro/Lige nu. Der er ingen fokus-gate i denne kaldesti. Når mood aktiveres, kan denne admission derfor starte AI inden første åbning af Musik. Godkendelsen siger første musikåbning eller Andre forslag. Meldt direkte til root; en lazy first-open-gate og en komponeret regressionsprøve er nødvendige. Fanevalg og senere tilbage-navigation skal fortsat bevare cache.

**Fire faner.** Runtime har Stemning · Topsange · Senest · Likede. Brugeren har foreslået Stemning · Humør · Topsange · Senest og afvist Playlister. Handoff siger ingen endelig accept af erstatningen; denne audit ændrer ikke UI. Beslutningen skal afstemmes konkret, ikke fremstilles som gennemført.

**Antal kort.** Katalog viser op til tre faktiske resultater. En sidste side af fx syv kildenumre viser ét nummer, ikke tre gentagelser. Dette er ærlig kildetro adfærd, men brugerens formulering om altid tre muligheder kan kræve en eksplicit beslutning om wrapping. Ingen opdigtede ekstra forslag.

## Kontrol udført

- 66 eksisterende fokuserede Node-tests består: music-cache, music-refresh-feedback, touch-intent, player-view, native-music-controls, shared-music-results, spotify-artwork og music-flow. Ingen redundant fuld suite kørt.
- Ved audit-tidspunktet var følgende 12 rootfiler byte-identiske med `integration/podvoice31/podvoice/gatekeeper/static/podview/`: widget-model.js, widget-view.js, live-music-view.js, live-music-selection-view.js, music-results.js, music-selection-model.js, player-view.js, live-media-view.js, live-control-view.js, spotify-artwork.js, ui/touch-intent.js og widget-redesign.css.
- Dette er en øjeblikskontrol under aktiv udvikling, **ikke et finalt freeze-manifest**. Efterfølgende lazy-init-rettelse og endelig pakning skal indgå i final parity-kontrol.
- Ingen runtimefiler ændret. Ingen Green-login, modelkald, musikstart, volumenændring eller native sideeffekt udført.
