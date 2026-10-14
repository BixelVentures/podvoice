# Aktuel status · 15. oktober 2026

**Lead:** root. Brugeren har **aktiveret nattens softwaremål**; fysisk accept afventer morgenprøven. Denne fil viser aktuel baseline
og aktive beslutninger. Ældre forløb er bevaret i det
[historiske statusarkiv](archive/STATUS-2026-10-14-pre-157.md); det er ikke aktuel evidens.

## Installeret baseline

- **HA Green:** PodVoice **2.0.25** med GPT-Live kører. Installeret via den normale
  HA-opdatering og frisk opstart matcher `ae9df631f90ff9ed0288be824ed957aec95e01f9`;
  artifact `rootfs-v1:8feaac42b465d326864996b5175014d5f3b760c35278ef167280b65badd2b25c`.
  HA/MCP er forbundet; Voice PE er forbundet med firmwarekontrakt og valgt wake-model
  bekræftet. Firmware er `podvoice_build_113114_livetimeroutput1`. Det beviser
  konfiguration/forbindelse, ikke fysisk wake eller lyd.
- **Udgivelse:** PR #158 er merged som `ae9df63`; PR-CI `38632352933` og
  main-CI/publisher `38633846409` bestod. Det er en testudgivelse, ikke produkt-
  eller lifecycleaccept.
- **Kendt fejl:** streng stilhedsprøve fejler stadig på ét sekund uidentificeret lyd før
  timerresultatet. Issue #153 står åbent; fuldt fjernet fyld eller hurtigere lukning er
  ikke bevist.
- **Fysisk accept:** timeralarm/stop, Voice PE-musikflytning, modelafslutning/næste wake,
  latency og stabilitet afventer én samlet prøve. Åbne installerede/afventende issues:
  #153, #118, #110, #103, #124 og #107. Aktuel baseline har ikke bevist ny golden chain
  eller 10/10 fysisk lifecycle.

## Aktiv installation · HA timerintegration 0.1.1

2.0.25 er installeret og startup-identiteten verificeret. Efter frisk læsning af den
anden chats aktive native-installation beholdes deres ejerskab af Core-genstarten.
Root udfører ingen yderligere native-filændringer eller genstarter under det forløb.
Før genstart returnerede begge endpoints ok med tomme timer-/alarmkøer og uden
recent-felt. Efter den anden operatørs Core-genstart er r0 og talk læst igen via
HA-handlingen: begge ok, timers=[], finished=[] og recent til stede. Det beviser
aktiveret 0.1.1-protokol; ingen timer eller alarm blev startet eller afbrudt.
Den eksisterende faste installer /homeassistant/.podview-native-installer-172ecb1b.py
skal hashmatche 172ecb1b744cd17377ded20d0db4a8d417951dfe3625e84cd7db941b49a728e3 og
må kun hente de fem reviewede filer fra immutable ae9df63. Den opretter privat
backup og stopper/rollbacker ved uventede filer/hashes eller concurrent writer.
Rootens installerforsøg blev afvist før ændring, fordi de nye filer allerede var
installeret af den anden operatør. Frisk read-only læsning bekræfter version 0.1.1 og
alle fem forventede NEW-hashes. Den anden chat har grønt konfigurationstjek og ejer nu
den samlede Core-genstart/PodConnect-aktivering. De friske endpoint-svar ovenfor er
rootens efterkontrol af den indlæste timerprotokol; fysisk alarm/Stop afventer morgen.

## Aktiv beslutning · nattens softwaremål / #156

**Lead:** root. Brugeren har genoptaget arbejde og godkendt nødvendige installs,
udgivelser og genstarter. Fysisk prøve foretages af brugeren i morgen. Prioritet:
daglig brug → én samlet fysisk serie → afgrænset #156-oprydning → målte CI-ventetider.
PR #158 er merged som ae9df63 og 2.0.25 kører på Green som registreret ovenfor.
Nattens branch er genbaseret på den main. PodView-chatten ejer næste UI-udgivelse
2.0.26; oprydningen forberedes isoleret uden konkurrerende version eller genstart.

**Direkte evidens og afgrænsning:** 2.0.24 har allerede rettelser til typed musikmål,
HA-ejede timere og native lukning; frisk read-only ejerreview fandt ingen ny
kildebevist fejl i disse kæder. Fysisk musikflytning, timeralarm/Stop og nyt wake er
stadig ukendt på denne kandidat. #153 har ikke bevist betydningen af den korte
provider-PCM; det begrunder ingen ny prompt-/lydtuning.

