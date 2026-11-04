# PodView: 50 hårde spørgsmål og svar

4. november 2026. Grundlag: hele den aktuelle tråd, gældende produktbeslutninger og undersøgelse af faktisk kilde. Dette er en audit og et korrektionsgrundlag, ikke en ny backlog eller en færdigmelding. Aktuel leverancestatus forbliver i `docs/UI-DELIVERY-GOAL.md`.

## Konklusion

**Efterfølgende brugerpræcisering:** De 50 svar skal omsættes til [den samlede grundplan](../PODVIEW-FOUNDATION-PLAN-2026-11-04.md). Brugeren bestiller en enkel, responsiv, stabil og modulær oplevelse; agenten ejer teknologivalg og udførelse. Brugerens omtale af asynkronitet/cache/WebSocket er ikke en teknisk binding. Planen beskriver derfor oplevelseskrav separat fra agentens begrundede tekniske arbejdsretning.

PodView er brugerens visuelt tilpassede HTML/CSS/JavaScript-dashboard til Home Assistant. Det viser hjemmets faktiske tilstand og sender eksplicit betjening til eksisterende ejere. PodConnect ejer Spotify; PodSpeakers ejer den faktiske lydrute. PodVoice leverer eksisterende bridge og stemmeintegration. Dashboardets almindelige betjening må ikke kræve en aktiv samtale eller falde ud ved uvedkommende samtaleændringer.

Det er ikke dokumenteret, at PodView har fået en ekstra fysisk afspilningsmotor. Den dokumenterede kompleksitet ligger især i flere kontroltilbud, kortlivede opgaver, fælles venteflag og sammenblanding af samtale-, observations- og betjeningslevetid. Flere af disse mekanismer kan afbryde basal betjening. Derudover mangler loggen dele af forklaringen, og en eksisterende test kræver, at Pause bortfalder ved sangskift under forberedelsen.

Den gennemgåede kode giver konkrete fejlmekanismer. Den eksisterende log kan ikke bevise, hvilken mekanisme der udløste brugerens konkrete pausefejl eller kontroltab. Det er et åbent diagnosehul, ikke grund til at gøre en sandsynlig forklaring til en konklusion.

## Kildegrundlag

Green blev aflæst i den faktiske browser som version **2.0.127**, commit `37680d1831ce26fd1c41a82a19a35482435b2ece`, med gemt build-identitet `f49fdef0fa7dbc58bfd9d6b44c25386621bd78999afd77529326d058e385d7d3`. Dette er dashboardets runtimeoplysning, ikke en ny hashmåling af hele det kørende filsystem.

Kildeundersøgelsen brugte også ren lokal kandidat `ebc8bdc34f85034dc54f18e34a5015d836ffa7f0` i `/private/tmp/pv128-robot-release-20261104`. Relevante 127-mekanismer blev kontrolleret mod Git-revisionen; 128 er ikke påstået installeret. Henvisninger nedenfor er repository-relative til denne PodVoice-kilde:

- **E1:** `podvoice/gatekeeper/static/podview/live-control-view.js:38–54,388,451–475`: robotkontekst, invalidering, ventebetingelser og særskilt overviewtilbud.
- **E2:** samme fil `:95–111,273–308`: musikkontekst, frisk setup, afbrydelser og dispatch.
- **E3:** samme fil `:57,125–138,306`: receipts, settlement og sent svar.
- **E4:** `podvoice/gatekeeper/static/podview/robot-control-panel.js:106,117,121`: rå headerfallback, headerhandlinger og aktive rengøringsvalg.
- **E5:** `podvoice/gatekeeper/podview_controls.py:1235–1260,1340–1360`: transporttilbud og opslugte fejl i delvist robotsetup.
- **E6:** `podvoice/gatekeeper/podview_vacuum_control.py:105` og omkringliggende transport: eksisterende HA-servicevej.
- **E7:** `tests/podview/canonical-next-native-music-controls.test.mjs:15`: item-skift under Pause-setup kræver nul effektkald.
- **E8:** `podvoice/gatekeeper/podview_room_media.py:19–48,428–437`, `tools.py:2883–2917`: playback-læsning og fejlprojektion. Gemte Green-logs omkring 11.56–11.57 viser owner/unavailable ved HTTP200; disse logs er tidligere indsamlet evidens, ikke en ny liveaflæsning i denne audit.
- **E9:** `podvoice/gatekeeper/static/podview/podvoice-transport.js:4–18,32–105,310–319`: begrænset diagnostikskema, retention/upload og effektkald.
- **E10:** `podvoice/gatekeeper/podview_client_diagnostics.py:22–24,31–69,87–109,377–392,459–474`: serverens diagnostikskema, retention og buildidentitet.
- **E11:** `podvoice/gatekeeper/static/podview/live-media-view.js:23–29`: aktualitet koblet til samtalekontekst.
- **E12:** PodViews `PRODUCT.md`, `docs/USER-DECISIONS-2026-10-16.md`, `docs/COMPONENT-LIBRARY.md`, `docs/UI-DELIVERY-GOAL.md` samt `docs/PODVIEW-CONTRACT.md`: eksisterende retning, aftalte kontroller og særskilte bevislag.

