# Aktuel status · #166 dokumentation / #156 / GPT-Live v2.x · 15. oktober 2026

**Lead:** root. V2.x er **kun GPT-Live med full duplex** for Voice PE og Talk.
Brugeren har præciseret den allerede valgte retning; det er ikke en ny featurebestilling.
Mit tidligere #164-P1-fund og #156-dokumenternes krav om lukket mic under svar var
forkerte anvendelser af en v1.x-kontrakt. De er trukket tilbage; intet mic-gatefix laves.

## Aktiv beslutning · #164 og oprydning af forældede krav

**Observeret fejl:** docs/agentkontrakt blandede v1.x-half-duplex og Realtime-wirekrav
ind i GPT-Live v2.x. Det gav et fejloprettet P1-issue. Kilden og den eksisterende
`test_selection_is_next_wake_and_stop_rejects_stale_stream_and_generation` i
`tests/integration/test_thin_live.py` kræver derimod mic-append under native playback.

**Kæde og invarianter:** firmware → VoicePELink → ThinSession/Live-input → GPT-Live →
outputstream/Live WAV → fysisk playback → afbrydelse/opfølgning → close/rearm/næste wake.
Aktiv session, privacy, connection/audio-generation, inputrevision, toolpolicy,
confirmation-rotation, fysisk output og én teardown/rearm bevares. State er lifecycle,
ikke et påbud om at lukke Live-input mens modellen tænker/taler. Transcript-fragmenter
må ikke opfindes som speech-start/interrupt-ACKs eller bruges til lokal semantik.

**Hypotese:** den konkrete #164-P1 er kravdrift, ikke en runtimefejl. Den falsificeres,
hvis Live-input under playback ikke er tilsigtet i gældende v2.x-retning; brugerens
præcisering og eksisterende kausale regression bekræfter netop denne retning.
Åben mic beviser ikke akustisk sikkerhed eller hørbar afbrydelse. Kilden har ingen
almindelig Live-inputfragment→stop_playback-kobling; provideren kan ændre sin løbende
outputstrøm. Det faktiske hørbare resultat er ikke afgjort af denne audit. #112/#103
følger full-duplex-input/afbrydelse/fortsættelse uden selvsvar, lukning og næste wake.
Der oprettes ikke en ny feltfejl alene ud fra manglende lokal interrupt-callback.

**Faktisk docsændring:** AGENTS, detaljeret agentkontrakt, README, INVARIANTER,
PRODUKTMÅL og ARKITEKTUR beskriver GPT-Live-only/full duplex. Gamle provider-vælgere,
closed-mic-gates og fabricated Realtime-ACKs er ikke v2.x-produktkrav. Historiske
Realtime-regressioner beholdes særskilt, ikke som en parallel produktionsmotor.
Native `full_duplex=False` er et legacyflag; Live-pump bypasser det eksplicit. Flaget
ændres ikke blindt, fordi andre grene også læser det.

**#166 og CI-hastighed:** brugeren bestiller hele projektets docs-/agentoprydning og
integration af #157's udviklings-/CI-forbedringer med #156. Alle 29 eksisterende
Markdown-filer plus nyt indeks er dækket. Direkte kildefund: Dockerfile kopierer
requirements/gatekeeper/run, ikke top-level DOCS/CHANGELOG; CI's `podvoice/**` tæller
alligevel disse som imageændring og kan udløse unødigt build/immutable-versionfejl.
Den afgrænsede hypotese er, at en eksakt nonpayload-allowlist og korrekt imagefilter
fjerner dette arbejde uden at lade nogen payload-/config-/workflowændring passere.
Kæden er changed paths → scopeklasse → required checks → addonchanged → immutable
publisherguard. Ukendt/escaped/ægte payload forbliver fuld CI; gatekeeper-Markdown må
ikke skjules generisk. Planlagte regressioner er positiv docs-only og negativ
config/requirements/run/Docker/gatekeeper/workflow, samt faktisk filtermatching og
bevarede guardtests. Uafhængigt review binder ændringen før freeze. Rollback er det
samlede CI/tooling-delta; versions-/publisherautorisation omgås ikke.