**#156-hypotese:** Config spejler engine/live_alpha, selv om load/from_options og
begge builders allerede vælger Thin/GPT-Live ubetinget. Ingen produktionslæsere af
netop disse Config-felter er fundet. Fjernelse af de to ubrugte spejle skal bevare
samme options → settings/migration → builder → ThinSession → native/Talk → fysisk
playback → teardown/rearm-kæde. Gemte settings/migration og aktive samtaler ændres ikke.
Seneste PodView-main ae9df63 og dens Config.podview_control_policy er bevaret.
Invarianter: én samtaleejer, én GPT-Live-vej, samme native/Talk-kontrakt og nul
skjulte engineskift. Ikke-mål: reply_streaming, prompt, VAD, lyd, timeouts, legacy-
massefjerning eller en ny abstraction.

**Anden afgrænset #156-bid:** Docker kopierer stadig hele gatekeeper-pakken, selv om
orchestrator/state/gatekeeper/watchdog kun bruges af historiske regressioner. En frisk
AST-gennemgang af øvrige runtime-moduler finder ingen imports af disse fire ejere.
Hypotese: de kan udelades fra den faktiske image-kontekst, mens kilder og historiske
tests bevares i repoet. Kun fire .dockerignore-mønstre og et import-check af den
faktisk pakkede __main__ samt dens lazy startup-moduler i den eksisterende
ARM-build tillades. Ingen Realtime-
adapter, direct-PCM-helper, settings/migration eller historisk regression slettes.
Kontrol: entrypoint, Thin, GPT-Live, Talk og de lazy trace/analyse/eval-moduler
importeres fra det pakkede image uden at kalde main eller starte forbindelser.
Første review afviste entrypoint-importen alene, fordi den ikke nåede lazy startup-
imports; samme ene build-kommando er udvidet til de konkrete moduler. Uafhængigt
review og officiel ARM-build stopper ved dependencyfejl; dynamiske runtimekald
og fysisk funktion bevises ikke af importkontrollen.
Dette er package-oprydning, ikke ny samtalelogik eller en ekstra testsuite.
Endeligt uafhængigt SOURCE review: night_product_chain GO på de to packagingfiler
og afgrænset importclaim. ARM-build bestod senere i de registrerede officielle
kontroller; endelig release af oprydningen er fortsat ikke udført.
Dockerfile SHA-256 94b320b4ecacff5ae278fdc1745013a1bc9c0d3781342c5f45cd30eb48cec8c3;
.dockerignore SHA-256 6496394485ba30d8eafdf1d333d1cb828f02d4c3d7c77076dd06d7a45c484b46.

**Planlagte kontroller:** følg Config-signaturen gennem alle constructors/fixtures;
relevante eksisterende config/settings/main-regressioner og statiske checks én gang;
uafhængigt adversarial review, exact-tree/scope og officiel CI på frosset samlet diff.
Rollback-grænse: hele dette afgrænsede ændringssæt; installeret baseline arver ingen
fysisk accept. CI-optimering må kun føjes til ved konkret dokumenteret ventetid og
skal bevare causal ordering, timeout/error, teardown og stale-generation-bevis.

**Prøven 15. oktober (plan, ikke resultat):** én samlet serie på ca. 5–10 minutter. Før start
registreres installeret version, git/artifact og firmware; de skal være uændrede ved
slutningen. Baselineparret ovenfor er 2.0.25/livetimeroutput1, indtil næste samlede
udgivelse faktisk er installeret. Begge HomePods, der skal bruges til flytning, skal
være online; brugeren skal kun høre/rapportere, lead følger eksisterende log/trace.

1. Start musik fra Spotify på mobilen og vælg den første HomePod. Bekræft faktisk lyd.
2. Sig “Hey Chat, hvad er klokken?”, vent på hele svaret, og spørg “Og hvilken ugedag
   er det?”. Sig derefter “Tak, det var det”. Hør begge svar/farvel; bemærk gentaget
   “Modtaget”, gul/rød ventetid, og om musikken bliver dæmpet og vender tilbage.
3. Efter lukning: nyt “Hey Chat, flyt musikken til [det andet tilgængelige rum]”.
   Bekræft lyd fra den ønskede højttaler og afslut samtalen. Tavshed, tidslinje eller
   API-success tæller ikke som musikflytning.
4. Nyt wake: “Sæt en timer på ti sekunder”, afslut samtalen og vent på faktisk alarm.
   Sig “Stop”; hvis det ikke virker, tryk én gang på pucken og registrér stemme-Stop
   som fejl. Derefter nyt wake og et kort spørgsmål for at kontrollere rearm.