**Mærkning:** Fund = læst kode eller konkret observation. Vurdering = konklusion ud fra disse fund. Retning = det arbejde, der følger af brugerens krav; ikke allerede implementeret. Åbent = endnu ikke bevist.

## 1–10: Er produktet blevet mere end det skal være?

| # | Hårdt spørgsmål | Svar og konsekvens |
| --- | --- | --- |
| 1 | Hvad er PodView faktisk bestilt som? | **Retning:** Et personligt udformet dashboard over HA med direkte betjening af eksisterende services. Det skal ikke vokse til en selvstændig orkestreringsplatform. Brugerens gentagne besked i denne tråd er acceptgrundlaget. |
| 2 | Kræver den visuelle ambition en kompliceret kontrolarkitektur? | **Nej, vurdering.** Det kanoniske kit ejer udseende og komposition; det begrunder ikke ekstra betjeningslivscyklusser. Bevar det godkendte UI, forenkl funktionens afhængigheder. E12. |
| 3 | Skal HTML/CSS alene udføre alle handlinger? | **Nej.** JavaScript og en autentificeret servicevej er nødvendige. Men deres opgave er afgrænset: vis observation, send eksplicit kommando, vis resultat. Brugerens forenklingskrav kræver ikke en teknisk urealistisk frontend. |
| 4 | Hvem ejer robot og hjemmets faktiske tilstand? | **Fund:** HA er kilde og serviceejer; robotvejen ender allerede i HA-services. Browseren skal ikke skabe en anden sandhed. E6. |
| 5 | Hvem ejer Spotify og det faktiske output? | **Fund/kontrakt:** PodConnect ejer afspilning, PodSpeakers lydruten. PodView viser og betjener deres tilstand gennem eksisterende integration. Ingen ny musikmotor er påvist eller nødvendig. E8, E12. |
| 6 | Skal dashboardet være afhængigt af, at Voice PE virker? | **Retning:** Nej. Touch-betjening skal fungere selvstændigt gennem eksisterende ejere. Stemme skal kunne anvende samme funktion, men er ikke en betingelse for et tryk på Pause. E12. |
| 7 | Har vi alligevel koblet dashboardet til samtalen? | **Ja, fund:** Robotkontekst og dele af musikaktualiteten indeholder samtalefelter. En ændring kan ugyldiggøre betjeningen. E1, E11. |
| 8 | Beskytter alle disse koblinger noget nødvendigt? | **Åbent.** Hvert felt skal begrundes med den konkrete handling og ejer. Samtalebundne svarvalg kan behøve samtalebinding; almindelig enhedsbetjening skal ikke arve den uden årsag. Blanketfjernelse ville også være ubegrundet. |
| 9 | Er en ny global statebus løsningen? | **Nej, retning.** Den ville tilføje en ny ejer oven på problemet. Brug eksisterende domæneejere, fjern uvedkommende koblinger og genbrug samme observation i flere visninger. E12. |
| 10 | Kan vi forenkle uden at genbygge hele produktet? | **Ja, vurdering:** Bevar renderer, eksisterende HA-/musikservices og autentifikation. Ret kontrolkontekst, delte venteflag, tilbudsforbrug og feedback hos eksisterende ejere. Der er ikke belæg for frameworkskifte eller fuld omskrivning. |

## 11–20: Hvorfor virker de banale handlinger ikke stabilt?