**Faktisk #166-CI-rettelse:** samme `git diff --no-renames -z` leverer tooling_only,
addon_changed og pr_addon_changed. Kun to eksakte top-level add-on-docs og to
script/spike-guides får nonpayload-undtagelsen; escaped/backslash/symlink/missing
paths og ukendt scope narrowes ikke. En eksisterende ikke-forfader afvises før diff.
PR-imagebuild og main immutable-guard bruger samme vurdering; dorny-dobbeltfilteret
fjernes. Reelle payload-/config-/workflowændringer beholder kontrollerne.

**Faktiske kontroller/review:** eksisterende CI/release-kontrakttests bestod samlet
50 cases før sidste rene parameter-/ancestrytilføjelser; kun scopefilen blev derefter
genkørt, sidst 47/47 PASS. Release-kontraktbits genbruges; metadata-versiontesten
og hele den berørte syntetiske music-scope-fil bestod efter 29-bump. Ruff/format og
diff-check PASS på ændrede Python-filer; 30/30 Markdown-links findes. Ingen ny lokal
bred suite, testplatform, provider- eller fysisk prøve. Den første linkscan læste
Git-quoted Unicode-navn forkert; kun den scan blev rettet til NUL-skilte filnavne.
Sol-reviewer(e) GO på docs/metadata/fixture; selvstændigt Ultra-review GO på CI ved
scopehash `cd6dcf898ec50710ac0cd6cee5cd8831395f3d97f7c4446f2e865504d759acd8`,
testhash `f3fc46593dbd86a440616f3ce24af95beb6360fdba3ced7f914a02230f44582c`,
workflowhash `05111a17f2c488af78618ee6aec75da2f749ddb7802d609c607209d29bc5430e`.
Ancestryfinding er lukket med permanent actual-Git-regression. Ingen uløst P0–P2
på det reviewede diff. Sidste mekaniske scope PASS mod main e272d181.

**Afgrænsning:** #166 ændrer docs, præcis CI-scope og issues; #156's tidligere
reviewede konstruktions-/replay-/packagingændring leveres samlet med version29.
Thin/provider/prompt/schema/audio/firmware ændres ikke. PodView28 bevares.
Slut-PR/main-CI og publisher afventer; kvitteringer registreres i PR/issues uden
post-CI docs-commits. Fysisk testinstallation og dens accept står separat.

**Ny leveringsordre:** brugeren beder nu om at merge alle færdige ændringer, så nyeste
samlede version er klar. #165/#156 og #166 samles derfor i én 2.0.29-kandidat fra
seneste udgivne 2.0.28. Versionbump er nødvendig, fordi #156 ændrer faktisk image-
payload og den immutable publisher med rette afviser genbrug af 28. Kun metadata,
release-note og den versionsuafhængige syntetiske scope-fixture ændres yderligere.
CI/source-review og første officielle slut-PR/main-CI åbner merge/publicering; ingen
manuel CI-retry uden faktisk invalideret årsag. HA/Voice PE installeres eller flashes
ikke af denne ordre: den eksisterende fysiske prøveversion står urørt. Rollback er
forrige immutable image; en ny udgivelse arver ikke fysisk accept.

## Slut-CI · afgrænset fixtureopfølgning