Lead samler første udfald/version/trace i denne post og retter konkrete fejl samlet.
Serien er daglig-brug-triage; den erstatter ikke 10/10 ubrudt fysisk lifecycle,
lydoptaget latency eller de øvrige fulde gates i PRODUKTMÅL.

**Afgrænset CI-forkortelse under vurdering:** Den nye tidsrapport bekræfter, at
Talk-ti-cyklusprøvens 60 s kontrollerer shippet close-grace og ikke må komprimeres.
Lead undersøger kun GitHubs eksisterende job-matrix: unit-tests på én runner og
resten via default discovery med --ignore=tests/unit på en anden. Separate GitHub-
VM'er ejer deres processer; den kasserede lokale processtyring genindføres ikke.
Hypotese: uændrede testcases/tidsgrænser kan overlappe, hvis cohorternes node-union
matcher fuld collection præcist og ingen globale fixture-/filafhængigheder findes.
Invarianter: alle tests, statics og browser/build før publish, fail-fast=false,
fuld main/publishergate og uændret produkttid. Ikke-mål: nyt framework, ny cache,
nyt lokalt runnerlag eller mindre assertions. Før ændring kræves afgrænset source-
review; derefter mekanisk collection-union og eksisterende CI/release-kontrakter.
Ved uafklaret coverage/ejerskab forkastes dette lille forslag. Uafhængigt source-
proposal GO foreligger. Faktisk collection giver fuld 5.086, unit 3.864 og rest 1.222;
unionen er præcis/disjoint, uden mangler, ekstra eller dubletter. Sorteret fuld node-
SHA256 d31c50e469709753920e0588a9ae86f0639d2a005571efc83d6620feabbf93d8.
Main har ingen required-check-navne eller aktive rulesets. Kun den eksisterende lint-
test-jobdefinition ændres: tooling-only får fortsat én unit-række, produkt får unit
og rest på separate VM'er; statics kører én gang. Publisherens needs/guards er uændrede.
38/38 eksisterende release-/CI-scope-tests samt formatter/lint/mypy (66 moduler)
bestod på 2,4 s. Endeligt uafhængigt workflow SOURCE GO: night_product_chain,
workflow SHA256 92c78ce41a0b8d8cfb58d8fd0bf840748cc79fa7b8664a598b689452c5c0f3b4.
Der er endnu ingen målt matrixhastighed eller faktisk matrix-CI-PASS.

**Tidligere CI-beslutning (udvides af job-isoleringen ovenfor):** tre eksisterende brede CI-logs viser pytest 472–481 sekunder;
Ruff <1 sekund og mypy ca. 15–17 sekunder. Brugeren har nedtonet CI-sporet. Kun
--durations=15 --durations-min=1 føjes til den eksisterende fulde pytest-kommando,
så næste nødvendige CI kan navngive ventetiderne. Ingen ekstra suite eller framework.
Et forsøg med to direkte pytest-processer blev kasseret før freeze: uafhængigt review
fandt risiko for detached testbørn ved failfast. Default discovery, cleanup,
job/publish-afhængigheder og produkttimeouts er derfor uændrede.

**Officiel draftkontrol:** PR #160 / head 5ee80c01dec2cf7888d516bae8974f9915a1bd65,
tree 262d0bbbe6dff2c09efce5a26d9527012cd1e549. CI 38640361087 fejlede i en
uændret PodView-test: test_expiry_config_change_and_capacity_are_bounded sætter
issued_at=0, som er gyldigt ved runner-uptime under tokenens 120 sekunder. Faktisk
ok=True er dermed foreneligt med produktreglen, ikke en påvist runtimefejl. Samme
DeviceControl/test bytes som main ae9df63; kildeårsagen er uafhængigt reviewet af
night_product_chain. Mindste test-only rettelse bruger cap.issued_at-121 som den
allerede eksisterende voice-expiry-test. No-write-, kapacitets- og config-toggle-
assertions bevares; ingen produkttimeout ændres. Det berørte testmodul bestod
10/10, formatter/lint og mypy (66 moduler) PASS, fast i alt 1,2 s. Original CI
forbliver FAIL. Den rettede public commit 6eb87a752dacc3430b59ddf1f86d6a3aa95ab121
bestod hele CI 38641756028: scope, lint/test, browser og ARM. Pytest tog ca. 555,6 s;
Talks 60,53 s og øvrige validerede timeoutgrænser bevares. Det er source/build-
godkendelse af oprydningen, ikke ny release/installation eller fysisk accept.