| # | Hårdt spørgsmål | Svar og konsekvens |
| --- | --- | --- |
| 11 | Hvorfor kan et sangskift kassere et Pause-klik? | **Fund:** Musikkonteksten indeholder item-URI og playing/paused. Intentionen afbrydes ved kontekstskift under setup. Pause kan dermed bortfalde på samme output. E2. |
| 12 | Er det nogensinde en godkendt brugeroplevelse? | **Nej, retning:** Pause skal standse den afspiller, brugeren betjener, også omkring normal sangovergang. Ny konto, ændret output eller tilbagekaldt adgang skal fortsat genvalideres. Dette kræver afstemning med serverens taskbinding. |
| 13 | Beviser dette årsagen før Colors? | **Nej, åbent:** Mekanismen er bevist i kode; brugerens konkrete klik mangler korrelation til setup, dispatch og serviceudfald. Vi må ikke udfylde det hul med en forklaring, der blot passer. E2, E9. |
| 14 | Hvorfor skal Pause først hente et nyt setup? | **Fund:** Klikket bruger et frisk servertilbud før action. **Retning:** Undersøg om samme ejer kan validere og udføre i ét kald. Frontend må ikke blot ignorere den nuværende kontrakt. E2. |
| 15 | Er en udløbet læseobservation det samme som manglende ret til Pause? | **Nej som begreb. Fund:** Koden bruger frisk observation som forudsætning for musikkontekst. **Retning:** Skeln visningsfriskhed fra ejerens aktuelle mulighed for at validere en eksplicit kommando. Bevar korrekt mål. E2. |
| 16 | Hvorfor kan en ny samtaletur fjerne robotbetjening? | **Fund:** Robotmyndigheden indeholder session/task/inputRevision/providerGeneration. Ændring invaliderer tilbuddet. **Retning:** Almindelig robotbetjening skal afgrænses af robot, reel adgang og relevante enhedsændringer. E1. |
| 17 | Hvorfor kan musikarbejde blokere robotten? | **Fund:** Fælles pending/setupPending/musicIntentPending indgår i robotveje. **Retning:** Ventetilstand afgrænses til berørt handling/enhed, medmindre en konkret fælles ressource kræver serialisering. E1. |
| 18 | Hvorfor er Pause på widget og i detaljen forskellige? | **Fund:** De bruger særskilte kortlivede robottilbud. De kan derfor være uenige om betjeningsmuligheder. **Retning:** Begge skal vise samme domænegrundlag; serveren genvaliderer stadig hver effekt. E1. |
| 19 | Har progressbaren slettet robotknapperne? | **Fund:** Headerhandlinger og aktive rengøringsvalg findes stadig i 127-rendereren. Direkte sletning ved progressændringen er ikke påvist. Manglende tilbud eller invalidering kan stadig få dem til at forsvinde. E4. |
| 20 | Hvor kommer Moppeintensitet-støjen fra? | **Fund:** En rå fallback i headeren, indført tidligere end den aktuelle fejl. **Retning:** Headeren viser opgave og relevant handlingsfeedback; indstillinger hører til den eksisterende rengøringskomposition. Ingen ny informationsfamilie. E4. |

## 21–30: Er tilstand, adgang og feedback forståelige?

| # | Hårdt spørgsmål | Svar og konsekvens |
| --- | --- | --- |
| 21 | Kan backend returnere succes uden de forventede robotkontroller? | **Ja, fund:** Transport-/indstillingsundtagelser kan opsluges, mens andre dele af setup lykkes. HTTP200 med delindhold forklarer ikke fraværet. E5. |
| 22 | Er manglende kontrol et tilstrækkeligt fejlsprog? | **Nej, retning:** Skeln ikke understøttet, ingen adgang, midlertidig fejl og afventer. Bevar den aftalte anatomi under opdatering og forklar årsagen uden at opfinde aktiv myndighed. E4, E5. |
| 23 | Skal rengøringsvalg være tilgængeligt under rengøring? | **Ja, brugerkrav.** Vis og betjen de indstillinger, den eksisterende ejer faktisk understøtter i den aktuelle tilstand. Andre valg skal være tydeligt afgrænsede; hele afsnittet må ikke tavst forsvinde. Præcis aktiv kapabilitet er fortsat et servicebevis. |
| 24 | Skal et tilbuds udløb ødelægge mine usendte valg? | **Nej, retning:** Lokale valg er brugerens kladde, ikke en capability. Bevar værdier uafhængigt af opaque action-ID'er; genvalidér og map til friskt tilbud før afsendelse. E1, E12. |
| 25 | Er tidligere renewal en fundamental løsning? | **Nej, vurdering:** Det kan reducere et tidsvindue, men fjerner ikke samtalekobling, særskilte tilbud eller opslugte fejl. 128's ændring må ikke stå som bevis for løst grundproblem. E1. |
| 26 | Må reconnect sende en tidligere kommando igen? | **Nej, retning:** Genopret læsning og visning. Et ukendt effektudfald må ikke automatisk gensendes. Forenkling må bevare denne egenskab. E12. |
| 27 | Betyder HTTP200, at musikken er pauset? | **Nej, fund/kontrakt:** Transportkvittering, accepted og frisk paused-observation er forskellige trin. Succes skal knyttes til faktisk observeret resultat. E3, E9. |
| 28 | Betyder unavailable, at Spotify-login er udløbet? | **Ikke bevist.** De gemte logs viser owner/unavailable ved HTTP200. Projektionen kan skjule den oprindelige gren; tokenudløb er kun én mulig forklaring. E8. |
| 29 | Skal læsefejl nulstille sangen eller se ud som pause? | **Nej, retning/kontrakt:** Bevar ærlig sidst kendt visning med manglende friskhed; hverken opfind idle, paused eller bekræftet output. Læsning og kommando er forskellige forløb. E12. |
| 30 | Må en ny feature ændre fungerende grundbetjening? | **Nej, acceptkrav:** Berørte naboforløb skal kontrolleres på den samlede kandidat. Ny progress eller nye oplysninger giver ingen tilladelse til at fjerne aftalte handlinger. E12 og brugerens feedback. |

