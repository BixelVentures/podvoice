# Aktiv parallel fordeling · 15. oktober 2026 · efter kapacitetsændring

Otte subagenter er faktisk startet og aflæst aktive samtidig; lead samler kandidat, admission og udgivelse. Alle aktuelle spor bruger Sol; ingen nye Ultra-kørsler. Tidligere fordelinger nedenfor er historik.

| Agent | Afgrænset ansvar |
|---|---|
| weather_data_sol | Rigtige vejrmetrics, regn/vind, timeprognose og scrollkanter |
| visual_live_qa_sol | Visuel svarkæde, navigation, fælles UI-pakning og konkrete runtimefejl |
| shared_music_ui_sol | Native musikårsag og præcis ændringsinventarliste til admission |
| visual_chain_review_sol | Uafhængigt review af faktakilder, query-binding og svarlivscyklus |
| ongoing_operator_review_sol | Uafhængigt review af løbende AI-kvoter og kold provisionering |
| timer_robot_acceptance_sol | Timer/robot, tilstandssandhed og relevante regressioner |
| music_behavior_acceptance_sol | Musikfaner, kortbevaring, refresh, tilstande og autoplay-kontrakt |
| ui_feedback_acceptance_sol | Alle brugerens UI-input samlet med konkrete acceptbeviser og åbne punkter |

Green-operationer har fortsat én ejer i v2.X. Parallelle sourcechecks er ikke installation eller fysisk accept. Løbende Stemning er eksplicit godkendt til20/dag og200/måned i dansk kalender; visuelle faktakorts eksisterende20-totalgrænse ændres ikke.

---

# Arbejdsfordeling og restliste · 15. oktober 2026

Brugeren har eksplicit bestilt parallelle fixes og en navngiven GPT-model for hver opgave. Modellen nedenfor er den tildelte udviklings-/reviewmodel, ikke automatisk et live API-modelvalg. Det tidligere godkendte afgrænsede AI-trin i produktet er fortsat særskilt GPT-6 Luna, højst20 kald; denne liste udvider ikke forbrug eller adgang.

Ingen samlet Green-accept. Lokale rettelser, source GO, udgivelse, installation og fysisk effekt føres separat. Appens goal var null ved readback; listen og brugerens fortsættelsesinstruks er bevaret her og i UI-GREEN-GAPS-2026-10-14.md. Der er ikke oprettet et nyt app-goal uden en konkret anmodning om det.

Første bølge (leveret lokalt; samlet kontrol i gang):
- **GPT-6.1 Sol / ui_surfaces_sol:** sekundær knap, modal og output-touchpadding. Ejer kun widget-redesign.css.
- **GPT-6.1 Sol / loading_feedback_sol:** bound refresh/hentefedback og tests. Ejer widget-view.js/widget-model.js/flow-controller.js.
- **GPT-6 Luna / overflow_luna:** scroll-edge-lifecycle, slutpunkter og tests. Ejer ui/scroll-edges.js.
- **Lead:** fælles browserkontrol, navigation/fixture-indgang, dokumentation og integration. Resten er tildelt men endnu ikke alle startet.

