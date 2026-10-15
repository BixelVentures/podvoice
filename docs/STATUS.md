<!-- candidate-scope-coupling
{
  "version": 5,
  "kind": "podview_native_source_ui_parity",
  "base_tip": "beed27b0528917e4872516a53d88bedb17d3d6ed",
  "merge_base": "beed27b0528917e4872516a53d88bedb17d3d6ed",
  "domains": [
    "ha_tools",
    "physical_output"
  ],
  "fingerprint": "74ea9dfc454b2834912bd967baa1ba0a2d213a02778ad7a56b27da2dfcd956bb",
  "regression_fingerprint": "1698407dd8a78227f457535afbe06d19874470bf82e06a2702a31bb510dff8c1",
  "policy_fingerprint": "1ba69b0d815d54507a2dc5d766a53faffb00bdc478e6316da621dd268a212da2",
  "config_fingerprint": "16115112cc71407eff6710402a473d0fc1bdae49cba124a4af1d21fbf5c58e17",
  "manifest_fingerprint": "ac9b6a75ca687dc93aa7357f7d8291777516a71e09116929aa1e99c7b3fa4fd8",
  "reviewer": "independent GPT-6.1 Sol Ultra / final_freeze_ultra / 2026-10-15",
  "rationale": "Independent final source GO on exact PodVoice30 and coupled PodConnect native05be2aec. Exact closed runtime and regression inventory; historical policy guards retained. Actual domains include ha_tools from existing large-diff weather text. CI, image, installation and physical acceptance remain pending. CI fixture repair: observed empty permits start; existing owner ID blocks new start and remains cancellable. Independent scoped delta GO confirmed by final_freeze_ultra; runtime and config unchanged."
}
-->

# Aktiv beslutning · samlet PodView UI/data-paritet · 15. oktober2026

Lead root. Status: planlagt build; 2.0.30 reserveret og forberedt, ikke installeret/testklar. Bruger bestiller samlet Green-installation med låst demoUI og fortsat parallel udførelse. Ny base er public2.0.29 a1bdc2ba1cf9e80f62874e4764586ec10d6d8042 med docsopfølgning beed27b0528917e4872516a53d88bedb17d3d6ed; tidligere28-base er historisk. v2.X har bekræftet29 publiceret, Green sidst28;30 er efterfølgende reserveret; deres opfølgende docsændringer skal bevares.

Observeret: Green bruger afvigende live widgets; lokale kort/playergeometri og tilstandsrettelser skal deles med native runtime. Reviewede isolatedinputs er native startpolicy0d1231e9, PodVoice native roomcontractb150a929, kiosk71673c69, hourly adviceb224b418 og fælles rootUI. Hypotese: fælles renderere + eksplicitte dataadaptere giver samme UI uden at tildele passive data ny autoritet. Native Speakers ejer startvolume/autoplay; PodVoice ejer serverissued valg og GPT-Live samtale; viewer er ingen grant. Ukendt effekt gensendes ikke.

Kæde: autentificeret HA-frame → room/account/source/ownerepoch → sourcebundne candidateIDs → paired serverissued option/session/task/revision → native prepare/readback/oneusecommit → provider/nativeobservation → samme player. Udløb, tab/boot/accountskift, revocation mellem awaits, duplicateclick og pagehide er nabogrænser. Timer/robot retain autoritative IDs og ingen simulerede data i live. Ingen Thin/firmware/prompt/providerændring; public29 GPT-Live-only/full-duplex/CI bevares.

Plan: compose exact reviewed narrow patches, ret faktiske mergekonflikter uden at genindføre28runtime; målrettede regressioner via durable scripts/dev fast; strict existing admission profiler skal udvides/reviewes til faktiske ændrede bytes, ingen gatebypass; uafhængigt adversarial review og exactmanifest; officiel PR/main/ARM64CI; faktisk Greenversion/assets/datareadback før testlink. Fysisk lyd/robot/iPadaccept rapporteres særskilt. Rollback: bevaret installeret28 og public29, nye grants/betalt AI er ikke aktiveret her.

Nye produktkrav til Stemning (ikke foregivet færdige): rigtige playlister, egen AI ud fra lokalt tidspunkt/rum med matchende skiftende illustrationer, kun initialload/Andre forslag ændrer indhold; fanenavigation bevarer valg. Autoplay næste+lignende er eksisterende nativeadfærd som skal bevares og verificeres. Humør som mulig nyfane er under brugerafklaring; ingen lydløs ny fane eller playlistfallback. Original20visualfactselectorbudget giver ingen ny moodAIudgift.

---

# Aktuel status · 2.0.29 leveret / resterende produktarbejde · 15. oktober 2026

**Lead:** root. V2.x er **kun GPT-Live med full duplex** for Voice PE og Talk.
Brugeren har præciseret den allerede valgte retning; det er ikke en ny featurebestilling.
Mit tidligere #164-P1-fund og #156-dokumenternes krav om lukket mic under svar var
forkerte anvendelser af en v1.x-kontrakt. De er trukket tilbage; intet mic-gatefix laves.

