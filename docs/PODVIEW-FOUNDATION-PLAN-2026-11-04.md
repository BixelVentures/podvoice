# Grundplan: PodView skal fungere fra Green på Mac og iPad

4. november 2026. Revideret efter [50-spørgsmålsauditten](reviews/PODVIEW-FUNDAMENTAL-AUDIT-2026-11-04.md) og [Astras faktiske adversarial review](reviews/ASTRA-FOUNDATION-REVIEW-2026-11-04.md). Dette er planen til Go; den ændrer ingen runtime og påstår ingen bestået produktaccept. Fremdrift, feedback og rester føres fortsat kun i `docs/UI-DELIVERY-GOAL.md`.

## Go-kontrakt og succes

**Seneste direkte kildebeslutning:** Arbejdet tager udgangspunkt i den seneste faktiske PodVoice v2.x-løsning. Før ændringer identificerer lead den aktuelle v2.x-kilde, kandidat/build og installerede Green-version og afstemmer eventuelle forskelle. Ældre PodView-workspaces, 127/128-checkouts og isolerede patches er referencer, ikke automatisk arbejdsbase; nødvendige ændringer optages i den aktuelle v2.x-løsning uden at overskrive nyere arbejde.

**PodView er UX-designerens personligt udformede dashboard til Home Assistant.** Play afspiller, Pause pauser også under sangovergang, højttalerskift ændrer faktisk output, og en vellykket opskriftsupload ender automatisk i et varigt katalog. Touch giver straks relevant feedback. Opdateringer giver ingen flashes, hop, mistede valg eller global ventelås. En udvidelse skal kunne tilføjes som et afgrænset modul uden at ødelægge grundbetjeningen.

**Go starter hele den allerede aftalte softwareleverance:** nødvendige rettelser, integration, effektiv QA, udgivelse og installation på Green samt faktisk brugsklarhed på **Mac/Chrome og iPad/Safari via samme faste link**. Ingen bestemt time- eller tokenramme er aftalt. Korte rettelsespakker skal give forbedringer tidligt; de reducerer ikke slutleverancen. Aktuelle browsermål følger denne senere direkte brugerbeslutning frem for ældre beskrivelser af Denver som eneste mål.

Før Go udføres kun plan og review. Efter Go ejer agenten teknik, softwarefejlsøgning, adoption af delarbejde og verificering. Brugeren skal ikke vælge transport, samle patches eller teste basale funktioner for os. Teknologi som cache, async, SSE eller WebSocket er agentens middel; brugerens bindende krav er oplevelse og resultat.

Produktet er under udvikling. Interne kontrakter og kode kan revideres eller erstattes, når det giver en enklere holdbar løsning. Ingen imaginær produktionskompatibilitet eller bred migration er en forudsætning. Bevar konkret autentifikation, domæneadgang, korrekt mål, data og beskyttelse mod dobbelteffekter.

**Næste særskilte mål efter denne leverance:** køb/verificering af Frameo og samme løsning i hardware/kiosk. Intet Frameo-køb eller kamera implementeres her. Manglende Frameo stopper ikke Mac/iPad; manglende iPad-bevis kan derimod ikke kaldes iPad-klar.

## Ansvar, modelvalg og udløsere

| Rolle | Hvornår den bruges | Konkret ansvar |
| --- | --- | --- |
| Sol 6.1 high — lead, arkitekt og integrator | Gennem hele arbejdet; ved pakkestart, ejerskabs-/kontraktvalg og samlet adoption. | Holder brugerresultatet på den kritiske vej, vælger mindste holdbare løsning, binder kandidat og bevis, integrerer delarbejde og ejer samlet brugsklarhed. |
| Terra 6.1 medium/high — afgrænset implementation | Medium til kendt lokal rettelse; high til en afgrænset ændring med asynkronitet, flere ejere eller ukendt effekt. Kun når en selvstændig pakke forkorter vejen. | Får navngivne filer, kontrakt, forventet brugerudfald og afslutningsbevis. Returnerer faktisk kilde og rester; lead optager og verificerer resultatet. |
| Astra high — adversarial review | Før Go på planen; efter konkret design af touch/targets/låse og før adoption af ændret auth, idempotens eller anden risikofyldt ejerskabsgrænse. Genbrug gyldigt review ved uændret grænse. | Angriber forkert mål, tabt input, races, falsk succes, datatab og utilstrækkeligt E2E-orakel. Konkrete fund rettes; ingen reviewrunde pr. kosmetisk edit. |
| Sol-lead / én koordineret Green-operatør | Ved publicering og installation, også af en tidlig integreret forbedring. | Go-sessionens Sol-lead er entydigt ansvarlig til faktisk brugsklarhed. Findes en aktiv releaseejer, koordineres én operator; ellers overtager lead release/installation inden for eksisterende autorisation. Optag præcis kandidat, bevar UI-bytes, installér og efterkontrollér. Brugeren vælger ikke person eller samler patches. |