| ID | Opgave | Tildelt model | Faktisk status / rest |
|---|---|---|---|
| U01 | Ren produktvisning uden teknisk støj | GPT-6.1 Sol | Fælles live-renderer og Green-kontrol mangler |
| U02 | Tilbage, swipe, fokus og returvej | GPT-6.1 Sol | Lokal pil/retur rettet; tværgående QA og Green mangler |
| U03 | Ens topplacering på alle sider | GPT-6.1 Sol | Lokalt målt ens top på musik/overblik/vejr; bred QA mangler |
| U04 | Fast playerhøjde, fyldt/tom | GPT-6.1 Sol | Lokal navhøjde rettet; tom/Ro/Green-prøve mangler |
| U05 | Én aktiv/færdig timer | GPT-6.1 Sol | Rigtig ejer og Green-forløb skal verificeres |
| U06 | Timerfarve og mellemrum | GPT-6 Luna | Lokale rettelser; Green-accept mangler |
| U07 | Visuel alarm på Ro og aktivitet | GPT-6.1 Sol | End-to-end observation og stale-case mangler |
| U08 | Ingen dobbelt alarm eller gammel nedtælling | GPT-6.1 Sol | Præcis samtidig case skal genprøves på Green |
| U09 | Timerbesked: udløb, swipe, luk og genvej | GPT-6.1 Sol | Samlet browser-/Green-accept mangler |
| U10 | Toast placering og samtidighed | GPT-6.1 Sol | Alle scener/dialoger skal kontrolleres |
| U11 | Voice-puls fra rigtig lyttetilstand | GPT-6.1 Sol | Reel phase/lifecycle og Green-accept mangler |
| U12 | Voice-widget placering | GPT-6 Luna | Ro/aktivitet på relevante viewports skal kontrolleres |
| U13 | Tom → lytter → arbejder → svar | GPT-6.1 Sol | Rigtig samtale, afbrydelser og stabil geometri mangler |
| U14 | Godkendte visuelle svar uden støj | GPT-6.1 Sol | Fælles renderer/datafyldning og Green-accept mangler |
| U15 | AI vælger nyttigt visuelt svar | GPT-6.1 Sol | Afgrænset aktivering og relevant end-to-end prøve mangler |
| U16 | Reel AI-styret søgning/berigelse | GPT-6.1 Sol | Søgehjælperfejl og evidensbundet berigelse mangler |
| U17 | Sammenhængende motion og oprydning | GPT-6.1 Sol | Tværgående normal/reduced/interrupted QA mangler |
| U18 | Roborock rum, indstillinger og handlinger | GPT-6.1 Sol | Frisk payload, grants, native valg og Green-prøve mangler |
| U19 | Kompakt støvsugeranimation | GPT-6 Luna | Rigtige statusser og stoptilstande skal kontrolleres |
| U20 | Vejrdata på godkendt UI-niveau | GPT-6.1 Sol | Fælles renderer, fuld dækning og råd på Green mangler |
| U21 | Musikdata, kø og afspilning | GPT-6.1 Sol | Fælles kort-renderer adopteret; live play-tilbud, player/kø-paritet og samlet native installation mangler |
| U22 | Lys bevares ærligt i Green | GPT-6 Luna | Placeholder-paritet; ingen opdigtede livehandlinger |
| U23 | Samlet installation og testklart link | GPT-6.1 Sol | Afventer reviewet samlet build og faktisk runtime-/UI-prøve |
| U24 | Ordbog og opdateret mangelliste | GPT-6 Luna | Løbende; hvert punkt kræver konkret acceptbevis |
| N01 | Identisk localhost/Green-rendering og assets | GPT-6.1 Sol | Delvis: fælles MusicResults adopteret; player/kø/vejr og samlet asset-paritet mangler |
| N02 | Realistiske lokale data inkl. robot/lys | GPT-6 Luna | Ni verificerede sange og household-fixture lokalt; bredde-accept mangler |
| N03 | Tre kort/fire faner bevares | GPT-6.1 Sol | Bruger godkendt; Green mangler |
| N04 | Andre forslag: UI og hentefedback | GPT-6.1 Sol | Lokalt browserverificeret pending → nye kort; afspilning bevaret. Live mood mangler |
| N05 | Player uden vandret scroll | GPT-6.1 Sol | Lokalt clientWidth=scrollWidth=299; touch-padding browserverificeret |
| N06 | Fælles header/player uden højdehop | GPT-6.1 Sol | Lokalt top84.71875/bund584 på tre scener; bred QA mangler |
| N07 | Rigtige scrollkanter og slutpunkt | GPT-6 Luna | Lokalt leveret;2 lifecycletests og faktisk vejr-slutpunkt kontrolleret |
| N08 | Køoverskrift uden scroll-baggrundsfejl | GPT-6.1 Sol | Lokal fast header uden for køscroll; modal browserverificeret |
| N09 | Længere tilbagepil | GPT-6 Luna | Lokalt implementeret; visuel accept mangler |
| N10 | Tryk Lige nu → Ro | GPT-6.1 Sol | Lokalt implementeret; touch/keyboard QA mangler |
| N11 | Global PodConnect-startvolumen | GPT-6.1 Sol | PodConnect + PodVoice kontrakt har uafhængigt source GO; samlet admission/install og fysisk test mangler |
| N12 | Fast rum og standardhøjttaler | GPT-6.1 Sol | Serverbundet kontrakt har source GO; faktisk rum/højttaler-opsætning og Green-prøve mangler |
| N13 | Kiosk og iPad fullscreen | GPT-6.1 Sol | Isoleret kilde/desktopfixture; Green/iPad-accept mangler |
| N14 | Touchflader med korrekt padding | GPT-6.1 Sol | Lokalt browserkontrolleret ved1024×600 og390×844 |
| N15 | Modal topafstand, lukning og scroll | GPT-6.1 Sol | Lokalt browserkontrolleret ved1024×600 og390×844 |
| N16 | AI-logik for nye musikforslag | GPT-6.1 Sol | Lokal rotation er fixture; live mood-valg fra faktiske kandidater mangler |

| N17 | Touch slip indenfor / annullér udenfor | GPT-6.1 Sol | Helper integreret med 9 fokuserede tests; samlet235 PASS; faktisk iPhone-prøve mangler |