## Leveret og installeret er adskilt

**2.0.29 er publiceret:** PR #165 er merged som `a1bdc2ba1cf9e80f62874e4764586ec10d6d8042`,
exact tree `e670ecc2de6a235e68a0228e2c97b1e17a633c7e`. Slut-PR-CI
[38705578552](https://github.com/BixelVentures/podvoice/actions/runs/38705578552) og
[main-CI/publisher 38706448103](https://github.com/BixelVentures/podvoice/actions/runs/38706448103)
er grønne. Versionstag 2.0.29 og source-SHA-tag er faktisk pushet med digest
`sha256:3ad2d0a886cd294cf430ec85aed37cc85c433a467749666c2e4b56da6f117376`.
#156 og #166 er lukkede med leveringskvittering; #157 har den samlede opfølgning.

**Frisk HA-readback 15/10:** PodVoice-panelet viser v2.0.28/status live efter reload.
HA/MCP og PodConnect vises verificeret; Voice PE-vækning er ikke bekræftet. Dette er
ikke en image-digest-, lyd-, barge-in- eller lifecycleaccept. Root har ikke installeret,
genstartet eller flashet noget; den fysiske prøveversion er ikke ændret herfra.

## Aktivt arbejde · parallel færdiggørelse uden ny fysisk serie

Brugeren bestiller hastighed, recovery, mobil/settings og stabilitetsarbejde parallelt
med mindste tilstrækkeligt kompetente agenter. Tre GPT-6-Luna/medium-spor har gennemgået
de konkrete rester; runtimeændringer kræver fortsat årsagsbevis og leadbeslutning.

- **#113:** den manglende navngivne Supervisor-rollbackvej er nu skrevet i add-on-DOCS
  og uafhængigt kontrolleret mod config/settings-kilder og officielle HA-backupdocs.
  App-backup gendanner version/data; panel-`.bak` alene gør ikke. Ingen rollback udført.
- **#150:** den faktiske HA `google_web_sogning`-YAML er nu læst. Den bevarer
  `response_type=error` som eksplicit `ok:false` med kode/besked; den gamle påstand om
  ulæst konfiguration er ophævet. Én offentlig, syntetisk URL-søgning er kørt uden
  Voice PE. Efter brugerens konkrete godkendelse blev den gemte Sporing læst:
  15/10 kl. 10.49.11–10.49.12, 1,03 s, `response_type=action_done`, efterfulgt af
  `result: {output: https://www.home-assistant.io/}` og normal afslutning. Ingen
  script-, agent-, nøgle- eller driftsændring. #150's software/backendrettelse er
  afsluttet; #119 og fysisk Voice PE-/Talk-funktionsaccept står separat åbne.
  Den første automatiske afvisning og den efterfølgende brugergodkendelse bevares
  som proceshistorik; ingen ekstra kørsel blev brugt til at læse resultatet.
- **#153:** et eksisterende syntetisk spor er fundet i
  `/private/tmp/pv24-timer-close-results-20261014/candidate/baseline-timer-10s/`.
  Provider-PCM bliver ikke-nul omkring 12,499 s; providertranscript er `Mm.` ved
  12,532 s, før timerdelegation/resultat omkring 13,588/13,590 s. Prøvens promptfil
  er bundet til `a4d5b82c0567954119b5648666ff9e89f58d43c1` / SHA-256
  `96534d2c3682e8896c2871f3a769ecbc203bf540157e95d4967409a3167d736c`.
  Det er den GAMLE prompt uden det eksplicitte forbud mod ikkeverbale kvitteringer,
  som blev tilføjet i `975936bb1d6fd57a5089cc72b9ca778eee8c7757` og bevares i 29.
  Aktuel promptfil SHA-256 er
  `1f10f64d44962dc905c5a0f77882d9c62c89ee84cda867664810d03bb5c1b050`.
  Sporet beviser provider-output i dén gamle prøve, ikke en aktuel promptfejl, lokal
  timerkvittering eller den konkrete feltlyd. Rapporten forbliver FAIL; ingen rumlyd/
  akustisk accept arves. Ingen ny promptpatch er begrundet af denne prøve.
- **#104–107:** ingen ny målt fysisk flaskehals eller kildebevist unødig ventetid.
  Lukkegrace er ikke første-svar-latens. Ingen blind ændring af prompt, buffer eller timeout.
- **#109/#111:** eksisterende recovery dækker bounded probe/backoff, atomisk discovery,
  stale schema/generation og ingen genafspilning af side effects. Ingen ny kildebevist
  fejl er fundet; reel HA/Connect recoveryaccept står fortsat åben.
- **#115:** readiness/settings-koden og de eksisterende browserregressioner dækker
  kendte fejlveje. Faktisk HA-app/Safari/VoiceOver/tastatur/safe-area mangler fortsat.
- **#116:** syvdøgnsperioden er ikke startet som godkendt stabilitetsbevis. Den kræver
  accepteret samme artifact; observation er ikke flere ugers kodearbejde.

Denne opfølgning ændrer kun dokumentation/kvitteringer. Ingen ny produktversion,
providerprøvesuite, testplatform, firmware-, prompt-, lyd- eller lifecycleændring.

## Afsluttet beslutning · #164 og oprydning af forældede krav

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
Slut-PR/main-CI og publisher er nu PASS som registreret ovenfor og i PR/issues.
Denne nye opfølgning er særskilt docsarbejde; fysisk accept står stadig separat.

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
Kravet om ny officiel exact-head CI og derefter normal main-publisher er nu opfyldt.
Endelige kvitteringer står ovenfor og i PR/issues; ingen tests eller produktbytes
blev ændret efter den beståede kandidat.

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


- PodVoice main / udgivet 2.0.29: `a1bdc2ba1cf9e80f62874e4764586ec10d6d8042`.
  Forrige udgivne 2.0.28 var `e272d1813930b819c019ca48469bf6f796f4fec0`.
- Første #156-kildefreeze (historisk): [nu merged PR #165](https://github.com/BixelVentures/podvoice/pull/165),
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
- Frisk egen HA-panel-readback viser 2.0.28/status live som beskrevet ovenfor.
  Sidste egen fulde artifactkvittering er 2.0.27/`669e739a`, artifact
  `rootfs-v1:c5855fa18a9f01ef9c7dcfbe0498b8cb64c0a95cbf36ff911fea60efb02559fb`,
  firmware `podvoice_build_113114_livetimeroutput1`; disse er historiske og arves ikke
  som nye 28/29-identiteter. GitHub/image-publicering er ikke HA-readback.
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
| [#113](https://github.com/BixelVentures/podvoice/issues/113) · P2 | Live-only migration leveret; rollbackvej dokumenteret | Supervisor/app-backup-vej er dokumenteret; faktisk rollback og platformaccept mangler. Gamle motorvælgere er ikke produktfunktion. |
| [#115](https://github.com/BixelVentures/podvoice/issues/115) · P2 | Browserrettelser leveret; samlet platformaccept åben | Samlet mobil/HA-app/Safari/VoiceOver, keyboard/safe-area, Talk/autoplay/drain og tilgængelighed; ingen ny samtaletest-UI. |
| [#116](https://github.com/BixelVentures/podvoice/issues/116) · P3 | Syvdøgns observation ikke accepteret | Efter funktions-/platformaccept: observer samme version uden manuelle genstarter. Dette er ikke syv dages yderligere kodearbejde. |
| [#118](https://github.com/BixelVentures/podvoice/issues/118) · P1 | Mål-/flyttekode leveret; delvis fysisk bekræftelse | Kreditér det bevis; fuld aktuel kandidat/queue/duck/close/nextwake-accept mangler. Ingen ny kildebevist flyttefejl fra audit alene. |
| [#119](https://github.com/BixelVentures/podvoice/issues/119) · P2 | Kapacitetsbeskyttelse kodet; oprindelig årsag uafklaret | Skeln gammel lokal afvisning/providerkvote fra aktuel drift. Ved gentagelse: korrelér tool-batch→resultat→cleanup; ingen kvote-/timeouttuning uden årsag. |
| [#124](https://github.com/BixelVentures/podvoice/issues/124) · P1 | Input/close-rettelser leveret; fysisk accept åben | Ny tale må ugyldiggøre gammel close, også under svar. Kontroller fuld lyd, fortsættelse, lukning og ny wake; ingen mic-lukning som workaround. |
| [#150](https://github.com/BixelVentures/podvoice/issues/150) · P2 | Lukket; fejlkontrakt og HA-backend verificeret | Faktisk HA-YAML bevarer ok:false; én aktuel URL-søgning gav action_done og sandt output på 1,03 s. Fysisk accept følges særskilt. |
| [#151](https://github.com/BixelVentures/podvoice/issues/151) · Senere | Eksplicit udsat af brugeren | Bevar udsættelsen. Undersøg senere; ingen skjult feature- eller releaseblokering nu. |
| [#153](https://github.com/BixelVentures/podvoice/issues/153) · P1 | Tale-/backchannelrettelser leveret; aktuel accept åben | Det kendte Mm-spor brugte gammel prompt før rettelsen; ingen ny fejl på aktuelle bits er bevist. Bind faktisk feltlyd før ny patch. |
| [#156](https://github.com/BixelVentures/podvoice/issues/156) · P2 | Lukket; 2.0.29 publiceret | PR/main/publisher PASS; fysisk installation ikke ændret herfra. |
| [#164](https://github.com/BixelVentures/podvoice/issues/164) · Forældet | Lukket som forældet fejlfortolkning | Intet mic-gatefix; faktisk afbrydelse/akustik følges i #112/#103. |
| [#166](https://github.com/BixelVentures/podvoice/issues/166) · P1 levering | Lukket; agent-/docs-/CI-oprydning leveret | Samlet 29-publicering PASS; ingen HA-installation her. |
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

1. 2.0.29 er merged og publiceret; #156/#166/#157 har faktiske kvitteringer.
   Lever den afgrænsede rollback-/driftsdokumentation; HA-resultatkontrollen er PASS.
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