Første slutrun [38703933906](https://github.com/BixelVentures/podvoice/actions/runs/38703933906)
på head `beb12fc0e4b336d5f712b238fddcf75de269fafc`, tree
`741b8eb02e13cf88c896185f2f02065fd5be138e` bestod scope, rest, browser og ARM-build;
unit fejlede på to gamle `test_dev_cycle.py`-assertions om det fjernede dorny-filter.
Lead havde ikke fanget disse to kaldesteds-/workflowfixtures før freeze. Run bevares
som fejlet. Kun de to assertions er opdateret til den faktiske fælles scope-/publish-
kontrakt; hele assertionkæden og øvrige referencer er gennemgået. De to noder bestod
2/2, Ruff/format/diff-check PASS. Lead-review bekræfter bevarede parallelle ARM-/
main-checks og immutable guard; fixturehash
`ba734d0c5fceb6dc214dc1bcb75b95887afb4862e92bc15c85077e7d15b145a6`. Der følger ingen
runtime-, version-, CI-policy- eller payloadændring. Tidligere produktchecks og
reviews genbruges; kun de to berørte noder og filens statiske checks køres lokalt.
Den nye officielle exact-head CI og derefter normale main-publisher skal bestå før
færdig levering. Endelige kvitteringer står i PR/issues, ikke et nyt post-CI commit.

## Kilde- og leveringsbinding

29-produkt-/metadatamanifest SHA-256: `6cfd0eb10f1cbbce389759e3a65161435154b249d5f6d2cc6a263455081a4020`.

```text
678af0c37f5103309f02116565b8721ec089d96ce318eebbacee1c9935f82ce4  podvoice/.dockerignore
ab77f51966601e0f0a4079b2c070e1ac23ddfa797a8fa883cb90a3cf417e482f  podvoice/gatekeeper/__main__.py
e5e06a851f18b14d434893271fa80a1c27a512f9c27550a2ba57a69a141c2a59  podvoice/gatekeeper/eval_harness.py
4523f241e408ed224785f5ac5a0352b11a552bc9d7fbc4544d0f2b3f04507510  podvoice/gatekeeper/web.py
31279c153f2c79a6e3e36f88e8423485e08363dc282c012b029e37605ef95df8  podvoice/gatekeeper/__init__.py
ea1fa533eef3530200bde92649bdb3ba853eff7fdfac45d981605120b0b4d12f  podvoice/config.yaml
cafba1b85e0c2dc535a5124ded432afcf7a7572306056c63da2552e0f01d2898  pyproject.toml
```


- PodVoice main / udgivet 2.0.28: `e272d1813930b819c019ca48469bf6f796f4fec0`.
- #156-produktrefaktorering: [draft PR #165](https://github.com/BixelVentures/podvoice/pull/165),
  kode/test-head `bb9db7f57d547b404b704b77d043243dff91fd1b`, tree
  `fbe3e8ff7a6a8ed34be138ec65d4587593bd6df7`. Exact-head CI
  [38697957426](https://github.com/BixelVentures/podvoice/actions/runs/38697957426)
  bestod scope/unit/browser/ARM/rest. #156-runtimebytes genbruges; 29 ændrer versionsmetadata/beskrivelser som reviewet.
  Første [CI 38696690975](https://github.com/BixelVentures/podvoice/actions/runs/38696690975)
  bevares som fejlet; de to stale fixtures blev rettet og fokuseret godkendt.
- PodConnect main: `8b178943e7c937338edaeeaffb2bf01600b696b1`; Control 0.10.11 har
  [grøn HA-CI](https://github.com/BixelVentures/podconnect/actions/runs/38688246337).
  Speakers 0.26.18/RSS-writerfix kom fra `643b86488a6af9392f82f6098531c61ee16b6f4c`,
  [native check](https://github.com/BixelVentures/podconnect/actions/runs/38415648831)
  og [publisher](https://github.com/BixelVentures/podconnect/actions/runs/38415648981) grønne.
- Sidste egen HA-readback herfra er fortsat PodVoice2.0.27/`669e739a`, artifact
  `rootfs-v1:c5855fa18a9f01ef9c7dcfbe0498b8cb64c0a95cbf36ff911fea60efb02559fb`,
  firmware `podvoice_build_113114_livetimeroutput1`. Nyere installation ejes af PodView-
  chatten og er ikke genlæst i denne audit. GitHub-release er ikke HA-readback.
- Brugeren har tidligere bekræftet Texas Sun→næste nummer, hurtig mobil→HomePod-lyd
  og perfekt højttaler→højttaler-flytning. Det er delvis fysisk evidens, ikke nul test;
  det arver ikke fuld accept på en nyere samlet kandidat.

## Alle åbne issues vurderet mod koden

27 PodVoice-issues (inklusive tre epics) og otte tilknyttede PodConnect-issues er læst
og sammenholdt med aktuelle ejere, callsites, eksisterende regressioner og leverings-
kvitteringer. Tre parallelle agenter bidrog; lead korrigerede historiske P0-/duplex-
slutninger med nyere source/publisher og brugerens fysiske tilbagemeldinger. Ingen
nye tests, providerkald eller fysiske prøver blev startet til selve auditen.
Prioritet er næste handling, ikke en påstand om, at alle gamle symptomer stadig findes.

| PodVoice | Aktuel status | Næste handling |
|---|---|---|
| [#94](https://github.com/BixelVentures/podvoice/issues/94) · P1 | Åben epic: måling og optimering | #104 først; #106/#105 vælges ud fra største målte ventetid. #108 samlet accept. |
| [#95](https://github.com/BixelVentures/podvoice/issues/95) · P2 | Åben epic: hovedparten af UI-koden leveret | #113 reel rollback og #115 samlet mobil/HA-app/Talk/accessibility-accept. |
| [#96](https://github.com/BixelVentures/podvoice/issues/96) · P1 | Åben epic: daglig brug og samlet accept | Prioritér aktuelt observeret svar/close, musik/timer og full-duplex-afbrydelse; derefter #112/#116. |
| [#98](https://github.com/BixelVentures/podvoice/issues/98) · P2 | Kode leveret; native evidensaccept åben | Kontrollér komplet native device/provider/speaker-kæde i den samlede prøve; ingen ny testplatform. |
| [#101](https://github.com/BixelVentures/podvoice/issues/101) · P2 | Historisk symptom; ingen ny kildebevist fejl | Kun genåbn konkret koderettelse hvis samme symptom ses med aktuel input/tool/lydkæde; medtag ét tidsopslag i serien. |
| [#102](https://github.com/BixelVentures/podvoice/issues/102) · P3 | Historisk regneopfølgning; nedprioriteret | Ingen lokal regnemotor eller tuning fra gammel transcript. Vurder kendt input/lyd/kontekst hvis fejlen gentages. |
| [#103](https://github.com/BixelVentures/podvoice/issues/103) · P1 | Lifecycle-kode/regressioner findes; fysisk accept åben | Samme-artifact samtale, afbrydelse/opfølgning, lukning, fuld lyd og ny wake. ON/OFF-motorvalg er forældet; Live-only gemte præferencer bevares. |
| [#104](https://github.com/BixelVentures/podvoice/issues/104) · P1 | Aktuel Live-baseline mangler; gammel reporter er Realtime-specifik | Brug korreleret rum/device-taleslut→første meningsfulde lyd med faktisk clockproveniens på samme kandidat. Bevar reporterens legacy40 adskilt; ingen ny testplatform. |
| [#105](https://github.com/BixelVentures/podvoice/issues/105) · P2 | Ingen dokumenteret ny opstartsoptimering | Afvent #104-data; bevar same-breath-input og kontinuerlig Live-input. Ingen blind timeouttuning. |
| [#106](https://github.com/BixelVentures/podvoice/issues/106) · P1 | Måledrevet svartidsarbejde åbent | Optimér største målte flaskehals fra #104. Gamle ON/OFF-adaptervalg og half-duplex-krav er historiske. |
| [#107](https://github.com/BixelVentures/podvoice/issues/107) · P1 | Lukkerettelser leveret; oplevet tid mangler | Mål aktuel talebesked→fuld lukning og næste wake. Forkort kun dokumenteret unødig ventetid, ikke guards ud fra gammel måling. |
| [#108](https://github.com/BixelVentures/podvoice/issues/108) · P2 | Samlet latencyaccept mangler | Vurder v2.x full duplex og meningsfuldt fysisk svar på samme bits; historiske mål bevares, ingen half-duplex-gate. |
| [#109](https://github.com/BixelVentures/podvoice/issues/109) · P2 | Recovery implementeret; systemaccept åben | Kontroller faktisk HA/MCP-tab→tilbagekomst uden reload/genstart eller tabt Live-samtale i samlet prøve. |
| [#110](https://github.com/BixelVentures/podvoice/issues/110) · P1 | HA-timer/lyd/Stop-kode findes; fysisk accept åben | Hør reel alarm, stop den, bekræft stilhed og næste wake. Manglende lyd er ikke løst alene af status/CI. |
| [#111](https://github.com/BixelVentures/podvoice/issues/111) · P1 | Recovery/attention-kode leveret; samlet accept åben | Aktuel Spotify/Connect-recovery, hørbar duck/restore og næste wake; saml med #118 og PC#9/#10. |
| [#112](https://github.com/BixelVentures/podvoice/issues/112) · P1 | Fysisk funktionsmatrix åben | Dansk/hjem/vejr/web/musik/timer/opfølgning samt tale under svar→relevant afbrydelse/fortsættelse uden selvsvar. Åben mic er ikke alene bevis. |
| [#113](https://github.com/BixelVentures/podvoice/issues/113) · P2 | Live-only migration leveret; reel rollback åben | Navngiven faktisk Supervisor/image+config rollback og platformaccept mangler. Gamle motorvælgere er ikke produktfunktion. |
| [#115](https://github.com/BixelVentures/podvoice/issues/115) · P2 | Browserrettelser leveret; samlet platformaccept åben | Samlet mobil/HA-app/Safari/VoiceOver, keyboard/safe-area, Talk/autoplay/drain og tilgængelighed; ingen ny samtaletest-UI. |
| [#116](https://github.com/BixelVentures/podvoice/issues/116) · P3 | Syvdøgns observation ikke accepteret | Efter funktions-/platformaccept: observer samme version uden manuelle genstarter. Dette er ikke syv dages yderligere kodearbejde. |
| [#118](https://github.com/BixelVentures/podvoice/issues/118) · P1 | Mål-/flyttekode leveret; delvis fysisk bekræftelse | Kreditér det bevis; fuld aktuel kandidat/queue/duck/close/nextwake-accept mangler. Ingen ny kildebevist flyttefejl fra audit alene. |
| [#119](https://github.com/BixelVentures/podvoice/issues/119) · P2 | Kapacitetsbeskyttelse kodet; oprindelig årsag uafklaret | Skeln gammel lokal afvisning/providerkvote fra aktuel drift. Ved gentagelse: korrelér tool-batch→resultat→cleanup; ingen kvote-/timeouttuning uden årsag. |
| [#124](https://github.com/BixelVentures/podvoice/issues/124) · P1 | Input/close-rettelser leveret; fysisk accept åben | Ny tale må ugyldiggøre gammel close, også under svar. Kontroller fuld lyd, fortsættelse, lukning og ny wake; ingen mic-lukning som workaround. |
| [#150](https://github.com/BixelVentures/podvoice/issues/150) · P2 | PodVoice-fejlkontrakt rettet; HA-konfiguration uafklaret | Aktuelle HA-scriptbytes er ikke læst i denne audit. Bekræft faktisk resultat eller sand fejl; kode alene beviser ikke ekstern scriptrettelse. |
| [#151](https://github.com/BixelVentures/podvoice/issues/151) · Senere | Eksplicit udsat af brugeren | Bevar udsættelsen. Undersøg senere; ingen skjult feature- eller releaseblokering nu. |
| [#153](https://github.com/BixelVentures/podvoice/issues/153) · P1 | Observeret taleproblem; årsag stadig åben | Afklar hvad der faktisk høres i aktuel version og bind input/provider/speaker. Fjern gammel 'afventer merge'-status; ingen blind tekst-/PCM-filterpatch. |
| [#156](https://github.com/BixelVentures/podvoice/issues/156) · P2 | 2.0.29-kandidat klar; slut-CI/merge afventer | Brugeren har bestilt samlet merge/udgivelse efter grøn CI; fysisk installation urørt. |
| [#164](https://github.com/BixelVentures/podvoice/issues/164) · Forældet | Lukket som forældet fejlfortolkning | Intet mic-gatefix; faktisk afbrydelse/akustik følges i #112/#103. |
| [#166](https://github.com/BixelVentures/podvoice/issues/166) · P1 levering | Agent-/docs-/CI-oprydning kildefærdig | Samlet slut-CI, merge og 29-publicering; ingen HA-installation her. |
| PodConnect | Aktuel status | Næste handling |
|---|---|---|
| [#6](https://github.com/BixelVentures/podconnect/issues/6) · P2 | Autoplay-fix leveret; én fysisk overgang bekræftet | Følgende nummer/øvrige kø/start/reconnect/OFF/stop-veje er ikke fuldt accepteret; ingen ny kildebevist fejl. |
| [#8](https://github.com/BixelVentures/podconnect/issues/8) · P1 | Rum-/targetflytning leveret; delvis fysisk bekræftelse | Samme aktuelle artifact + bevaret queue/position/duck/restore/nextwake; aktuelt Control0.10.11 er kode/CI, ikke installeringsbevis. |
| [#9](https://github.com/BixelVentures/podconnect/issues/9) · P1 | Native attention/custody-kode leveret; samlet accept åben | Faktisk installation af18 er ikke genlæst her. Aktuel A→B-volumen/restore/stale-owner og nextwake kræver fysisk accept. |
| [#10](https://github.com/BixelVentures/podconnect/issues/10) · P1 | Konkrete races rettet; delvis fysisk forbedring bekræftet | Tidligere lydløse episode er ikke fuldt årsagsforklaret; mål aktuel visning/valg/hørbar start før yderligere kodeændring. |
| [#11](https://github.com/BixelVentures/podconnect/issues/11) · P2 | Stale target/status-races rettet; aktuel accept åben | Resterende samme-artifact targetaccept samles med #8/#10; åben checkliste er ikke i sig selv manglende implementering. |
| [#12](https://github.com/BixelVentures/podconnect/issues/12) · P2 | Falske play-kvitteringer rettet; gammel403-årsag uafklaret | Ingen ny auth/pairingpatch uden aktuel kausal episode; gammel /info og pair-pin403 må ikke sammenblandes. Fysisk accept åben. |
| [#13](https://github.com/BixelVentures/podconnect/issues/13) · P2 | Contextforberedelse og URL-fix leveret; feltårsag uafklaret | Gammel konkret404-årsag og fuld postfailure/next-command-afspilning ikke accepteret; ingen blind retry/fallback. |
| [#29](https://github.com/BixelVentures/podconnect/issues/29) · P1 accept | Startup- og RSS-writerfix leveret; historisk P0 er ikke ny bevist fejl | Generisk manglende totaldeadline er ikke i sig selv en aktuel kildebevist blocker. Feltårsag/installeret18/Connect→lyd-accept er fortsat uafklaret. |

## Prioritet nu

1. Merge/publicér den samlede reviewede 2.0.29-kandidat efter grøn slut-CI.
   #164 er lukket; #156/#166's leveringskvittering opdateres efter faktisk resultat.
2. Daglig brug: afklar faktisk gentaget kvittering (#153), close under ny tale/lukketid
   (#124/#103/#107), musik/attention (#118/#111, PC#9/#10) og timeralarm/Stop (#110).
   Kod kun ved en aktuel kausal fejl; flere af rettelserne er allerede leveret.
3. Saml én aktuel fysisk serie, herunder tale under svar→relevant fortsættelse uden
   selvsvar. Brug samme artifact og de eksisterende optagelser; krediter tidligere PASS.
4. Tag #104's faktiske latencybaseline og optimér største målte flaskehals (#106/#105).
   Ekstern HA-webfejl (#150), recovery (#109), reel rollback (#113) og UI (#115)
   får konkrete kilde-/systemchecks; udfør ikke blind tuning fra gamle incidents.
5. #151 er udsat af brugeren. #102 er lavere prioritet. #116 er senere observation,
   ikke en begrundelse for flere ugers udvikling eller at blokere daglig brug.

Alle uafsluttede produkt-/latency-/UI-epics forbliver åbne. Kilde, CI, publicering,
installation og fysisk accept er separate påstande; ingen af de gamle lukkede-mic-
krav genindføres som en gate for v2.x.