| N18 | Kompakt musikmodal med tre hele kønumre | GPT-6.1 Sol | Browserverificeret1024×600: tre64px rækker,228px køområde, dialog uden egen scroll |

Anden bølge, faktisk startet:
- **GPT-6.1 Sol / podvoice_native_contract_sol:** frosset backendkandidat b150a929,124 fokuserede tests. Ingen installation.
- **GPT-6.1 Sol / native_contract_review_sol:** uafhængigt review af b150a929 mod native0d1231e9.
- **GPT-6.1 Sol / shared_music_ui_sol:** fælles lokal/live musikkort-renderer adopteret efter uafhængigt GO. Live player/kø og play-autoritet er stadig åbne.
- **GPT-6.1 Sol / touch_cancel_sol:** touch-cancel helper/tests leveret og integreret af lead.

Lead-integration: touchhelper er tilkoblet connected/schedule/disconnect/pagehide-lifecycle. Samlet225tests PASS. Faktisk browser fandt Illegal invocation fra ubundet window.setTimeout i local refresh; standardtimerne er rettet til closures, genprøve følger. Kildereview af b150a929 + native0d1231e9 har uafhængigt GO,124tests og2inertprobes; ingen Green-installation eller fysiskaccept af denne nye kobling.

Aktuel kontrol:235 samlede tests PASS efter fælles renderer-adoption. Kompakt modal kontrolleret i den faktiske in-app browser: dialog568px uden overflow; tredje kønummer slutter535.5px,24px før køområdets bund. Evidens: visual/local-modal-three-queue-20261015.png. Ingen ny Green-installation.

## Nyeste bindende opgaver og faktiske fremskridt ·15. oktober11:16

Alle nye opgaver nedenfor tildeles GPT-6.1 Sol til implementering/review; eventuel produkt-AI til Stemning er separat foreslået GPT-6 Luna og er ikke aktiveret.

| ID | Opgave | Model | Faktisk status / rest |
|---|---|---|---|
| N19 | Tydelig afstand mellem volume og transport | GPT-6.1 Sol | Målt26px fri touchafstand ved1024×600; tre hele64px kønumre bevares |
| N20 | Tidsafhængig AI-Stemning med passende illustrationer | GPT-6.1 Sol | Bindende krav dokumenteret; faktisk model/tema/assets/playlistintegration og separat budgetaktivering mangler |
| N21 | Rigtige playlister og bevaret autoplay | GPT-6.1 Sol | Eksisterende nativeautoplay genbruges; playlist search/read/play_context under implementering, ingen ny autoplaymotor |
| N22 | Kun Andre forslag må udskifte kort | GPT-6.1 Sol | Per-fane indholdscache integreret; første indlæsning undtaget;8regressioner PASS; sourceexpiry giver ingen automatisk udskiftning |
| N23 | Fjern Navn og præcis tid | GPT-6.1 Sol | Fjernet lokalt og faktisk browserverificeret; Greenpakke afventer endelig sync |
| N24 | Empty/loading/error/offline/missingart i begge players | GPT-6.1 Sol | Fælles renderer integreret; faktiske Ro/activeempty/loading/errorcaptures; resterende auditstates/deviceQA åbne |
| N25 | Fanerne Stemning/Humør/Topsange/Senest | GPT-6.1 Sol | Drøftet; endeligt faneskift afventer brugerbeslutning. Playlister som fanenavn er eksplicit afvist |
| N26 | Custom enheds lysstyrke/sluk/genstart/lyssensor | GPT-6.1 Sol | Bruger godkendt som senere spor; dokumenteret i DEVICE-SCREEN-CONTROLS-FUTURE.md. Ingen implementation nu |

U20: fælles weather-renderer integreret efter leadreview; faktisk lokalt1024×600capture bevaret. U21/N01: fælles player+queue integreret efter uafhængigt GO. Samlet274root-tests PASS før collectionUIadoption; backendofficialfast123tests+69mypy/Ruff/format PASS på durablepublic29+native/kiosk/weather/collections.130pakkedeassets matcher rootdist byte-for-byte, independentlyverified. KioskBFCachefindingrettet,5VMtests PASS. Endelig13-slicecoupling/admission/freeze/CI/install mangler; Green sidsteverificerede28. v2.X har reserveret30 til denne ene samlede installation og publiceret29+docsbeed, som kandidaten nu bevarer.

N26 præcisering11:22: senere adgang skal være swipe NED FRA TOPPEN →Skærm, ikke swipeop. Ingen runtimeændring nu. Musikdefault i nuværende kode: Stemning ved førsteinit/fuldreload, sidstevalgtefane+cache ved normalnavigation; QAstageparameter kan eksplicit vælge testfane.