## 31–40: Kan loggen faktisk forklare en testkørsel?

| # | Hårdt spørgsmål | Svar og konsekvens |
| --- | --- | --- |
| 31 | Logges handlingen, før den kan forsvinde lokalt? | **Ikke dækkende, fund:** Tidlige returneringer i musikintentionen kan mangle registreret input og årsag. Log intentionen ved input, før validering og setup. E2, E9. |
| 32 | Kan vi følge ét klik gennem alle kald? | **Ikke entydigt, fund:** Effektens request-ID opstår senere; klientskemaet mangler fælles intention og handlingsnavn. Udvid eksisterende diagnostik, ikke en ny logplatform. E9, E10. |
| 33 | Logges alle afvisningsgrene med konkret årsag? | **Nej, fund:** Tidlige returns og opslugte setup-undtagelser efterlader huller. Registrér trin, udfald og sikker klassifikation dér, hvor årsagen kendes. E2, E5. |
| 34 | Logges bekræftet effekt lige så tydeligt som accepted? | **Nej, fund:** Settlement findes i hukommelsens receipts, men den tilsvarende vedvarende diagnostikrække mangler. Den endelige observation skal forbindes til samme intention. E3, E9. |
| 35 | Kan et sent svar forsvinde fra forklaringen? | **Ja, fund:** En aktualitetskontrol kan returnere før remember. Bevar svarets udfald i loggen, også når det korrekt ikke må ændre den nye visning. E3. |
| 36 | Overlever hele forløbet loggens begrænsninger? | **Ikke garanteret, fund:** Klienten har 128 poster, serveren 512/256 KiB; rolige poster fortrænges. Succeser, start og accepted kan være nødvendige for forklaringen. Bevar sammenhængende handlingsforløb og angiv tab. E9, E10. |
| 37 | Betyder manglende serverlog, at brugeren ikke trykkede? | **Nej.** Klienten kan have afbrudt før HTTP eller ikke uploadet endnu. Logeksport skal vise klient-/uploadhuller og dækket tidsvindue. E9. |
| 38 | Hjælper tusind identiske poll-succeser? | **Kun når de bidrager til forløbet, vurdering.** Bevar nødvendig tids-/tilstandskontekst og fejl-/recoveryovergange. Gentagelser må ikke fortrænge brugerhandling, årsag eller slutudfald. Det er sporbarhed, ikke linjeantal, der afgør kvaliteten. |
| 39 | Kan vi love, at loggen altid kender enhver fysisk årsag? | **Nej.** Vi kan kræve, at hvert forløb enten forklares eller præcist angiver den manglende observation. Uden hardwareobservation må softwareloggen ikke påstå fysisk effekt. Diagnosehullet er selv et åbent fund. |
| 40 | Hvad skal en god lograpport svare på? | **Retning:** Hvilken handling, version og enhed; hvilke valideringer; hvad sendt/modtaget/udført; hvilken effekt observeret; hvilken feedback vist; hvorfor afbrudt; hvad recovery gjorde. Hver intention får et forklarligt slutudfald. |

## 41–50: Har vores tests og afleveringer bevist det rigtige?