Scope, browser og ARM-imagebuild bestod. Den pakkede importkommando bestod og nåede
build_identity/export. Disse uændrede kilde/buildresultater bevares; den ændrede test
og dens formatter/lint kontrolleres særskilt før nyt exact-head CI. Ingen manuel
CI-genkørsel på gamle bits. Den brede pytest tog ca. 466,5 s; langsomste case var
Talks faktiske SDK-ti-cyklusprøve på 60,25 s (10 × shippet 6 s close-grace), native
13,49 s og MCP discovery-deadline 10,03 s. Uafhængig gennemgang fandt ingen sikker
forkortelse af den dominerende Talksventetid; der tilføjes intet nyt framework.

**Aktuelt / 2.0.27-beslutning:** den reviewede oprydning og den grønne CI-matrix
samles oven på merged PodView2.0.26. Configs nye podview_visual_policy og
podview_control_policy, Supervisor-only indlæsning, alle UI-assets og AI-grænser
bevares. Kun de oprindeligt reviewede ubrugte engine/live_alpha-spejle fjernes.
PR160 på 312ea881 bestod CI38643540645 fuldt: unit/rest, browser og ARM. Pytest-
kritisk vej var 266,4s mod555,6s i serial reference, ca.52% kortere; hele CI299s.
Det er én sammenlignelig observation, ikke et løfte om fremtidig kø-/runnertid.
Rebase/versionering er afgrænset source-reviewet af night_product_chain: alle
PodView26 UI/server/scopepolicy-bytes er uændrede fra7efe8cb bortset fra det allerede
reviewede Config-diff og ren versionsmetadata. Prod-manifest SHA256 (rækkefølge:
.dockerignore,Dockerfile,config.yaml,__init__.py,config.py):
704d0de0983e17ab49f84ad903a7042da48df26f8f5cc6168c6fb511a7be6c95.
Config SHA256 d52de19fb1bd451733d9d0d2ed1ee2fe469c241453efecb565d2e3f1944476f5;
workflow92c78ce41a0b8d8cfb58d8fd0bf840748cc79fa7b8664a598b689452c5c0f3b4.
Efter rebase bestod67/67 berørte Config/main/Supervisor-authority/versioncases,
formatter/lint og mypy66; fast2,4s. Ny collection:5.149=3.923unit+1.226rest,
eksakt disjoint uden mangler/ekstra; SHA256
1fd8cf71ec5907bf0f5d8c3cf89a290cca34259b358295f7980799a9c650d4c6.
Nyt exact-head CI kræves på27. Publicering/installation afventer grøn mainartifact;
fysisk accept arves ikke.
PodView2.0.26 er merged som 7efe8cbd7fbcfd506fd2162f428945f751e8f6cb. Nattens
ændringer genbaseres på præcis den main; den publicering færdiggøres først. Næste
oprydningsrelease planlægges som 2.0.27, uden ændring af PodViews godkendte policy.
Ingen ændringer i seneste PodView-assets eller nye timerkontrakter. Tre afgrænsede agentgennemgange er udført parallelt. De to ubrugte
Config-spejle er fjernet og fire eksisterende testfiler tilpasset; gemte settings og
builders er uændrede. Første statiske check fandt én ubrugt testimport; den blev
fjernet før de endnu ukørte tests. Fokuseret fast-gate: 63/63 PASS, formatter/lint
PASS, mypy PASS (59 moduler), samlet 3,1 s. Efter genbasering på PodView-main bestod
64/64 relevante config/main/release-cases samt formatter/lint og mypy (66 moduler),
samlet 2,8 s. Uafhængigt SOURCE review: night_product_chain GO på alle seks
kode-/test-/workflowfiler; ingen dynamiske Config-læsere, constructors, settings-
migration eller native/Talk-ejerskab blev ændret. Kandidaten er endnu ikke frosset:
aktuel main efter PR #158 skal indgå i scope/binding, officiel CI og versionering. Ingen
providerprøve eller fysisk accept er udført af oprydningskandidaten. Baseline 2.0.25
er installeret; oprydningen er endnu ikke udgivet eller installeret.

## Aktiv beslutning · #157 udviklingsflow og agentdokumentation

**Lead:** root. **Scope:** fuld issue #157 på dokumentation, CI-scope og relevante
runner-/scope-regressioner; ingen runtimeændring eller produktversion. Baseline var
`d1bb25c`.

**Observeret problem:** agent/statusdokumenter er vokset, udviklingsflowet har forældede
tidsmål, og tooling-only CI udførte unødigt fuld suite. Tidligere fuld PR-CI tog 416 s og
main-CI 423 s. En manuel cacheprototype på én repræsentativ lille `run_fast`-node gav
Ruff/mypy eksisterende-cachetider på 0,350/0,351 s; prototypen gav 1,573 s koldt og
1,080 s varmt, altså ca. 0,73 s dårligere varm stage, samt utilstrækkelig binding til ekstern
konfiguration/Python path. Det er stage-måling, ikke end-to-end CI-tid; cacheforslaget er
kasseret; begge runnerfiler er uændrede mod baseline.