Lead kan selv udføre en pakke. Ingen model eller antal agenter er en leverance. Parallelisér kun uafhængige ejere med adskilte filer; aftal fælles kontrakt først. Opskriftsadoption kan køre parallelt med musikpakken. Robot-/backendarbejde koordineres med musikpakken, hvis de berører samme kontrolfil. Én ejer integrerer delte ændringer.

## Besluttet engineeringretning

HA ejer hjemmets data og enheder. PodConnect ejer Spotify-afspilning; PodSpeakers ejer faktisk native output. PodVoice leverer den eksisterende bridge og stemmeflade. PodView ejer kanonisk præsentation, navigation, lokale usendte valg og midlertidig feedback. Stemme og touch ender hos samme autoritative domæneejer. Ingen ny global bus, musikmotor, lifecycle-ejer eller generisk pluginplatform.

### HA først: genbrug det der allerede virker

PodView beholder sit eget kanoniske UI og genbruger mest muligt af HA's eksisterende kapabiliteter. Afklar den konkrete eksisterende HA-forbindelse og ejer, før der oprettes noget nyt. A0 vælger den enkleste konkrete indgang. Ved ingress er retningen eksisterende autentificerede backend → HA's faktiske state/events/services → eksisterende UI-bridge/SSE → PodView, med mindst mulig projektion.

| Genbrug først | Faktisk hul der kan kræve egen kode | Minimum egen kode |
| --- | --- | --- |
| HA-login/adgang samt entity-/device-/area-registre og state | Kanonisk PodView-præsentation og præcis domæne-/målvalidering | Afgrænset adapter og eksisterende valideringsgrænse; ingen ny auth eller stateejer. |
| HA-services, eventabonnementer og eksisterende timerejer | Konkret manglende mapping eller observation i det aftalte flow | Genbrug backendens abonnement og servicekald; ingen parallel lifecycle eller særskilt pollinglag uden påvist hul. |
| Eksisterende HA-/PodVoice-integration til musik og upload | Faktisk Connect-/Speakers-route eller varig opskriftslagring, som HA-forløbet ikke allerede leverer | Bevar disse faktiske ejere og eksisterende receipts; tilføj kun manglende binding/adoption. |

