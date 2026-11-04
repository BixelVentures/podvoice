# Astra high: adversarial review af PodView

4. november 2026. Faktisk udført af `gpt-6-astra`, reasoning `high`, agent `/root/astra_plan_grill`. Dette er reviewevidens, ikke runtime-/produktaccept eller en ny statusoversigt. Ingen runtimeændring eller fysisk handling blev udført. Kilde: den undersøgte 128-checkout `ebc8bdc3`, PodView-workspace og de gældende dokumenter; aktiv kilde/installationsidentitet skal stadig aflæses ved udførelse.

## Første dom

Den første grundplan blev **afvist som klar til bred implementering**. Den beskrev rigtigt produktmål, men risikerede lange arkitektur-/logfaser før en fungerende Pause. Den manglede beslutninger om kommandomål, serverlåse og faktisk bevis. Astra krævede revision og genkontrol.

## Otte væsentlige fund

1. **P0: Første pakke var flere projekter.** Reproduktion skulle frem før samlet oprydning. Luk ved samme fejlede før-/beståede efter-forløb gennem klient/server/service, ikke ved implementeret log.
2. **P0: Backend låser på rum.** `podview_controls.py:235–236,897,927,2198,2219,2239–2240` bruger rumglobale `busy/setups/mutations`. Frontendafkobling alene løser ikke domæneblokering. Både konfliktregler og serverejerskab skal ændres målrettet.
3. **P0: Kommandoidentitet var uafklaret.** `_binding` og `_move_revision` indeholder samtalekontekst; `_light_current` bruger denne revision. Almindelig touch kræver sin præcise mål-/adgangsidentitet, ikke en sang eller samtaleturn. Udviklingsfasen gør en enklere intern kontrakt mulig uden kunstig legacykompatibilitet.
4. **P1: Opskriftsadoption er ubevist.** Lokal autoimportpakke er overdraget, mens undersøgte server-/dev-ejere stadig beskriver admin-review/publicering. Identificér faktisk route og varigt katalog tidligt; genbrug pakken frem for at bygge en ny importer.
5. **P1: Dokumenteret begrænsning kunne blive PASS.** Kun korrekt observeret udfald lukker funktionen. Manglende adgang/data er åbent/blokeret. En fungerende integreret rettelse kan leveres, før hele det øvrige inventar er afsluttet; samlet produktaccept forbliver åben.
6. **P1: Frisk tilstand er ikke altid kausal effekt.** Skeln eksisterende request-/settlementbevis fra observeret aktuel paused-state. Ekstern pause/resume og sene svar må hverken give falsk succes eller evig pending.
7. **P1: Hurtig pending kan skjule langsom funktion.** Mål touch→feedback, dispatch, ACK og observation hver for sig. Undersøgte musiksetup kan vente op til 20 sekunder. Faktisk effektlatens og timeout/recovery skal afgøres i den konkrete pakke.
8. **P1: Flashes kræver tidsligt browserbevis.** To korrekte screenshots beviser ikke stabil overgang. Gennemgå sammenhængende forløb over berørte opdateringer med indhold, geometri, fokus, scroll og drafts.

## Grilling fra 15 vinkler

KODE = konkret læst mekanisme; STIKPRØVE = repræsentativt spor; IKKE VERIFICERET = ingen runtimeaccept. Et auditeret område er ikke automatisk et fungerende område.

| # | Vinkel og dækning | Konkret fund | Krav til løsningen og udviklingsprocessen |
| --- | --- | --- | --- |
| 1 | Produkt/accept — dokumenter | Aktuelle krav ligger langt nede blandt historiske produktmål, simulation og tidligere skærmstørrelser. | Kort gældende topindgang i eksisterende oversigt; historik må ikke styre ny implementation. |
| 2 | Domæneejerskab — stikprøve | Vacuum sender HA-services; playback resolver bruger faktisk Connect-output. Ingen ekstra musikmotor påvist. | Bevar faktiske ejere. Ingen ny global bus, state-service eller framework som svar på kontrolfejl. |
| 3 | Auth vs kontrolprotokol — kode | `podview.py:115–143,616` har request-scoped HA-ingressauth; browserens kortlivede tilbud er ikke selve HA-loginbeskyttelsen. | Undersøg enklere normal touch: handling + præcist mål + request-ID, valideret hos eksisterende ejer. Fjern redundant setup/renewal, hvor den direkte kontrakt kan overtage. Bevar faktisk målskærmsauth; dens aktuelle mode er ikke verificeret. |
| 4 | Frontendkvalitet — kode | Release-LiveControlView ca112 KB/508 linjer, 42 linjer over500tegn; lokal WidgetHost ca142 KB/622 linjer. | Formatér berørte funktioner, navngiv scope/await/cleanup/settlement, og adskil konkret sammenblandede domæner. Ingen kosmetisk helreformat. |
| 5 | Serverlåse/livscyklus — kode | Rumglobal busy/setup/mutation blokerer uafhængige domæner. | Navngivne ressourceidentiteter/konflikter i både klient og backend. Genvalider grant/targetændring uden globalt at fryse dashboardet. |
| 6 | Async/orden — stikprøve | ActiveRead-coalescing og generationshegn findes, men readscope arver samtalefelter. SSE-dækning og snapshot/eventhul ikke verificeret. | Bevar nyttig ordensbeskyttelse, fjern irrelevante felter og prøv ældre svar efter nyere event samt reconnect. |
| 7 | Respons — kode, runtime åben | Frisk setup før Pause; musiksetup op til20s. | Første klik skal virke; mål faktisk kommandoforløb. INP/100ms er støttemål, ikke bevis for effekt. |
| 8 | UI-kit/bevægelse — stikprøve | Komponentgate/bundles og retained-delta-tests findes; de beviser ikke visuelt forløb. | Faktisk Product Design/Impeccable-gennemgang af produkt og kit, inklusive tidslige skift og reduceret bevægelse. |
| 9 | Faktisk service — stikprøve, runtime åben | Robot genlæser identity/features/state før servicekald; musik skelner konto fra native route. | Prøv korrekt service og mål. Fjern kun uvedkommende state-lighedskrav. Ingen replay af UNKNOWN. |
| 10 | Opskrifter/lager — kode/pakke, adoption åben | Dev-JS og undersøgt Python har adminpublish; separat autoimportpakke er dokumenteret. | Reel uploadroute→samme varige katalog→automatisk visning. Prøv dublet/genstart og bevar oprindelig receipt. |
| 11 | Fejl/log — kode | Tavse returns/catches, generisk unavailable og sene svar før remember. | Forklar input, afbrydelse, dispatch, service, observation og feedback i eksisterende log; ingen selvstændig logplatform. |
| 12 | Testorakel — kode | Pause-test kræver ingen write ved item-skift; mocks kan blot svare accepted. | Forventet brugerudfald defineres før kode. Små kodetests kun ved konkret værdi; fuldt brugerflow er primært bevis. |
| 13 | Browserdækning — kode/stikprøve | CI Chromiumgate prøver admin `static/index.html`; PodView Node-tests bruger bl.a. håndlavet DOM. | Genbrug browserinfrastruktur til faktisk `static/podview/index.html` og rigtige journeys. Admin-PASS er ikke PodView-accept. |
| 14 | Kilde/build — kode | Lokal PodView-git har ingen HEAD, alle filer untracked; lokal control348 linjer vs release508. Devserver bruger ESM medmindre `--delivery`. | Én konkret kandidat/overlay for berørte filer; prøv faktisk leveringsbundle. Ingen stor gitmigration som forudsætning. Byg efter sidste ændring. |
| 15 | Udvikling/handoff — dokumenter/stikprøve | Gentagne lokale/release/installbeviser efterfulgt af genåbning; parallelle opskriftspakker ikke automatisk adopteret. | Én ansvarlig integrator, tydeligt filejerskab, adoptionkvittering og fremdrift målt på fungerende brugerflow. Ingen kunstige produktions-/kompatibilitetsgates. |