| # | Hårdt spørgsmål | Svar og konsekvens |
| --- | --- | --- |
| 41 | Har en test godkendt en forkert brugeroplevelse? | **Ja, fund:** Testen kræver nul effekt ved item-skift under Pause-setup. Den beskytter implementationens regel, men afviser brugerens forventede pause på samme afspiller. E7. |
| 42 | Skal vi derfor droppe alle tests? | **Nej, vurdering:** Vi skal rette deres acceptgrundlag og deres bevispåstand. En intern kontrol kan beskytte en grænse, men kan ikke alene bevise, at et menneskes handling virker. Testantal er ikke brugerresultat. |
| 43 | Hvad er det rigtige orakel for Pause? | **Retning:** Den faktiske afspilningsejers friske paused-observation for korrekt konto/output, sammenholdt med intention og UI. Et mock-svar, en boolean eller accepted alene er utilstrækkeligt. Hørbar slutprøve registreres særskilt. |
| 44 | Hvad er det rigtige orakel for robotbetjening? | **Retning:** Korrekt HA-enhed, servicehandling og efterfølgende relevant HA-observation, sammenholdt med kontrolmuligheder og feedback. Service-ACK alene beviser ikke bevægelse. Active settings kræver deres faktiske tilstandsobservation. |
| 45 | Kan isolerede patches bevise det installerede produkt? | **Nej.** De kan bevise deres eget afgrænsede flow. Samlet kandidat, faktisk build, installation og brugerresultat skal knyttes sammen. Det er netop et hul i den hidtidige aflevering. E12. |
| 46 | Hvorfor beskytter mange grønne checks ikke mod dette? | **Vurdering med konkret belæg:** Mindst én forkert antagelse er skrevet ind i en test; andre checks dækker dele frem for hele effekten. Flere af samme checks retter ikke acceptgrundlaget. E7 og manglende klik-/effektkorrelation. |
| 47 | Er lys, timer, radio, opskrifter og alle fejltilstande så bevist? | **Nej, åbent:** Denne audit har kausalt undersøgt robot og musik. Øvrige funktioner må ikke arve en færdigmelding. De skal vurderes mod deres allerede aftalte handlinger og faktiske ejere i den eksisterende feedbackoversigt. Ingen ny scopeudvidelse. |
| 48 | Hvordan opdager vi, at en rettelse i A ødelægger B? | **Retning:** Kontroller de konkrete delte afhængigheder: samtaleskift, sangskift, pending, reconnect og tilbudsfornyelse, mens grundbetjeningen bruges. Bevis korrekt serviceudfald på samme samlede kandidat; genbrug gyldigt bevis for uændrede grænser. |
| 49 | Hvem ejer fejlsøgning og komplet funktionskontrol? | **Agenten.** Brugeren skal ikke genbestille aftalte kontroller, sammenstille patches eller opdage basale softwarefejl. Manglende adgang eller fysisk observation angives præcist; det flytter ikke softwareansvaret til brugeren. |
| 50 | Hvad betyder færdig fra nu af? | **Retning:** Den aftalte handling virker gennem eksisterende ejer, vises korrekt, overlever relevante opdateringer og fejl, og har et forklarligt logforløb. Kode, visuel gennemgang, udgivelse, installation og fysisk accept registreres særskilt. Åbne fejl forbliver åbne. |

## Hvad der konkret skal forenkles

1. Afgræns almindelig betjening efter domæne og faktisk mål. Fjern afhængigheder af uvedkommende samtale- og itemændringer efter gennemgang af serverkontrakten.
2. Lad robotwidget og detalje projicere samme domænegrundlag; bevar kontroller og usendte valg gennem læsning/fornyelse. Skjul ikke tekniske fejl som manglende produktfunktioner.
3. Afgræns venteflag til berørt handling/enhed. Behold kun delte låse, når en navngiven delt ressource kræver det.
4. Gør én intention forklarlig fra klik til serviceobservation i eksisterende log. Luk tavse returns, delvise setups uden årsag og manglende terminalresultater.
5. Ret brugerforløbets forventede udfald før dets regressionstest. Undersøg derefter om eksisterende service kan samle setup og udførelse; indfør ikke endnu et mellemlag som genvej.

Bevar HA-login, konkret enheds-/domæneadgang, korrekt konto/output, validering før effekt og UNKNOWN uden automatisk gentagelse. Bevar godkendt UI og eksisterende kanoniske komponenter. Enklere arkitektur må ikke betyde svagere målvalidering eller færre aftalte funktioner.

## Faktisk status efter denne audit

Produktkode og Green er ikke ændret af denne audit. De konkrete fejl er stadig åbne. De gennemgåede mekanismer og loghuller er nu dokumenteret som et samlet korrektionsgrundlag; der er ikke opnået service- eller fysisk accept. Den aktuelle tråds brugerbeslutning er grundlaget for det videre arbejde, ikke en invitation til flere featureudvidelser.
