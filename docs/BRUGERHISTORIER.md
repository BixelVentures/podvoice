# PodView — brugerhistorier (acceptgrundlag)

Hver linje er én historie: **Givet** situation → **Når** jeg gør noget → **Så** sker der dette.
Skærmrespons måles fra brugerens tryk; enhedseffekt måles separat fra samme tryk. Eksterne ændringer
måles fra ændringen i kildeappen, ikke først fra modtaget HA-event. Hver historie skal have en automatisk browsertest
(`tests/browser/*_actual_e2e.cjs`), der tjekker præcis historien og tiden.
**Bevis og rester:** Status beskriver netop historiens kontrollerede forløb, ikke blot at en test findes.
"Delvist bevist" angiver den afprøvede handling, overgang og observerede resultat samt det, der mangler.
"Ikke historiebevist — områdetest: X" er kun en testhenvisning; historiens udfald og tidsmål er ikke bevist.
"Ikke dokumenteret" betyder manglende konkret evidens, ikke nødvendigvis en dokumenteret produktfejl.
En historie er først fuldt bevist, når dens aftalte forløb, relevante fejl/recovery og tidsmål er kontrolleret.
Angiv kilde/kandidat og eksisterende test eller artefakt ved nye resultater; navngiv simulerede ejerled.
Browser-, service- og fysisk bevis holdes adskilt. Publicering, installation og testantal er ikke brugeraccept.
Der sættes ikke en confidence-procent på en historie uden et dokumenteret beregningsgrundlag.
Ejeren (produktdesigneren) godkender teksten; agenten skriver testene.
Udvidelsen 7. november samler tidligere brugerfeedback til fælles gennemgang. Nye rækker er krav,
ikke implementerings- eller testresultater. Eksisterende delvise resultater bevares med deres begrænsninger.
Brugeren godkendte 8. november musiksøgning (F3), konto-overtagelse med Spil her (H2–H3), portionsændring (O2/O9) og timer direkte fra opskriftstrin (O3) som idéer: »Lav det som ideer. Ikke udfør endnu. Kun evt ui.« De er derfor alene idéer til senere UI, ikke bestilt funktionalitet eller udgivelseskrav. De øvrige allerede aftalte dele af O2/O3 bevares.
Daily Mix er valgfri. En historie giver ikke tilladelse til at opfinde nyt layout eller enhedsfunktioner.