## Opdaterede brugerkrav, som reviewet skal håndhæve

- Produktet er i udvikling. Interne kontrakter, struktur og kode kan ændres, når det giver den enkleste holdbare løsning. Faktisk adgang, korrekt enhed, databevaring og ingen dobbelteffekter er stadig reelle hensyn.
- Brugeren ejer oplevelsen, agenten ejer teknikken. Cache/async/WebSocket er ikke brugerbestilte teknologier.
- Minimum nødvendig kodetest. Primær accept er faktisk PodView end-to-end gennem korrekt service og renderet resultat. Eksisterende nødvendige suites køres målrettet uden gentagelsesritualer.
- Planen skal være klar til ét Go. Ingen produktimplementation eller installation i denne reviewrunde før Go.
- Modelvalg, roller, reviewudløsere og ansvar skal være besluttet i planen; brugeren skal ikke koordinere modeller.

## Uafklarede faktiske observationer

Aktiv Green/kandidat/assetbinding; målskærmens faktiske auth; det konkrete pausekliks bortfald; SSE-domænedækning/reconnect; service/route/settlement ved musik; aktive robotmuligheder; original opskriftsreceipt og faktisk adopteret importer/lager; faktisk latency, blink, touch, lyd og robotrespons. Disse er agentens afgrænsede opgaver efter Go, ikke tekniske spørgsmål til brugeren.

## Anden runde

Astra læste Sol 6.1 highs faktiske omskrivning. Alle otte oprindelige fund blev vurderet substantielt adresseret. To yderligere lukninger blev krævet og skrevet ind:

1. Ressourceafgrænsede låse må ikke fjerne fælles invalidering ved faktisk ændret adgang, placement, policy eller relevant ejergeneration.
2. UNKNOWN må ikke blive permanent kontroltab. Afstem passivt med faktisk ejer; giv derefter adgang til en ny eksplicit intention mod et aktuelt valideret mål, uden replay af den gamle kommando eller falsk kausal succes.

Senere brugerpræcisering om HA-genbrug blev også gennemgået: vurder hele indgang/auth/dataflow, ikke kun API-kald. Native HA-panel er en relevant kandidat, men undersøgte renderere bruger dokumentglobale ID'er; et native mount kræver konkret scope-/APIarbejde. Go-planen skal derfor afgrænset sammenligne HA-native indgang med slank HA-auth ingress og vælge den samlede enkleste løsning. Aktuel indgang kan bære første Pause-rettelse; ingen uprøvet wrapper eller parallel renderer.

**Endelig dom fra Astra high: READY FOR GO.** Astra genlæste slutrevisionen og verificerede SHA-256 `bdea44ffbfbd22f5c5d8f9bf10c175e55205167f92fb50e3dab59c37152a44a8` for `docs/PODVIEW-FOUNDATION-PLAN-2026-11-04.md` (189 linjer). Ingen tilbageværende planblockers blev fundet. Otte oprindelige fund, to efterfølgende lukningskrav og senere HA-/model-/Mac-/iPad-præciseringer er adresseret.

Godkendelsen omfatter udførbar plan, ikke fungerende produkt. Aktiv kilde, faktisk adgang, serviceadfærd og native panel-mount afklares i de konkrete opgaver efter Go; de er ikke ekstra tekniske godkendelseskrav til brugeren. Ingen produktimplementation, tests, installation eller fysisk effekt er udført i dette review. Udførelse afventer brugerens Go, som brugeren selv har fastlagt.