**Beslutning:** forkort AGENTS.md til opgavebaseret læsevalg, ti leveringsregler,
modelrouting og kontroltabel. Rutine-docs/tooling læser AGENTS og STATUS; runtime og
højrisiko læser alle fire autoritative produktdokumenter samt relevante agentkrav.
`docs/AGENTKONTRAKT.md` beholder de detaljerede bindende risikokrav, men fjerner
indgangsdubletter, gentagne standardkommandoer og urealistiske historiske tidsmål.
STATUS er forkortet; tidligere payload er arkiveret byteidentisk. CI begrænser kun kendt
docs/devtools-scope til `test_dev_cycle`, `test_ci_scope` og `test_release_contract`; ukendt,
runtime, config, requirements, produkt og `.github/workflows` forbliver fuld CI. Fire
prose-snapshot-testcases erstattes af én faktisk intern agentlink-test; release-immutability-
og runtime-guards beholdes. Cacheprototypen er kasseret; `fast --test` kører pytest hver gang
og bruger kun eksisterende Ruff/mypy incremental caches. Ingen runtime-, review- eller fysisk
acceptkrav svækkes.

**Faktiske resultater:**

- AGENTS.md før/efter: 358 → 106 linjer.
- STATUS.md før/efter: 18.571 → 56 linjer.
- Historisk STATUS-fil SHA-256: `d3817644c0a7e079057bbc5cce37925fa147fe954cfa4cdc6e21e57bda0cd1ad`.
- Aktuel AGENTKONTRAKT SHA-256 efter de-duplicering: `bc9f7929f00000b5712a425ad73551785daf5e87f0747c94f20ddbc621defa3e`. Oprindelig AGENTS-tekst kan genskabes fra baseline `d1bb25c` i Git-historikken.
- Historisk STATUS matcher SHA-256 og byteantal; lokale Markdown-links, formatter/lint og scopekontrol PASS. Den detaljerede kontrakt er redigeret for navigation/duplicering; ingen exact-copy-claim.
- Målrettet lokal regression fandt ét manglende agentlink; det blev rettet, og kun den fejlede node blev gentaget (PASS, fast 0,8 s). Øvrige testresultater blev bevaret.
- Uafhængigt source review: GO. Cache- og shell-wrapper-findings er løst; ingen ny manuel cache leveres.
- PR #159 er merged som `4768a3584b0e64e0c57a46163f390b1f39f83372`. Endeligt PR-head `f783aae` bestod CI `38628544699` på 8m52s: lint/test, browser og ARM-build grønne. Main-CI `38629952851` bestod på 9m21s; ingen add-on-version blev genpubliceret.
- Førmåling for en ren STATUS-ændring: CI `38624071975` på `d1bb25c` tog 9m21s; pytest 7m57s. Ny docs-CI `38630020233` bestod: scope 7 s og lint/test 33 s; browser/build/publish blev sprunget over. Det tidligere docs lint/test-job tog 8m36s. Ny samlet tid var 9m38s inklusive ca. 8m58s i kø bag main, så dette beviser mindre aktivt arbejde, ikke kortere wall-clock i denne kørsel.
- **Udgivet:** [dev-tools-2026.10.14](https://github.com/BixelVentures/podvoice/releases/tag/dev-tools-2026.10.14), kildecommit `0787aff94bbdca13e487dde5ceca3616aa924c02`. Issue #157 er lukket. Ingen ny HA-version eller installation indgår.
- Runtime/provider/fysisk gates: ikke ændret eller kørt af docsarbejdet; baselineaccept
  står som ovenfor.

## Bevaret integrationsbaseline · PodView2.0.26 / PR161

Main `7efe8cbd7fbcfd506fd2162f428945f751e8f6cb` bevarer hele den reviewede26-
leverance. PR-CI `38643032300` bestod; main/publisher `38644287035` var ved seneste
læsning i gang. Root ændrer hverken den anden chats arbejdsbranch, dens ufærdige
musik-/robotarbejde eller den godkendte20-kaldspolicy. Komplet pre-freeze-beslutning,
Ultra-review og exact-tree-binding er bevaret i [baseline-STATUS](https://github.com/BixelVentures/podvoice/blob/7efe8cbd7fbcfd506fd2162f428945f751e8f6cb/docs/STATUS.md).
Ingen26-installation eller aktivering udledes af merge/CI. Ovenstående installerede
baseline opdateres først ved faktisk HA-readback.