**Green · 8. november 2026.** PodVoice-tilføjelsen 2.0.151 blev installeret via Supervisor, og admin viste version 2.0.151 med runtime-commit `e9c187c10fa0644c7fdcae4877294824a4817d76`. Diagnostikken viste verificeret PodConnect og Home Control. Speakers 0.26.70 var installeret og aflæst kl. 11.11 CET, og Control 0.10.37 var allerede indlæst. PodVoice-komponenten i HA Core fortsatte med 0.1.17. Supervisor opdaterede tilføjelsen uden genstart af Core. Voice PE stod offline. S4 dokumenterer robotforløbet i Chromium med inert HA. Fysisk robot, skærm, stemme og lyd afventer afprøvning. [Udgivelse 2.0.151](https://github.com/BixelVentures/podvoice/releases/tag/2.0.151)

**Ny læsende Green-kontrol · 8. november 2026.** Home Assistants eksisterende ingress kunne åbnes. PodVoice-admin viste fortsat 2.0.151 og runtime-commit `e9c187c10fa0644c7fdcae4877294824a4817d76`, verificeret PodConnect og Hjemmestyring samt Voice PE offline. Dette er en aktuel versions-/forbindelsesaflæsning, ikke bevis for 2.0.155 eller de nye radioændringer. Ingen installation, genstart eller afspilning blev udført i kontrollen.

**Publiceret software · 8. november 2026.** 2.0.153 er verificeret på release-tag/merge `0b1fd336` og ARM-image `sha256:a40d3496…`: opskriftshistorik og bevarede robotvalg gennem netudfald. 2.0.154 med HA-komponent 0.1.18 er verificeret på release-tag/merge `d41310fe` og ARM-image `sha256:2986fdba…`: kildebundet Tesla-ladetid med versionskompatibilitet. Officiel CI og publicering bestod for begge. Ingen af disse versioner er installeret som del af det aktuelle softwaremål; den tidligere Green-aflæsning ovenfor er ikke ny live-accept. 2.0.155 er verificeret på tag/merge a6edc553 og ARM-image sha256:7389abb3…: opskriftskatalogets scroll bevares ved retur via Forside. Main-CI og imagepublicering bestod. HACS-job 42479918544 oprettede korrekt stabil release/tag, men afsluttede med generisk Rejected; efterfølgende API-læsning bekræfter korrekt latest-release og uændret payload. Opfølgende main-CI 42479988736 og HACS-kontrol 42480381908 fra 0469ba81 bestod; den eksisterende uændrede udgivelse blev verificeret uden nyt tag eller payload. A8/H5-beviserne er merged i PR #328 efter grønt PR-CI uden produktændringer. Ingen installation.

**Seneste publicering · 8. november 2026.** PodVoice 2.0.156 er merged via PR #331 på `929aafa1`; officiel CI 42489841305 og ARM-image `sha256:e5fe2fc8…` er bestået. Stabil GitHub-release og tag 2.0.156 er aflæst på samme merge; HACS-kontrol 42490478376 forsøg 2 består og verificerer eksisterende uændret payload. Speakers 0.26.73 er merged via PR #116 på `1f4b3368`; officiel kandidat-CI 42489503428 og begge imagebygninger 42489948102 består. ARM-image `sha256:f6542fc2…`, AMD64-image `sha256:f36e5057…`, fælles produkttræ `14f9010f`; main-publicering 42490446860 verificerer genbrug af de samme immutable images. Control forbliver 0.10.38 og HA-komponenten 0.1.18. Ingen installation eller fysisk prøve er del af denne levering.

**Aktiv Green-fase · 8. november 2026, 17.24–17.35 CET.** Root ejer installation og liveprøver; uafhængig radioårsagsrettelse kører parallelt. Live-admin viser PodVoice 2.0.156 / runtime `929aafa141f590f72f141b9c4352f443d36bf6af`, verificeret PodConnect og Hjemmestyring. Speakers er faktisk 0.26.73, Control indlæst 0.10.37 og HA-PodVoice indlæst 0.1.17. Fuld krypteret lokal HA-backup `494f05e7`, “PodView før samlet opdatering 2026-11-08”, oprettet 17.27, 81.93 MB: indstillinger/historik, SSL, delte filer, medier og alle apps inklusive Speakers 0.26.73 og PodVoice 2.0.156 verificeret i backupdetaljer. Ingen fysisk prøve endnu. HACS Control 0.10.38 og PodVoice 2.0.156-pakken med HA-komponent 0.1.18 er downloadet og kvitteret Opdateret; Én Core-genstart er udført; integrationssiderne bekræfter nu indlæst Control 0.10.38 og HA-PodVoice 0.1.18. Den åbne HA-ingressfane endte efter Core-genstart på HA-overblikket; automatisk retur til PodView er derfor ikke bevist. Radio er åbent: Green bruger builtin/worker; primærrutens startup kræver physical=true, mens worker normaliserer værdien til false. Tidligere composed-bevis brugte ikke deploy-profilen; agent retter den dokumenterede ejergrænse og tilføjer præcis regression uden at påstå fysisk accept. Eksisterende HA-reparation om ændrede Roborock-segmenter viser bevarede stueplan-mappinger, men Living room/Study på 1. Sal samt Balcony/​Balcony1 uden HA-område; intet ændret eller kvitteret. Læsende PodView på faktisk Green viser 7° Skyet, konfigureret Køkkenalrum og robot oplader/84 %. Find musik fejlede første åbning 17.37 (årsag endnu ukendt); én eksplicit læsende gentagelse 17.41 lykkedes med tre forslag. `mood_result outcome=success reason=model_timeout total_ms=4445` og seks `search_playlists` HTTP 200 beviser recovery med fallback, ikke løsning af første fejl. Ingen lyd startet.

**Radioårsag rettet og leveret · 8. november, 17.48 CET.** PR #119 normal merge `02ac11554cb7ba1b661b116fed7e6def19c1e1b9` har base `7fa2161a`, reviewed head `e4df7d31`, samme fulde træ `9bb5e9ea56b35be7cee351adb6208bac446ac06b`. Speakers 0.26.75 bruger eksisterende valideret worker-runtime-readiness ved primæropstart; fysisk accept forbliver false. Begge autentificerede læsninger kræver frisk samme Native-ejer. Faktisk Linux composed-test med builtin/worker/physical=false består: Manager P3/P1/P6 og RTP-testmodtager samt Spotify-resume; dette er ikke husets højttaler. PR-CI 42500876090/42500876105 og publisher 42500946348 består; mainpublisher 42501440753 genbruger samme immutable produkttræ `1d4d9c0316ee9d412b87f84869bbd9294bbb1f57`. ARM-image `sha256:1ba3fef8484b93f9ee8c45ac946538c4984f3139526d536e225da8b770e3bd92`. Green-opdatering 0.26.73 → 0.26.75 startet via Supervisor med yderligere app-backup, efter læsning af Køkkenalrum main idle. Supervisor kvitterer installeret 0.26.75; nyt runtime OwnTone-process og bevarede rum er læst via eksisterende Manager /api/state. Main-CI 42501443115 og 42501440669 består. Radio er fortsat ikke liveklar.

**Aktiv årsagsbeslutning · 8. november, 17.51 CET — radio på Green.** Root er ejer; agent radio_teardown_sol implementerer afgrænset diagnostik fra merged Speakers 0.26.75 `02ac11554`. Handling: åbne Radio efter installation → faktisk: alle kanaler disabled; `/view/api/radio` enabled=false, tomme targets/actions, statiske blockedReasons. Manager `/api/state` viser OwnTone oppe, playing=false, released=false; Køkkenalrum findes, selected=false, needs_auth=false, session_epoch=0, lease=0, restoring=false. Frida mangler fra faktisk roster, hvilket forklarer dens readiness-409; Køkkenalrums primary-owner-409 er stadig uforklaret. Ingen lyd eller fysisk kommando er sendt. Næste præcise observation: første fejlede eksisterende C-predikat i `outputs_primary_radio_absent_owner` — START/journal/pin/fault custody, idle-target guard eller FIFO-registrering/writer (0) kontra ufuldstændig scan (-1). Beslutning: tilføj kun endelig statisk årsagslog i samme short-circuit/owner-tråd og samme antal læsninger; ingen tokens, IDer, filstier eller payloads, ingen ændret adgang/adfærd. Eksisterende kausal regression og fokuseret uafhængigt review før levering; diagnostik tæller ikke som rettet radio. Kilde `/private/tmp/podconnect-pc75-cold-owner-diag`. Efter observation rettes kun dokumenteret fejlende ejergrænse. Ingen nye installationer/genstarter med risiko for lyd eller lydprøver kl.18–08.

**Lydfri livekontrol · 8. november, 17.53–17.58 CET.** Faktisk PodView på Green 2.0.156: opskriftskatalog → Brød og bagværk viser fem relevante opskrifter → Burgerboller viser originalbillede, 10 ingredienser og fem trin → ingrediens-accordion lukker, Om opskriften åbner med korrekt kilde/fakta → retur bevarer Brød og bagværk. Oprindeligt Alle-filter genvalgt; ingen opskrift startet, slettet eller uploadet. Dette dækker navigation og accordion-adfærd, ikke pixelgodkendelse eller igangværende opskrift. Tesla åbnet uden bilhandling: sidst kendt låst, ældste observation 17.09, batteri9%/32km, ingen ladeeffekt vist. Ved sidst kendt slukket klima er temperatur ±, afrimning og sædevarme alle disabled. Klima-toggle og Lås op er synlige; bagagerum disabled (kapabilitet/observation endnu ikke afklaret). Ingen wake eller ændring af bilen. Radio diagnostik-PR #120 er kun kandidat; ingen mainpublicering/installationsret efter stilletid. Ingen lyd er startet i denne Green-fase.

**Softwareopfølgning · 8. november, 18.02 CET.** Stilletid er aktiv: ingen lyd, Green-installation eller genstart. Speakers har automatisk opdatering aktiveret, så radio-diagnosekandidat 0.26.76 / PR #120 må heller ikke merges/publiceres til main i stilletiden. Faktisk kompileret OwnTone-test har bevist de endelige årsagslabels og uændret fraværsbevis uden parring/start; samlet CI og imagepublicering af kandidat afventes. Separat versionsvisningsfejl er rettet og reviewet i `5dd3f2e1a466f82a99a03ea2d69be28ac086dcf6` fra main `6bd03379`: bundle og klientdiagnostik læser samme config-version som udgiver; pakket Chromium viser 2.0.156. 87 fokuserede tests og komponentgate bestod. Kilde `/private/tmp/podvoice-ui-version-binding-20261108`; rettelsen er ikke integreret eller udgivet og skal følge næste kandidat. Den oprindelige første musikindlæsningsfejl er fortsat åben: eksisterende klientjournal indeholder ikke den fejlede mood-anmodning; næste relevante bevis er dens HTTP-status/varighed sammenholdt med serverens mood-resultat. Ingen spekulativ runtimeændring.

**Frisk musikindlæsning · 8. november, 18.04 CET.** Én kontrolleret genindlæsning af HA/PodView i browseren og ét tryk på Vælg musik viste tre forslag uden genforsøg eller afspilning. Serverens korrelerede `mood_result` kl.18:04:05.807 var publish/success, reason=none, total_ms=569, playlist_search_ms=542, response=full. Køkkenalrum var automatisk konfigureret i visningen. Dette beviser dette friske browserforløb, ikke iPad eller årsagen til den tidligere første fejl. Eksisterende klientjournal efter cursor228344 viste ingen mood-terminal; fraværet kan ikke bruges til at fastslå, hvorfor den tidligere anmodning fejlede. Ingen ændring af runtime for den uafklarede fejl. Root verificerede officielt radio-CI42502414498 og imagebyg42502506042 som completed/success på præcis1881917577; PR120 er fortsat kandidat uden mainmerge eller Green-installation.



**Aktiv musikrettelse · 8. november, 18.06 CET.** F11: faktisk Green 2.0.156 Hør igen viser fem aktiverede sange. Tryk på Se tidligere låser alle fem, mens Henter historik vises; færdigt svar viser syv aktiverede sange. Din musik → Hør igen bevarer alle syv. Root ejer livekontrol; actual_close_evidence ejer afgrænset rettelse. Kildeårsag: udvidelsen kalder beginRead(recent,refresh), som rydder valgkilder og sætter canChoose=false under busy; serveren pensionerer samtidig kildens handlegrundlag før I/O. Det er ikke dokumenteret naturligt udløb. Næste rettelsesspor undersøger om de allerede modtagne rækker kan udvides lokalt uden ny kildeudskiftning. Reelt udløb/adgangstab må fortsat håndhæves; ingen UI-only ophævelse af backendafvisning. Ingen sang startet.

**Vejr på Green · 8. november, 18.07 CET.** Header og åbnet detalje viser samme 7°/Skyet. Den faktiske Met.no-visning indeholder 12 timepunkter og seks dagsrækker med skyet, let skyet og solrigt-ikoner samt temperaturer. Dette beviser normal liveindlæsning og konsistens i dette forløb, ikke kildeudfald, ikonfallback, præcis datalder eller fysisk iPad. Versionsrettelse er nu PR #334, head8327c489, reviewet og fokuseret testet; ikke merged/udgivet.

**Robotvisning på Green · 8. november, 18.09–18.10 CET.** Faktisk installeret 2.0.156 viser Oplader/98 %, seks tidligere valgte rum, Støvsug og vask/Støvsug/Vask uden Tilpasset type, valgt Maks./Extreme/Standard/2× samt kun 1×/2×. Ingen indstilling eller enhedshandling ændret. Vedligeholdelse åbnes fra én lukket række til fire kompakte navne; Sidebørste åbner konkret intervalbaseret vejledning. Begge accordions lukket igen; ingen påmindelse afvist eller vedligeholdelse nulstillet. Basebetjening var ikke synlig i den aflæste visning og er derfor ikke livebevist. Første adgang viste Henter aktuel betjening, hvorefter kontrolpanelet kom frem; dette er ikke et bevis for opstartstidsmål eller fravær af alle flashes. Fysisk robot og iPad stadig åbne.

**Musikårsager rettet lokalt · 8. november, 18.18 CET.** F11 lokal udvidelse er integreret i PR334-grenen: Hør igen og Din musik udvider allerede modtaget prøve uden katalog-GET eller udskiftning af de fem eksisterende kort/valgkilde. Kausal RED havde to recent-GETs frem for én. Pakket Chromium beviser eksisterende rækker fortsat enabled under tilbageholdt afspilningslæsning og korrekt udvidelse. Den uændrede sene prøve efter genåbning og volumen fandt desuden reelt gammelt targets-svar: 13,27/13,68 s gammel observation genbrugt af serverens 15s-cache, afvist af skærmens 10s-grænse før setup. Kilde f296b0aa udløber cache efter original observedAt; ingen omskrivning af tidsstempel. Samme sene prøve består med frisk mål-læsning, præcis én eksplicit fornyelse og én inert play_track-effekt på den udvidede række. Endeligt review af cachegrænser afventes; ingen rigtig afspilning. Separat CI-fixture rettet i63c6dfd9: en 0,2s inerts opstartsbudget udløste fejllukning før det undersøgte Stop. Forsinket ACK reproducerede præcist fejlen; fixturebudget2s og eksplicit vellykket opstart/korrekt stop-ejer beviser begge afbrydelsesforløb. Produktionsdeadlines uændrede.

**Aktiv robot-UI-rettelse · 8. november, 18.17 CET.** Base-grant er faktisk til stede forr0/roborock_qrevo med trevacuum_command-roller, HA supported_features30524 indeholderSEND_COMMAND, og status/dock_error/mop_drying er friske og normale. Ved ny normal opsætning vises Base med Vask moppe, Tøm støvbeholder og Tør moppe; ingen aktiveret. Et rent visningsforløb viser derefter ny fejl: åben Base(id53) bliver lukket(id67) ved passiv opdatering på samme robotside uden brugertryk. radio_teardown_sol ejer afgrænset bevarelse af accordion-tilstand ved samme enheds opsætningsopdatering; root ejerintegration. Ingen model-/policyændring ud fra den tidligere manglende Base.

**Samlet kandidat 2.0.157 · 8. november, aften.** PR #334 samler musiklisteudvidelse uden ny læsning, korrekt udløb af højttalercache efter original observation, én afgrænset læsende fornyelse ved udløb under transport, bevaret Base-panel gennem adgangsfornyelse og versionsvisning fra den byggede kandidat. Produktbundle `cf5b52cfeba1e74c69f7db94006419e4f0283bdcd3e21817df7baba7a717d6d6`, CSS `27a1c290f2b11dcf245ad1f6236cd66828f56fc765505c7dd1351b61e2272268`. Faktisk Chromium med inerte ejere består på dette bundle: Hør igen udvider til 10 uden at låse eksisterende rækker; 10.054 ms gammel målobservation får én læsende fornyelse og præcis én eksplicit afspilningseffekt; genåbning bevarer fortsæt/lydstyrkebetjening. Robot-Base forbliver åben både ved reelt tilbudsudløb og frisk nyt tilbud; gamle handlinger er deaktiverede, nye aktiverede, nul kommandoer under fornyelsen. Seks eksplicitte inert-basehandlinger udføres én gang hver. Eksisterende browserforløb `MUSIC_RECENT_SESSION_TEST` og robot-dock er brugt. Den komplette UI-suite havde 4.828 beståede og fem fejl: fire loopback-afvisninger består ved tilladt loopback, og én fake-DOM-fejl er rettet ved korrekt parent/remove-semantik; alle 52 berørte live-view-tests består. Komponentgate og Ruff check/format består. Ingen produktændring for fixturefejlene. Officiel CI afventer den samlede kandidat; ingen mainmerge, installation, rigtig afspilning eller fysisk accept i stilletiden. Radioens konkrete Green-guard, oprindelig første musikindlæsningsfejl og faktisk iPad/serviceaccept står fortsat åbne.

**Aktiv musikårsag · 8. november efter 18.17 CET.** Brugeren kunne ikke starte musik i 2.0.156. Green loggede gentagne `stage=setup outcome=stale_source` fra 18.17.06.999 til 18.17.16.834. Browserjournalen viser to andre afvisninger efter HTTP 200 fra targets, uden setup-rækker og med andre korrelationshashes (`559cec2630c6bb21`, `b7b230c4f0c6753b`). Den konkrete årsag til det rapporterede forsøg står åben. Et særskilt reproduceret problem i 2.0.157: to lokale HTTP-klienter med samme autentificerede HA-bruger og rum deler kildeomfang. B’s snapshot og robot-setup ændrer ikke A’s kandidat; B’s godkendte musiklæsning pensionerer A’s kandidat, hvorefter A får 409 `stale_music_selection`. Begge klienter kan klargøre det aktuelle valg; ingen musik- eller robotkommando blev sendt. actual_close_evidence ejer næste afgrænsede rettelse: adskil dokumenternes valgkilder, bevar fælles effekt-/adgangsejer og samme dokuments kildeudskiftning, og bevis begge overgange på eksisterende HA-ingressfixture. Lokal regression fejler på 2.0.157, hvor B’s læsning fjerner A’s udstedte tilbud. På næste kildekandidat kan A stadig klargøre efter B’s læsning; A’s egen nye læsning erstatter stadig A’s gamle kandidat. Udløbet valg, forkert dokument, ugyldigt headerfelt og ændret ejer afvises. Ved én tilbageholdt inert start afvises B’s læsning som busy; efter kvittering kan B læse uden at fjerne A’s præcise kvittering. Efter B’s opdatering af Vibe eller Tid på dagen genvaliderer A nu sine egne synlige rækker, også efter at afspilningsvalget er udløbet. Lokal regression beviser begge forløb med inerte katalogejere. Rækker til genvalidering holdes højst 30 minutter efter sidste vellykkede læsning, inden for 256 dokument-/visningsposter. Ingen ændring i 2.0.157-leverancen og ingen rigtig afspilning.

**Claude-gennemgang · 9. november 2026.** Brug `BixelVentures/podvoice` og `BixelVentures/podconnect`
på main-commits nedenfor. Det historiske Documents-checkout har lokale ændringer og er ikke
kandidatens kilde. Gennemgangen af radio starter ved den konkrete fejl nedenfor.

- **PodVoice 2.0.158** er udgivet fra `ab5928ece98885f36e7e8a44a6c9707105546d11`.
  ARM64-imageindeks er `sha256:5384522bea04be40235ef17b72758f5ba6d2aa708621f2eda178177a254b4275`.
  Supervisor viste 2.0.158 installeret og opdateret på Green efter en opdatering med backup aktiveret.
  Admin bekræftede samme runtime-commit og build
  `a40a72d890e87c7e3ce6732d436c2cc8b5f2238c7775fd35dc01c955d82cb1dd`.
  PodConnect og Hjemmestyring var verificeret, Voice PE stod offline, og »Ekstra hjemmefunktioner
  afventer godkendelse« stod stadig i admin. Advarslen er uafklaret.
  Pakket Chromium beviste med to samtidige dokumenter, at en læsning på skærm B ikke udløber A’s
  musikvalg. A’s eget næste opslag udløber stadig det gamle valg. Prøven brugte inert musikejer.
  [PR #335](https://github.com/BixelVentures/podvoice/pull/335) · [Main-CI](https://github.com/BixelVentures/podvoice/actions/runs/42510834616) · [Stabil udgivelse](https://github.com/BixelVentures/podvoice/releases/tag/2.0.158)
- **Speakers 0.26.76** er merged på `4093bcb49724a73da5ee7b8d3b84c88d995e0aba`, og ARM64- og
  AMD64-publiceringsjobbene bestod. Det aflæste ARM64-manifest er
  `sha256:e72195afd16e83ca22130f23f51d74c92e5308f5b3eb65ce9b64b64bd03e23b5`.
  Efter brugerens udtrykkelige valg om at installere seneste version viste Green Supervisor
  0.26.76 som installeret og opdateret. Supervisor havde automatisk opdatering slået til for Speakers.
  Den tidligere installationspause er ophævet. Den røde radioprøve er fortsat åben, og installationen
  blev gennemført uden lydprøve.
  [PR #120](https://github.com/BixelVentures/podconnect/pull/120) · [Publicering](https://github.com/BixelVentures/podconnect/actions/runs/42506924481)
- **Åben radioovergang.** Efter merge fejlede P3-start gennem Manager → Native HTTP → C i
  `selected-start-clock`. Native kvitterede reserve og klargøring og gav `pending` på Start.
  OwnTone sendte den gamle Spotify-sessions TEARDOWN, lukkede på `finalize_writer_custody`, og
  `result/start` svarede HTTP 409. Manager beholdt UNKNOWN ved `start-attempted`, og prøven
  observerede intet radio-RTP. Claude skal gennemgå, om den eksakte Native-writer endnu var åben,
  eller om den positive optælling af lukkede writers manglede efter TEARDOWN. Det eksisterende
  signal skelner ikke de to årsager. Kilden er OwnTones `start_all_writers_closed(...) == 1`-krav
  i `radio-primary-owntone.patch`. Green-radio og fysisk lyd blev ikke prøvet i dette forløb.
  [Fejlet main-CI, konkret job](https://github.com/BixelVentures/podconnect/actions/runs/42506924541/job/128812501780)
- **Control 0.10.38** er den separate stabile GitHub-udgivelse fra
  `0aa8f1caeb45b9fcfb45473895904c3fd0a75d1a`. Ved overdragelsen stod de to main-grene på
  produktcommits ovenfor uden en nyere åben PR. [Control-udgivelse](https://github.com/BixelVentures/podconnect/releases/tag/0.10.38)

**Liveforløb på Green · 9. november 2026.** De følgende observationer er fra installeret PodVoice
2.0.158 og Speakers 0.26.77 (`999a983beb4e6039397cebfc8a5ae252915e531f`). De dækker de anførte
trin uden lydprøve eller måling af svartider.
[PodVoice 2.0.158](https://github.com/BixelVentures/podvoice/releases/tag/2.0.158) ·
[Speakers 0.26.77](https://github.com/BixelVentures/podconnect/pull/122)

- **F1/F9/F11 og H4.** Musiklisterne indlæste med coverbilleder, inklusive fallback for Boogie.
  Vibe indlæste tre kort med coverbilleder og lokal illustration som fallback. Der blev ikke
  sammenlignet med en pixelreference. Hør igen udvidede fra fem til syv og beholdt de eksisterende
  rækker. Højttalerdialogen viste
  Køkkenalrum som valgt og Svend som ikke valgt. Frida var deaktiveret med »Status ukendt« og
  manglede i ejerens aktuelle højttalerliste. Brugeren bekræftede, at højttaleren var slukket.
  Det forklarer, at Frida ikke var tilgængelig. Ingen sang eller overførsel blev startet.
- **R3.** Radiokanaler var deaktiverede, og ejerens svar havde `targets: []`. Den bevarede journal
  viste fase 10, afsluttet START uden registreret retirement, som blokerede efter genstart.
  Rettelsen af genoprettelsen er under arbejde. Green har endnu ikke bekræftet en valgbar station.
- **S5/S7/S13.** Robotvisningen viste Extreme, 2× og seks rum. Base var ikke synlig. En separat
  lokal regression gengav, at `recipeId` fra den almindelige automatisk gendannede historik
  skjulte Base. Den nye softwareprøve `ROBOT_HISTORY_DOCK_TEST` skelner historikgendannelse fra
  et eksplicit opskriftsvalg. Den gendannede kladde og den åbne Base bliver stående gennem
  fornyelse. Først et eksplicit tryk sender én vaskekommando til inert HA.
  Der blev ikke startet rengøring eller basebetjening i dette Green-forløb på 2.0.158.
- **V1/V4 og B1/B6.** Met.no-visningen viste 8° mærket »Sidst kendt«, timeprognose og seks
  dagsrækker med ikoner. Tesla viste en frisk aflæsning kl. 11.27 CET på 89 % og 343 km, efter
  en tidligere aflæsning på 92 %. Klima stod tændt og sædevarme på mellem. »Lås op« åbnede
  bekræftelsen, og »Annuller« lukkede den uden at udføre handlingen.
- **O1/O4/O5.** Start af Burgerboller gav »I gang« i kataloget og i widgetten på forsiden.
  Widgetten genåbnede den aktive opskrift. Efter bekræftet »Nulstil« kom det oprindelige
  katalog tilbage uden en aktiv opskrift.
- **T1/T2 og G2.** En timer på fem minutter kvitterede, viste 4:55 i overblikket og 4:48 i
  detaljen. »Annuller« fjernede den aktive timer før udløb, og »Senest brugt« viste 5:00.
  Under livekontrollen forsvandt en midlertidig HA-forbindelsesbesked automatisk uden reload.
- **Q2.** Det gemte svar om El Clásico kunne åbnes med samme svartekst, tidsstempel og
  AI-forklaring. Der blev ikke stillet et nyt spørgsmål med stemmen.

**Musik på Green · 9. november 2026, 11.58 CET.** På 2.0.158 blev Walk of Life valgt fra Hør igen.
Afspilleren viste titel, cover og Køkkenalrum. Pause ændrede knappen til »Fortsæt«, og Speakers
bekræftede `playing=false` på Køkkenalrum med lydstyrke 35. Efter genindlæsning af HA og åbning
af overblikket stod samme nummer fortsat på pause. Forrige, Fortsæt, Næste og lydstyrke var
tilgængelige uden et særskilt »Gendan«-trin. Dette er observeret afspiller- og ejerstatus.
Hørbarhed og fysisk responstid er ikke verificeret. Lokale artefakter er
`green-158-music-pause-proof.json` og `green-158-music-paused.png`.

**Green efter opdatering · 9. november 2026.** Supervisor viste PodVoice 2.0.159 og Speakers
0.26.78 installeret efter opdateringer med backup. Admin bekræftede PodVoice 2.0.159, commit
`7fe32da500150b75a73cf7434dd8283d280b1634` og build
`ec2e08b43749552ef8347a773dcfae6f5d5cc9f927f08ba5beaed1ab61497c7c`.
PodConnect og Hjemmestyring var verificeret, og Voice PE stod offline. Lokal aflæsning er
`green-159-runtime-readback.txt`. På 2.0.159 gendannede almindelig åbning af
robotvisningen seks rum, Maks., Extreme og 2×. Base var synlig. Åbning af Base viste »Vask
moppe«, »Tøm støvbeholder« og »Tør moppe« som tilgængelige. Dette bekræfter den synlige del af
S7 og de gendannede valg på Green. Ingen rengøring eller basehandling blev udløst. Lokale
skærmbilleder er `green-podvoice-159-installed.png` og `green-159-robot-base.png`.
Radio R3/R4 står stadig åbne på Speakers 0.26.78. Den passive klargøringskontrol blev gentagne
gange afvist af den primære radioejer med `start_busy`. Der blev ikke forsøgt radioafspilning.
En frisk backup kl. 12.19 CET viste fase 10 med `retired_known` i den primære radiojournal.
Radioejeren arbejder på den næste rettelse.
[PodVoice 2.0.159](https://github.com/BixelVentures/podvoice/releases/tag/2.0.159)

**Opskrift og musik på Green 2.0.159 · 9. november 2026, 12.53–12.54 CET.** Burgerboller havde
ingen aktiv session før prøven. Start med 350 ml vand afkrydset og første trin markeret viste
Trin 2/5. Efter HA-genindlæsning via fotovisning og overblik viste widgetten »Burgerboller · I gang«.
Genåbning bevarede Trin 2/5, det markerede første trin, én af ti afkrydsede ingredienser og lukket
Ingredienser. De sidste fire trin gav »Alle trin færdige«. »Afslut madlavning« fjernede den aktive
markering i kataloget, og widgetten viste »Se katalog«. »Senest gennemført« viste Burgerboller
9. november kl. 12.54. Testposten blev bevaret. Lokal visning er `green-159-recipe-completed.png`.
Dette beviser afslutningen i brugerfladen og historikken, mens fysisk madlavning ikke indgik.

Jul på Vesterbro blev startet og pauset på Køkkenalrum. Speakers bekræftede `playing=false`, og
Spotify-observationen kl. 12.53.20 viste frisk pauset status med synlig betjening. HA-genindlæsning
bevarede pausen. Dette er en kort Green-prøve. A10-forløbet med ti minutters afspilning afventer.

**Timer på Green 2.0.159 · 9. november 2026, 12.55 CET.** Ved opsætning ændrede +1 varigheden
fra 5:00 til 6:00, og −1 satte den tilbage til 5:00. Efter start viste overblikket 4:56 og detaljen
4:50. Efter HA-genindlæsning viste fotovisningen 4:40 og den genåbnede timer 4:36. Den aktive
timer havde kun »Annuller«. Ved 4:32 fjernede »Annuller« den aktive timer, og »Ny timer« og
»Senest brugt« viste begge 5:00. Timeren blev annulleret før udløb. Lokal visning er
`green-159-timer-cancelled.png`.

**Tesla på Green 2.0.159 · 9. november 2026, 12.56 CET.** Bilen viste 83 % og 320 km. Klima var
tændt med 20 °C og måltemperatur 20 °C. Førersædevarmen stod på lav. »Åbn bagagerum« viste
samme handling i bekræftelsen. »Annuller« lukkede dialogen uden at udføre en bilhandling.

**Radio på Green 2.0.159 · 9. november 2026, 12.57 CET.** Ét eksplicit valg af P3 gav ukendt
udfald. Speakers viste `playing=false`, og radioejeren meldte `unknown`. Den bagvedliggende
årsag er åben hos radioejeren og lead. Arbejdskandidaten indeholder den særskilt gennemgåede
rettelse `85b0d872`, som fornyer korte radioobservationer før deres udløb. Den retter et
læseforløb. P3-starten står fortsat åben.

**Robot på Green 2.0.159 · 9. november 2026, 13.07–13.21 CET.** Efter bekræftet HA-pause viste
den aktive visning to Base-paneler. Ved anden prøve kl. 13.18 var HA stadig på pause, og den
friske PodView-observation tilbød `stop` og `return`. Den eksisterende robots Supervisor-regel
manglede `resume`, som produktet kræver særskilt. Kl. 13.20 blev kun denne handling tilføjet til
samme regel. Konfigurationen er gemt, og indlæsning ved næste samlede installation afventer.
Robotten viste »Oplader« ved basen kl. 13.21. Seks rum, Støvsug og vask, Maks., Extreme, Standard
og 2× blev gendannet manuelt. Fortsæt efter indlæsning af den nye regel og Stop afventer liveprøve.
Lokal pauseobservation er `green-159-robot-paused-1318.json`.

**Afslutning og upload på Green · 9. november 2026.** Kl. 13.24–13.25 blev Burgerboller afsluttet
med en separat femminutterstimer kørende. Kataloget mistede den aktive markering, widgetten viste
»Se katalog«, og historikken viste Burgerboller kl. 13.25. Samme timer fortsatte til 4:22 og blev
annulleret ved 4:16. Lokal visning er `green-159-recipe-finished-timer-kept.png`.

Kl. 13.39 sendte Mac-prøven den faste Arla-URL. Kataloget viste én række for »Nem chokoladekage i
bradepande«, detaljen kunne åbnes, og »Uploadhistorik« viste én post som »Gemt« kl. 13.39. Den
efterfølgende kontrol genbrugte den gemte post. Brugeren bekræftede særskilt, at uploadfeedbacken
var korrekt på iOS og PodView, og at opskriften kom frem. Den konkrete iPhone-anmodning
blev ikke indfanget særskilt. O10 kombinerer brugerens observation, Mac-forløbet på Green
og kontraktprøverne for afvisning, beskeder og kodeadskillelse.

**14 af 97 historier er færdige.** F4, R3, O1, O4, O5, O7, O8, O10, T2, V1, V2, V4, B5 og B6 har den
relevante Green-observation og de eksisterende softwareprøver for øvrige betingelser. De øvrige 85 afventer
deres fulde accept.

**Levering til Claude-gennemgang · 9. november 2026.** PodVoice 2.0.160 er merged fra PR #340
på `ce37b41cb513dc6ea87bd61afecd15aa2e3b0d46`, og ARM-imageindekset er publiceret som
`sha256:46c5c6f6ce0bb59fc6d66d91a3bb6c62a4120ca659f1cbdc8a4263724caa018b`. Green installerede
2.0.160 via HA's `update.install` med backup. Add-onens infoside viste 2.0.160 og »Kører«.
Speakers 0.26.79 var allerede installeret. Lokal visning er `green-podvoice-160-installed.png`.
PodView-indstillingerne viste 2.0.160 og forbindelse til HA. Den eksisterende browserfane
genforbandt efter genstart uden genindlæsning og vendte tilbage til fotovisningen med 8° og Skyet.
Den genforbundne fane kørte stadig 2.0.159-bundlen. Klienten viste 2.0.160 efter genindlæsning.
Den aktuelle radiovisning var deaktiveret med seks årsagslabels. Speakers 0.26.79 loggede
HTTP 409 med `start_busy` ved passiv klargøring hos den primære radioejer. En frisk backup viste
en gyldig afsluttet MOVE-journalpost med `retired_known`. Klargøringen efter genstart krævede en
START-post og afviste derfor MOVE, før den kunne kontrollere den gamle ejer. R3 er fortsat åben.
Speakers 0.26.80-kandidaten `6afca3eb` bestod Native-, OwnTone- og overgangskontrollen.
Kandidatens imagebyg er i gang. Green afventer fortsat radioprøven.
[Speakers PR #125](https://github.com/BixelVentures/podconnect/pull/125)
[PodVoice PR #340](https://github.com/BixelVentures/podvoice/pull/340)

**Robot på Green 2.0.160 · 9. november 2026, 14.15–14.19 CET.** Én støvsugetur i Gang med
Stille og 1× gik til Rengør. Pause gav bekræftet pausestatus. Efter genindlæsning stod »Fortsæt«
stadig til rådighed. Et tryk på »Fortsæt« gav en ny HA-observation af rengøring kl. 14.16.54.
På 2.0.160 var der ét Base-panel i både pausestatus og rengøring. Bekræftet »Kør til basen«
gav »På vej til basen« kl. 14.18 og »Oplader« med 100 % kl. 14.19. Detaljen viste seneste
afsluttede tur kl. 14.18 med 0,2 m² og 1,1 min. Den særskilte Stop-handling afventer.
En automatisk fornyelse lukkede en åben bekræftelsesdialog. Den reviewede rettelse `0eda24d7`
bevarer dialogen ved fornyelse for samme robot og samme aktuelle handling. Den afventer levering.
En uafsendt kladde nulstilles ved skift af proces efter den eksisterende ejergrænse. Spørgsmålet om
bevarelse af kladden på tværs af genstart står fortsat åbent.

**Køvalg på Green 2.0.160 · 9. november 2026, 14.23 CET.** Valg af playlisten BRYLLUP startede
»Fast Car«. Køen viste 20 rækker sammen med en læsefejl. Ét eksplicit tryk på »Unlonely« blev
vist som afvist, og betjeningen blev derefter skrivebeskyttet. Et senere tryk på Pause gav
bekræftet `playing=false` hos Speakers. K3/K5 står åbne. Årsagen kræver det oprindelige svar
for køvalget og den tilhørende ejerobservation.

**Køvalg og installation på Green · 9. november 2026, 14.58–15.01 CET.** Green installerede Speakers
0.26.80 med backup, efter at HA's opdateringsentitet viste versionen. På PodVoice 2.0.160 blev alle
fire Find musik-faner gennemgået. Faneskift og listeudvidelse bevarede forslagene.

Musikvalget Rachel/Peter startede »Ordinary Things« på Køkkenalrum. Kølæsningen kl. 14.58.46
viste fejl med HTTP 200 og `reason=other`. Efter pause viste køen 20 rækker. Ét tryk kl. 14.59.21
på »What Is Hip – Live«, række 2, gav accepteret kvittering kl. 14.59.22 med
`stage=validate_receipt`, `dispatched=true` og reference `dd7a459a0f110e50`. Titlen skiftede i
PodView, hvorefter betjeningen blev deaktiveret, og højttaleren stod ubekræftet. Speakers viste
Køkkenalrum `main` idle. Native Stop blev ikke bekræftet. En separat Spotify-aflæsning viste
afspilning på Køkkenalrum. Pause dér gav ukendt udfald. Næste Spotify-aflæsning omkring kl. 15.01
viste `NONE`. Pakke 3 står åben. Musikagenten følger den konkrete kvittering gennem den native
ejer og læsevejen for at forklare de modstridende observationer.

**Anden køprøve på Green · 9. november 2026, 15.05–15.06 CET.** Før valg af »Unlonely« viste
Speakers »Fast Car« på pause med lydstyrke 35. Køkkenalrum var valgt, rute 3, sessionsepoch 3.
Efter køvalget var samme proces, rute 3 og valgt Køkkenalrum bevaret. Sessionsepoch var 4, mens
`playing` fortsat var `false`, titlen var tom, og lydstyrken var `-1`. Native-sundhedskontrollen
fejlede kl. 15.05.24 og 15.05.54, henholdsvis forsøg 1 af 3 og 2 af 3. Musikagenten undersøger
sammenhængen. Spotify Pause under oprydningen gav ukendt udfald, og næste aflæsning viste `NONE`.
Lokale aflæsninger er `pc80-pause-owner-1505.json`, `pc80-queue-owner-lost-1505.json` og
`pc80-health-after-queue-1506.txt`.

**Leadbeslutning om køfejlen.** To afgrænsede Linux-prøver afgjorde ikke årsagen. Næste
foreslåede skridt er at registrere den første fejltype ved Native-status, hvor Native-aktøren
eller kaldet til C blokeres under sessionslukning, og C-ejerens årsag til at fjerne sessionen.
Brug eksisterende logveje med faste grænser og redigerede felter. Musikagenten afklarer filer,
udløser og grænser med lead før implementation. En ny fysisk prøve afventer denne måling.
Diagnostikken skal skelne årsager uden at ændre afspilningen. Køfejlen står fortsat åben.

**Timer og lys på Green 2.0.160.** Ny timer kunne sættes fra 5:00 til 6:00 og tilbage før start.
Efter start viste overblikket 4:58 og detaljen 4:55. Den aktive detalje viste kun »Annuller«.
Annullering ved 4:53 fjernede timeren fra overblikket før udløb. Lysvisningen meldte Hue ikke
forbundet. Et faktisk lysforløb afventer forbindelse.

Timeradapteren afviste den form, HA faktisk returnerer for v2-timerens selectorer, og faldt
tilbage til v1 uden aktiv +1/−1. Den reviewede rettelse `b94296ab` godkender de konkrete
HA-standardværdier. Samme pakkede Chromium-prøve skiftede fra v1 til v2 og gennemførte seks
justeringer hos samme inerte timerejer med dækket pause og genoprettelse efter ukendt udfald.
En prøve bruger HA's faktiske service-serialisering og afventer officiel CI. Timerrettelsen kan
leveres med den mergede robotrettelse i `c2b5d55a`. Publicering og Green-prøve afventer.

Efter opdateringen åbnede den aktive Burgerboller-widget direkte på trin 2 af 5 med én af ti
ingredienser markeret og 15 stk. Galleriet gik fra 1/3 til 2/3 og lukkede tilbage til opskriften.
Ingredienser kunne lukkes, »Om opskriften« viste Meyers, og retur fra Arla-opskriften bevarede
kategorien Kager. Den gemte upload var stadig tilgængelig. Det tidligere El Clásico-svar kunne
åbnes med samme tekst, tidspunkt og AI-forklaring. Q2 afventer en ny livebesked under læsning.

Green viste kl. 14.08 samme 8° og Skyet på fotovisning, forside og vejrdetalje. Forsiden og
detaljen viste samme temperaturspænd og fælles timer kl. 15–19. Detaljen viste 12 timer og seks
dagsrækker fra Met.no. Den tidligere aflæsning kl. 13.39 viste »Sidst kendt« med tidspunkt.

**Samlet Green-runde · 10. november 2026, 10.27–10.32 CET.** PodVoice 2.0.165 er merged
i PR #349, publiceret og installeret; Supervisor viste Kører. Denne levering er ikke i sig selv
accept. En frisk HA-fane åbnede uden Gendan/ekstra login med Køkkenalrum konfigureret.

- Musikstart: Morning Coffee gav Tom and Jerry på Køkkenalrum, bekræftet af Spotify.
  Første Pause kl. 10.28.50 fik `outcome=unknown` kl. 10.28.51 (`b368e58c9c5befcb`);
  Spotify fortsatte. Et nyt eksplicit Pause-tryk kl. 10.29.16 fik `accepted` kl. 10.29.17
  (`229aa53b19655f6d`), og Spotify viste PAUSED ved 41814 ms. A1 er fortsat fejlet i denne gren.
- Køvalg: 20 navngivne rækker var synlige. Ét tryk på Kiss Me kl. 10.29.27.918 gav
  `stage=presentation dispatched=false outcome=rejected kind=none`, reference
  `884f59a83b69311c`. PodVoice afviste før PodConnect-dispatch. Den kendte liste blev bevaret
  som Kun visning. Sol undersøger den konkrete generations-/fornyelsesgrænse; live-loggen
  skelner endnu ikke den enkelte presentation-betingelse. K3/K5 er ikke afsluttet.
- Radio: P3 start admission 10.30.05.139 → accepted 10.30.07.576; P1 skift
  10.30.18.618 → accepted 10.30.20.725; Stop 10.30.29.415 → accepted 10.30.29.854.
  UI viste korrekt valgt station og derefter Stoppet. Det er service/UI-bevis, ikke hørbar accept.
  Efter Stop fejlede eksplicit Dinner Chill-valg fra Find musik: ingen ny selected_trace i den
  observerede log, forslag blev bevaret med Prøv igen, og afspilleren stod på den gamle sang,
  På pause · højttaler ikke bekræftet med deaktiveret betjening. Spotify forblev PAUSED.
  Radio → Spotify-retur står derfor fejlet, og testlyden er stoppet. Efterfølgende loglæsning
  afgrænsede det nye valg til forslagets fornyelse: `mood_result` kl. 10.31.02.683 var full,
  selection_allowed=True, reference `95aa0988e0ddcb81`; klientkvitteringen for samme reference
  var `renewal_card_mismatch`. Det beviser afvist forslag før musikstart, ikke en defekt radiohandoff.
- Kold katalogåbning på den nye IAB-klient kl. 10.34: widget Se katalog åbnede direkte ni
  alfabetiske opskriftsrækker uden aktiv opskrift. Første observerede UI efter trykket havde
  rækkerne; efterfølgende screenshot viste thumbnails, og DOM bekræftede 9/9 afkodede billeder.
  Ingen brugeropskrift blev nulstillet. Dette er Mac/Green-bevis; ingen målt første frame eller
  fysisk iPad-prøve. Terra bekræftede separat aktiv Burgerboller i Chrome med bevaret fremdrift.
- Robotkladden på Green 165 viste tre typer, Extreme samt kun 1×/2×. Vask/Extreme/2×/Gang
  var bevaret efter 30 sekunders passiv ventetid. Typeskift kombineret → Vask gav Mellem/1×;
  ønsket typespecifik bevarelse skal sammenholdes med eksisterende kontrakt før fejlklassifikation.
  Ingen robot- eller basekommando blev sendt i denne delrunde.
- Terra Tesla/vejr: HA og PodView stemte for locked/closed, 51 %, 194 km, klima off,
  kabine 20,5 °C og mål 21 °C. Temperatur, afrimning og sædevarme var deaktiveret ved OFF;
  ingen 0 kW ved disconnected. Lås op-dialog blev annulleret uden bilhandling. Passivt
  skift til Sidst kendt bevarede værdier og tidsstempel 10.13; dette beviser ikke faktisk dvale.
  Met.no 5,9 °C blev vist som 6° Skyet med samme timer og seks dagsrækker med ikoner.

**Første samlede Green-runde fortsat · 10. november, ca. 10.46–10.52 CET.** Ingen installation eller lyd i denne delrunde.

- Terra, egen Chrome: Find musik åbnede alle fire faner. Første åbning viste Henter forslag og derefter tre faktiske kort. Din musik udvidede 5→10; Hør igen 5→6 og var derefter udtømt. Ti kendte rækker og rækkefølge blev bevaret ved faneskift og varm genåbning fra forsiden. Morgenvisningen havde hovedkort til venstre og to alternativer til højre; Vibe viste tre genrekort. Rigtige og illustrerede covers var synlige. Ingen konkret fejl; ingen ny frame-/300 ms-måling eller fysisk iPad-referencekontrol. Genbrug eksisterende kontrollerede timing-/loadingprøver.
- Terra robot: Skjul vedligeholdelse i dag bevaredes efter 20 sekunder, Forside→robot og fuld reload. Vis igen gendannede de oprindelige fire påmindelser. Filterteksten beskrev interval, ikke bevis for slitage. Ingen robot-/resetkommando. Numeriske tællere var ikke synlige; ny vandfejl blev ikke fremprovokeret. De negative grene er fortsat softwarebevist, ikke ny fysisk fejlprøve.
- Root IAB, samme dokument efter Ro: kl. 10.50 viste HA Forbindelse afbrudt / Opretter forbindelse igen. Ro→forside→katalog viste stadig ni opskrifter. Uploadhistorik åbnede én Gemt-post; Arla-detaljen viste elleve ingredienser og syv trin; Om opskriften kunne åbnes og Ingredienser lukkes. Tilbage bevarede åben Uploadhistorik. Vejr stod fortsat Sidst kendt. Ingen genindlæsning eller Gendan blev udført; genoprettet liveforbindelse er ikke bevist af fungerende cache-navigation. En frontend-consolepost kl. 10.50.26 med teksten `3` giver ikke en årsag. Næste afgrænsning er frisk kildeobservation i samme dokument, ikke gentagen katalogtest.

**Genforbindelse afgrænset · 10. november, kl. 10.52–10.54 CET.** Samme IAB-dokument, ingen reload/Gendan: vejrdetaljen viste Hentet 10.52 men stadig Sidst kendte vejr. Højttalerdialogen hentede Køkkenalrum (Valgt), Svend (valgbar) og Frida (Status ukendt, deaktiveret). Et eksplicit Opdater liste bevarede alle tre rækker, navne og Køkken-valg både under og efter kaldet; ingen afspilning eller outputskift. Om skærmen viste derefter Home Assistant **Forbundet** og version **2.0.165**. Den tidligere afbrudte forbindelse kom dermed tilbage uden manuelt gendannelsestrin. Vejrets Sidst kendt er et særskilt friskhedsspørgsmål: kode bruger minimum af retrievedAt+15min og stateUpdatedAt+30min; nyere Hentet er ikke alene en frisk HA-kilde. Den konkrete kildetidsstempelværdi er endnu ikke aflæst. H6 har nu faktisk Green-refresh med bevarede rækker; fysisk iPad og visuel kantreference er ikke nyverificeret her.

**Samlet musikrunde, alternativ indgang · 10. november kl. 10.56–10.57 CET.** Spotify viste NONE før prøven. Morning Coffee fra den bevarede morgenvisning gav Klargør dit musikvalg og derefter Kunne ikke hente nye forslag; ingen afspilning. Uden at gentage handlingen åbnedes Hør igen med friske historikrækker. Ét valg af Kaj Og Andreas’ Duet startede og viste korrekt titel, cover, Køkken-output og aktive kontroller. Pause trykket kl. 10.57.36.365 gav Fortsæt i UI; efterfølgende Spotify-kilde bekræftede PAUSED ved 18316 ms på Køkken. Ingen præcis ende-til-ende-pausetid er målt af disse adskilte værktøjskald. Det viser en fungerende start/pause fra denne indgang, men lukker ikke den tidligere UNKNOWN-gren eller ti-minuttersprøven. Testmusikken er pauset/stoppet; ingen ekstern afspilning blev afbrudt.

**Kontroltab efter vellykket pause · 10. november kl. 10.58 CET.** Samme start fra Hør igen ovenfor: efter bekræftet PAUSED var Forrige/Fortsæt/Næste og volumen deaktiveret; output sagde På pause · højttaler ikke bekræftet · Køkkenalrum HomePod · Kontostatus · Vælg næste højttaler. Ingen anden brugerhandling imellem. Dette er et dokumenteret kontroltab efter succes, adskilt fra første Pauses UNKNOWN. Ingen ny afspilning blev forsøgt. Core-loggens seneste grupperede room_queue-advarsel var kl. 10.57.20, speakers_unavailable; den ligger før Pause og beviser ikke alene årsagen til kontroltabet. Det efterfølgende PodVoice-logvindue viste 200 fra snapshot/targets/queue-kald men ikke deres svarfelter. Næste nødvendige observation er ejerens konkrete readiness/session/output-felter efter Pause; HTTP200 er ikke bevis for bevaret kontrol.

**Afgrænset diagnostikbeslutning, samme kontroltab.** Lead/root ejer. Eksisterende UI viser account-only afspilning, men logs logger ikke `account_observed`; HTTP200 skelner ikke manglende outputbevis fra udløbet rute eller afvist admission. Derfor tilføjes alene en begrænset enum-log ved den eksisterende autoritative `resolve_actual`/`read_playback`-grænse: output.status/reason og controls.status/reason. Log ved tilstandsskift eller eksisterende begrænsning; ingen IDs, tokens, payloads, ekstra kald, automatisk gentagelse, ny autoritet eller ændret wirekontrakt. Færdigkriterium for diagnostikken er en kausal regression og uafhængigt review, efterfulgt af én målrettet Green-observation i samlet levering. Resultatet vælger den konkrete ejerrettelse; diagnostik alene lukker ikke fejlen. Dette er testblokerende musikobservation, ikke anledning til separate generelle release-/auditloops.

**Optælling af første gennemgang · 10. november.** 15 fuldt bestået; 33 har registreret forløbsresultat med navngiven rest (inklusive kontrollerede negative grene og konkrete fejl); 29 har en konkret resterende Green-prøve; 20 har en fysisk/kildeafhængighed. Det er 97 historier, ikke 97 fejl. Alle har delevidens. Fordelingen er en arbejdssortering, ikke nye acceptniveauer: den enkelte histories acceptkrav gælder stadig. De kendte kø-/forslagsfejl samt kontroltab efter pause blokerer flere efterfølgende betjeningsgrene samlet. De skal ikke gentages som isolerede fejlprøver.

| Pakke | Fuldt bestået | Registreret resultat med rest | Konkret Green-prøve | Fysisk/kildeafhængighed |
|---|---|---|---|---|
| 1 · Adgang (6) | — | G3–G5 | — | G1, G2, G6 |
| 2 · Musik (25) | F4 | A1,A7,A11,A14,F1,F2,F5–F8,F10–F12 | A2–A6,A8–A10,A13 | A12,F9 |
| 3 · Kø/højttaler (15) | — | K3,K5–K7,H6,H8,H10 | K1,K2,K4,H1,H5,H7 | H4,H9 |
| 4 · Radio (6) | R3 | R4,R6 | R5 | R1,R2 |
| 5 · Opskrift (7) | O1,O4,O5,O7,O8,O10 | — | — | O6 |
| 6 · Robot (16) | S5 | S8–S10,S14–S16 | S1–S4,S7,S11–S13 | S6 |
| 7 · Tesla (11) | B5,B6 | B9 | B1,B2,B4,B10,B11 | B3,B7,B8 |
| 8 · Øvrige (11) | T2,V1,V2,V4 | V3 | — | L1–L3,T1,Q1,Q2 |

**Robot samlet ventetidsprøve · 10. november kl. 11.03 CET.** Terra havde Gang/Støvsug/Stille/Standard/1× bevaret i samme kladde efter over ti minutter og Ro; HA var docked/cleaning off før Start. Log: Start admission 11.03.05.486 (bcbd113af720f212), HA app_segment_clean area_ids=[gang], repeat=1, accepted 11.03.11.629. PodView/HA viste rengøring; synligt rum Bathroom1 kan være position/transit og er ikke bevis for forkert bestilt område. Ét Pause-tryk: admission 11.03.30.952 (aac2b9d5b2b46952), receipt rejected delivery=new kind=direct 11.03.30.953. UI viste kort Fortsæt, derefter Pause og afvisning; HA fortsat cleaning. Robotten gik derefter naturligt til returning før agentens returhandling; ingen Fortsæt eller gentaget Pause. Efter naturlig returning blev HA idle uden docked. PodViews nye returbekræftelse forsvandt før bekræftelsesklik (8,7 s værktøjsdeadline); ingen retur blev sendt herfra. Én særskilt oprydning via HA vacuum.return_to_base blev derefter sendt. Seneste kilde viste returning_home, charging off, battery99 %, cleaning off, dock-fejl ok og ingen vandfejl. Ingen konkret fysisk hindring var synlig, og faktisk docking er ikke bekræftet. Brugeren bekræftede efterfølgende, at genstande foran robotten hindrede hjemkørslen, og at robotten forsøgte at komme hjem. Hjemkørslens manglende docking klassificeres derfor som fysisk hindret, ikke dokumenteret softwarefejl. Pauseafvisning og den forsvundne returbekræftelse forbliver særskilte softwarefund. Faktisk docking efter fjernelse af hindringen er ikke bekræftet; ingen flere robotkommandoer. Senere robot_setup_failed/settings 11.03.49 og offer_changed_dock_offer 11.03.50 er særskilte læse-/fornyelsesgrene, ikke dokumenteret Pause-årsag.

**Afgrænset robotmåling, root-beslutning.** Den eksisterende control_command-kvittering udelader afvisningens allerede beregnede error-kode, og den understøttede browseradgang har ikke bevaret netværkssvaret. Tilføj alene en lukket enum-kode til eksisterende receipt-log, med kausal test af direkte pauseafvisninger og redaktion af ukendt input. Ingen ny læsning, endpoint, retry eller adgangsændring. Mindste manglende observation skelner busy/scope/setup/unsupported/stale ved næste målrettede prøve. Dette er ikke en løst robotfejl og indgår i samme kandidat med uafhængigt review.

**Tesla læsende sammenligning · 10. november kl. 11.03.** PodView viste sidst kendt klima slukket, kabine20,5/mål21 og ældste observation10.13. HA-tabellen viste climate.fam_bach_klima heat_cool, kabine19/mål20; entity-tidsstempel var ikke synligt, så samtidighed og faktisk bileffekt er ikke bevist. HA charging=disconnected uden synligt timestamp. Parkering/inaktiv bil kunne ikke bekræftes; ingen klimatoggle/vækning. Core har desuden to Tesla Fleet-listenerfejl (09.53.22/10.03.22): select.py:190 IndexError ved options[value]. Dette beviser en select-opdateringsfejl, ikke at alle Tesla-data fejler eller årsagen til denne visningsforskel. Næste sikre observation er tidsstemplede kildedata; ingen spekulativ HA-patch.

**Senere samme session · 10. november kl. 11.07–11.09.** Uden musikkommando eller reload siden den bekræftede Pause vendte kontrollerne selv tilbage: aktuelt Køkken-output og Fortsæt/næste/volumen aktive. Vejr blev samtidigt 7° Skyet uden sidst-kendt-markering. Ét UI-volumenvalg 35→20 viste 20 %, men efterfølgende Spotify-læsning gav NONE og afspilleren blev tom; ingen kildekvittering på volumen blev observeret, så effekt og årsag til sessionens ophør er uafklaret. Musikken var allerede pauset, og der blev ikke sendt Stop eller ny start. Radio blev åbnet for R5, men viste Radioafspilning er endnu ikke tilgængelig via Home Assistant med alle fem stationer deaktiveret; uændret ved næste aflæsning. R5 kan derfor ikke prøves i denne aktuelle tilstand. Ingen radio blev startet.

**Samlet kandidat, diagnostikreview.** PodVoice 0295c306 og 5fb72d7f er integreret med uafhængigt GO: eksisterende musik-read logger begrænsede årsager ved overgang til account-only; direkte afvist robotreceipt logger begrænset reason. Ingen ekstra læsninger, kommandoer eller adgangsændringer. Samlet eksakt kandidat: musikovergangstest PASS; seks direkte robotcases PASS efter lokal loopback-port blev tilladt (første forsøg var miljø-EPERM, ikke produktfejl). Begge er målinger, ikke rettelse af de aktuelle Green-fejl. Den tidligere PR350-kandidat5fc65e87 havde grøn officiel CI42793220944; nye diagnostikbytes har endnu ikke officiel CI/publicering/installation.

**Robotdialog, årsagsafgrænsning og beslutning.** Pakket kandidat1ff547b2 i rigtig Chromium med inert HA bevarer samme returdialog under almindelig samme-ejer setup-fornyelse og frisk Home-læsning. Én kontrolleret Home503 reproducerer derimod straks forsvundet dialog, selv med uændret stopped-status, boot og rum; ingen control/actions sendes. Det beviser en transient-fejlgren, ikke at netop503 udløste Green-hændelsen. Root beslutter mindste UX-rettelse: behold brugerens åbne dialog ved midlertidigt læseudfald for uændret ejer/status, men deaktiver bekræftelse til frisk gyldig handlingsadgang foreligger. Ingen cacheautoritet eller automatisk afsendelse. Reelt skift i ejer/status/job/adgang følger fortsat den eksisterende afvisning. Kausal prøve skal dække503→bevaretdisabled→frisksammeejer samt ændret scope og nul kommandoer indtil eksplicit tryk. Samles i samme kandidat; fysisk Green-årsag står fortsat særskilt.

**Samlet 2.0.166-kandidat.** Robotdialogrettelsen er integreret som297c1bbf med uafhængigt GO og kausal Chromium-prøve: midlertidig Home-fejl bevarer dialogen uden handlingsadgang; frisk adgang genaktiverer, ændret status eller afvist adgang lukker. Produktassets er genbygget fra samme kilde. Den samlede PodView-suite består med4898 tests, nul fejl. Dette er softwarebevis; Green kører fortsat2.0.165 før installation.

**Green11:22, før installation.** Forsiden viste robotten som Oplader100% efter den tidligere fysisk blokerede retur. Et eksplicit valg af Bandeordssangen fra Hør igen endte i ukendt udfald og blev ikke gentaget. Efterfølgende Spotify-læsning viste ingen aktiv afspilning. Næste/lydstyrke-forløbet kunne derfor ikke gennemføres. Startudfald og efterfølgende kontroltab skal stadig afgrænses med den installerede diagnostik; ingen ekstra flueben.

**Afstemning efter seneste Green-observationer · 10. november kl.11.37.** Alle97 aktive IDer er afstemt mod den eksisterende evidens. Den tidligere optælling15 fuldt bestået er nu14: R3 tilbagetrækkes som aktuelt bestået, fordi alle fem radiostationer var deaktiverede11.07–11.22. De14 er F4,O1,O4,O5,O7,O8,O10,S5,B5,B6,T2,V1,V2,V4. Ni historier har dokumenteret fejlet brugerforløb: A1,F2,F10,K3,K5,R3,R4,S3,S4; flere deler samme hændelse/årsag. Ingen optælling af scoped software-PASS som fuld Green-accept.

26 har fortsat utilstrækkelig konkret Green-prøve: A2–A6,A8–A10,A13,K1,K2,K4,H1,H5,H7,S1,S2,S7,S11–S13,B1,B2,B4,B10,B11. 27 har kontrollerede eller delvise beståede observationer, men mangler deres fulde acceptkrav: G3–G5,A7,A11,A14,F1,F5–F8,F11,F12,K6,K7,H6,H8,H10,R6,S8–S10,S14–S16,B9,V3. De27 er ikke fuldt beståede. 21 har registreret konkret afhængighed: G1,G2,G6,A12,F9,H4,H9,R1,R2,R5,O6,S6,B3,B7,B8,L1–L3,T1,Q1,Q2. Referencekontrol/egne rester må ikke fremstilles som brugerblokering; gennemfør dem hvor værktøjerne tillader det. Næste runde gennemgår hele restlisten før nye runtimepatches, bortset fra nødvendige testblokeringer.

Uafhængig læseprøve11.29: climate.fam_bach_klima off, last_changed/last_updated11.23.22, target20; PodView Slukket,target20,samletældste11.23. Tidligere klimamismatch ikke reproducerbart nu; separat climate.status-tid mangler i UI, så præcis kildeidentitet er ikke bevist. Ingen bilhandling. Læseprøve11.37: Lys Ikke forbundet; Voice PE Vækning ikke bekræftet/ikke verificeret (ikke bevis for offline); timerUI læsbar uden alarmstart; vejr viste samme sidstkendte7°/hentet11.32 på forside/detalje og seks normale dagsikoner. Ingen ny kildefejl/lyd/lyshandling fremprovokeret.

Levering: PR350 merged c88206d8 fra e8499323 efter grøn officiel PR-CI42799427875. Main-publicering42800322702 kører. Green er stadig2.0.165; 166 er endnu ikke installeret eller fysisk accepteret.

**Acceptafstemning22/97 · 10. november, 2.0.166.** G5,F5,F8,H6,S10,B9,V3,R6 afsluttes mod deres konkrete kriterier efter root har læst de faktiske assertions og CI-runneren, som kører dem på166. Det kræver ikke at ødelægge Green-konfiguration, vente på tilfældige kildefejl eller genskabe stale-races på fysiske enheder. Kontrolleret HTTP/HA-slutled er stadig inert og er ikke bevis for fysisk lyd, bil eller robotbevægelse. F5/F8/H6/S10/V3 kombinerer browserfejlgrene med allerede registrerede reelle Green-visninger. G5/B9/R6 har eksplicit rent logik/UI-/negativt kriterium. Ingen kendt faktisk kontroldefekt lukkes af dette. Dermed22 bestået,9 dokumenteret fejlede,21 navngivne afhængigheder og45 øvrige rester; hele restlisten skal fortsat gennemgås før næste rettelsesrunde.

**Installation verificeret · 10. november ca.11.51.** Officiel main-CI/publicering42800322702 bestod; release2.0.166 publiceret10.46.24UTC. Supervisor havde først inkonsistent opdateringstilbud (installeret/nyeste165) efter et timeout. Senere viste både Supervisor og PodVoice-runtime166, Kører, commitc88206d813121ac20d38f3f85094f2493b2d9cc5. Terra trykkede ikke installation; et samtidigt brugerforløb gennemførte den. Ingen dobbeltafsendelse. Dette er leveringskontrol, ikke nye fysisk accepterede historier. Terra_green_read ejer den næste musik/radio-serie alene; root og andre sender ingen samtidige musikhandlinger.

**166 samlet Green-serie · 10. november11.52–11.53.** Terra alene ejer musikhandlinger. SpotifyNONE før; ét Hør igen-valg Kaj Og Andreas' Duet mod Køkken viste titel/cover og Starter afspilning, derefter tom player og Højttaleren i rummet kan ikke bruges lige nu. Efterfølgende SpotifyNONE. Ingen gentagelse. PodVoice-log: request9271056bb9694397 client start11.52.41.608 → rejected11.52.52.109. Speakers11.52.38 content_read_failed/capture_unavailable og wrapper native_read ligger før client-start uden fælles reference; ikke dokumenteret årsag. Ingen account-observed afspilning opstod, så kontroltabsdiagnostikkens overgang blev ikke udløst. Core viste ingen tilsvarende navngiven receipt; det manglende er den korrelerede terminale room-start-ejerårsag. Kø/næste/volumen/pause er konkret blokeret af denne start, ikke særskilt fejlet. Uafhængig radiolæsning11.53: alle femP3/P1/P4/P6/P8 deaktiverede, Radioafspilning er endnu ikke tilgængelig via Home Assistant. Ingen radiokommando; R1/R2/R5 blokeret af readiness, R3 fortsat fejlet. Læsende musikfaner fortsættes uafhængigt. Ingen aktiv testmusik ifølge seneste Spotifykilde.

**166 uafhængige rester11.53–11.56.** Din musik5→10 og Hør igen5→6; tilbagefaneskift bevarer10navne/rækkefølge. Ingen ny timing/scrollmåling eller musikstart. Passiv HA playback.v3-læsning11.55 viste frisk no_active_playback, output/controls unavailable reason route_unavailable, bindingnull og ingen supported_actions; dette er aktuel manglende rute ved ingen afspilning, ikke bevis for tidligere startårsag. Spotify-enhedslisten havde stadig Køkkenalrum som tilgængelig inaktiv enhed, så rene enhedsfravær er ikke dokumenteret.

S7-baseprøve11.56: frisk HA docked/charging, dockerrorok, vandfejl/mangeloff og tankmonteret; PV Oplader100%. Base rækkefølgeVask/Tøm/Tør korrekt. ÉtVask-tryk: efter8.7s UIUNKNOWN+Offline og disabledBase; HA viste washing_the_mop. PV kom senere til Vasker moppe/Anmodningen er modtaget. Ét nyt Stop moppevask gav modtaget, HAcharging bekræftede stop. Ingen genvask. Det er faktisk effekt+stop med dokumenteret forkert/misvisende mellemfeedback, ikke rentPASS. Uafhængige tøm/tør følger kun med frisk afgjort status; andreagenter sender ingen samtidige fysiskehandlinger.

**S7-serie afsluttet11.57–11.58.** Automatisk tørring efter vask visteHA dryingon/PV Tørrer moppe. Ét Stop tørring gav modtaget og HA dryingoff/charging. Dette beviser stop af automatisk tørring, ikke egen eksplicit Tør-start. DernæstétTømstøv vistePV Tømmer støvbeholder/modtaget og HAemptying_the_bin; afsluttedeHAcharging med ny dock_error duct_blockage, PV Tømningskanalen er blokeret. Ingen genafsendelse eller tørstart ved faktiskbasefejl. S7funktioner vask/start/stop, automatiskdry-stop og tøm har observerede effekter; egenTør-start og efterfølgendeStop konkretblokeret af faktiskbasefejl. Fysiskvellykkettømning er ikke bevist.

Kausal166-browserreproduktion (inertHA), /private/tmp/pv166-dock-receipt-red.log: énapp_start_wash/serverHTTP200accepted; kunsvaret holdes tilbage, énHome503. Connectedtrue,pendingtrue; robot_offer_invalid fjerneropgave ogmalerUNKNOWN. Frigivsammeacceptedresponse→modtaget, nul ekstraPOST,262ms. Reproducerer falsk midlertidigUNKNOWN, ikke præcis liveårsag eller varigt tab afreceipt. Ingenruntimepatch; tilsamletrettelsesrunde. De faktiskeGreenreceipt1.114s/5.237s efteradmission afkræfter8sdock-timeoutfornetopdisse to accepteredehandlinger; browsernetværkskobling varikke fanget.

**S15/S16 afsluttet på konkret bevis · Green166.** Læsende reel duct_blockage: kompakt Tømningskanalen er blokeret; Vedligeholdelse sekundær/lukket4påmindelser; Tekniske detaljer lukket somstandard, åbenviste Base · duct_blockage identiskmedHA, lukningfjernedekoden. Ingen enhedshandling. S15kombinereraktuelGreenobservationmed166browserassertionsforsekundærSkjul. S16kombinererfaktiskGreenSkjul/navigation/reload udenreset medtestensobserverettæller-2 bevaret og nulskrivninger; senere-3 er nykildeobservation, ikkeUI-reset. Kriteriet kræverikke fysiskreset eller at vi fremprovokererslitage. Aktueloptælling24bestået,10dokumenteretfejlede(tilføjS7feedbackfejl),21afhængigheder,42øvrigerester. Fysiskblokeringduct_blockage stårsærskiltfradenreproduceredeS7feedbackfejl.

EksternSpotifyA8-prøve12.01blevafvistafautomatiskgodkendelsesreviewvedPlaypåKøkken. Ingenmusikstart. Rootharbedt omdirektekonkretbekræftelse; øvrigelæsningerfortsætter. Dette er værktøjsautorisation, ikkeproduktfejl.

**PodConnect-afgrænsning12.04–12.07.** Green UI bekræfter Speakers0.26.84Kører; HACS viser Control0.10.39downloadet (ikke selvstændigt runtimebevis). DirekteautoriseretSpotifyPlay~12.05.43 modKøkken førteikke tilafspilning,SpotifyNONE12.05.55. Speakers12.05.51 dealerendpointresume afvist content_quarantined; aliasregistryerrortekst er generiskkarantæneguard, ikkebevisforændretaliasfil. Tidligsteårsagsspor11.22.35AirPlayPairingstep2authenticationfailure samtidigcontent_start_failed/c_barrier/unknown. Sammenhængstærk, præcisCreceiptmangler. Quarantinelogikuændret83→84;84ændredeFIFO/ownerlock/legacy-recovery. Ingenperson/agenttilskrivning.

Sourceverificereteksisterenderecovery: SpeakersAddspeakerRescan→custody/admission→NativeSIGTERM/joinmensClever→Cstop/join→friskNative/Cmeddurableownerproof. Ingenquarantinebypass. RootautorisererénnormalRescanunderledigtSpotify/idleog08–18; resultatogCproof skalaflæses, ikkeantagHTTPok=funktion. Ingenhostreboot/nyparring/credentials.

Tesla16612.04læst: HAunlocked,trunkclosed,heat_cool,target20,insidesensor19.7,battery45,range170.767,chargingdisconnected. PVUlåst/Åbnbagagerum/Varme-køling/20/19.7/45%/171km matcher. Samletældste11.56, felttiderikkesynlige; B2friskhedståråben. Ingenparkgearbekræftelse/bilhandling. Opskrifter166: aktivBurgerbollertrin2/5,1/10ingredienser;Ingredienser/Omåbner, Sconesvisesudenatændreaktivopskrift, tilbagebevarerBrødogbagværkfilter. Scrollikke målt; ingen nyafslutning/afspilning.

**Acceptafstemning 34/97 · 10. november, samme 2.0.166.** G3, G4, F1, F11, F12, K6, H8, H10, S8 og S9 afsluttes mod deres konkrete skrevne kriterier efter uafhængig assertion-/CI-gennemgang og relevante eksisterende Green-observationer. Det er ti afklarede acceptforløb fra allerede udførte prøver, ikke ti nye fysiske prøver eller ti nye rettelser. F1 gælder varm åbning med kendt indhold; K6 gælder forekomstidentitet og afvisning af gamle svar; H8/H10 gælder negative sikkerhedsforløb. Aktuelt: 34 bestået, 10 dokumenteret fejlede, 21 navngivne afhængigheder, 32 øvrige rester. K7 står åben, fordi dens dedikerede fejlkildegren ikke sikkert er kørt i officiel166-CI. Musikstart og fortsat rigtig betjening er fortsat åbne.

**Genopretning, browsergrænse.** Terra-forsøget kl.12.11 fik timeout ved bekræftelsen. Efterfølgende aktiv Speakers-log dækkede perioden uden den kildeverificerede optagelsesmarkør `rescan: retiring Native`; ingen optaget genstart blev dokumenteret. Root kontrollerede Spotify NONE og Speakers idle, åbnede Rescan-bekræftelsen og accepterede via browserens dialog-API. Dialogen forsvandt, men browserstyringen ramte igen fokus-timeout. Den efterfølgende log viste stadig ingen optagelse eller nye motorstarter. Ingen yderligere gentagelse; procesgenopretning og ny lydautoritet er IKKE bekræftet. Ingen Play eller anden lydhandling blev sendt i denne opfølgning. Browserfaner forsøgt bevaret til videre udfaldskontrol.

**K7 og genopretning · opfølgning 10. november.** K7 er nu kørt uden early return på samme166-bundle og bestod; root læste både assertions og kvittering. Aktuelt35/97 bestået,10 dokumenteret fejlede,21 afhængigheder,31 øvrige rester. Ingen ny fysisk musikaccept. Native Chrome-aflæsning viste Speakers-listen uden åben bekræftelse, men fortsat ingen Rescan-optagelsesmarkør. Kildeanalyse viser konkret UI-fejl: Rescan ignorerer HTTP-svar og exceptions. Afvisning og uafklaret transport kan derfor ikke skelnes af brugeren. En minimal afgrænset rettelse af netop denne feedback er igangsat i separat PodConnect-kandidat; ingen adgangs-/custodyændring, ingen automatisk gentagelse. Den skal vise den manglende kvittering og afgøre næste handling, ikke regnes som løst musikstart. Den mulige attention-custody-afvisning er endnu ikke bevist som Green-årsag.

**Accept og afgrænset leverance · 10. november.** A7, A11, F7 og S14 afsluttes mod de skrevne kriterier. A11 fik ny faktisk Chromium-kørsel på166; øvrige specifikke166-assertions og eksisterende CI genbruges. Aktuelt39/97 bestået,10 dokumenteret fejlede,21 afhængigheder,27 øvrige rester. F6 står fortsat åben for det samlede godkendte visuelle match; samme komponent alene afgør ikke pixelkravet. A14 kræver endnu exact84-kontrol af Native/C-overgangen, så separat historisk bevis sammenkædes ikke til fuld accept.

Speakers0.26.85 er afgrænset til den dokumenterede Rescan-feedbackfejl. Review rettede succesordlyden til accepted/restarting, fordi kvitteringen ikke beviser nye processer eller lyd. Shipped-handler-test RED før og GREEN efter; guards og genafsendelse uændrede. PR130, head6e39cbae; officiel nativepolicy42807158853, pinned-stack42807158680 og imagebyg42807158004 er igangsat. Go findes ikke på denne lokale kommandosti, derfor ingen påstået lokal Go-PASS. Begge arkitekturimages skal bestå før mainmerge. Ingen installation eller løst musikstart hævdes.

**A14 afklaret · 10. november.** Den faktiske endelige84-CI erstatter behovet for at genbruge det ældre7f7931f-bevis. Root læste assertion/udfald i /private/tmp/pc84-final-a14-selected.log:1123–1125 og scenarieflag:913. Aktuelt40/97 bestået,10 dokumenteret fejlede,21 afhængigheder,26 øvrige rester. F6 forbliver åben: mangler begge166-lister sammenholdt med godkendt reference ved samme viewport. Speakers85-manager/nativepolicy42807158853 bestod; pinned-stack42807158680 og begge immutableimagebyg42807158004 kører fortsat. S7-rettelsen har kausal browserGREEN og67 fokuserede unitPASS i separat kandidat; cleaningStart/retur-naboforløb og finalreview afventes. Ingen ny enhedshandling eller fysisk accept.

**Samlet rettelse og Speakers-levering · 10. november kl.12.31 CET.** S7-kilden er integreret somff5f684f/693fedf5 og produktbygcd89030a, bundle42ef989b. Præcis samme bundle bestod kausal Dock503/holdt-kvittering, langsomStart16.128s over tilbudsudløb samt returdialogens503/statusskift/403-grene. Uafhængigt reviewGO. Fuld UI-suite havde4897PASS og fem tooling/assetfejl: fire lokale loopbackEPERM og én ældre pakket bundle. Efter korrekt kopiering/hashbinding bestod alle49 prøver i de to berørte testfiler; uændredePASS genbruges. Ingen fysisk S7-gentest på grund af faktisk duct_blockage, og ingen PodVoice-version bumpet endnu.

Speakers85 PR130 er merged som2ca86ac96bb7a45bac88db815f0cbd2eec8baa9f efter review og alle officiellePRchecks. Imagebyg42807158004 bestod beggearkitekturer med podconnect-subtree d8dee715332932860d966eeb0dac410b471a486b. Terra_green_read er eneste installationsejer og kontrollerer ledigSpotify før Supervisor-installation; root udfører ingen parallelle enhedshandlinger. Installation og faktisk recovery er endnu ikke bekræftet. Denne afgrænsede rettelse synliggør Rescan-udfald; den bypasser intet og tæller ikke som løst musikstart.

**Årsagsafgrænsning og installation · 10. november efter kl.12.33 CET.** Uafhængig sammenligning af Speakers83 (3cadf25),84 (60d5266) og85 (6e39cba) viser identiske go-librespot-blobs for quarantineguard, START-karantæne og App.Close/replaceAppPlayer. 84 ændrede FIFO-lifetime/owner-recovery;85 ændrer alene Rescan-feedback. Derfor er Claude som fejlårsag ikke dokumenteret. Manglende afgørende observation er den samme11.22-handlings C-route-ready-kvittering: pairing/auth kontra owner/FIFO-admission. Ingen blind downgrade eller guard-bypass.

Terra læste igen Supervisor: opdateringsmærke synligt, men dialog installeret84/nyeste84 og Opdatér deaktiveret. 85 er publiceret, ikke installeret; ingen ny Play eller Rescan. F6-reference genfundet i Musik audit research: brugeren godkendte localhost53880/music-prototype-morning, historisk1156×1060 og56pxcovers. Den tilhørende patch/build/capture er ikke længere på de registrerede stier; fuld visuel sammenligning står derfor åben. Aktuelt fortsat40/97, ingen nye fysiske acceptpåstande.

**Aktiv Green-gennemgang i otte pakker · 9. november 2026.** Gennemgå de eksisterende forløb i
rækkefølgen nedenfor. Saml dokumenterede fejl til én rettelse og installation pr. berørt produkt.
Gentag derefter de fejlende handlinger og deres relevante naboforløb. En pakke står åben, mens
en aftalt gren mangler afprøvning. Fælles forløb som A12, G4 og G5 tælles i deres egen pakke.

| Pakke og historier | Green-observation | Næste åbne forløb |
|---|---|---|
| 1 · Adgang og navigation (G1–G6) | Åben. HA-login gav adgang på Mac. Den eksisterende fane genforbandt selv efter fuld Green-værtsgenstart. På 2.0.164 beholdt Scones → Tilbage læsepositionen i Alle. | Prøv kold åbning, dvale og genoptagelse på iPad. Afklar den oprindelige adgangsafvisning efter natten og kontrollér bevarede valg ved en tilsvarende genoprettelse. Sammenlign de aftalte flader. |
| 2 · Afspiller og Find musik (A1–A14, F1–F2, F4–F12) | Åben. Hør igen viste titel og cover. Fire faner og listeudvidelse bevarede forslag. Andre forslag beholdt kortene under læsning og viste tre nye titler. Green 2.0.163 startede Tidsrejsen på Køkken, og Spotify bekræftede pause. En ekstern Tesla-session blev vist med lokale kontroller deaktiveret. | Mål de aftalte tider. Prøv fortsat betjening efter ti minutters afspilning og de øvrige Find musik- og eksterne forløb. |
| 3 · Kø og højttalere (K1–K7, H1, H4–H10) | Åben. Control 0.10.39 gav 20 navngivne køposter. På Speakers 0.26.83 blev en køpost afspillet, hvorefter PodView mistede output og betjening. På 0.26.84 viste Green igen 20 rækker. Ét køvalg fra pause gav spinner og derefter Ingen bekræftet kø. Spotify forblev pauset på det gamle spor. | Find den præcise køkvittering for 09.10 med stage, dispatched og outcome før ny handling. Efter årsagsafklaring skal valgt spor, samme output og fortsat betjening bekræftes, herunder eksplicit Pause. Højttalerskift kræver en tilgængelig anden modtager. Frida var slukket. |
| 4 · Radio (R1–R6) | Åben. På Green 2.0.164 og Speakers 0.26.84 var fem stationsknapper aktive på Køkken uden fejl, også efter 30 sekunders passiv ventetid og Forside → Radio. | På Green næste morgen blev P3 → P1 → Stop observeret på Køkken. Prøv eksplicit Spotify-retur, de aftalte tidsmål, fysisk lyd og højttalergrenen særskilt. |
| 5 · Opskrifter (O1, O4–O8, O10) | Åben. I en ny HA-autentificeret Chrome-fane viste første observerede katalog efter Burgerboller alle ni rækker, og alle ni billeder blev afkodet. Brød og bagværk bevarede kategori og fem rækker efter Scones. O4, O5, O7, O8 og O10 er bestået. Brugeren bekræftede iOS-kvittering og gemt opskrift i PodView. | Afklar O1 ved en kold direkte katalogåbning uden aktiv opskrift, og afslut O6-reference- og iPad-sammenligningen. Green har vist ingredienser, kildedetaljer og udfoldet Uploadhistorik. |
| 6 · Robot (S1–S16) | Åben. Start, Pause, Fortsæt, Afslut rengøring og retur til Oplader er observeret. På 2.0.164 kom Stille tilbage automatisk ved skift til Støvsug efter Støvsug og vask. | Kontrollér kladden ved naturlig fornyelse og Stop- eller returbekræftelsen, mens den er åben under fornyelse. Tidsmål, fysiske Base-kommandoer og faktisk Extreme-niveau 30 afventer. |
| 7 · Tesla (B1–B11) | Åben. Green viste låsebekræftelse og sikker annullering. Klima OFF deaktiverede de relevante kontroller. Den læsende HA-sammenligning matchede lås, batteri, afrundet rækkevidde og separat kabinetemperatur. | Prøv frisk ændring i lås, bagagerum eller klima med HA-sammenligning, faktisk opladning og bekræftede bileffekter. Dvale kræver en tidsstemplet kildeobservation. |
| 8 · Lys, timere, vejr og svar (L1–L3, T1–T2, V1–V4, Q1–Q2) | Åben. Green viste aktiv +1/−1 og annullering, og senere udløb med ét Stop. Met.no viste bevarede rækker efter genoptagelse, og gemt svarhistorik kunne åbnes. Hue meldte ikke forbundet. | Afvent Hue-forbindelse og normal Voice PE-brug til et nyt Køkken-svar under historiklæsning. Hørbar alarm og relevante vejrafvigelser afventer. |

De seks idéposter F3, H2, H3, O2, O3 og O9 indgår ikke i pakkernes accept. De allerede aftalte
dele af O2/O3 bevares. [Robot PR #342](https://github.com/BixelVentures/podvoice/pull/342) ·
[Speakers PR #125](https://github.com/BixelVentures/podconnect/pull/125)

**Supplerende læsende Green-kontrol · 9. november, 15.22–15.25 CET.** HA viste kortvarigt
forbindelsesafbrydelse og genforbandt uden genindlæsning af PodView. Tesla viste 78 %/299 km,
ældste observation 15.24, slukket klima og deaktiveret temperatur, afrimning og sædevarme.
Ét tryk på Lås op efterfulgt af umiddelbar AX-aflæsning viste endnu ikke dialogen; efterfølgende
faktisk DOM og screenshot viste »Lås bilen op?«. Annuller lukkede dialogen, og DOM bekræftede,
at den var væk. Ingen bilkommando eller vækning blev bekræftet. Evidens:
`/private/tmp/green160-tesla-unlock-dialog-1524.png`. Dette forløb kræver ingen spekulativ
Tesla-rettelse; det fastslår ikke årsagen til enhver tidligere manglende observation eller et tidsmål.

**Samlet installation · 9. november, ca. 15.38–15.40 CET.** PodVoice 2.0.161 er normalmerged
fra PR343 til `0ff3c92f45246e15f903581bc79fd804463ed57f`; officiel kandidat- og main-CI består.
Stabilt tag/release og ARM-image `sha256:5fa5506e12eaafcc293852d93f7075c2d0343e329e9266a1f91f244af2ea271d`
er verificeret. Speakers 0.26.81 er normalmerged fra PR126 til `e8aa656b35e74c74049ed1fe41726524ed6ac499`;
fire kandidatchecks og publicering42635766401 består. Begge arkitekturer genbrugte det reviewede
produkttræ `358969c4b53176cd5fb4180c4bdc1edd225fcf2d`; ARM-image
`sha256:2ec5732123091cce66a505a935b5bbaa93ca764c80f59578b62e75c8f9d7f1ed`.
Root installerede begge via Supervisor med backup. Begge opdateringsdialoger viste installeret
og seneste henholdsvis 2.0.161 og 0.26.81. Bevis: `/private/tmp/green-podvoice-161-installed.png`
og `/private/tmp/green-speakers-081-installed.png`. Spotify viste NONE før installation.
Supervisors butikssøgning timed out i HA, men gennemførte senere; fornyelse af de to update-entiteter
indlæste de reelle tilbud. Ingen gentaget installationskommando ved ukendt udfald.
Timer- og robotrettelser afventer nu målrettet Green-gentest. Speakers indeholder kun den aftalte
kødiagnostik; musik/kø og radio er ikke erklæret rettet.

**Målrettet Green-gentest på 2.0.161 · 9. november, 15.39–15.42 CET.** Root startede en femminutters
timer, åbnede detaljer med 4:48 og observerede aktive −1/+1. +1 gav 5:41 efter den fortsatte
nedtælling, −1 gav 4:30. Annuller ved ca.4:25 fjernede timeren; Ny timer/Senest brugt var tilbage.
`/private/tmp/green161-timer-adjusted.png` dokumenterer de aktive knapper. Dette beviser den
rettede aktive justering på Green; alarmudløb og fysisk iPad er stadig ikke prøvet.

Robotprøven havde en testfejl: root bad agenten åbne en forventet startbekræftelse uden effekt,
men Start er tilsigtet direkte. Ét tryk Start i Gang startede rengøring, observeret Rengør/Bathroom1.
Agenten satte straks på pause, afsluttede rengøringen og bekræftede retur til basen. Root godkendte
oprydningen, og Green viste til sidst Oplader/100 %. Ingen yderligere robothandling. Kilden
`robot-control-panel.js` tilbyder kun bekræftelse ved Stop og retur, ikke Start. Dette må ikke
behandles som runtimefejl eller som bestået fornyelsesprøve. Den planlagte bekræftelsesbevarelse
er stadig ikke gentestet på Green; softwarebeviset består. Root ejer fejlen i testinstruksen.

### Green 9. november kl. 15.48 — kølåsningen lokaliseret på 2.0.161 / Speakers 0.26.81

- Fra pauset Ordinary Things i Køkkenalrum blev køforekomst 2, What Is Hip? - Live, valgt én gang. Valgt række viste Starter; derefter skiftede titlen, mens højttaler blev ubekræftet og kø/pause/lydstyrke blev utilgængelige.
- Ny installeret diagnostik fangede kl. 15.48.24 timeout og `native_health_probe phase=queued`: actor ventede i `Player.RoomMove → captureQueueWriter → radioPrimaryActorState`; worker ventede i `LockTransport → WithStartLock → applyRoomMove`; pipe ventede i faktisk FIFO `File.Write`. Det er nu konkret ejer-/låseevidens, ikke alene et UI-symptom.
- Analyse: passiv radio-readiness bruger writer-inspection, der venter på lås holdt af blokeret lydskrivning; actor bliver dermed utilgængelig for status. Ejer actual_close_evidence implementerer mindste rettelse med faktisk Linux-FIFO regression og uafhængigt review. Ingen rettelse eller ny release er endnu påstået.
- Bevis: `/private/tmp/pc81-queue-immediate-1548.txt`, `/private/tmp/pc81-queue-log-1548.txt`, `/private/tmp/pc81-queue-controls-lost.png`. Testmusik stoppet via Spotify; efterfølgende læsning kl. 15.49 viste NONE. Ingen automatisk gentagelse af køhandlingen.

### Green 2.0.161 — samlet læsende musiknavigation 9. november

Terra gennemgik alle fire faner i separat Chrome uden afspilningshandlinger: Tid på dagen viste tre billedkort, Vibe tre kort, Din musik udvidede 5→10 og Hør igen 5→7. Ved tilbagevenden til Din musik blev alle ti rækker bevaret, og Tid på dagen viste de tre kort direkte. Intet tomt mellemtrin blev observeret i disse snapshots; det er ikke frame-for-frame bevis for fravær af alle flashes. Syv af første ti Din musik-poster viste Omslag ikke tilgængeligt; tre havde billede. Coverkilden undersøges særskilt. Fysisk iPad og komplet godkendt reference-sammenligning står fortsat åbne.

### 9. november — kørettelse 0.26.82 og radioens næste årsagsobservation

- Kørettelsen er uafhængigt reviewet: 899ef8b oven på e8aa656, produkttræ 4e759f76d62aae4949a4bbf9cacfa842a3b70041. PR127 officielle Native/OwnTone/clock-checks og begge imagebygninger består. Normal merge er sendt; installation og faktisk køgentest afventer. Runtimepatch er byte-identisk med reviewet 858b2e8.
- Den downloadede Speakers-backup fra kl.15.37 indeholder afsluttet START phase10/retirement none og matchende FIFO-identitet. Den er taget før shutdown og kan ikke bevise, hvilken efterfølgende kold-start-kontrol der afviser posten. Nuværende kolde proof-funktioner logger ikke første afvisning. Logeksport med 10000 linjer blev prøvet af root IAB og Terra Chrome: dialog lukker, ingen fil/download-event.
- Afgrænset diagnostikbeslutning: næste nødvendige radioobservation er én endelig kategori for første fejlede eksisterende kolde proof-trin samt journaltype/phase/outcome. Brug samme reads/rækkefølge; ingen nye probes, IDs, paths, tokens, ændret adgang eller automatisk afspilning. Den skelner tidligere proces stadig levende, ikke-idle output, FIFO-identitetsmismatch, aktiv writer vs ufuldstændig census, resterende PCM/reader samt journalpersistens. Observationen skal afgøre en konkret årsagsrettelse; diagnostik er ikke en radiofix eller accept. Forberedes separat fra den frosne kørettelse og følger næste nødvendige samlede levering.
- Covers: Terra bekræftede to manglende playlistcovers som faktisk indlæst lokal node-SVG (150×150), ikke ødelagt billede. AI-grafik til personlige playlister er ikke implementeret af den nuværende temabundne fallback og må ikke påstås bevist af F9/F12's temaprøver.

### Green 9. november kl.16.05–16.15 — 0.26.82 installeret, faktisk kømetadatafejl afgrænset

- PR127 merged normalt som ded9b131. Officiel PR-CI og to imagebygninger bestod; main-publisher42640536285 genbrugte præcis produkttræ4e759f76d62aae4949a4bbf9cacfa842a3b70041. ARM64 digest3817e9dd10f0332c533f06d48db9db14ceb497e33be8bf5abd056efd952f3ff9, AMD64 digest648a379de436073df37168bc77ac0dd7820519343a37abfbe924c5864f91184a.
- Green viste Installeret/Nyeste0.26.82 efter normal backup-opdatering; proof `/private/tmp/green-speakers-082-installed.png`. Gammel PodView-fane vågnede og genforbandt uden reload. Jazz in the Background startede Ludlow i Køkkenalrum; touch-pause virkede og Spotify bekræftede PAUSED ved20sek. Testmusikken er på pause.
- Køgentest kan endnu ikke markeres bestået: PodView viser Ingen bekræftet kø at vise, selv om Spotify-read har32 kommende forekomster. Authentificeret PodView-snapshot har queueSelection=true og queue i musicRead. HA get_room_queue_controls returnerer ok/fresh20forekomster, alle metadata_known=false; HA get_queue på samme konfigurationspost returnerer20rigtige navne. Efterfølgende rumlæsning forbliver metadatafalse. Ingen køhandling blev sendt i denne prøve.
- Private læsebeviser: `/private/tmp/pc82-ha-room-queue-full-1614.yaml`, `/private/tmp/pc82-ha-account-queue-1614.yaml`, `/private/tmp/pc82-ha-room-queue-warm-1615.yaml`; UI `/private/tmp/green-pc82-paused-empty-queue.png`. Ejer actual_close_evidence følger URI-/metadataforbindelsen i Control, med bevarede forekomst- og adgangschecks. Det er ikke bevis for, at kølåsningens Green-regression er afsluttet.
- Radioens afgrænsede første-fejl-diagnostik772cd928 er lokalt reviewet og kompileret/prøvet med faktiske LinuxFIFO/proc; ikke publiceret/installeret. Ingen radiopolicy eller afspilningshandling ændres.

**Leveringsaflæsning · 9. november, ca. 16.33 CET.** PodVoice PR #344 er merged på
`75a7852283698c83d45c8dc47bd3d07c12e4c5f6` med samme træ `a0712c18`. Kandidat-CI 42644717603
bestod alle 18 jobs. Main-CI 42645584411 kørte ved aflæsningen.
[PodVoice PR #344](https://github.com/BixelVentures/podvoice/pull/344) ·
[PodVoice main-CI](https://github.com/BixelVentures/podvoice/actions/runs/42645584411)

PodConnect PR #128 er merged på `f67f1bf9de8b3babacbd7645a3881a7eb36b38ac`, træ `f08364b0`.
Kandidatkontrollerne 42644728175 og 42644728190 samt imagebyg 42644733250 bestod på kilde
`991e3da2`. ARM64-digest er `sha256:4c8e996da7bd4cf7994b9bf59a70da5009ef4c4b491c5958a5dda8bcbf07a395`.
AMD64-digest er `sha256:d373ffa002b40f9ac88bb586674eaa5829c5c60a66256dc6c0d5cdf86966ce9b`.
Main-publicering 42645728983 bestod. Control 0.10.39 var endnu ikke synlig som stabil udgivelse.
Ny installation på Green afventer. [PodConnect PR #128](https://github.com/BixelVentures/podconnect/pull/128) ·
[PodConnect-publicering](https://github.com/BixelVentures/podconnect/actions/runs/42645728983)

**Green 2.0.161 · 9. november, 16.21–16.33 CET.** Ved timerudløb viste PodView alarmen. Ét tryk
på »Stop« fjernede alarmvisningen. Hørbarhed er ikke verificeret. Lokale billeder er
`green161-timer-expired-1621.png` og `green161-timer-stop-confirmed-1621.png`.

Ved opvågning kl. 16.27 uden reload bevarede vejret »Sidst kendt« og seks dagsrækker med ikoner.
Frem til kl. 16.33 skiftede hentetid fra 16.18 til 16.28, mens visningen fortsat var mærket
»Sidst kendt«. Lokale aflæsninger er `green161-weather-resume-1627.txt` og `green161-weather-resume-1627.png`.

Kl. 16.33 viste Spotify, at brugeren spillede i Tesla. PodView viste det aktuelle eksterne nummer
og output med hjemmets betjening deaktiveret. Der blev ikke sendt en musikkommando. Lydprøver
afventer, mens brugeren spiller i bilen. Lokale aflæsninger er `green161-external-tesla-1633.txt` og
`green161-external-tesla-1633.png`.

På 2.0.161 gik personlige playlister fra Spotify-cover til lokal SVG, når cover manglede. Den grafiske
mellemfallback er temabundet. Den er fortsat åben for personlige playlister, uden kildeændring i denne levering.

**Leadbeslutning om radiostart på Green · 9. november, 16.47 CET.** Supervisor viste Speakers
0.26.83 som installeret og seneste. Det publicerede image bygger på `991e3da2`. Første kolde
afvisning kl. 16.47.35 var `kind=start phase=10 outcome=retired_known stage=fifo_before_reader
reason=writer_census_incomplete`. Den primære radioklargøring gav derefter HTTP 409 med `start_busy`.
Lokal aflæsning er `pc83-boot-log-1650.txt` og `green-speakers-083-installed.png`.
Radioejeren `radio_teardown_sol` skal i én afgrænset Linux-regression skelne en ufuldstændig procesaflæsning ved kold
opstart fra en faktisk aktiv writer. Hvis prøven ikke skelner dem, dokumenteres den manglende
observation. `UNKNOWN` skal fortsat afvise klargøring. En årsagsrettelse afventer den sondring.

**Opstartsbeslutning for R3 · 9. november, 17.38 CET.** Den stoppede Speakers 0.26.83-backup
viser præcis START.v1, fase 10, `retirement_outcome=none`, `cancelled=false`,
`writer_pending=false` og `move_existing_session=false`. Sti og digest matcher den gamle
kanoniske FIFO, og writerens inode og enhed matcher journalen med registreret writer-epoch.
Tidligere `session_changed` afviste klargøring til pensionering før journalen blev skrevet.
Den primære FIFO flyttes direkte til `/data/media/spotify` med samme konfiguration hos begge
ejere. Den dokumenterede afsluttede START og gyldige pensionerede poster må kun migrere efter
bevist kerneskift, utilgængelig gammel kanonisk FIFO, autentificeret ejerlås og gentaget
inodelåst bevis for tom ny FIFO. Den eksisterende journal-CAS gemmer den kolde START-afslutning
før idle-grænsen åbner. UNKNOWN, ventende pensionering, annullering og upensioneret MOVE forbliver
blokeret. Senere opdateringer på samme kerne kræver begge primære processers fælles kernelås.
Den samlede Speakers 0.26.84-kandidat `60d52667` er uafhængigt reviewet. Den kompilerede
Linux-prøve gendanner den observerede START-form og bevarer den inaktive rute ved næste opstart.
Den officielle Native/OwnTone-kørsel består på samme kandidat. Den inkluderede kørettelse
bevarer den valgte modtager og betjening efter et accepteret køvalg fra pause.
Værtsgenstart, installation og fysisk radioaccept er separate trin.
[PodConnect PR #129](https://github.com/BixelVentures/podconnect/pull/129) ·
[Officiel Native/OwnTone CI](https://github.com/BixelVentures/podconnect/actions/runs/42657776154)

Kl. 16.40 blev en manuel backup på 84,98 MB verificeret lokalt på Green og i Cloud med HA-
indstillinger og alle add-ons, herunder PodVoice 2.0.161 og Speakers 0.26.82. Almindelig download
i både IAB og Chrome gav ingen Mac-fil. Før Speakers-genstart stod den lokale ejer idle. Brugerens
Spotify-afspilning i Tesla blev ladt i fred.

PodVoice 2.0.162 er publiceret som ARM-image
`sha256:49bab5d4a735e8c97517a367a2dcdf07aad6f808753f097c1c7142d98226d522` efter bestået
main-CI 42645584411. PodConnect main-CI 42645728725 bestod, og Control 0.10.39 er publiceret på
`f67f1bf9de8b3babacbd7645a3881a7eb36b38ac`. Installation af PodVoice 2.0.162 og Control 0.10.39
afventer. Coverkandidaten 2.0.163 i PR #345 på `68820266` har uafhængigt review, fokuserede prøver,
4.842 UI-prøver og faktisk Chromium med inert ejer. Officiel CI afventer. Valg af næste installerede
PodVoice-version afventer kandidatens resultat.
[PodVoice main-CI](https://github.com/BixelVentures/podvoice/actions/runs/42645584411) ·
[Control 0.10.39](https://github.com/BixelVentures/podconnect/releases/tag/0.10.39) ·
[Cover-PR #345](https://github.com/BixelVentures/podvoice/pull/345)

**CI og Core-genstart · 9. november.** På coverkandidat `68820266` fejlede Python-jobbet på én
manglende mypy-typeannotering. De øvrige 17 aktive jobs bestod. Rettelsen er pushet som
`d5f0339af92b670f0cf02fbba94930c0e55f83df`, og officiel CI 42649918164 er i gang.
Control 0.10.39 blev downloadet. HA genforbandt automatisk efter Core-genstart. Integrationssiden
viste kl. 17.00 den indlæste version 0.10.39, syv enheder og syv entiteter uden opsætningsfejl.
Køgentest med versionen afventer. Lokalt billede er `green-control039-loaded-1700.png`.
Den eksisterende Flow-fane gik fra Ro til Forside ved ét tryk uden reload. Forsiden viste frisk
8° og Let skyet, robotten Oplader/100 %, Tesla 66 % og låst samt konfigureret Køkkenalrum.
Spotify-aflæsningen viste `NONE`. Aflæsningen var lydfri.
[Første CI-kørsel](https://github.com/BixelVentures/podvoice/actions/runs/42648333910) ·
[CI på rettelsen](https://github.com/BixelVentures/podvoice/actions/runs/42649918164)

**PodVoice 2.0.163 · 9. november.** PR #345 er normalmerged på
`352e7e01134f65bf2dde0f4333656cef43e8e118` med træ `3aa458b`. Alle 18 kandidatjobs bestod i
42649918164. Main-CI 42650974279 og imagepublicering 129279610104 bestod. ARM-imageindeks er
`sha256:3fda727e521944eda4e4dbe0b909b091c0178a4e17ea988574d34f539ebdf684`.
Supervisor viste 2.0.163 som installeret og seneste omkring kl. 17.14 efter opdatering med backup.
Lokalt installationsbillede er `green-podvoice163-installed.png`. Green-prøverne følger nedenfor.
[Cover-PR #345](https://github.com/BixelVentures/podvoice/pull/345) ·
[Main-kontrol](https://github.com/BixelVentures/podvoice/actions/runs/42650974279)

**Cover og kø på Green 2.0.163 · 9. november, 17.15–17.19 CET.** De første fem covers i Din musik
var indlæst. Tre var lokale SVG'er med billedbredde 150 px, og to var Spotify-billeder på 300 px.
Den grafiske mellemfallback blev ikke observeret i denne aflæsning. Lokalt billede er
`green163-personal-playlist-covers.png`.

Hør igen startede »Tidsrejsen« på Køkkenalrum. Touch-Pause gav observeret `PAUSED` hos Spotify.
Vibe-valget Lounge startede »Voyage Voyage«, og køen viste 20 navngivne rækker med covers.
Kl. 17.19 gav ét tryk på række 2, »Rein Me In«, en afvisningsbesked. »Voyage Voyage« fortsatte
med tilgængelige kontroller. Ét efterfølgende touch-Pause viste pausen i PodView og hos Spotify
på Køkkenalrum. Der kom ingen automatisk gentagelse. Lokale billeder er
`green163-queue-20-before-choice.png` og `green163-queue-denied-paused.png`.
Genoprettede labels er observeret. Dette valg endte med afvisning. Den præcise afvisningsfase
for trykket mangler, og musikagenten lokaliserer den i eksisterende diagnostik.

**Aktuel hovedfejl på Green 2.0.163 · 9. november, 17.27–17.30 CET.** Ét tryk kl. 17.27.55
på første kø-række, »Losing My Religion«, gav accepteret svar. HA-kaldene svarede 200, og
kvittering `c390970d6b040d9f` viste `stage=validate_receipt` og `dispatched=true`. Spotify
bekræftede det valgte nummer som `PLAYING` på Køkkenalrum. Derefter viste PodView ubekræftet
output, deaktiverede kontroller og tom kø. Det afgrænser hovedfejlen til det, der sker efter et
accepteret køvalg. Køejeren `cover_fallback_sol` følger den efterfølgende ejerlæsning.

Spotify Pause gav `REQUESTOUTCOMEUNKNOWN`. To friske aflæsninger viste fortsat `PLAYING`.
Lead stoppede Speakers 0.26.83 via Supervisor. Omkring kl. 17.30 viste Supervisor »Stoppet«,
og Spotify viste `NONE`. Speakers er bevidst stoppet af hensyn til stilhed. Lead ejer
genoptagelse efter rettelse. Lokale beviser er `pv163-queue-live-bracket-1727.txt`,
`green163-accepted-queue-control-lost.png` og `green-speakers83-stopped-after-queue-lock.png`.

**Afgrænset årsagsbevis for køfejlen.** En Linux-prøve med den faktiske C-ejer fra Speakers
0.26.83 etablerede PCM/RTP og bekræftet Pause. En gyldig køkvittering fjernede den bevarede pause,
mens den forsinkede STOP-callback stadig kunne køre. Da prøven udløste callbacken før ny PCM,
sendte C TEARDOWN og mistede den samme AirPlay-session og epoch. Det reproducerer en konkret
årsag til kontroltab efter accepteret køvalg. Lokalt logbevis er `pc83-paused-queue-wire-red.log`.
Kandidaten `6fdf186f` fører pausebevarelsen videre ved køvalg på præcis samme ejer og rute efter
sidste writer-, udløbs- og ejerskabskontrol. Uafhængigt review og Linux-prøven med inert AirPlay-
modtager bestod. Samme writer leverede fortsat RTP, 15 friske ejerlæsninger bestod, og et nyt
eksplicit Pause-tryk virkede. Lokalt logbevis er `pc83-paused-queue-wire-green-final.log`.
Rettelsen er samlet med radioens opstartsrettelse i Speakers 0.26.84. PR #129 er normalt
merget som `7092587f792d7647f7bace58142b435f967a233e` med base `f67f1bf9`, reviewet
head `60d526` og verificeret træ `7066cb`. Mainpublisher 42659063643 bestod og genbrugte det autentificerede produkttræ `dca9fc803bd83944650267d40a1703b8114f572c`.

**Green-installation · 9. november, ca. 17.56 CET.** Home Assistant viste Speakers
0.26.84 som både installeret og seneste version (`green-speakers84-installed.png`).
Add-onen stod fortsat Stoppet efter den tidligere manuelle standsning. En frisk Spotify-
aflæsning viste brugerens afspilning på Tesla. Ingen agentkommando blev sendt til Spotify.

Den automatiske godkendelseskontrol afviste den første anmodning om fuld værtsgenstart
ca. 17.58. Brugeren godkendte derefter udtrykkeligt genstarten. Lead udførte én fuld
Green-værtsgenstart kl. 18.03. Green var tilbage, og Speakers startede kl. 18.07.39.
HA viste 0.26.84 Kører (`green-speakers84-after-reboot.png`). Den oprindelige Mac-fane
genforbandt automatisk kl. 18.10. Begge forbindelsesbannere forsvandt, og vejret viste
7° Skyet, uden genindlæsning eller tryk på Prøv igen. iPad er uprøvet.

Kl. 18.11 var alle fem radioknapper P3, P1, P4, P6 og P8 aktive på den konfigurerede
Køkken-højttaler uden radiobanner (`green84-radio-readiness1811.png`). Kontrollen var
læsende. Kl. 18.31 på Green 2.0.164 og Speakers 0.26.84 var de samme fem knapper
fortsat aktive på Køkken uden fejl efter 30 sekunders passiv ventetid og efter
Forside → Radio. Ingen station blev valgt, og ingen lyd blev afspillet. Prøven målte
hverken polling eller netværkstrafik. Afspilning, lyd og køgentest afventer.

PodVoice 2.0.164 er publiceret fra main `cbae9b26`. Main-CI 42660667755 og publiceringen
bestod på det samme træ. Imagedigest `sha256:c9b2d97ae88fc3b7d4476ea56d6cb32ceea327a387341a9e23111dac0c6a033f`.
Home Assistant bekræftede derefter 2.0.164 som installeret og seneste version, »Opdateret«,
og appen kørte. Opdateringen gik gennem det normale HA-flow med backup markeret.

**Læsende Green-navigation · 9. november, 17.36 CET.** Efter en frisk HA-login åbnede den
eksisterende Burgerboller-widget trin 2 af 5 med én af ti ingredienser markeret. Tilbage i
kataloget åbnede Brød og bagværk Scones med billede, 13 ingredienser og fem trin. Retur bevarede
kategorien og de samme fem rækker. Hele listen passede i visningen, så scroll blev ikke prøvet.
Forløbet understøtter G1 på Mac og den allerede beståede O5. Sammenligning med den godkendte
reference og iPad står fortsat åbne for O6. Ingen enhedskommando blev sendt.

En efterfølgende prøve i det fulde katalog »Alle« rullede til K med Scones og Uploadhistorik
synlige. Scones → Tilbage bevarede »Alle«, men nulstillede læsepositionen til toppen ved aktiv
Burgerboller og C. Samme detaljeovergang blev genskabt i Chromium med 2.0.163, hvor 600 px
blev til 0 px. Med rettelsen `20970ed5` bevarede den pakkede softwareprøve alle 600 px,
kategorien »Alle« og den aktive Burgerboller-session. Prøven brugte inerte afhængigheder.
På installeret Green 2.0.164 beholdt Scones → Tilbage kategorien Alle og den samme
læseposition med aktiv Burgerboller. Scones stod fra y=854 til 950 i en 1094 px høj
visning både før og efter. Returens position er verificeret i DOM.

Kl. 17.38 blev der oprettet en krypteret lokal Green-backup på 520 KB kun af Speakers 0.26.83
med navnet »Custom backup 2026.8.2«, mens add-onen stod stoppet. Backupen indeholder ingen HA-data
eller andre add-ons. Download lykkedes til `/Users/madsbachandersen/Downloads/custom_backup_2026_8_2.tar`.
Radioejeren verificerede i den stoppede 0.26.83-backup `START.v1`, fase 10, retirement `none`,
`cancelled=false` og `writer_pending=false`. Migreringen skal omfatte denne afgrænsede historiske
post før installation. De øvrige krav til uafhængigt boot-, layout- og writerbevis gælder fortsat.

**Læsende Tesla-sammenligning · 9. november, 17.42–17.43 CET.** Green 2.0.163 viste
sidst kendt kl. 16.59, låst bil, 66 % og 253 km. HA viste låst bil, lukket bagagerum,
66 % og 252,86 km. Klima var slukket med mål 20 °C. PodViews 17,3 °C matchede den
separate kabinetemperatursensor. Klimaentiteten viste 17,5 °C i sit eget felt.
Temperatur, afrimning og sædevarme forblev deaktiveret efter retur og genåbning.
HA viste ladekabel frakoblet og 0 kW. Forbindelsessensoren stod OFF, og HA viste
ikke et særskilt tidspunkt for denne observation. Dvale er derfor stadig uafklaret.
Ingen bilkommando blev sendt. B1, B3, B7 og B11 forbliver åbne. B6 var allerede bestået.

**Robotkladde på Green 2.0.163 · 9. november.** De tre rengøringstyper var synlige, og
Støvsug og vask samt Vask viste Lav, Mellem, Høj og Extreme. Vandmængde stod før Rute
og Antal gange. Kun 1× og 2× blev tilbudt. Vedligeholdelse startede lukket med fire
kompakte rækker, og Filter viste, at vedligeholdelsesintervallet var nået. Ved skift
fra Vask tilbage til Støvsug viste kladden Balanceret, selv om den oprindeligt viste
Stille. Prøveren valgte Stille igen og verificerede Gang, Støvsug, Stille, Standard,
1× og Oplader. Ingen robotkommando blev sendt, og Extreme som faktisk niveau 30
blev ikke prøvet.

Tidlig fornyelse efter en kildeopdatering genskabte fejlen med samme enhed og rum.
En anmodning med `renewTaskId` og Vask-kladden fik `rebind:not_restored` og
`draft:restored`. Kladdens aktuelle tilstand blev gendannet, men da panelet blev
oprettet igen, mistede det de øvrige typers kladde. Tilbage i Støvsug stod derfor
Balanceret. Reproduktionen gav ingen writes. Den eksisterende browserprøve fejler på den gamle
2.0.163-bundle, fordi den genskabte formular viser Balanceret. Log: `podvoice-robot-mode-regression-red-20261109.log`.

Rettelsen `88d9d2e9` bevarer de synlige, uafsendte kladder for samme enhed og rum.
Pakket Chromium med inert robot bekræftede Støvsug/Stille → Vask → tidlig fornyelse
efter kildeopdatering → Støvsug/Stille. Fornyelsen beholdt kladden, og delprøven sendte
ingen robotkommando. På installeret Green 2.0.164 skiftede prøveren fra Støvsug/Stille
til Støvsug og vask/Balanceret/Mellem og tilbage til Støvsug. Stille kom tilbage
automatisk. Gang, Standard og 1× var bevaret, og robotten viste Oplader. Ingen
robotkommando blev sendt. Green-prøven viste typeskiftet. Den præcise fornyelse med
ny formular er bevist i Chromium med inert ejer.

**G3 og main-CI.** PR #347 bestod CI 42664388828. Efter merge fejlede kun
musikjourney-jobbet i main-CI 42665247165. `manualRetryJourney` stoppede på linje 670
under den indledende Pause, før G3's fejl og manuelle genoprettelse. Ved fejlen stod
musikken som playing, og begge lister for forespørgsler og writes var tomme. Årsagen
til den manglende indledende Pause er uafklaret. Det separate A1-forløb med faktisk
Pause i Chromium er bevaret.

G3-fixturen starter nu med en allerede observeret pause hos den inerte ejer. Den
fokuserede prøve på uændret 2.0.164-bundle `02da7206` bestod med 503, et betroet tryk
på Prøv igen, præcis én manuel snapshotlæsning og bevaret opskriftsforløb og
pausebinding. Prøven sendte ingen handlings-POST eller native writes under recovery.
Log: `podvoice-g3-fixture-hardened-20261109.log`. Produktkode og acceptstatus er uændret.

**O6 på Green 2.0.164.** Widgetten viste Burgerboller I gang og åbnede trin 2 af 5.
Ingredienser gik fra lukket til åben med den bevarede vandmarkering, én af ti, og to grupper.
Trinene var nummererede. Om opskriften viste Meyers, udbytte, tider og kilde-URL. Begge
sektioner blev lukket igen. Scones viste samme Hero- og tokolonnemønster som Arla-referencen
med anden opskrift og visningsstørrelse. I kataloget lå Uploadhistorik under sidste opskrift.
Udfoldet viste den den faktiske Gemt-post fra 9. november kl. 13.39 med titel og status til
venstre og dato til højre uden overlap. Sektionen blev lukket igen. Ingen upload eller Prøv
igen blev udløst. Observationerne bekræfter de konkrete strukturer. Pixelmatch og fysisk
iPad står åbne. Referencebillederne `upload-history-local.png` og `arla-import-local.png`
hører til `UI-DELIVERY-GOAL.md:2713–2715` i PodView og ligger i visualizations-mappen
`2026/11/03/01a1a151-583d-75c2-b237-f8f7f222d5be`.

**Green · 10. november, kl. 09.00–09.05 CET.** HA viste PodVoice 2.0.164 og Speakers
0.26.84 kørende. Før radioforløbet viste en frisk Spotify-aflæsning NONE. Efter at HA
havde genforbundet, viste fanen fra aftenen før Adgang mangler. Den kørte stadig
klient 2.0.163 mod server 2.0.164. En frisk PodView-fane virkede. Ét tryk på Prøv igen
i den gamle fane viste straks Forbundet uden fuld genindlæsning eller enhedshandling.
Den berørte adgangslogik var uændret mellem udgivelserne. Ejeren af den oprindelige
afvisning er uafklaret. Forløbet verificerede ikke alle bevarede valg i G3.

På den friske 2.0.164-fane viste ét P3-tryk kl. 09.03 først Starter og derefter P3
Valgt, Stop radio og Spiller på Køkken. Ét tryk på P1 skiftede til P1 Valgt med samme
output. Efter et eksplicit Stop radio viste afspilleren den tomme Vælg musik-visning
med Køkken fortsat konfigureret. Slutvisning: `green164-radio-stop-20261110.png`.
Det er faktisk Green-feedback for start, skift og stop. Fysisk lyd, de aftalte
tidsgrænser og eksplicit Spotify-retur blev ikke prøvet i dette forløb.

**Køgentest på Green · 10. november, kl. 09.10.** Efter radiostop åbnede Morning Coffee
Spotify-afspilning på Køkken med Tom and Jerry af John Mayer i PodView. Ved touch-Pause
bekræftede Spotify PAUSED efter 11.170 ms. Køen viste 20 rækker. Ét tryk på første række,
Kiss Me, gav spinner og derefter Sidst kendte kø / Ingen bekræftet kø. Spotify forblev
PAUSED på Tom and Jerry. Handlingen blev ikke gentaget. Slutvisningen er
`green164-paused-queue-failure-20261110.png`.

Speakers-loggen `pc84-morning-log-20261110.txt` viser 409 på `reacquire` kl. 09.11.03.
Det delte endpoint alene knytter ikke afvisningen til køtrykket. PodViews viste log
manglede tidsvinduet omkring 09.10, og download blev ikke indfanget. Den manglende
observation er den konkrete `queue_command`-kvittering med stage, dispatched og outcome.
Denne gentest er en anden observeret sluttilstand end accepteret køvalg med efterfølgende
kontroltab på 0.26.83. Køvalget står fortsat åbent.

## Fælles tilstande og overgangsregler

| Tilstand | Forventet adfærd |
|---|---|
| Første åbning, ingen data | Stabil plads til det godkendte indhold; neutral loading. Ingen opdigtede værdier eller tomme kø-rækker. |
| Kendte data, opdatering i baggrunden | Bevar indhold, covers, scroll, valg og åbne accordions; ingen blink eller midlertidig låsning. |
| Eget tryk afventer svar | Vis valget straks. Skeln brugerens ønskede tilstand fra bekræftet effekt; ingen global ventelås. |
| Bekræftet effekt | Afstem med den autoritative kilde uden at gammelt svar ruller et nyere valg tilbage. |
| Afvist eller fejlet handling | Kort konkret feedback; bevar seneste bekræftede data og mulighed for et nyt relevant tryk. |
| Ukendt udfald / timeout | Ingen automatisk gentagelse. Et nyt eksplicit tryk er en ny handling; almindelig opdatering fortsætter. |
| Forbindelsen mistes | Bevar sidst kendte data med tidspunkt; forbind automatisk igen. Foregiv ikke succes eller gem offline-tryk til senere afvikling. |
| Kilden bekræfter tomt indhold | Vis den relevante tomme tilstand; timeout, manglende felt og transportfejl er ikke en tom liste. |
| Reel manglende adgang eller funktion | Forklar konkret hvorfor netop handlingen er utilgængelig. Baggrundsrefresh er ikke manglende adgang. |
| # | Historie | Bevis og rester |
|---|---|---|
| G1 | Jeg åbner PodView i HA på Mac eller iPad → eksisterende HA-login giver den aftalte betjening uden ekstra skærmregistrering eller manuelt refresh | Delvist bevist — VEHICLE_RECOVERY_TEST på samlet bundle cac4be37: kold Chromium-åbning med supervisor-autentificeret HA-aktørfixture giver betjening uden navngiven skærmregistrering. 60 HA-ingress-kontrakttests dækker adgangsgrænsen. Eksisterende HA-login gav faktisk betjening i Green-browseren. Kold åbning og genoptagelse i iPad-appen afventer. |
| G2 | iPad går i dvale, appen sættes i baggrunden eller nettet forsvinder → ved genåbning gendannes forbindelse og aktuelle data automatisk, uden at miste lokale valg | Delvist bevist — VEHICLE_RECOVERY_TEST på samlet bundle cac4be37: netværk offline/online, lukket SSE og faktisk 503→200 genopretter Tesla-funktioner automatisk uden retry-tryk; samme aktive opskrift, ejer/session og trin bevares. Recipe-journey bevarer også ingrediensvalg, accordion og scroll. Den eksisterende Green-fane genforbandt efter add-on-genstart uden reload. En fysisk iPad-prøve med dvale og bevarede valg afventer. |
| G3 | Jeg bruger »gendan funktioner« → forbindelsen genoprettes uden at nulstille valg, starte musik eller gentage tidligere handlinger | Bestået mod det skrevne logik-/UI-kriterium på 2.0.166. Uafhængig gennemgang knytter de konkrete assertions i tests/browser/music_actual_e2e.cjs:656–759 til officiel CI42800322702. Kontrollerede ejere er inerte; dette lukker ikke rigtig musikstart, fysisk outputflytning eller robotbevægelse. Tidligere observation og dens begrænsning: Delvist bevist — pakket Chromium med inert HA. Efter et simuleret 503-svar gav det viste »Prøv igen« ét nyt snapshot-opslag. Opskriftsvalg, trin, afkrydsning og den pausede musiks binding blev bevaret. Der blev sendt nul handlingskald under genoprettelsen. Green viste Forbundet efter ét Prøv igen i den gamle fane uden fuld genindlæsning eller enhedshandling. Bevarede valg ved denne konkrete adgangsfejl og den oprindelige afvisningsårsag er uafklarede. |
| G4 | Jeg skifter side og vender tilbage under opdatering → indhold og placering bevares; ingen skeleton/empty-state-flash | Bestået mod det skrevne logik-/UI-kriterium på 2.0.166. Uafhængig gennemgang knytter de konkrete assertions i tests/browser/recipe_actual_e2e.cjs:362–408 til officiel CI42800322702. Kontrollerede ejere er inerte; dette lukker ikke rigtig musikstart, fysisk outputflytning eller robotbevægelse. Tidligere observation og dens begrænsning: Delvist bevist — pakket 2.0.150 i Chromium med inert katalog og køejer. Hør igen beholdt ti rækker og 464 px scroll over passiv læsning og faneskift. Ved genåbning af køen stod de samme kendte rækker og den samme DOM-række under holdt læsning og efter 503, uden tom tilstand. Opskriftskatalogets manglende scrollbevarelse via Forside blev reproduceret (920→0) og rettet i d28c5831. Pakket bundle 4ed3dc2f viser efter 11,5 ms de samme ni rækker, åben afslutningshistorik og 920 px, både mens den faktiske kataloglæsning holdes tilbage og efter dens JSON er behandlet. Ingen loading-/tom erstatning i de målte frames. Andre konkrete bevarede tilstande fremgår af S8, L2, V1–V4, B3/B8, T2 og Q2; de er ikke én påstand om alle tænkelige navigationer. Fysisk skærm er ikke prøvet. Green 2.0.163 bevarede Alle efter Scones→Tilbage, men nulstillede kataloget fra K til toppen. Pakket Chromium genskabte 600→0 px før rettelsen og bevarede 600 px, Alle og den aktive Burgerboller-session efter `20970ed5`. Den samme returvej bestod på installeret Green 2.0.164 med Scones i samme DOM-position før og efter. Øvrige aftalte G4-flader vurderes særskilt. |
| G5 | Et ældre svar ankommer efter et nyere svar eller efter skift af konto/output → det overskriver ikke nyere tilstand og sender ingen handling til det gamle mål | Bestået mod historiens konkrete acceptkrav — verificeret i officiel 2.0.166 CI42800322702 med rigtig browser og kontrolleret fejlkilde; eksisterende relevante Green-observationer genbruges. Der kræves ikke fysisk fremprovokation af denne fejlgren. Tidligere evidens: Delvist bevist — pakket 2.0.150 i Chromium med inert ejer. En nyere HA-hændelse opdaterede titlen, mens et ældre afspilningssvar var holdt. Da det gamle svar kom, blev titlen stående. Efter outputskift blev et stadig gyldigt køsvar fra den gamle session forkastet, nyt tilbud og rækker blev bevaret, og ejeren modtog ingen ny kommando. Kontoskift er også bevist i pakket 2.0.153 med MUSIC_ACCOUNT_ROLLOVER_TEST: A’s svar ankom efter 176 ms inden for sin gyldighed på 4.999 ms, men blev forkastet. B’s tilbud og rækker blev bevaret på samme output; efter et nyt tryk modtog den inerte ejer én effekt for B og nul for A.|
| G6 | UI sammenlignes i bibliotek, produkt, Mac og HA-appens iPad-webview → samme godkendte komponenter, layout, fokus, touchmål og tilstande; tastaturfokus bevares | Delvist bevist. Bibliotekets produktpreview bruger samme indgang, WidgetHost, RecipeView, VehicleView og kit som produktet. Opskriftsreference og Tesla-afvigelser er dokumenteret i O6/B10. Samlet Mac/iPad-webview-sammenligning af layout, tastaturfokus og touchmål er åben. |

Ingen lydprøver mellem 18–08 Europe/Copenhagen; heller ingen installation/genstart, der kan genoptage lyd.
Softwareprøver bruger isolerede adaptere uden fysiske sideeffekter. Efter tilladte lydprøver stoppes testmusikken.


## Afspiller

| # | Historie | Bevis og rester |
|---|---|---|
| A1 | Musik spiller → jeg trykker pause → knappen viser "Fortsæt" < 100 ms, musikken stopper < 1 s, knappen bliver aldrig grå | Delvist bevist — music: ægte browsertryk → knap < 100 ms (målt 7,7–15,8 ms), ingen grå knap under forsinket svar/refresh; fysisk stoptid ikke målt |
| A2 | Musik er sat på pause → jeg trykker afspil → samme som A1 omvendt | Delvist bevist — MUSIC_RENEWED_CONTROLS_TEST på samlet bundle cac4be37: fortsæt efter reelt adgangsudløb viser ønsket afspilning efter 13,5 ms under holdt svar; én inert kommando og korrekt efterfølgende observation. Fysisk genoptagelsestid er ikke målt. |
| A3 | Musik spiller → jeg trykker næste 3 gange hurtigt → der springes 3 sange frem, skærmen viser den nye sang < 1,5 s efter sidste tryk | Delvist bevist — music: tre hurtige browsertryk giver tre simulerede ejerkommandoer, titel efter sidste tryk 695 ms; fysisk afspilning ikke målt |
| A4 | Jeg trækker i lydstyrken → slideren følger fingeren uden at hoppe tilbage, lyden ændres < 1 s | Delvist bevist — MUSIC_RENEWED_CONTROLS_TEST på samlet bundle cac4be37: volumen viser ønsket værdi efter 14,5 ms under holdt svar; én kommando til samme output og korrekt ejerobservation efter frigivelse. MUSIC_VOLUME_DRAG_TEST på pakket 2.0.153 beviser fem kontinuerlige touchbevægelser til 82 %: en forsinket observation på 23 % ændrer ikke skyderen under trækket; nul kommandoer før slip, derefter én kommando på 82 % og matchende inert ejerobservation. Fysisk lydændring under 1 s er ikke bevist. |
| A5 | Jeg trækker i tidslinjen → sangen spoler, tiden springer ikke tilbage | Delvist bevist — MUSIC_SEEK_TEST: faktisk browsertræk → Python-broker → simuleret ejer; spoling under afspilning/pause, fastholdt position under refresh og UNKNOWN uden gensendelse. Poll-race mellem tilbud og frisk læsning er rettet med én afgrænset læseafstemning og kausal regression. Rigtig Spotify/fysisk effekt ikke prøvet |
| A6 | Nogen ændrer musikken fra Spotify-appen → skærmen viser det < 1,5 s | Delvist bevist — publiceret Speakers 0.26.72 / Control 0.10.38 (merge 0aa8f1c) bruger eksisterende Speakers-læseforbindelse til at fremrykke Control-læsningen ved native nummerskift, pause, fortsæt og spoling. Faktisk Go-manager + Home Assistant mod allerede opdateret inert Spotify-kilde: alle fire overgange under 1,4 s, én providerlæsning pr. overgang og nul handlinger. Dubletter, gamle signaler, overlappende læsning, engine-identitetsgenopretning og polling-fallback består. PodViews separate browserprøve viser 25–30 ms fra HA-hændelse og afviser gammel læsning. Officiel HA-, Go-race- og publisher-CI bestod, begge Speakers-images er verificeret, og Control-tag 0.10.38 peger på samme merge. Installation og hele Spotify-app → PodView under 1,5 s, cloudens opdateringstid, eksternt output og fysisk afspilning er ikke bevist. På Green 2.0.161 fulgte PodView brugerens faktiske nummer og Tesla-output kl. 16.33. End-to-end-tiden fra Spotify-ændringen blev ikke målt. |
| A7 | Netværket falder ud og kommer igen → sidst kendte sang bliver stående, knapperne virker igen uden genindlæsning | Bestået mod det skrevne logik-/UI-forløb på 2.0.166: music_actual_e2e.cjs:1324–1384 og root-live-media-view.test.mjs:108. Testet med inert ejer; dette lukker ikke rigtig musikstart eller bevægelse. Tidligere præcis evidens: Delvist bevist — music: mistet accepteret pause-svar efterfulgt af browser-offline; genforbindelse læser simuleret ejer igen med samme sang/output og faktisk pausetilstand uden gensendelse. Nye eksplicitte fortsæt/pause-tryk efter samme genforbindelse når den simulerede ejer præcis én gang hver uden reload; fysisk effekt ikke prøvet. Komponentprøven i 47c698b9 bevarer sang og cover som Sidst kendt ved udløbet læsning for samme pausede ejer. Knapperne er låst indtil frisk observation, og en ændret ejer eller rute genbruger ikke visningen. |
| A8 | Jeg starter musik i Spotify på hjemmets højttaler → PodView viser titel, cover og output og kan pause/fortsætte uden først at starte musikken selv | Delvist bevist — pakket 2.0.155 i Chromium med inert musikejer: ekstern start giver titel, Køkkenalrum og et synligt afkodet 64×64-cover fra afspilningsobservationens Spotify-albumreference. Ved faktisk ejeropdatering 9→10 bevares samme billednode, URL, dimensioner og synlighed uden src/class/style/hidden-mutation. Nul lokale starthandlinger; derefter én pause og én fortsæt ved eksplicit touch på samme native rum. Billednetværket er inert; rigtig Spotify/CDN og fysisk effekt er ikke prøvet. |
| A9 | Jeg trykker pause, fortsæt og pause under et langsomt svar → trykkene håndteres i rækkefølge, sidste intention respekteres, ingen knap låses af polling | Delvist bevist — music: tre browsertryk giver pause/resume/pause hos simuleret ejer, korrekt sidste label, ingen disabled-blink; fysisk lyd ikke prøvet |
| A10 | Musik har spillet i 10 minutter med løbende refresh → pause, næste og lydstyrke virker stadig; ingen udløbet kontroladgang | Delvist bevist — MUSIC_LONG_SESSION: 600 s reel tid, 263 simulerede ejerlæsninger, ingen automatiske effekter; pause/næste/volumen/fortsæt når ejer én gang både efter ventetid og luk/genåbn browser. Rigtig Spotify og fysisk lyd ikke prøvet |
| A11 | En start fejler eller ender ukendt → skærmen hænger ikke permanent på det ønskede nummer og hævder ikke bekræftet afspilning; ny eksplicit handling er mulig | Bestået mod det skrevne logik-/UI-forløb på 2.0.166: pv166-a11-exact-20261110.log:15, eksakt bundle a07a0bae. Testet med inert ejer; dette lukker ikke rigtig musikstart eller bevægelse. Tidligere præcis evidens: Delvist bevist — collection-selection: direkte UNKNOWN, korreleret UNKNOWN efter accept og svar under disconnect tillader nyt eksplicit valg med ny kandidat/opgave/request; gammel effekt gensendes ikke passivt. Browser med mistet accepteret svar prøvet; fysisk effekt ikke prøvet |
| A12 | Stemme starter musik → PodView viser samme konto/output; jeg vælger i køen og pauser med touch → hele forløbet styrer samme session | Delvist bevist — pakket Chromium og rigtig Thin/ToolRouter med syntetiske stemme- og godkendelseshændelser. Accepteret stemmestart ændrede først den viste titel ved særskilt afspilningsobservation. Anden af to køforekomster med samme URI blev valgt præcist. Pause og fortsæt brugte samme konto, output og native sessionsvidne efter fornyet rutebinding. HTTP-integrationen verificerer også separat start- og pausesettlement samt idempotente kvitteringer. PodConnect/HA-I/O er inert. Rigtig Voice PE, Spotify, native udførelse og fysisk lyd er åbne. |
| A13 | Pause/fortsæt, næste/forrige og volumenkontrol bruges efter adgangsfornyelse → ingen venten på »observeret musik« før visuel feedback; korrekt effekt følger de respektive tidsmål | Delvist bevist — pakket Chromium med inert ejer: efter oprindeligt adgangsudløb giver pause/fortsæt, næste/forrige og volumen synlig feedback efter 11–15 ms, mens kommandoen er holdt og den gamle ejerobservation stadig gælder. Efter frigivelse ses korrekt ejerobservation inden for 31–51 ms fra tryk/slip. Én kommando pr. input til samme output, ingen kommando ved fornyelse. Rigtig Spotify og fysisk lyd/tidsmål afventer prøve. |
| A14 | En musikstart afbrydes midt i klargøring → gammel session ryddes korrekt op, og en senere eksplicit start kan gennemføres uden at genstarte HA | Bestået på softwareovergangen: endelig Speakers84-kilde60d5266, officiel CI42657776154/job129303580726 beviser præcis staged-cancel, stale Commit-afvisning før/efter ny START35 og seks faktiske C→inert-modtager RTP-pakker. Sammen med166 HTTP-annullering dækker det det skrevne forløb. Relevante Native/C-/fixturebytes er uændrede i85. Ingen fysisk lydaccept. Tidligere evidens: Delvist bevist — faktisk PodView HTTP og MusicControlFacade mod inert PodConnect-adapter. Skift af adgang under tilbageholdt klargøring annullerede det præcise tilbud, sendte ingen start og afviste gammelt valg. Et nyt eksplicit valg fik frisk sekvens og startede én gang. Afspilning blev først bekræftet ved separat observation. PodConnect PR112 har separat officiel HA-framework-CI med inerte Speakers. Supplerende officiel PodConnect-CI 42489503428 på 7f7931f beviser nu faktisk Native/C-oprydning: en klargjort inert dekoder lukkes præcis én gang ved annullering, gamle Commit afvises før og efter et nyt eksplicit valg, og det nye valg når START35 og krypterede RTP-pakker ved simuleret modtager. Rettelsen fjerner en sen tildeling, som kunne genindsætte den allerede lukkede dekoder efter annullering. Fysisk afspilning er åben. |

## Kø

| # | Historie | Bevis og rester |
|---|---|---|
| K1 | Jeg åbner afspilleren → kommende sange vises straks (kendte) og opdateres i baggrunden; aldrig tom liste mens den henter | Delvist bevist — MUSIC_QUEUE_IDENTITY_TEST på pakket 2.0.151: et faktisk touch genåbnede den kendte kø med to bevarede rækker i første synlige frame efter 10,9 ms, uden placeholder, mens det nye køsvar var tilbageholdt. Den lokale ejer var inert. På Green med Speakers 0.26.82 viste PodView ingen bekræftet kø, mens HA's rumsvar havde 20 forekomster med metadata_known=false. Kontolæsningen havde 20 navne. Green 2.0.163 viste 20 navngivne kø-rækker med covers. Første synlige frame ved åbning af den kendte kø afventer måling på Green. |
| K2 | Sangen skifter → køen rykker op uden at listen blinker | Delvist bevist — QUEUE_PERSISTENCE_TEST: faktisk browser/simuleret ejer; fixture med bevarede opaque forekomst-ID’er flytter rækker frem med samme DOM-række, mindst to synlige kommende rækker i 20 overgangsframes. Native ID-kontinuitet efter valg er kausalt testet og publiceret i Speakers 0.26.68; automatisk Spotify-sangskift og fysisk effekt ikke prøvet |
| K3 | Jeg trykker på en sang i køen → den spiller < 1,5 s | Delvist bevist — MUSIC_QUEUE_IDENTITY_TEST på pakket 2.0.151: touch på anden forekomst gav præcis én effekt hos inert native-ejer efter 8,0 ms; særskilt observeret afspilning og titel blev vist efter 25,7 ms. Rigtig Python-broker, men simuleret musikejer; tidsmålet for rigtig Spotify og fysisk lyd er åbent. 0.26.82 er installeret efter den reviewede rettelse af Native-låsen. Green-gentesten nåede ingen valgbar række på grund af manglende metadata i rumsvar, så der blev ikke sendt et køvalg. Green 2.0.163 viste navngivne rækker. Ét tryk på række 2, Rein Me In, blev afvist. En senere Green-prøve accepterede række 1, Losing My Religion. Spotify observerede det korrekte nummer på Køkkenalrum. Tidsmålet er ikke målt, og efterfølgende ejerstatus i PodView stod ubekræftet. På Green 2.0.164 med Speakers 0.26.84 gav ét tryk på Kiss Me fra pause intet observeret sporskift. Spotify forblev pauset på Tom and Jerry. Den præcise handlingskvittering mangler. |
| K4 | Auto-fortsæt spiller videre → vis kommende sange, når kilden leverer dem; opfind ikke fremtidige sange og forveksl ikke manglende kødata med stoppet musik | Softwareprøve — MUSIC_QUEUE_IDENTITY_TEST på samlet bundle cac4be37: inert ejer fortsætter uden browserhandling; utilgængeligt køtilbud bevarer tidligere rækker som sidst kendte uden eksekverbare valg, mens aktuelt nummer fortsat vises afspillende. Nye ejerleverede kødata erstatter rækkerne; ingen opdigtet fremtid eller automatisk start. Rigtig Spotify-autofortsæt og fysisk lyd er åbne. |
| K5 | Jeg vælger en kø-række → kun denne række viser spinner; køen forsvinder ikke under start, sangskift eller fejlet opdatering | Delvist bevist — faktisk browser med inert køejer: kun valgt række spinner; kø bevares under POST, sangskift og læsefejl. Tre eksplicitte valg før/efter accept og med nyt metadata-tomt køelement udføres via friske opgaver og præcis forekomst. UNKNOWN afslutter spinner og annullerer ventende valg; et nyt bevidst tryk virker i samme visning med frisk læsning/opgave, også uden nyt poll og uden gensendelse af gamle valg. Native kontinuitetsrettelse er testet/reviewet og publiceret i Speakers 0.26.68 til begge arkitekturer og installeret på Green; fysisk afspilning af dette forløb afventer. Den seneste Green-gentest med 0.26.82 blev standset før et køvalg, da HA's rumsvar manglede metadata til rækkerne. Efter afvisningen på Green 2.0.163 fortsatte Voyage Voyage med tilgængelige kontroller. Et nyt eksplicit Pause blev bekræftet af Spotify. Ved et senere accepteret køvalg kl. 17.27 mistede PodView kø og betjening, mens Spotify bekræftede afspilningen. Forløbet står åbent. Green 2.0.164 viste spinner og derefter Ingen bekræftet kø efter Kiss Me. Der var ingen gentagelse. Se køgentesten ovenfor. |
| K6 | Køen indeholder samme sang flere gange → valg rammer den valgte forekomst; et sent svar fra forrige session erstatter ikke den aktuelle kø | Bestået mod det skrevne logik-/UI-kriterium på 2.0.166. Uafhængig gennemgang knytter de konkrete assertions i tests/browser/music_selection_actual_e2e.cjs:1156–1259 til officiel CI42800322702. Kontrollerede ejere er inerte; dette lukker ikke rigtig musikstart, fysisk outputflytning eller robotbevægelse. Tidligere observation og dens begrænsning: Softwareprøve — MUSIC_QUEUE_IDENTITY_TEST på samlet bundle cac4be37: browsertryk på anden af to ens sange rammer dens præcise opaque native forekomst/index1 i Køkkenalrum42. Holdt, stadig gyldigt køsvar fra gammel session frigives efter observeret skift til Soveværelse43; nyt køtilbud og rækker bevares, gammelt svar bliver superseded, nul ekstra handlinger. Inert ejer; rigtig service/fysisk lyd er åbne. |
| K7 | Jeg forlader køen og åbner den igen under samme afspilning → kendt kø genbruges og opdateres i baggrunden; refresh, tomt svar og fejl behandles forskelligt | Bestået — eksakt installeret 2.0.166-bundle a07a0bae, MUSIC_QUEUE_JOURNEY=1 med andre early-return-modes fravalgt. Rigtig Chromium og Python-købroker: kendte forekomster23/24 og samme DOM-række bevares under holdt læsning og inert ejers503; først særskilt autoritativ tom observation fjerner kommende rækker, aktuelt nummer22 bevares. Ingen ekstra effekter. Log /private/tmp/pv166-k7-exact-20261110.log og podview-queue-persistence-proof.json. Dette logikforløb er ikke rigtig Spotify-/lydaccept for K2/K5. |

## Find musik

| # | Historie | Bevis og rester |
|---|---|---|
| F1 | Jeg åbner Find musik → forslag (Tid på dagen/Vibe/Din musik/Hør igen) vises < 300 ms fra sidst kendte, uden spinner | Bestået mod det skrevne logik-/UI-kriterium på 2.0.166. Uafhængig gennemgang knytter de konkrete assertions i tests/browser/music_selection_actual_e2e.cjs:669–685 til officiel CI42800322702. Kontrollerede ejere er inerte; dette lukker ikke rigtig musikstart, fysisk outputflytning eller robotbevægelse. Tidligere observation og dens begrænsning: Delvist bevist — pakket 2.0.155 i Chromium med inert katalog. Et faktisk tryk på Find musik fra Forside viste første synlige frame efter 9,7 ms med de samme tre ordnede forslag og den bevarede Din musik-fane, uden spinner, skeleton eller tom tilstand. En tidligere forladt Hør igen-læsning var stadig tilbageholdt og blev ikke genstartet. Målingen gælder kendt indhold ved genåbning, ikke en kold ekstern netværkslæsning. De eksisterende faneskiftsprøver består; rigtig Spotify og fysisk iPad er åbne. |
| F2 | Jeg trykker afspil på et forslag → afspilleren viser valget med det samme og musikken starter < 3 s | Delvist bevist — pakket 2.0.150 i Chromium med inert ejer. Ved tryk på Coming Home kom titel efter 11,3 ms og afkodet fixturecover efter 27,8 ms, mens startkaldet var holdt. Derefter nåede præcis én start ejeren, og en efterfølgende læsning viste afspilning. Rigtig Spotify og fysisk start under 3 s er åbne. |
| F3 | Jeg søger efter en kunstner, sang eller playliste → resultater vises mens jeg skriver | Idé til senere UI — søgning med resultater under indtastning. Ingen implementering bestilt. Indgår ikke som releasekrav. |
| F4 | Jeg trykker "Andre forslag" → nye forslag uden at siden hopper | Bestået — på Green 2.0.164 kl. 18.21 beholdt ét tryk de tre kort, billeder og layout under Henter forslag. Tre nye titler kom i de samme DOM-kort, og knappen blev aktiv igen. Pakket Chromium med tilbageholdt katalogsvar bekræfter stabil geometri under opdateringen. Ingen musik blev startet. |
| F5 | Første åbning og skift mellem alle fire faner → loading matcher slutlayoutets plads; kendt indhold bliver stående uden hop, komprimerede rækker eller flash | Bestået mod historiens konkrete acceptkrav — verificeret i officiel 2.0.166 CI42800322702 med rigtig browser og kontrolleret fejlkilde; eksisterende relevante Green-observationer genbruges. Der kræves ikke fysisk fremprovokation af denne fejlgren. Tidligere evidens: Delvist bevist — kandidat 2.0.156 med faktisk pakket Chromium ved 1280×800 og inert musikkilde. Alle fire faner er målt gennem første tilbageholdte læsning og færdigt indhold: syv frames pr. fane, tre under holdt svar, samme række-/kort-/covergeometri, nul falsk tom tilstand og nul handlingskald. Tid på dagens hero-reservation og fallback-coverets placering er rettet i kanonisk ui-kit.css; produkt og bibliotek bruger samme CSS 27a1c290 og uændret JavaScript 4ed3dc2f. Varm genåbning og eksisterende coverforløb består; fuld fokuseret UI-suite med målrettet genkørsel af fem ugyldiggjorte checks og uafhængigt review er bestået. Din musik bruger top-track-fixturen i denne prøve; tidligere playlist-loading-prøve bevares. Eksterne covers/provider og fysisk iPad er ikke bevist.|
| F6 | Din musik og Hør igen vises → større covers, læsbar tekst, afstande og udvidelse af lister matcher den godkendte lokale visning | Delvist bevist mod den godkendte Find musik-reference i PodViews UI-DELIVERY-GOAL (3. november). Ved 1270 × 1060 og 1280 × 800 bruger produkt og bibliotek de samme listeelementer. Lange titler afkortes visuelt med fuld titel i rækken. Begge centrerede knapper følger sidste række. Faktisk browser med inert katalog udvidede begge lister 5 → 10 uden at flytte de første fem. Rigtig Spotify og pixelmatch mod et referencemotiv er åbne. |
| F7 | Tid på dagen vises morgen, eftermiddag og aften → tidspunktet påvirker hvilke playlister der vælges, også uden AI-valg; ikke blot sorteringen | Bestået mod det skrevne logik-/UI-forløb på 2.0.166: test_podview_mood_playlists.py:428–443, tre forskellige URI-sæt kl.7/14/20 uden AI. Testet med inert ejer; dette lukker ikke rigtig musikstart eller bevægelse. Tidligere præcis evidens: Delvist bevist — inert integration: kl. 7/14/20 uden AI giver tre forskellige sæt af faktiske kilde-URI’er, ikke kun rækkefølge. Modelkontrakt sender alle døgnperioder; morgen/aften med simuleret AI-valg prøvet. Rigtig AI/Spotify ikke prøvet |
| F8 | Tid på dagen åbnes → hovedkort og to mindre kort har den godkendte komposition; Vibe bevarer godkendt titel-/fanehierarki | Bestået mod historiens konkrete acceptkrav — verificeret i officiel 2.0.166 CI42800322702 med rigtig browser og kontrolleret fejlkilde; eksisterende relevante Green-observationer genbruges. Der kræves ikke fysisk fremprovokation af denne fejlgren. Tidligere evidens: Bevist lokalt mod den godkendte Find musik-reference i PodViews UI-DELIVERY-GOAL (3. november). Pakket Chromium og bibliotek ved 1270 × 1060 og 1280 × 800 viste hovedkortet til venstre, to lige høje alternativer til højre og synlig højde som Vibe inden for 1 px. Overskrift og sekundær handling er samlet under fanerne med synligt tastaturfokus. Green og fysisk skærm er åbne.|
| F9 | Et cover opdateres eller fejler → bevar det viste cover; ellers Spotify-cover → grafisk AI-cover inden for eksisterende budget → lokal illustration. Cache må ikke genindføre forkert billedstil | Delvist bevist — faktisk browser/inert katalog: samme afkodede cover og DOM bevares ved manglende/ugyldige billeddata under refresh og udvidelse til syv rækker, uden ny crossfade. Enhedstest afviser genbrug over URI/konto/boot/rum/row removal. Supplerende pakket 2.0.156-browserprøve beviser Spotify 503 → præcis én autentificeret ThemeArtStore-GET med 200/image/webp og generated-theme-proveniens → afkodet og synligt 1024×1024-cover på samme række/billednode. Body-hash og ETag matcher; nul provider-dispatch og nul betjeningseffekter. Det cachede billede er gyldige syntetiske testdata, ikke ny AI-generering. F12 bevarer separat budget-, gammel billedpolitik- og lokal fejl-fallback-bevis. Rigtig Spotify/CDN/AI er åbent. På Green 2.0.161 blev en lokal SVG afkodet på personlige playlister uden cover. Den temabundne AI-prøve dækker ikke grafik for personlige playlister. Green 2.0.163 viste tre afkodede lokale SVG'er og to Spotify-billeder i de første fem rækker i Din musik. Den grafiske mellemfallback blev ikke observeret i denne prøve. |
| F10 | Jeg vælger fx Coming Home fra Hør igen → titel/cover vises straks i afspilleren; efter start forbliver betjeningen tilgængelig gennem efterfølgende refresh  | Delvist bevist — MUSIC_RECENT_SESSION_TEST på pakket 2.0.149: Coming Home-titel 11,3 ms og afkodet cover 27,8 ms efter browsertryk, mens startkald holdes og ejerens læsning stadig viser gammelt nummer. Én start; passiv fornyelse efter oprindeligt adgangsudløb sender intet ekstra. Pause/fortsæt/pause håndteres i rækkefølge under forsinkelse; ny browser åbner samme nummer/cover, og fortsæt/volumen virker. Inert PodConnect; rigtig Spotify og fysisk lyd ikke prøvet. |
| F11 | Jeg udvider en liste og skifter faner → godkendt udvidelse/scroll bevares under refresh; kun det valgte emne viser igangværende handling, ikke hele siden | Bestået mod det skrevne logik-/UI-kriterium på 2.0.166. Uafhængig gennemgang knytter de konkrete assertions i tests/browser/music_selection_actual_e2e.cjs:225–245,285–291 til officiel CI42800322702. Kontrollerede ejere er inerte; dette lukker ikke rigtig musikstart, fysisk outputflytning eller robotbevægelse. Tidligere observation og dens begrænsning: Bevist lokalt — pakket Chromium med inert katalog. Begge lister udvider 5 → 10 og bevarer rækkefølgen efter faneskift. Hør igen beholdt 464 px scroll under passiv afspilningslæsning og efter Din musik → Hør igen med alle ti rækker. Under tilbageholdt start havde kun Coming Home en spinner og rækken var den eneste optagede. Listen og de øvrige rækker blev stående. På Green 2.0.161 udvidede Din musik 5→10 og Hør igen 5→7. De ti rækker stod ved genåbning af Din musik. Fysisk iPad og den kombinerede prøve med holdt start afventer. |
| F12 | Coverkilden eller AI fejler, budgettet er brugt eller cache har gammel billedpolitik → lokal fallback virker uden blankt kort, ekstra ukontrollerede billedkald eller tab af eksisterende cover | Bestået mod det skrevne logik-/UI-kriterium på 2.0.166. Uafhængig gennemgang knytter de konkrete assertions i tests/browser/music_selection_actual_e2e.cjs:799–819 og coverfejlgrenen til officiel CI42800322702. Kontrollerede ejere er inerte; dette lukker ikke rigtig musikstart, fysisk outputflytning eller robotbevægelse. Tidligere observation og dens begrænsning: Delvist bevist — pakket Chromium/inert katalog: Spotify-503 → cachebillede-503 → synligt afkodet lokal illustration; udfaset billedpolitik og udtømt budget giver lokale billeder, nul generatorkald. Eksisterende cover bevares under refresh/udvidelse. Ét forsøg pr. kilde pr. indlæsning; eksplicit fanegenbesøg kan læse igen. På Green 2.0.161 var to manglende playlistcovers vist som indlæst lokal SVG. Fejlgrene og budget ved en rigtig billedprovider afventer. |

## Højttaler

| # | Historie | Bevis og rester |
|---|---|---|
| H1 | Jeg vælger en anden højttaler → musikken flytter < 3 s, valget står med det samme | Delvist bevist — pakket 2.0.150 i Chromium med inert ejer. Ét tryk flyttede den eksisterende session fra Køkkenalrum til Soveværelse, og begge åbne skærme viste den bekræftede destination og samme nummer. MUSIC_OUTPUT_TRANSFER_TEST på pakket 2.0.154 måler nu første synlige Skifter til Soveværelse efter 9,5 ms fra faktisk touch. Mens den inerte native-ejer holder flytningen tilbage, bevares bekræftet Køkkenalrum, samme sang og nul effekt. Først efter ejerens svar vises den bekræftede destination; én native effekt, retur, kø/volumen og afvist/ukendt udfald består. Fysisk flytning under 3 s er åben. |
| H2 | Sofie spiller fra sin konto på Køkken → skærmen viser "Spiller fra en anden konto" og tilbyder "Spil her" | Idé til senere UI — visning af en anden konto og handlingen »Spil her«. Ingen implementering bestilt. Indgår ikke som releasekrav. |
| H3 | Jeg trykker "Spil her" → min musik spiller på Køkken < 3 s; aldrig uden mit tryk | Idé til senere UI — eksplicit »Spil her« og måling af starttid. Ingen implementering bestilt. Indgår ikke som releasekrav. |
| H4 | Jeg åbner på iPad uden aktiv afspilning → Køkkenalrum er valgt som standard. Aktiv faktisk afspilning på et andet output overtages ikke automatisk | Browser verificeret på den byggede PodView med touch i iPad-størrelse. Ved bekræftet tom afspilning er Køkkenalrum alene valgt. Ved ny åbning med afspilning i Soveværelse er det alene aktuelt output. Nul kommandoer og effekter hos den simulerede ejer. Fysisk iPad er ikke prøvet. |
| H5 | Jeg flytter Køkkenalrum → Svend → Køkkenalrum → musikken og styringen følger hver gang; pause, lydstyrke og kø virker også efter ventetid  | Delvist bevist — MUSIC_OUTPUT_TRANSFER_TEST på pakket 2.0.155: Køkkenalrum → simuleret Soveværelse → Køkkenalrum, med fuld reload på returen. Begge oprindelige femsekunders adgangsfrister passeres i reel tid; nyere gyldig læsning bevarer samme ejer, binding, rum og HomePod. Fornyelse sender nul kommandoer/effekter. Pause, fortsæt, volumen (25/31 %) og præcise køforekomster (22/23) rammer derefter hver destination én gang. Det beviser kontinuitet over den gamle frist, ikke et tvunget hul uden gyldig adgang. Fysisk Svend, længere fysiske sessioner og lyd er ikke prøvet. |
| H6 | Højttalerdialogen er åben under refresh → listen udløber ikke synligt, valgt output har samme kantmarkering som valgt radiokanal; stabilt navn og layout | Bestået mod historiens konkrete acceptkrav — verificeret i officiel 2.0.166 CI42800322702 med rigtig browser og kontrolleret fejlkilde; eksisterende relevante Green-observationer genbruges. Der kræves ikke fysisk fremprovokation af denne fejlgren. Tidligere evidens: Delvist bevist — pakket Chromium/inert ejer: faktisk 30 s listeudløb under holdt refresh bevarer samme rækker, navn, bekræftet outputtekst, kant og geometri før/under/efter. Computed kant/baggrund matcher valgt radiokanal. Ingen kontrol-POST eller native effekt. Frisk afspilning begrunder visningen; listeudløb giver ikke ny handlingsautoritet. Fysisk iPad/højttaler ikke prøvet|
| H7 | Spotify flyttes til Tesla/iPhone og senere tilbage til Køkkenalrum → PodView følger faktisk output, tager ikke kontoen tilbage automatisk og genvinder betjening ved hjemkomst | Delvist bevist — pakket Chromium/PodVoice med inert PodConnect: eksterne Tesla-/iPhone-mål uden hjemmeroute vises gennem efterfølgende læsning; touch på utilgængelige kontroller sender nul forberedelser, POSTs eller effekter. Ekstern hjemkomst sender heller ingen handling; derefter rammer eksplicit pause/fortsæt native-room/42 én gang hver med samme sang. Green 2.0.161 viste faktisk Tesla-afspilning fra Spotify med korrekt eksternt nummer og deaktiveret hjemmebetjening. Spotify-retur til Køkkenalrum og genvundet betjening afventer liveprøve. |
| H8 | Flytning afvises eller får ukendt udfald → ønsket højttaler vises ikke som bekræftet output; ingen automatisk gentagelse, og gammel sessions kø/kommandoer flyttes ikke blindt  | Bestået mod det skrevne logik-/UI-kriterium på 2.0.166. Uafhængig gennemgang knytter de konkrete assertions i tests/browser/music_actual_e2e.cjs:255–287 til officiel CI42800322702. Kontrollerede ejere er inerte; dette lukker ikke rigtig musikstart, fysisk outputflytning eller robotbevægelse. Tidligere observation og dens begrænsning: Delvist bevist — MUSIC_OUTPUT_TRANSFER_TEST: afvist og UNKNOWN flytning giver præcis ét eksplicit forsøg, ingen simuleret effekt eller passiv gensendelse; ønsket Soveværelse bliver aldrig bekræftet output. Efter UNKNOWN er tidligere kø uden eksekverbare valg. Rigtig service og fysisk højttaler ikke prøvet. |
| H9 | En anden PodView-skærm eller Spotify ændrer afspilningen → Mac og iPad viser samme bekræftede session/output; lokal standardhøjttaler bliver ikke en ny sessionsejer | Delvist bevist — to uafhængige Chromium-kontekster med pakket PodView og inert musikejer. Ét eksplicit outputskift og en ekstern ændring gav begge skærme samme konto, ejer og observerede output. Faktiske Mac/iPad-enheder og Spotify er åbne. |
| H10 | Output er optaget eller kontoen er ukendt → ingen påstand om en bestemt anden konto uden kildegrundlag; ingen automatisk overtagelse ved refresh eller genåbning | Bestået mod det skrevne logik-/UI-kriterium på 2.0.166. Uafhængig gennemgang knytter de konkrete assertions i tests/browser/music_actual_e2e.cjs:351–398 til officiel CI42800322702. Kontrollerede ejere er inerte; dette lukker ikke rigtig musikstart, fysisk outputflytning eller robotbevægelse. Tidligere observation og dens begrænsning: Delvist bevist — to uafhængige Chromium-kontekster med pakket PodView og inert musikejer. Ved tvetydigt output eller utilgængelig konto var betjeningen utilgængelig på begge skærme, og ingen bekræftet højttaler eller navngiven anden konto blev vist. Genindlæsning og genåbning udløste ingen automatisk overtagelse eller afspilningshandling. Rigtig Spotify og fysisk udstyr er åbne. |

## Radio

| # | Historie | Bevis og rester |
|---|---|---|
| R1 | Jeg vælger en station → den spiller < 3 s, logo og navn vises med det samme | Delvist bevist — pakket Chromium: P3-navn, afkodet logo og ventemarkering efter 28,9 ms før kaldet når ejeren. Lokal NativeRadio HTTP-ejer observeret som afspillende efter 46,4 ms. På Green 2.0.164 viste P3 Valgt og Spiller på Køkken efter Starter. Fysisk lyd og tidsmålet på Green afventer. |
| R2 | Jeg trykker stop → radioen stopper < 1 s | Delvist bevist — pakket Chromium: stopfeedback efter 12,2 ms mens ejeren stadig rapporterer afspilning. Efter frigivelse observeres stoppet radio efter 29,3 ms fra trykket. Én kommando til inert NativeRadio. Green 2.0.164 viste Vælg musik efter eksplicit Stop radio, med Køkken fortsat konfigureret. Fysisk stop og tidsmålet på Green afventer. |
| R3 | Radio er korrekt konfigureret i HA/PodConnect → kanaler kan vælges; ingen generisk »ikke tilgængelig via HA« ved almindelig opdatering | Bestået — Green 2.0.165 med Speakers 0.26.84: fem stationer kunne vælges, bevaret klargøring ved ventetid/genåbning og P3 → P1 → Stop accepteret med korrekt UI. Det opfylder denne konfigurations-/valgbarhedshistorie; fysisk lyd, tidsmål og Spotify-retur hører til de øvrige åbne radiogrene. Tidligere forløb:  radio: faktisk browser/inert NativeRadio accepterer nyt stationsvalg under holdt svar og udfører P3→P1→P6 med friske tilbud; observeret station forbliver markeret. Native preparing uden tilbud dækkes i enhedstest. På Green kl. 11.11 CET med Speakers 0.26.70 stod manageren idle på Køkkenalrum. Discovery fandt Køkkenalrum, Svend og Mac. Frida blev ikke fundet. SettledNative viste tre mål, nul journalfejl, én probe-fejl med HTTP 503, to mål uden tilgængelig varig AirPlay-parring og nul godkendte mål. Diagnostikken viste ingen fejl i autorisation, signering eller identitet. OwnTone-siden Devices var tilgængelig på Green og viste Køkkenalrum, MacBook og Svend med offset-felter. Siden viste “No active pairing request” og havde ingen synlig kontrol til at starte parring eller indtaste og verificere en PIN. Ved denne tidligere Green-version var radio blokeret af den isolerede radiosenders krav om varig parring. Brugerens beslutning er at genbruge PodConnect Speakers, ikke at tilføje en ny parringsopsætning. Den eksisterende primære AirPlay-ejer understøtter almindelig transient parring; arbejdet flytter radioens outputstyring til denne ejer med adskilte lydstrømme og præcis sessionslukning. Isolerede faktiske C/UDP-prøver beviser adskillelse og afviser gamle sessioner; Green-integration og fysisk lyd er stadig åbne. Ny softwareevidens 8. november: PodConnect-kandidat `64f4398`, officiel CI 42486699466, består gennem konfigureret Manager → faktisk Native HTTP-aktør → C-motor → autentificeret simuleret RTP-modtager. P3 → P1 → P6 giver tre særskilte modtagervinduer; den aktive højttaler forbliver valgbar, selv om en anden er utilgængelig. Årsagen var Native-status unknown for det andet mål, som fik Manager til at afvise hele listen. Native markerer nu dette mål utilgængeligt efter frisk ejerbekræftelse; streng validering og modtagerens afvisning bevares. Den samlede produktpakke på 7f7931f består officiel CI 42489503428 med de samme produktpatches som imagebygningen. Speakers 0.26.73 er publiceret til ARM/AMD64 fra samme produkttræ 14f9010f og merged i PR #116 (1f4b3368). Efterfølgende main-kontrol 42491599126 afviste én initial Spotify→radio-overgang med generisk alias-konflikt; kontrolleret reproduktion 42493450188 bekræfter fejlen på forsøg 2, mens bevidst tilbageholdt TEARDOWN-svar består. Ved fejlens afslutning er Spotify-parkering accepteret og drænet, aktivering registreret, men ingen ny radiomodtager optaget. Efterfølgende kontrol 42494321801 viser den konkrete afvisningsårsag i samme ejergrænse: stat af en netop opregnet fildeskriptor giver ENOENT, writer-proof bliver ukendt, og konstruktion af den nye radiomodtager afvises. PR #118 indeholder nu den reviewede årsagsrettelse (9a75da1): den ufuldstændige aflæsning kasseres, og kun det konkrete ENOENT tillader én ny fuld scanning med samme levende Native-identitet. Ingen kommando gentages. Officiel Linux-kontrol 42495328286 består: faktisk fremprovokeret FD-forsvinden efterfølges af tre krypterede stationers modtagervinduer, Spotify-resume og bestået samlet Manager/Native/C-forløb. Supplerende afvisningsscenarier er reviewet og integreret i 697822b. Endelig Speakers 0.26.74-kandidat 6bfcd846 (produkttræ 175a591d) består CI 42495888006, inklusive den fremprovokerede race, afvisningsscenarier og samlet Manager/Native/C-forløb. Begge images er publiceret i 42495899569: ARM sha256:623cbbda58a2c8f1e53b22a8818224e7d97d39dd7648d82cd8295f0f7228fdc4 og AMD64 sha256:8a13cfb3f7b01ba71d38a07b7a14d90336b92efffab2e2955309ebe231f13706. PR #118 er normal-merged på 7fa2161a. Den dokumenterede softwarefejl er rettet og regressionen består; main-kontrol 42496384210 og præcist imagegenbrug 42496384150 består. Ingen installation eller fysisk accept. Green og fysisk radiolyd er ikke bevist. På Green med Speakers 0.26.79 afviste START-kravet den gyldige MOVE-post med retired_known ved passiv klargøring. På 0.26.80 afviste passiv klargøring med start_source_owned. 0.26.83 er installeret. Dens første-fejl-diagnostik viser fifo_before_reader / writer_census_incomplete ved kold opstart. Speakers 0.26.84 retter den dokumenterede START-form i den kompilerede Linux-prøve og i officiel CI. Se opstartsbeslutningen ovenfor. Efter godkendt fuld Green-værtsgenstart viste 0.26.84 alle fem radioknapper aktive på Køkken uden fejl. Green 2.0.164 bekræftede klargøringen efter 30 sekunders ventetid og genåbning fra Forside. Næste morgen viste Green P3 Valgt og derefter P1 Valgt på samme Køkken-output efter eksplicitte tryk. Fysisk lyd og de øvrige radiogrene afventer. |
| R4 | Station eller stream fejler → kort konkret fejl på valget; en anden station kan vælges, og musik/radio-skift efterlader ikke låst afspiller | Delvist bevist — radio: faktisk inert afvisning og mistet accepteret svar viser feedback; ny eksplicit station virker i samme visning. UNKNOWN annullerer ventende valg uden gensendelse; ejer-/Spotify-skift dækkes i enhedstest. Baseline radio→Spotify består; fysisk streamfejl ikke prøvet Kandidat `64f4398` består desuden faktisk Native/C med simuleret modtager for Stop → ny radio, eksplicit Resume af bevaret Spotify-kilde/kø og eksplicit valg af nyt Spotify-indhold. Sidstnævnte kræver den præcise nye START-binding og sender ingen genoptaget gammel Spotify-lyd. Fejlårsagen var sammenblanding med legacy-radiosenderens nøglekrav; legacy-kravet bevares. Mistet sikker afvisning ved første start kan afklares med én præcist bundet resultatlæsning uden gensendelse; mulige effekter forbliver UNKNOWN. Lokale kausale regressioner og fokuserede reviews består. Produktpakningen består desuden officiel CI 42489503428 på 7f7931f; Speakers 0.26.73 er publiceret, og fysisk prøve afventer. |
| R5 | Jeg vælger P3 og åbner radio igen → faktisk valgt station har den godkendte kantmarkering, navn og logo; refresh ændrer ikke valget | Delvist bevist — pakket Chromium med inert NativeRadio HTTP bevarer P3/playing, Valgt og aria-pressed gennem genåbning, uændret repaint og fuld page.reload med ny ejerlæsning. Officielt P3-logo og mørk 2 px kant matcher den godkendte reference 26fab0dc; skærmbilleder før/efter reload er identiske. Præcis én POST/native Start i hele forløbet. Rigtig radiostream og fysisk højttaler er ikke prøvet. |
| R6 | Radiokonfiguration mangler eller tokens passer ikke sammen → præcis opsætningsfejl; samme radio_transport_token i Speakers og podconnect_radio_token i PodVoice håndteres uden at vise/logge værdien | Bestået mod historiens konkrete acceptkrav — verificeret i officiel 2.0.166 CI42800322702 med rigtig browser og kontrolleret fejlkilde; eksisterende relevante Green-observationer genbruges. Der kræves ikke fysisk fremprovokation af denne fejlgren. Tidligere evidens: Delvist bevist — pakket Chromium og lokal NativeRadio HTTP: tom opsætning og afvist token giver hver sin besked, med stationer uden valgmulighed og ingen handlingskald. 401 → almindelig 503 → frisk ejerobservation fjerner den gamle diagnose og gendanner betjeningen uden gentagelse. Testværdier optræder hverken i UI, HTTP-svar eller diagnostik. Rigtig Green-konfiguration er ikke prøvet.|

## Robotstøvsuger

| # | Historie | Bevis og rester |
|---|---|---|
| S1 | Jeg åbner robotten → status, batteri og igangværende rum vises straks | Delvist bevist — ROBOT_OBSERVATION_TEST i pakket Chromium viser rengøringsstatus, 78 % batteri og det observerede Køkkenalrum i oversigt og detalje fra inert HA. Tid til første visning på rigtig skærm er åben. |
| S2 | Jeg vælger rum og trykker Start → robotten starter; knappen bliver ikke grå undervejs | Delvist bevist — pakket Chromium sender ét eksplicit Start for valgte rum gennem rigtig PodVoice til inert HA. Hovedknappen bevarer mørk primær fremtoning og spinner gennem et 16,1 s holdt svar. Accept og efterfølgende ejerobservation af rengøring er begge prøvet. Fysisk start er åben. |
| S3 | Robotten kører → jeg trykker pause / fortsæt / til base → knappen skifter < 300 ms og bliver aldrig grå; robotten følger < 2 s | Delvist bevist — robot_ux viser pause og fortsæt inden for 300 ms uden grå knap. Robot-browserprøven viser »På vej til basen« inden for 300 ms, mens den inerte kilde stadig rengør, og observerer én returkommando og efterfølgende kildestatus. Fysiske tidsmål er åbne. Green 2.0.159 bekræftede Pause og retur til Oplader. Fortsæt manglede, fordi samme robots Supervisor-regel manglede resume. På Green 2.0.160 forblev Fortsæt tilgængelig efter genindlæsning under pause. Ét tryk gav bekræftet rengøring, og Kør til basen gav bekræftet retur. På Green 2.0.161 blev Pause, Afslut rengøring og retur til Oplader/100 % observeret under oprydning efter direkte Start. Den rettede bekræftelsesbevarelse under fornyelse og tidsmål afventer en målrettet prøve. |
| S4 | Jeg lader skærmen stå åben i 10 min → alle knapper virker stadig uden genindlæsning | Delvist bevist — efter 601,437 s i pakket Chromium med 2.0.151 vågnede skærmen fra Ro i samme browserdokument. Et nyt tilbud bevarede Køkkenalrum, Støvsug og vask, Extreme, Maks., Hurtig og to gennemløb. Ét tryk på Start sendte fem indstillingskald og én start for segment 16 med to gennemløb til inert HA. I en tidligere separat ti minutters Chromium-prøve nåede Pause, Fortsæt og Kør til basen inert HA én gang hver. Supplerende pakket Chromium-prøve på 2.0.155 ventede 600,009 s i samme dokument: efter en eksplicit uændret HA-fixturrapport med frisk last_reported virkede alle seks Base-handlinger én gang hver mod inert vacuum.qrevo. Ingen Base-effekter før tryk; det gamle tilbud var udløbet og et nyt blev hentet. Første prøve med reelt forældede sensordata afviste korrekt betjening. Koden for betjening er uændret; testen simulerer HA-rapportering, ikke friskhed ved læsning. Fysisk skærm og robot er åbne. |
| S5 | Jeg skifter rengøringstype → kun toppen ændres; rute og antal gange beholder placering. Typer er Støvsug og vask, Støvsug, Vask; ingen Tilpasset-type eller opdigtede 3 runder | Bestået — ROBOT_DRAFT_TEST viser de tre aftalte typer og kun 1×/2× på 1280×800. Terra målte desuden Green 2.0.165 i rigtig Chrome 10. november: ved alle tre typer var Rute x=687/y=884 og Antal gange x=1072,53/y=884 i samme viewport og scrollposition. Kun toppen skiftede; Tilpasset fandtes som rutevalg, ikke type. Ingen robotkommando. Den særskilte iPad-layoutaccept hører til G6; Chrome-målingen var ikke ved 1280×800. |
| S6 | Jeg vælger Extreme vand for Støvsug og vask → den eksisterende HA/API-kobling sætter faktisk custom niveau 30; valget overlever opdatering | Delvist bevist — pakket Chromium bevarer Extreme for Støvsug og vask gennem opdatering. Rigtig DeviceControl sender custom_water_flow og distance_off 60 og kræver en frisk observation af mode 207/distanceOff 60 før Start. Slutkilden er inert. Visning som niveau 30 på den konkrete Q Revo er åben. |
| S7 | Jeg åbner basefunktioner → godkendt rækkefølge og vask/støv først bevares; vask/stop, tømning og tørring/stop bruger reelle understøttede HA-handlinger | Delvist bevist — ROBOT_DOCK_TEST viser Vask → Tøm støv → Tør. Åbning af Base sender ingen kommando. Seks eksplicitte tryk går én gang hver gennem rigtig PodVoice til inert HA for start/stop af vask, tømning og tørring. Fysisk base er åben. 22948415 reproducerer to Base-paneler efter observeret pause og viser efter rettelsen ét panel med både Kør til basen og Vask moppe. Åbning og annullering sender ingen kommando. Prøven bruger pakket Chromium og inert HA. Green 2.0.160 viste ét Base-panel i både pause og rengøring. Fysiske vaske-, tømme- og tørrehandlinger afventer. |
| S8 | Robot/HA bliver midlertidigt utilgængelig → sidst kendte status med tidspunkt og rumvalg bevares; genforbindelse kræver ikke refresh | Bestået mod det skrevne logik-/UI-kriterium på 2.0.166. Uafhængig gennemgang knytter de konkrete assertions i tests/browser/robot_actual_e2e.cjs:630–689 til officiel CI42800322702. Kontrollerede ejere er inerte; dette lukker ikke rigtig musikstart, fysisk outputflytning eller robotbevægelse. Tidligere observation og dens begrænsning: Delvist bevist — én simuleret HA-læsefejl bevarer sidst kendte status med tidspunkt og valgte rum og indstillinger som skrivebeskyttet kladde. Efter det gamle tilbud udløber genskaber almindelig baggrundslæsning valgene i samme browser uden refresh. Rettelse 672551c3 på samlet bundle e3b986ee beviser også fuldt forbindelsesbrud: Chromium offline og suspenderet inert server bevarer deaktiverede rum-/indstillingsvalg og oprindeligt observationstidspunkt. Efter genforbindelse genvaliderer samme ejer valgene uden refresh; nul skrivninger før et nyt Start-tryk, derefter præcis seks accepterede inerte HA-kald. Skiftet scope/mål, tilbagekaldt adgang og ukendt udfald afviser gendannelse. Uafhængigt review består. Fysisk HA er ikke prøvet. |
| S9 | Rent vand mangler → én kompakt besked for samme bekræftede fejl. Vedligeholdelse er neutral, lukket som standard og har korte rækker med detaljer ved behov | Bestået mod det skrevne logik-/UI-kriterium på 2.0.166. Uafhængig gennemgang knytter de konkrete assertions i tests/browser/robot_actual_e2e.cjs:365–388 til officiel CI42800322702. Kontrollerede ejere er inerte; dette lukker ikke rigtig musikstart, fysisk outputflytning eller robotbevægelse. Tidligere observation og dens begrænsning: Delvist bevist — pakket Chromium viser én »Rent vand mangler« fra to signaler for samme fejl. Vedligeholdelse starter lukket, og Filter kan åbnes til vejledning. Inert HA. Fysisk skærm er åben. |
| S10 | Jeg skjuler vedligeholdelse i dag → baggrundsopdatering genåbner den ikke; en ny aktuel fejl skjules ikke. Driftstællere omtales som påmindelser, ikke bevis på slitage | Bestået mod historiens konkrete acceptkrav — verificeret i officiel 2.0.166 CI42800322702 med rigtig browser og kontrolleret fejlkilde; eksisterende relevante Green-observationer genbruges. Der kræves ikke fysisk fremprovokation af denne fejlgren. Tidligere evidens: Delvist bevist — »Skjul vedligeholdelse i dag« bliver stående over ny ejerobservation, mens den nye aktuelle vandfejl vises. Filterteksten beskriver et vedligeholdelsesinterval, og interaktionen sender ingen enhedskommando.|
| S11 | Robot rengør → vis fremdrift fra tilgængelige reelle data. Et estimat mærkes som estimat; uden grundlag vises ingen opdigtet procent | Delvist bevist — pakket Chromium viser 42 % fra en frisk ejerobservation. Når feltet bliver utilgængeligt, forsvinder procent og måler. Ingen estimeret procent blev vist. Virkelig sensorkilde er åben. |
| S12 | Forside og robotdetaljer opdateres → relevant hovedknap vises stabilt med kendt status; ingen forsinket indflyvning eller flash | Delvist bevist — pakket 2.0.155 i Chromium med inert HA. Forside og robotdetaljer er hver prøvet med Pause og Fortsæt gennem en faktisk tilbageholdt REST-læsning af samme kendte status og efter anvendt nyere Home-revision. 67 målte frames, heraf otte under holdt læsning i hvert forløb, bevarer præcis samme handlingsknap, label, ikon, farver, opacity og geometri; nul disabled-mutationer og nul enhedskommandoer. Tidligere holdt Start bevarer bredde, ikon/spinner og accepteret feedback. Prøven gælder normal opdatering med samme kendte status; fysisk skærm/Safari er åbne. |
| S13 | Jeg ændrer rum, rute, antal gange eller suge-/vandniveau → næste Start bruger netop de valgte værdier og eksisterende HA/API-funktioner; refresh ændrer dem ikke | Delvist bevist — ROBOT_DRAFT_TEST bevarer rum, type, rute, antal, sug og vand gennem udløb, genåbning og passiv gendannelse efter læsefejl. Én Start sender de valgte værdier for Køkkenalrum, Hurtig, 2×, Maks. og Extreme gennem DeviceControl til inert HA. Fysisk rengøring er åben. |
| S14 | Robotdata mangler kortvarigt → åbne indstillingsfelter, hovedknap og rumvalg beholder layout; opdateringen opfinder ikke en ny rengøring eller afsluttet tur | Bestået mod det skrevne logik-/UI-forløb på 2.0.166: robot_actual_e2e.cjs:442–464,630–643 og root-home-model.test.mjs:7. Testet med inert ejer; dette lukker ikke rigtig musikstart eller bevægelse. Tidligere præcis evidens: Delvist bevist — pakket Chromium bevarer rumvalg, indstillinger og placering under et simuleret læseudfald. En allerede sendt Start forbliver afventende gennem tilbudsudløb, og sen accept vises også ved fortsat sidst kendt status. Ny rengøring vises først ved ejerobservation. Fysisk HA er åben. |
| S15 | Jeg åbner vedligeholdelsesdetaljer → teknisk fejlkode ligger diskret under detaljer, aldrig som stor normal betjening. »Skjul vedligeholdelse i dag« er en diskret handling, ikke en stor primær knap | Bestået mod historiens konkrete acceptkrav på 166: pakket Chromium viser én almindelig fejlbesked og holder kildens tekniske kode bag lukkede Tekniske detaljer. Koden vises først ved åbning. »Skjul vedligeholdelse i dag« er en sekundær handling. Inert HA og browserbevis, fysisk skærm er åben.|
| S16 | Jeg håndterer en vedligeholdelsespåmindelse → skjul nulstiller ikke robottenes tællere. En eventuel understøttet nulstilling er separat og sker kun efter brugerhandling | Bestået mod historiens konkrete acceptkrav på 166: skjul af en vedligeholdelsespåmindelse i pakket Chromium sender ingen robotkommando og ændrer ikke kildens tæller. Ingen nulstillingshandling er tilbudt af den prøvede konfiguration.|

## Lys

| # | Historie | Bevis og rester |
|---|---|---|
| L1 | Jeg trykker på et rum → lyset tænder/slukker, knappen skifter < 100 ms | Delvist bevist — pakket Chromium, faktisk bridge og inert HA. Ventestatus efter 4,2 ms. To hurtige tryk under holdt svar giver præcis Sluk → Tænd efter frisk observation. Et ukendt udfald eller en fejlet efterlæsning stopper køen uden genafsendelse. Fysisk lys og Green ikke prøvet. |
| L2 | Jeg trækker i lysstyrke → lyset følger, slideren hopper ikke | Delvist bevist — pakket Chromium viser 49 % gennem holdt svar. Efterfølgende touchvalg 62 → 37 % erstatter det ventende absolutte valg, så ejeren modtager 49 % og derefter 37 %. Utilgængelig lampe blokerer styring, og genåbning efter offline → online viser observerede 60 %. Fysisk lys og iPad ikke prøvet. |
| L3 | Lyset ændres fra en kontakt → skærmen viser det < 1,5 s | Delvist bevist — i pakket Chromium når inert HA WebSocket-hændelse eget rum efter 11,5 ms og et andet åbent rum efter 30,0 ms uden servicekald eller skift af valgt rum. En holdt gammel områdelæsning efterfølges af frisk læsning uden at genaktivere gammel betjeningsadgang. Fysisk kontakt → HA og Green ikke prøvet. |

## Opskrifter

| # | Historie | Bevis og rester |
|---|---|---|
| O1 | Jeg åbner opskrifter → kataloget vises straks med billeder | Bestået —  pakket 2.0.155 i Chromium med inert katalog og billedkilde. Første synlige frame efter faktisk tryk viste Henter opskrifter … (9,9 ms), mens første læsning var holdt. Efter frigivelse viste første ready-frame alle otte rækker og fire afkodede billeder i de synlige billedpladser (26,0 ms). Ingen målt frame var falsk tom eller blank. Tiderne beskriver den kontrollerede lokale prøve, ikke et nyt svartidskrav eller produktionsnetværk. Det eksisterende samlede opskriftsforløb består. På Green 2.0.164 viste første observerede katalog i en ny HA-autentificeret Chrome-fane alle ni rækker efter Tilbage fra aktiv Burgerboller. Efterfølgende DOM viste ni afkodede faktiske billeder. På Green 2.0.165 kl. 10.34 åbnede en frisk klient uden aktiv opskrift direkte katalogets ni rækker; screenshot og DOM bekræftede 9/9 indlæste billeder. Første frame er softwaremålt ovenfor, ikke tidsmålt på Green. Fysisk iPad-designaccept står særskilt under O6/G6. |
| O2 | Jeg vælger en opskrift → ingredienser og trin kan læses på afstand; antal personer kan ændres | Idé til senere UI — ændring af antal personer. Ingen implementering bestilt. Indgår ikke som releasekrav. Den eksisterende ingrediens- og trinvisning leveres som del af opskriftsforløbet. |
| O3 | Jeg følger trin → det aktuelle trin er tydeligt, og jeg kan starte en timer fra trinnet | Idé til senere UI — timerstart direkte fra et opskriftstrin. Ingen implementering bestilt. Indgår ikke som releasekrav. Den eksisterende opskriftsvisning markerede trin 1 → 2 og bevarede det aktuelle trin ved genåbning i pakket Chromium. Green 2.0.159 viste Trin 2/5 efter markering af første trin og bevarede det efter genindlæsning. |
| O4 | Jeg starter burgerboller og går tilbage til kataloget → den godkendte bjælke for igangværende opskrift vises i oversigten; widget bruger sit eget godkendte design, ikke en ny sort bjælke | Bestået — Green viste aktiv Burgerboller i katalog og særskilt widget. Den pakkede browserprøve viser den godkendte mørke katalogrække og den særskilte widget i samme RecipeView. Reference PodView/docs/UI-DELIVERY-GOAL.md:2632–2654 og kildekontrakt 552e37c7. |
| O5 | Jeg åbner den aktive opskrift fra oversigt/widget eller genåbner appen → samme opskrift, trin og portioner bevares; ingen ny start eller erstatning med forkert »Fortsæt«-flow | Bestået — efter opdatering og genstart åbnede den aktive widget samme Burgerboller direkte på trin 2/5 med 1/10 ingredienser og 15 stk. Green 2.0.159 og den pakkede browserprøve dækkede også genåbning efter reload og bevaret accordion. Ændring af portionstal er idéen i O9. |
| O6 | Jeg åbner alle undersider og accordions → komponenter, numre, typografi og tilstande matcher godkendt opskrifts-UI; ingen parallel reduceret produktvisning | Delvist bevist. PV126 ved `552e37c7` gendannede det godkendte PodView-dist-layout. STATUS-posten om PV126 linker kildebeviset til lokalt 1280×800-match for widget, katalog, nummererede trin, Ingredienser og Om opskriften. Bibliotek og produkt bruger stadig samme RecipeView og kit. Heroens 200 px minimum, tekstombrydning og Uploadhistorik følger det efterfølgende review i PodView UI-DELIVERY-GOAL.md:2665–2683 og :2713–2715. Pakket 2.0.152 i 1280×800 er sammenholdt med de senere godkendte upload-history-local.png og arla-import-local.png: tom/udfyldt/utilgængelig Uploadhistorik, lang URL uden datooverlap, lang Hero med synlig Start samt Om opskriften åben/lukket matcher de prøvede layoutkrav. Katalogets separate Senest gennemført er desuden bevist på pakket 2.0.153: én gennemført række med tidspunkt, åbnet sektion bevaret efter widgetnavigation og ny kataloglæsning. Indholdsafhængige opskriftsfotos er ikke en ny pixelreference; den eksisterende Hero-/galleribinding bevares. Fysisk iPad-sammenligning er ikke bevist. Lokal rettelse 84a13909 viser nye historikrækker med fokuseret disclosure uden navigation, bevarer fokus og bruger samme læsesløjfe ved Prøv igen; kausal Chromium-prøve og uafhængigt review består. |
| O7 | Jeg afslutter opskriften → aktiv markering fjernes konsistent fra oversigt og widget; allerede startede timere følger deres aftalte selvstændige adfærd | Bestået — Green 2.0.159 fjernede aktiv markering i katalog og widget og viste Burgerboller i historikken kl. 13.25. Den separate femminutterstimer fortsatte gennem afslutningen og blev først fjernet ved eksplicit Annuller. |
| O8 | Jeg uploader via genvejen → gyldig opskrift bliver tilgængelig; ugyldigt input/afvist adgang giver forståelig besked og korrekt afvisningslog uden tokens. Gentaget indsendelse må ikke give skjulte dubletter | Bestået — Mac-prøven mod Green gemte Arla-opskriften kl. 13.39. Katalog, detalje og én Gemt-post i Uploadhistorik blev observeret. Brugeren bekræftede korrekt feedback på iOS og PodView samt synlig opskrift. Pakket Chromium med inert importkilde dækker ugyldigt input, adgangsafvisning 401/403, dublet med samme kvittering og én række efter genstart. Journalprøven viser korreleret afvisning uden uploadkoder. |
| O9 | Jeg ændrer antal portioner → ingrediensmængder følger med; navigation og accordion-opdateringer ændrer ikke valgt portionstal eller aktuelt trin | Idé til senere UI — skalering og fastholdelse af portionstal. Ingen implementering bestilt. Indgår ikke som releasekrav. |
| O10 | Upload fra iPhone-genvejen lykkes/afvises → POST /api/podvoice/recipe-submissions med JSON-url og Bearer-uploadkode giver et forståeligt message-svar. Uploadkode er adskilt fra radiokode og må ikke lækkes i log | Bestået — brugeren bekræftede uploadfeedback på iOS og den gemte opskrift i PodView. En faktisk POST fra Mac på Green gav Gemt og katalogpost. Kontraktprøver dækker JSON-url, Bearer, message, afvisning, adskilte koder og logredaktion. Afvisning er softwareprøvet. Den konkrete iPhone-anmodning er ikke særskilt indfanget. |

## Timere, vejr, bil, svar

| # | Historie | Bevis og rester |
|---|---|---|
| T1 | Jeg starter en timer → den tæller ned straks; +1/−1 min virker; alarm kan stoppes med ét tryk | Softwareprøve — pakket Chromium med inert native-v2-timerejer: Start viser 5:00 og tæller ned. +1/−1 flytter samme ejer-ID og slutpunkt +60/−60 s. Udløb giver én alarmvisning, og ét Stop giver én kvittering hos ejeren. Nul browserlydkald. Green 2.0.161 bekræftede aktiv +1 og −1 på en femminutterstimer, mens nedtællingen fortsatte. Annuller fjernede timeren før udløb. Green 2.0.161 kl. 16.19–16.21: 1:00 startede, udløb viste Timeren er færdig/00:00, ét Stop alarm gav kvittering og fjernede alarm og aktiv timer. Skærmbevis: /private/tmp/green161-timer-expired-1621.png og /private/tmp/green161-timer-stop-confirmed-1621.png. Fysisk alarmlyd er ikke bekræftet. |
| V1 | Vejret vises på forsiden og er højst 30 min gammelt; fejl viser sidst kendte med tidspunkt | Bestået — Green viste frisk 8° og Skyet kl. 14.08 samt en tidligere dateret visning som Sidst kendt. Pakket Chromium med inert HA prøver den præcise 30-minuttersgrænse fra kildeopdateringen, bevaret tidspunkt gennem kildefejl og reload, genoprettelse og senere udløb. |
| B1 | Bilens batteri/rækkevidde vises; handlinger følger de godkendte bekræftelsesregler | Delvist bevist — pakket 2.0.150 i Chromium med inert HA viste 72 % og 312 km. Klima og bagagerum fulgte de prøvede regler for bekræftelse og adgang, og annullering sendte ingen kommando. B10 beskriver de resterende visuelle afvigelser. Green viste 78 % og 299 km kl. 15.24. Ét tryk på Lås op viste den korrekte dialog, og Annuller lukkede den uden observeret bilhandling. Bekræftede bileffekter afventer. |
| Q1 | Jeg spørger stemmeassistenten → svaret vises som kort på skærmen og kan læses senere i historik | Softwareprøve — pakket Chromium og faktisk Thin: tekstspørgsmål → struktureret afsluttet svar fra inert SDK → synligt kort → normal lukning → reload → samme kvittering og kort i historik, mens den aktuelle læselease stadig gælder. Historik har passivt indhold og giver nul handlingskald eller afspilning. Fysisk mikrofon, Voice PE og rigtig provider ikke prøvet. |
| T2 | Jeg navigerer væk, genåbner eller mister netværket → timerens slutpunkt bevares; ingen ny timer eller dobbelt alarm fra refresh | Bestået — Green 2.0.159 bevarede samme nedtælling gennem HA-genindlæsning og genåbning. Pakket Chromium med inert timerejer dækker samme ID og slutpunkt gennem netudfald, én alarmvisning efter genforbindelse og ét Stop. Efter reload var alarmen væk. |
| V2 | Prognosen mangler eller har ukendt vejrikon → neutral fallback i samme ikonplads; dato, temperaturer og søjlekolonner forskydes ikke | Bestået — Green viste Met.no-dagsrækker med afkodede ikoner. Pakket WEATHER_RETENTION_TEST med inert HA viste kendt, manglende og ukendt ikon på samme plads med uændret dato, temperaturspænd, bjælke og fem kolonner ved 1280×800 og 768×1024. Kildeevent gendannede ikonet på samme DOM-noder. |
| V3 | Vejrkilden fejler ved åbning → vis reelle sidst kendte værdier og tidspunkt; uden historik vises ærlig tom tilstand. For gamle data mærkes, aldrig som friske | Bestået mod historiens konkrete acceptkrav — verificeret i officiel 2.0.166 CI42800322702 med rigtig browser og kontrolleret fejlkilde; eksisterende relevante Green-observationer genbruges. Der kræves ikke fysisk fremprovokation af denne fejlgren. Tidligere evidens: Delvist bevist — pakket Chromium/inert HA: første kildefejl uden historik åbner ærlig tom detalje ved touch; næste normale ejerpoll genopretter samme visning. Med historik bevares oprindeligt tidspunkt under fejl/reload, og udløb fjerner for gamle værdier. Frataget læseadgang vinder over cache. Green 2.0.161 bevarede Sidst kendt og seks dagsrækker efter opvågning uden reload. Ny hentetid ændrede ikke status til frisk. Åbning under en faktisk kildefejl uden historik afventer.|
| B2 | Tesla-data ændres i HA → PodView viser de nyeste relevante entitetsværdier og deres faktiske opdateringstid; ingen ældre samlet cache overskriver friskere felter | Delvist bevist — kausale ejerregressioner: nyere scoped HA-lås/bagagerum/klima vinder pr. felt; uændret genudsendelse fornyer ikke observationstid. Ændring under ventende cachelæsning prøvet; fysisk Tesla ikke prøvet |
| B3 | Bilen sover → bevar hver kendt status med tidspunkt; dvale angives kun med kildegrundlag. Åbning af PodView vækker ikke bilen eller starter ekstra polling | Delvist bevist — VEHICLE_LIFECYCLE_TEST på pakket 2.0.149: kendt→sidst kendt bevarer værdier og præcise felttider; åbning giver ingen ekstra native snapshotlæsning/vækning. Den identitetskontrollerede Tesla Fleet-koordinator har rå online/asleep/offline, men uden særskilt observationstid; PodVoice projicerer kun de tidsstemplede køretøjsblokke. HA’s binære forbindelsessensor skelner ikke asleep fra offline. En frisk dvalemærkning afventer derfor betroet tids-/ændringsevidens fra samme ejer; læsetid eller gamle data bruges ikke som bevis for aktuel dvale. Rigtig bil ikke prøvet. |
| B4 | Bilen vågner eller en handling udføres → nye HA-observationer opdaterer status; accepteret kommando er ikke bevis for åbent bagagerum eller tændt klima | Delvist bevist — sammenhængende vehicle-browser: ekstern HA-ændring opdaterer lås/bagagerum/klima; én inert close_cover-kommando accepteres, mens visningen stadig siger åbent. Først en separat lukket observation skifter til Åbn. Ingen fysisk bilprøve. |
| B5 | Bagagerumsstatus er kendt → handling og bekræftelse siger entydigt Åbn eller Luk. Ukendt status gættes ikke; følg HA-kilden og vis konkret begrænsning | Bestået — den faktisk lukkede Tesla viste Åbn bagagerum i både knap og bekræftelse på Green 2.0.159. Annullering lukkede dialogen. Pakket vehicle-browser med inert HA dækker præcis Luk ved kendt åbent samt én deaktiveret kontrol ved ukendt status. |
| B6 | Klima er slukket → temperaturbetjening, sædevarme og afrimning er utilgængelige som aftalt; ved bekræftet tændt klima aktiveres understøttede funktioner. Ingen ekstra modsatrettede knapper | Bestået — på Green viste tændt klima relevante kontroller kl. 14.34. Slukket klima viste kl. 15.24 deaktiveret temperatur, afrimning og sædevarme. Pakket Chromium med inert HA viste OFF→ON→OFF, nul POST fra låste kontroller og én afrimningsknap uden modsatrettet dublet. Ukendt status og OFF før afsendelse dækkes af komponent- og ejerprøver. Bileffekt efter handling hører til B4/B10. |
| B7 | Bilen lader ikke → rent batteri/rækkevidde-kort uden 0 kW. Når den lader → det godkendte ladekort med reelle ladedata | Delvist bevist — vehicle-browser: idle skjuler kW, frisk charging viser 11 kW fra inert kilde, efterfølgende idle skjuler feltet igen. Den nyere kanoniske 256 px bilslot er bevidst indført i e6ba16ab med en bindingsprøve og erstatter den ældre 192 px audit. B7-browserprøven fandt et ejergap: charging.endsAt blev afvist, og HA-projektionen producerede ikke feltet. Rettelse 4193321b bruger samme koordinator og oprindeligt ladetidspunkt med positiv minutes_to_full_charge; intet ekstra Fleet-opslag. Faktisk pakket Chromium med inert HA viser fire friske ladefakta og samme 256 px bilslot uden overlap; omission skjuler alene sluttiden. Tilvalget annonceres via eksisterende HA-serviceopdagelse, er som standard slået fra og dækker blandede klient-/komponentversioner, schema-rollback samt klient-/tokenskift. 205 fokuserede ejerprøver, tre faktiske HA-framework-prøver og uafhængigt review består. 2.0.154 / HA 0.1.18 er publiceret og versions-/commitverificeret efter officiel CI. Rigtig opladning og installation er ikke prøvet. |
| B8 | Adgangs- og klimakort vises på Mac/iPad → samme godkendte layout og betjening; fejl i hentning af funktioner genoprettes automatisk uden ekstra registrering | Delvist bevist — PodViews POWER-TOGGLE-REVIEW:15–23 og UI-DELIVERY-GOAL:445–454 samt billederne 87/88/82 dokumenterer gennemgået klima tændt/slukket, deaktiverede indstillinger, 64 px temperaturknapper og fælles knapgeometri. Produkt og bibliotek bruger samme VehicleView og kit. Adgangsfeedback følger ec085f57/860762e1; pakket Chromium 834×1194 viser de to kort og én deaktiveret Afrimning ukendt (B9). VEHICLE_RECOVERY_TEST på bundle cac4be37 genopretter klimabekræftelse efter mistet binding og 503→200; annullering sender nul handlinger, HA-skrivninger eller registreringer. Faktisk Mac/iPad-sammenligning er åben. De historiske referencer noterer fortsat brugergodkendelse af kontakt/afstande som åben; de bruges ikke som bevis for godkendelse af alle tilstande. |
| Q2 | Jeg åbner tidligere svar og modtager et nyt → historikken bevares, og opdatering flytter ikke utilsigtet mit læsepunkt | Delvist bevist — answers: rigtig pakket browser med inert svarkilde bevarer historik, synlig DOM, tastaturfokus og scroll 122→122 ved nyt svar. Ny kvittering indlæses; historiklæsning afbrydes ikke. Enhedstest viser normal automatisk præsentation efter historik forlades. Green 2.0.160 åbnede det gemte El Clásico-svar med samme tekst, tidspunkt og AI-forklaring. En ny besked til Køkken under læsning afventer normal Voice PE-brug. Admin Talk leverer til sit eget Talk-rum og afspiller lyd. |
| B9 | Afrimningsstatus mangler → ingen to modsatrettede afrimningsknapper; behold godkendt enkelt betjening med ærlig status. Ukendt er ikke automatisk Slukket | Bestået mod historiens konkrete acceptkrav — verificeret i officiel 2.0.166 CI42800322702 med rigtig browser og kontrolleret fejlkilde; eksisterende relevante Green-observationer genbruges. Der kræves ikke fysisk fremprovokation af denne fejlgren. Tidligere evidens: Delvist bevist — vehicle-browser: manglende afrimningsstatus giver én deaktiveret kontrol; ingen modsatrettet dublet. Kendte søskendefelter bevares. Eksisterende 834×1194 Chromium-billede viser samme enkelte deaktiverede Afrimning ukendt og tilgængelige nabokontroller. Den eksisterende regel om ærlig ukendt status bruges; fysisk iPad er åben.|
| B10 | Jeg åbner Tesla-handlingens bekræftelse → korte præcise tekster og knaplayout matcher godkendt dialog; efter bekræftelse viser netop den berørte kontrol straks neutral igangværende tilstand og spinner (fx Låser op…), indtil HA bekræfter resultatet eller der vises konkret fejl/ukendt udfald. Baggrundsopdatering nulstiller ikke feedback. Ingen ekstra accordion med dubletter af hovedknapper | Delvist bevist — lokal rettelse ec085f57 efter 2.0.151 matcher statusplacering, bagagerumsikon og godkendt oplåsningsdialog. Rigtig Chromium med inert HA viser neutral Låser op… og spinner straks efter modalbekræftelse, gennem tilbageholdt POST, Home-læsning og accepteret kvittering. Først en nyere observation af samme felt/bil bekræfter resultatet; afvisning og ukendt udfald vises uden automatisk gentagelse. Tre browserforløb og fokuseret review bestod. Opfølgning 860762e1: efter kvittering kan uafhængig funktion hente egen bekræftelse; før kvittering bevares ejerens serialisering. Pakket Chromium viser separate lås-/bagagerumsobservationer, nul skrivning ved annulleret klimamodal og bevaret ukendt låseudfald ved bagagerumssucces eller -afvisning. Fokuseret review gav GO. Samlet 2.0.152-kandidat bygger samme produktbundle 2e35884d som browserprøven. UI-suiten består (fire loopback-prøver genkørt efter sandbox-afvisning). 2.0.152 er publiceret fra merge 85c21759 efter officiel CI; image-digest df89eb2d og release-tag er verificeret. Green viste Lås bilen op? i DOM kl. 15.24, og Annuller lukkede den. Den umiddelbare AX-aflæsning i samme forløb havde endnu ikke vist dialogen. Den aktive feedback og bileffekten efter bekræftelse afventer Green-prøve. |
| B11 | HA viser frisk lås-, bagagerums- eller klimastatus → PodView viser samme kildeværdi; et manglende felt erstatter ikke øvrige kendte data eller fortolkes som Åbent | Delvist bevist — ejerregressioner + lokal HTTP: manglende/null/ugyldig rt bliver ikke Åbent; kendte søskendefelter bevares med originale tider. Bagagerumstilbud og sidste afsendelse kræver matchende lokal HA-kilde; gyldig 12 timer gammel rå status bevarer betjening og mærkes stale med oprindeligt tidspunkt; gammel komponent uden kontrakt afviser handling. Ingen fysisk bilprøve |
| V4 | Jeg går fra forsiden til vejrdetaljer → temperatur, tilstand og tidspunkt er konsistente; manglende ikon påvirker hverken temperaturspænd eller søjlens bredde | Bestået — Green viste samme temperatur og tilstand på forside og detalje med samme temperaturspænd og fælles timepunkter. Den pakkede WEATHER_RETENTION_TEST dækker samme hentetid i begge visninger og uændret temperaturspænd og søjlebredde med manglende eller ukendt ikon. |

## Samlede forløb og svære tilfælde

Kør de relevante historier som sammenhængende forløb, ikke kun som isolerede første tryk:

- Musik: stemme eller Spotify-start → korrekt titel/output → køvalg → pause/fortsæt → 10 min refresh → stadig kontrol. Samlet A12→A10-softwarebevis på pakket 2.0.156: syntetisk Thin/ToolRouter-stemmestart, separat titel/outputobservation, anden forekomst af samme kø-URI, Pause/Fortsæt, 600,013 s reel ventetid og 239 passive ejerlæsninger uden automatisk handling. Derefter Pause/Næste/lydstyrke 55/Fortsæt med præcis sekvens 3–10 i samme dokument, konto, native session, rum og route-epoch. Eksisterende tests/browser/music_selection_actual_e2e.cjs, MUSIC_VOICE_JOURNEY_TEST=1 med MUSIC_LONG_SESSION=1. Rigtig Voice PE, Spotify og fysisk lyd er ikke bevist.
- Output: Køkkenalrum → andet rum → tilbage → Spotify på iPhone/bil → tilbage → stadig kontrol og korrekt kø. Samlet softwarebevis 8. november: H5→H7 på pakket 2.0.156 i ét Chromium-dokument. Begge lokale adgangsfrister passeres med passive ejerlæsninger uden handlinger. Tesla→iPhone tilbagekalder rum-/køadgang; hjemkomst giver nyt køtilbud til samme ejer, og eksplicit pause/fortsæt samt køforekomst 24 udføres én gang hver. Inert PodConnect, ingen rigtig Spotify eller fysisk lyd. Eksisterende tests/browser/music_actual_e2e.cjs, MUSIC_OUTPUT_TRANSFER_TEST=1.
- HA-app: første åbning → navigation → dvale → genåbning → netudfald → automatisk recovery på Mac og iPad.
- Robot: vælg rum/type/vand/rute → start → pause/fortsæt/base → statusopdatering → bevar relevante valg.
- Opskrift: widget → katalog → start → trin/timer → tilbage til katalog → genåbning → afslutning.
- Tesla: kendt HA-status → dvale → egne handlinger eller ekstern ændring → frisk HA-status og korrekte klimaregler.

For berørte historier dækkes langsomt svar, afvisning, timeout med ukendt udfald, tabt svar,
dobbelte/ombyttede events, hurtige brugertryk, delvise data og reelt tomt resultat. Et sent svar
må ikke genoplive en gammel sang, højttaler, opskrift eller valgt tilstand. Næste/forrige tæller
hvert eksplicit tryk; slideropdateringer skal ende på brugerens seneste værdi uden tilbagespring.

## Åbne produktdetaljer til gennemgangen

- Ved visuelle krav angives eksisterende godkendt screenshot/visning og revision i historiens egen række,
  samt hvilke skærme og tilstande referencen dækker. Agenten genfinder først eksisterende godkendelser.
  Et fejlrapport-screenshot er ikke automatisk en godkendt reference. Manglende reference står åbent;
  den må hverken erstattes af et nyt design eller ophæve brugerens allerede kendte adfærdsregler.
- Tesla-betjening når bilen er væk hjemmefra blev spurgt til, men hjemmestedslåsning er ikke besluttet her.
- Kilden og den præcise præsentation af robotfremdrift skal afklares; procent må ikke opfindes.
- Nye søge-/konto-overtagelsesflader (F3, H2–H3) samt eksisterende timers adfærd ved opskriftsafslutning
  afklares før nyt UI implementeres. De er ikke stiltiende godkendt af denne dokumentopdatering.

Tests beviser kun det, de måler: fixture/browser, rigtig HA/service og fysisk effekt angives særskilt.
Ved UI-sammenligning dækkes hele vejen fra widget til undersider, dialoger og accordions samt loading,
valgt, igangværende, fejlet og tom tilstand. Samme kanoniske komponent bruges i eksempel og produkt;
korrekt komponentnavn alene beviser ikke korrekt layout. Et dokumenteret fokusomrids fjernes ikke for
at få et screenshot til at ligne referencebilledet.

En historie med delvis dækning bliver ikke fuldt bevist på baggrund af en grøn områdesuite eller en release.