HA tilbyder autentificerede WebSocket-events og servicekald; det er en genbrugsmulighed hos den eksisterende ejer, ikke en bestilling af ny browserforbindelse. [Officiel HA WebSocket API](https://contributors.home-assistant.io/core/internals/websocket-api/). HA-frontends `hass` har state og `callService`, når man faktisk er i den kontekst; vi antager ikke, at det objekt findes i en ingress-iframe, og indfører ikke separat browsertoken/WS alene af den grund. [Officiel hass-reference](https://contributors.home-assistant.io/frontend/reference/hass-object/).

### Almindelig touch bliver en direkte kommando

**Vi vælger handling + præcist mål + request-ID til den eksisterende serverejer**, som autentificerer, validerer aktuel policy, ejer, mål og faktisk kapabilitet ved effektgrænsen og derefter udfører handlingen. Genbrug eksisterende request-/receipt-/idempotensmekanismer. Implementér ikke et ekstra kommandolag oven på setup/renewal. Den konkrete wireform afstemmes i de berørte eksisterende kontrakter, når kandidaten er identificeret.

- Normal Pause bindes til faktisk konto, afspilningsejer og native output, ikke item-URI, playing/paused eller samtaletur. Sangskift på samme output er lovligt; ændret output/ejer skal afvises eller genvalideres tydeligt, aldrig stiltiende retargetes.
- Robot bindes til faktisk robot og relevante job-/map-/indstillingsidentiteter. Lys bindes til faktisk område/entities og aktuel adgang. Fjern uvedkommende samtalekobling i både klient og backend, herunder `_binding`, `_move_revision` og lysenes brug af denne revision.
- Samtalebundne svar/valg beholder nødvendige session-/task-/revision- og optionidentiteter. Det er en anden binding end almindelig Pause. Vieweridentitet giver ingen opgave- eller effekttilladelse.
- Den undersøgte HA-ingress autentificerer hver request. Opaque browsertilbud er derfor ikke i sig selv HA-loginbeskyttelsen. I første berørte pakke verificeres den faktisk brugte Mac-/iPad-adgangsvej og dens servervalidering; ingen antagelse om en uverificeret cookie-/skærmmode, ingen ny loginløsning.
- Fjern redundant setup/renewal som effektforudsætning, hvor den direkte ejer overtager. Hvis første afgrænsede Pause-reparation er hurtigere på eksisterende vej, må den leveres først, men den må ikke bevare tabt input eller blokere den besluttede forenkling. Afvigelse kræver en konkret teknisk grund og et åbent leverancepunkt.
- Et request-ID må kun referere til samme aktør, handling, mål og parametre. Eksisterende receipt genfindes ved dobbeltlevering; et tabt svar bliver ikke en ny effekt. `UNKNOWN` gensendes aldrig automatisk. Browserens annullerede venten beviser ikke annulleret servicehandling.

Et ukendt resultat er terminalt for den oprindelige intention, ikke en permanent global kontrollås. Afstem passivt; næste eksplicitte brugerhandling valideres mod aktuel ejer/target og konkret mulig konflikt. Den må ikke replaye den gamle effekt eller sende en modstridende effekt, mens ejeren stadig kan udføre den. Hvis denne konflikt ikke kan afklares, forklares præcis den berørte handlings blokering; navigation og uafhængige handlinger forbliver brugbare.

### Ventetid og tilstand får et konkret scope

| Område | Beslutning og konsekvens |
| --- | --- |
| Backendkonflikter | Afgræns effekt-/setupkonflikter efter faktisk ressource og handling hos samme eksisterende ejer, så rumglobale `busy/setups` ikke blokerer uafhængigt musik-/robot-/lysarbejde. Bevar fælles invalidering ved konkret ændret adgang, placement, policy eller ejergeneration for alle berørte ressourcer; mutations-fences opdeles kun, når deres beskyttede årsag er domænelokal. Klientændring alene er utilstrækkelig. |
| Fælles ressource | Modstridende handlinger mod samme robot eller native output ordnes/afvises tydeligt. Radio og Spotify kan dele output og er derfor ikke automatisk uafhængige. Ingen skjult kø eller replay. |
| Læsning | Ét delt observationsgrundlag pr. domæne i eksisterende adapter/ejer bruges af widget og detalje. Bevar kildeidentitet, revision og observationstid; læsning giver ingen effektmyndighed. |
| Cache | Bevar senest validerede data i hukommelsen under navigation/refresh, afgrænset efter faktisk hjem/rum/konto/enhed/ejer. Ingen cachede credentials/actiontilbud som autoritet; ingen ny varig browsercache uden konkret behov. |
| Opdatering | Genbrug eksisterende SSE og nødvendige domænelæsninger; saml ens samtidige reads. Verificér berørt snapshot/event-dækning og reconnect, før noget transportskifte overvejes. WebSocket er ikke et mål. |
| Orden/recovery | Nye gyldige observationer må ikke overskrives af gamle svar. Snapshot og events afstemmes via ejerens revision eller afgrænset genlæsning. Reconnect genopretter læsning uden effekt-replay. |
| Lokale valg | Drafts er ikke capabilities. Bevar dem gennem refresh/fornyelse/navigation; genvalidér ved send. Faktisk skift af robot/map/konto eller tilbagekaldt adgang kan kræve forklarlig rydning. |
| UI | Første tryk giver lokal feedback før netværkssvar. Kun relevant kontrol/ressource er pending. Bevar komponent, geometri, fokus og scroll; opdatér ændrede felter. Første besøg uden data bruger kittets ærlige tomtilstand. |
| Modularitet | Eksisterende buildless moduler og native Web Components fortsætter. Domæneadapter, kommandoejer, UI-kit og komposition har hver sit ansvar. Historik/store kataloger indlæses efter behov, basal kontrol gør ikke. |

Ved berørte funktioner formateres tæt kode læsbart og scope, await, cleanup og settlement navngives. Ingen helreformat eller omskrivning af uændrede domæner. Kamera er kun en fremtidig modularitetsprøve: en senere faktisk adapter og eventuel godkendt kitudvidelse må kunne tilsluttes uden at omskrive musik/robot.

## Korte leverancer med brugerresultat

Hver pakke går hele vejen fra reproduktion til samme kandidats browser/service/UI-bevis. Diagnose, minimal log og nødvendige kontraktændringer følger den aktuelle fejl; de er ikke forfaser til en første forbedring. Kode, softwarebevis, publicering, installation og fysisk accept registreres særskilt.

### A0. Afgrænset valg af HA-indgang — ingen migration først

**Også indgang og hosting udfordres.** Nuværende ingress/PodVoice-bridge er en mulighed, ikke en urørlig arkitektur. Før den fælles touchkontrakt låses, sammenligner lead den faktisk brugte HA-autentificerede ingress med et HA-native custom panel, som HA leverer `hass` til. Foretræk native panel, hvis det konkret genbruger HA-login, tilstande, servicekald og events og samlet fjerner mere integration, end det tilføjer. Vælg ellers slank ingress med HA som autoritet. Begge muligheder anvender én kanonisk PodView-renderer; slutleverancen får én fast adresse, ikke to produktindgange. [Officiel HA custom panel-reference](https://contributors.home-assistant.io/frontend/custom-ui/panel/).

Dette er én afgrænset teknisk prøve efter Go: afklar og prøvemontér den eksisterende renderer i faktisk HA-shell uden parallel UI. Kontrollér dokumentglobale element-ID'er/root-scope, adgang til eksisterende Connect-/Speakers-/opskriftsruter samt login/session, navigation og genåbning på Mac Chrome og iPad Safari. `hass` forudsættes kun, hvor HA faktisk leverer det. Dokumentér valget og præcis hvilke lag der kan slettes; implementér ikke begge alternativer fuldt.

Kræver native-mount bred ombygning eller ekstra auth-/proxyveje uden påvist gevinst, fortsættes musikpakken på eksisterende adgang, og en begrundet entryændring afgrænses særskilt. Musikbetjening skal ikke vente på en hostingmigration. Ingen blankettilbagekompatibilitet, ny bred redesignfase eller ny brugergodkendelse af tekniske valg. Uafklarede runtimefakta løses tidligt af lead, ikke som nye godkendelsesgates for brugeren.

### A. Musik først — hele musikoplevelsen på den kritiske vej

**Senere direkte brugerpræcisering:** Første samlede arbejdsområde er musik, ikke kun Pause. Start, pause/fortsæt, næste/forrige, højttalerskift, volumen, kø og gældende aftalte musikfaner/katalogvalg skal fungere sammen. Pause-fejlen er et konkret første reproduktionspunkt inde i musikpakken; den afgrænser ikke pakkens leverance. Derefter følger robot og resten af det aftalte inventar; opskriftsadoption kan fortsat foregå parallelt.

1. Identificér kun de nødvendige aktuelle klient-/server-/musikbits og den faktisk åbne Green-version før berørt arbejde. Den auditerede 127 og læste 128 er historiske observationer, ikke en automatisk arbejdsbase. Lokal PodView har ingen HEAD og untracked filer; lokal `dist` afviger fra release. Bind én konkret kilde/overlay med hash af ændrede ejere og faktisk assetmanifest. Ingen stor gitmigration først. Afklar samtidig faktisk adgang til Mac Chrome og iPad Safari, deres viewport/orientering og muligheden for at observere reelle input; manglende enhedsbevis navngives tidligt, mens uafhængigt softwarearbejde fortsætter.
2. Åbn det faktiske PodView og gentag Pause-fejlen på korrekt konto/output, inklusive sangovergang. Registrér input før en mulig lokal afbrydelse, dispatch, ejer/target, receipt, observation og renderet feedback med samme korrelation. Tilføj kun manglende diagnostik i denne vej. Hvis netop brugerens gamle klik ikke kan rekonstrueres, sig det; den læste mekanisme er ikke historisk runtimebevis.
3. Ret den observerede afbrydelses-/setup-/målmekanisme hos eksisterende ejere. Ret samtidig det fejlagtige testorakel, der forventer nul write ved normalt item-skift. Første tryk skal faktisk pause samme output, også når nummeret skifter. Almindelig touch skal fungere uden aktiv samtale.
4. Prøv samme før-/efter-forløb gennem faktisk browser → rigtig PodConnect/PodSpeakers-ejer → frisk korrekt observation → UI og log. Gennemfør derefter hele musikforløbet: musikvalg → start → pause/fortsæt → næste/forrige → volumen → køvalg → faktisk højttalerskift → ny korrekt betjening. Kontrollér ekstern Spotify-ændring, forbindelsestab/recovery og bevaret UI uden flashes/hop. Afsendelse/ACK alene lukker ingen musikfunktion.
5. Vis og adoptér den integrerede rettelse tidligt. En Green-installation af en gennemprøvet forbedring kan ske før hele inventaret er færdigt, med tydelige rester. Ingen ren logrelease og ingen påstand om samlet brugsklarhed endnu.

**Pakkens udfald:** sammenhængende fungerende musikoplevelse med alle aftalte musikhandlinger, korrekt faktisk output/state, stabilt UI og forklarlige input-/effektforløb. En rettet Pause alene lukker ikke musikpakken. Hvis reproduktion stadig ikke skelner årsager efter én afgrænset undersøgelse, skift tilgang og navngiv den præcist manglende observation; fortsæt uafhængigt arbejde.

### B. Robotbetjening, fornyelse og isolation i samme rum

Byg videre på A's fælles beslutning, uden at vente på en generel arkitekturombygning. Ret både frontendflag og backendens rumglobale låse. Bevar robotwidget og detaljes fælles domænegrundlag samt kittets forskellige overblik/detail-handlinger.

- Aktiv/pauset robot beholder den aftalte header med Pause/Fortsæt, Afslut og Base, samt faktisk understøttede aktive rengøringsvalg. Fjern rå indstillingsstøj i fallback; fejl forklares i eksisterende roller frem for at skjule en aftalt sektion.
- Drafts, rumvalg, fokus og scroll overlever gentagen fornyelse og samtalestart/-slut. Relevant robot-/map-/adgangsændring genvalideres uden at nulstille urelaterede domæner.
- Indstillingsskrivning validerer faktisk service/værdi og relevante mode-/modelafhængigheder; uvedkommende ændringer ugyldiggør ikke valget via lighed af hele observationen. Aktivt valg udløser ikke en ny Start.
- Ret delvist setup og tavse undtagelser dér, hvor de skjuler årsagen til manglende kontroller. Afslut og Base er forskellige tilsigtede handlinger med hver sit observerede resultat.
- Prøv langsom musik + robotnavigation/handling og langsom robot + musik/lys/timer i samme rum. Prøv også lys gennem samtaleskift, så afkoblingen ikke kun gælder de to mest synlige domæner.

**Pakkens udfald:** lovlige kontroller og drafts består gennem relevante opdateringer, og uafhængige domæner fungerer samtidigt. Rigtig HA-service og relevant tilstandsobservation kræves for serviceaccept; autoriseret fysisk robotrespons registreres særskilt, ikke udledt af ACK.

### C. Upload bliver automatisk til varigt opskriftskatalog — uafhængig pakke

Find den faktiske uploadroute, oprindelige receipt, importer og katalog-/lagerejer på den valgte kandidat tidligt. Den allerede overdragede autoimportpakke skal enten adopteres konkret eller navngives som endnu ikke adopteret; en handoff er intet integrationsbevis. Genbrug pakken frem for at bygge endnu en importer. Undersøgte admin-review/publiceringsveje er ikke brugerens ønskede automatiske flow.

Bind upload → modtaget → valideret/importeret → varigt gemt → automatisk synlig katalogpost hos samme eksisterende ejer. Bevar original kilde og korrelation. Dubletter afstemmes uden dobbeltpost; mislykket import siger ikke Gemt og har en konkret recovery. Åbn/start/genoptag/afslut og kataloglæsning skal bruge den samme gemte post.

**Pakkens udfald:** en faktisk upload kan genfindes automatisk og efter genindlæsning samt kontrolleret genstart af den relevante lagerejer, når denne er autoriseret. Dublet og fejl er prøvet. UI, receipt og varigt lager er enige. Lead kvitterer for faktisk adoption i samme samlede kandidat; lokal patch eller admin-PASS lukker ikke punktet.

### D. Afslut og bevar resten af den allerede aftalte oplevelse

A–C er første prioritet, ikke hele scope. Brug nedenstående inventar og senere accepterede beslutninger til at afprøve alle eksisterende handlinger; tilføj faktiske underhandlinger i den eksisterende feedbackoversigt ved deres ejere. En funktion, der mangler i UI, bortfalder ikke af den grund.

| Område | Forløb der skal fungere | Uafhængigt orakel |
| --- | --- | --- |
| Musik | Start, pause/fortsæt, næste/forrige, volumen, kø, højttalervalg, gældende aftalte musikfaner og katalogvalg. Stemmestart → vis → touch-pause; ekstern Spotify-ændring; ejer-genstart. | Faktisk PodConnect-observation og PodSpeakers-route for korrekt konto/output; standard og ønsket destination er ikke aktuel route. |
| Robot | Aktiv/idle, overblik/detail, pause/fortsæt/afslut/base, aktive valg, rum/start, understøttede basehandlinger, fejl/pleje, fornyelse og aftalte redigerbare forslag. | Korrekt HA-enhed, faktisk service/kapabilitet og efterfølgende relevant state/indstillingsobservation. AI-udkast er ingen effekt. |
| Lys | Område/navigation, tænd/sluk, niveau og aftalte scener/lamper; unknown/unavailable, områdeskift og adgangsændring. | HA's faktiske entities, område og kapabiliteter; ingen virkning fra navigation. |
| Timer | Opret, justér, stop/annullér, færdig og alarmkvittering, også under andre forløb og reconnect. | Eksisterende timer-/HA-ejer; faktisk alarmoutput prøves og registreres særskilt. |
| Radio | Aftalt start/stop/stationsvalg og kildeskift med Spotify, korrekt output og volumen i samme player. | Eksisterende radio-/musikejer og faktisk route; ingen parallel player eller opdigtet integration. |
| Tesla | Aftalte passive data, kendt utilgængelighed og kun konkret aftalte/optagne handlinger. | HA/eksisterende køretøjsejer; ingen opdigtede værdier eller ny effektmyndighed. |
| Opskrifter | Upload/import, automatisk katalog, kilde/status/historik, dublet/fejl/recovery og varig genfinding; åbn/start/genoptag/afslut. | Faktisk lager-/katalogejer og original receipt. Modtaget er ikke Gemt. |
| Vejr og svar | Faktiske data, råd/kilder, aftalte ti svarformater og visuel historik; brugbar navigation under langsomme svar. | Eksisterende data-/svarejer med kilde/friskhed; AI er ingen betingelse for basal kontrol. |
| Fælles skærm | Ro/overblik/detail/Back, modaler, musikvalg, billedpladser, fokus/scroll, genindlæsning og forbindelsestab. Mac Chrome og iPad Safari ved deres faktiske viewports/input. | Samme kanoniske renderer/navigation, faktisk transporttilstand og visuelt forløb på begge mål. |

Dokumenteret begrænsning, manglende adgang/data eller manglende integration er **åbent/blokeret**, aldrig PASS. Agenten afhjælper det, der kan afhjælpes, og navngiver resten uden at skjule funktionen eller nedskrive kravet. En ændring af aftalt scope kræver en faktisk brugerbeslutning.

## Praktisk E2E-loop og mindst nødvendig test

**Primært bevis er det faktiske PodView: browser → eksisterende rigtig service → observeret resultat → renderet feedback og forklarlig log.** CI's Chromiumkontrol af admin `static/index.html` er ingen accept af PodView `static/podview/index.html`. Genbrug browserinfrastrukturen til den rigtige indgang og de konkrete journeys.

For hver berørt pakke: skriv forventet brugerudfald før ændring; reproducer; ret den konkrete årsag; kør samme flow efter rettelsen; kontrollér de få delte grænser, ændringen kan ramme. Brug faktisk leveringsbundle med `--delivery`, ikke kun dev-ESM. Byg efter sidste ændring og bind hash/manifest, serverkilde og runtime til det testede. Uændrede dele genbruger gyldigt bevis.

| Konkret prøve | Bestået betyder |
| --- | --- |
| Pause ved sangovergang | Ét legitimt Pause-input når korrekt samme konto/output og ender med korrekt ejerudfald, frisk observation og feedback; normalt item-skift kasserer ikke intentionen. |
| Stemmestart → touch-pause | Start og pause går gennem samme ejer; faktisk track/output/state vises korrekt mellem handlingerne. |
| Outputskift/ekstern ændring | Faktisk ny route/state vises; næste handling bruger korrekt mål. Uventet targetændring giver ingen stiltiende ny effekt. |
| Robot gennem gentagne renewal-/refreshperioder | Kontroller, drafts, fokus og geometri består; faktisk aktivt valg og separate Afslut/Base-forløb giver deres tilsigtede udfald. |
| Samtidige domæner | Langsom fejlende musik blokerer ikke robot/lys/timer/navigation; faktisk delt output eller samme robot håndterer sine konkrete konflikter. |
| Sent svar, push og reconnect | Ældre observation overskriver ikke nyere; snapshot/eventhul afstemmes; ingen replay og intet tab af navigation. |
| Dobbelttryk, timeout, ændret adgang/ejer | Ingen dobbelteffekt eller forkert mål. Ukendt udfald afsluttes forklarligt uden replay; gamle data/tilbud giver ingen ny adgang. |
| Upload/dublet/genstart | Én gyldig post bliver automatisk synlig og består i faktisk lager; fejl giver ingen falsk Gemt. |
| Uændrede/hurtige events og gentagen navigation | Ingen flashes, layout-hop, kortanimation fra underkontrol, tabte drafts/fokus/scroll eller ophobede timere. |

Races, netværksforsinkelse, dubletter, UNKNOWN og tilbagekaldelse prøves først med inerte ejere, der faktisk håndhæver kontrakten. Små unit-/kontrakttests tilføjes kun, hvor de kausalt beskytter en konkret fejl eller risikofyldt grænse. Intet nyt stort testprojekt og ingen test, der blot spejler implementationen. Inert browserbevis kaldes ikke rigtig service eller fysisk effekt.

Kør nødvendige eksisterende checks én gang på den samlede relevante kilde: syntaks for ændrede moduler; `npm test` inklusive komponentgate ved UI/sceneændring; eksisterende samlet UI-kontrol før push ved fælles renderer; Ruff på ændret Python og fast Python 3.12 til AST/hash. Kør kun om ved ændring, fejl eller konkret ugyldiggjort bevis. En grøn suite lukker ingen brugerfunktion alene.

### Respons, kausalitet og tidsligt UI-bevis

- Mål input→første feedback, input→dispatch, service-ACK, ejerens terminale udfald og frisk observation→synlig opdatering separat. Arbejdsmål er relevant feedback inden 100 ms på de faktiske browsermål. Ingen netværksventetid før lokal navigation/trykfeedback.
- Før efterprøven fastsætter lead en konkret effekt-/afklaringsfrist for det berørte flow ud fra ejerens faktiske timeout og målt førforløb. Fjern unødigt setup, herunder den påviste mulige 20-sekunders musikventen; hurtig spinner kan ikke bestå en langsom eller tabt Pause. Registrér faktisk effektlatens og overskridelser, ikke kun UI-latens.
- `accepted` og HTTP200 er ikke effekt. En frisk paused-state er aktuel tilstand, men beviser ikke alene, at dette klik forårsagede den. Sammenhold eksisterende request/settlement med korrekt target og observationstid. Ekstern pause/resume og sene svar må ikke give falsk succes. En allerede bekræftet effekt efterfulgt af ekstern resume beholder sit historiske receipt-udfald, mens UI viser den nye playing-state; den må ikke blive evigt pending eller tilbagerulles af et sent svar. Manglende kausal forbindelse er ubekræftet/UNKNOWN; aktuel state må stadig opdateres ærligt, og pending afsluttes ved fristen.
- Eksisterende log skal kunne forklare input, afvisning/afbrydelse, dispatch, serviceudfald, observation, feedback og recovery på samme kandidat. Bevar sene svar i loggen, selv når de ikke må ændre skærmen. Angiv retention-/uploadhuller; ingen ny logplatform eller generisk logfase.
- Inspicér sammenhængende browserforløb over opdatering, fornyelse, sangskift og reconnect, fx optagelse eller tætte frames med timing. To slutbilleder beviser ikke fravær af flashes. Se indhold, geometri, fokus, scroll og drafts samt afbrydelse/oprydning og reduceret bevægelse.
- Ved enhver ændret UI-tilstand bruges de registrerede kit-ejere og fælles tokens. Product Design og Impeccable gennemgår faktisk renderet bibliotek og produkt ved relevante Mac-/iPad-mål; kliktest udføres særskilt. Registrér reference, billed-/forløbsbevis, reviewfund og rester i eksisterende feedbackmatrix. Ingen lokal specialfamilie; ny familie kræver fortsat konkret specifikation og menneskelig godkendelse.

## Green, faktisk brugsklarhed og afslutning

Go-sessionens Sol-lead fører selv eller via den koordinerede aktive releaseejer den samlede identificerede kandidat gennem eksisterende merge → CI/publisher → installation; der er én Green-operatør og intet uafklaret eksternt handoff. Kilde og buildpins kontrolleres sammen, og relevant bygget produkt sammenlignes med godkendt UI før publicering. Ingen releaseadministration før kendt rettelse, bortset fra mindst nødvendige konkrete diagnostik. Bevar eksisterende Sites-identitet og owner-private audience, hvor kanalen bruges.

Efter installation aflæses Green-version og faktisk asset-/kildebinding. Gentag oprindelige fejl og relevante brugerforløb mod Green på **både Mac Chrome og iPad Safari**, med det samme faste link, faktisk login/adgang, navigation og den normale genåbning. Prøv responsive kompositioner og de reelle inputformer. Desktopemulering støtter udvikling, men er ikke bevis for den faktiske iPad/Safari-leverance.

Agenten ejer adgangs-/browser-/servicefejlsøgning og mulige workarounds inden for aftalt løsning. Hvis en konkret enhed/adgang/observation mangler, registreres præcis hvad der mangler og fortsæt alt uafhængigt arbejde. En resterende blokering må hverken blive til Klar til brug eller en uafgrænset testopgave overdraget til brugeren.

Fysisk lyd, alarmer og robotrespons kontrolleres særskilt inden for faktisk gældende autorisation. En installation er ingen autorisation til nye fysiske effekter. Saml nødvendige fysiske observationer effektivt; manglende fysisk bevis holdes synligt og må ikke standse andet softwarearbejde eller omdøbes til fysisk accept. Frameo/hardware/kiosk er næste særskilte mål.

**Samlet accept kræver**, at alle aftalte funktioner har korrekt observeret udfald, den samlede oplevelse er stabil, og den installerede løsning er afprøvet som brugbar på begge aktuelle browsermål. Registrér unit/kontrakt, sammensat integration, rigtig browser, rigtig service og fysisk hardware særskilt som bestået/fejlet/blokeret/ikke kørt. Registrér også kode, build, publicering og installation hver for sig. Delvise forbedringer kan leveres løbende; samlet accept forbliver åben, mens krav eller nødvendig dokumentation mangler.

Aflever kort: hvad brugeren nu kan gøre, samme faste link, præcis installeret kandidat, faktisk Mac-/iPad-/servicebevis og konkrete rester. Vis de sammenhængende forløb i produktet. Ingen testtal, modeller eller handoffs som erstatning for et fungerende dashboard.

## Dækning af audit og review

| Grundlag | Hvor det er omsat |
| --- | --- |
| Audit 1–10: produkt/ejere | Go-kontrakt og besluttet engineeringretning; ingen ekstra platform eller samtalekrav for normal touch. |
| Audit 11–20: tabt betjening | Pakke A–B, direkte målidentitet og ressourceafgrænsning i både frontend og backend. |
| Audit 21–30: tilstand/adgang/recovery | Drafts, ærlige observationer, kapabiliteter, idempotens og konkrete E2E-races. |
| Audit 31–40: forklarlighed | Minimal korrelation inde i rettelsespakken, terminalt udfald, sene svar og navngivne loghuller. |
| Audit 41–50: accept/leverance | Forkert Pause-orakel rettes; primær rigtig E2E; hele inventaret og faktisk Green/Mac/iPad-brugsklarhed. |
| Astras otte fund og 15 vinkler | Pause før brede forfaser; backendlåse og samtalebinding; faktisk opskriftsadoption; ingen begrænsnings-PASS; kausalitet, effektlatens, tidsligt UI-bevis og én testet leveringskandidat. |

Uafklarede runtimefakta fra auditten er afgrænsede observationer **efter Go**, ikke tekniske spørgsmål til brugeren. Astras anden gennemgang kan godkende planens udførbarhed; den kan ikke godkende produktet før arbejdet og det faktiske bevis.
