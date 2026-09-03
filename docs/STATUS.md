# PodVoice-status — én aktuel sandhed

Senest opdateret: 2026-09-03.

## Aktiv lead-beslutning

**Beslutningsejer:** Lead Voice/Reliability Engineer. **Fysisk baseline:** v1.13.11.
**Installeret kandidat:** add-onen rapporterer v1.13.55 fra kandidatcommit
`d496ca0`; runtime-rootfs er
`645adfade8b46ab46068ff6121347d593b13737897db096420a9393bed77cbde`.
Den armerede fysiske trace `20260902T141043-607` er én bestået Golden Chain på disse
bits: 12 × 7 gav 84, “Læg seks til” gav 90 i samme provider-conversation og generation,
og “Tak, det var alt” gav præcis ét `end_conversation`, én teardown og én rearm.
Den efterfølgende tekst/lyd-sammenligning `eval-1788351114-20fddc` gav korrekt 90 uden
værktøj i 5/5 tekstkontroller og 5/5 replay af den eksakte provider-PCM. Rapportens
samlede NO-GO er dog ikke gyldig som provider-kædedom: oraklet kræver en indbyrdes
rækkefølge mellem to sideordnede start-events, som alle ti liveforsøg og den armerede
trace leverede modsat. Den separate diagnostiske ASR skrev samtidig “Klik seks til” i
5/5 lydforsøg. Device-/provider-sammenligningen viser efterfølgende, at hele signalet
nåede providerinputtet uforvansket; afvigelsen tilhører derfor den separate
diagnose-ASR og er ikke en Voice PE-transport- eller runtime-semantikfejl. Den bevares
synligt som en konservativ diagnostisk afvigelse. **Aktuel fysisk gate:**
Golden Chain **1/1**; ubrudte lifecycle-cyklusser **0/10**. v1.13.55 er derfor ikke
releasegodkendt endnu.

**Aktiv udviklingskandidat:** v1.13.56 ændrer kun Grundtestens UI, lokale bevisoptagelse
og evaluator. Den installerede samtaleadfærd fra v1.13.55 bevares; firmware, gain,
fysisk lydtransport, playback, prompt, model, reasoning, schema, værktøjer,
firesekunders timeout, teardown og rearm er frosne.

### Aktiv beslutning 2. september — Grundtesten skal måle den bindende 5+5-gate

- **Observeret fejl og stærkeste direkte evidens:** Panelets nuværende Grundtest beder
  om `Farvel` i alle ti samtaler, kræver tre input- og tre outputtranscripts samt blot
  en vilkårlig senere `IDLE`, og kan samlet bestå med 9/10 korrekte. Den måler derfor
  hverken de fem bindende firesekunders-timeouts, stille model-close eller den faktiske
  close-/teardown-/rearm-kæde i `docs/PRODUKTMÅL.md`.
- **Kæde, invarianter og hypotese:** Testbeviset skal følge det automatisk optagede,
  lokale device-/provider-/speaker-trace fra ét fysisk wake gennem to accepterede ture
  og deres provider-ejede svar/playback til enten én modelsemantisk close eller præcis
  `idle-fallback`, efterfulgt af én teardown og én korreleret rearm. Næste fysiske wake
  skal binde den lukkede trace til præcis den næste session og provider-generation.
  Hypotesen er alene, at Grundtestens UI og evaluator er forældede; produktionsruntime
  udførte den seneste armerede Golden Chain korrekt og må ikke ændres for at rette
  acceptværktøjet.
- **Mindste plan og eksplicitte ikke-mål:** De ti eksisterende to-turs-samtaler får fem
  varierede semantiske afslutninger og fem eksplicitte stilhedsforløb. Serveren måler
  den forventede close-type, accepterede fysiske ture, playback-finish, close-id,
  teardown og rearm i samme session; transcript bruges kun som synligt diagnosebevis.
  Kun 10/10 med præcis 5/5 i hver close-type kan bestå. Ingen ændring af `ThinSession`,
  Realtime-wire, prompt, schema, model, reasoning, VAD, firesekunders-timeout,
  firmware, gain, lydtransport, playback, teardown eller rearm er mål.
- **Regressioner, gates og rollback:** Bevis både kort og stille model-close samt
  `idle-fallback`; krydsede close-typer, ekstra tale under timeout, manglende/dobbelt
  close, manglende teardown/rearm, fremmed session og 9/10 skal afvises. Kør fokuseret
  web-/paneltest, lifecycle-gaten, uafhængigt adversarial review og én `release` på
  frosset diff. Hvis evaluatorens observering selv ændrer runtime eller en forkert
  close-type kan blive grøn, rulles hele Groundtest-deltaet tilbage.
- **Faktisk ændring og foreløbig status for v1.13.56:** Grundtesten armerer selv ét
  lokalt lydbevis for hver af de ti samtaler og for den afsluttende wake-kontrol. Det
  eksisterende strenge `TraceOracle` kontrollerer fysisk wake, accepteret lyd,
  provider-ejet response, playback, close, teardown, audio-boundary og rearm; en lille
  wrapper kontrollerer præcis 5 semantiske closes, 5 firesekunders timeouts og eksakt
  generation-/tokenkobling mellem samtalerne. Første fejl stopper runden, manuelle
  lydknapper kan ikke overtage recorderen, og afbrudte mobilrequests frigiver deres
  claim. De seneste 12 traces beholdes lokalt, så hele runden plus slutkontrollen kan
  efterprøves. `ThinSession` har kun fået passiv wake-/artifact-provenance i tracen;
  udgående Realtime-wire og produktadfærd er uændrede. Første adversarial review fandt
  tre falsk-grønne bevisveje: manglende generationsfelter, manglende komplet
  providerrespons og manglende speaker-spor. Alle tre er nu fail-closed og dækket af
  konkrete mutationer. En fjerde mutation kræver desuden konkret og ens
  audio-generation på slut-wake, wake-gate og forrige rearm. Den fokuserede gate er
  27/27 grøn, `scripts/dev fast` gennemførte formattering, Ruff, mypy og den valgte
  fulde testsuite på 43,8 sekunder, og den fulde lokale releasegate bestod på 43,7
  sekunder. Frozen Ultra-re-review er **GO med P0=0/P1=0** og bekræfter ingen ændring af
  Realtime-wire, prompt, VAD eller firmwareadfærd. Exact-commit CI/ARM64, installation
  og den fysiske 10/10 mangler fortsat. Fysisk status er derfor stadig Golden Chain 1/1
  og ubrudte lifecycle-cyklusser 0/10 på v1.13.55.

### Aktiv beslutning 2. september — eval-oraklet må afspejle providerens partielle orden

- **Observeret fejl og stærkeste direkte evidens:** Alle 5/5 tekst- og 5/5 lydsessioner
  har eksakte, sammenhængende conversation-, generation-, user-, assistant- og
  response-id'er samt completed-status. Den faktiske rækkefølge er konsekvent
  `user added → response.created → response.output_item.added → assistant item added →
  response.output_item.done → response.done`. Oraklet kræver fejlagtigt de to
  sideordnede item-start-events i omvendt rækkefølge og mærker derfor alle ti som
  `provider-item-chain-broken`. Den fokuserede fysiske lydsammenligning placerer
  opfølgningssegmentet fra providerfilens 4,45–5,45 s ved devicefilens 13,09–14,09 s
  med normaliseret korrelation 1,000 efter den kendte 16→24 kHz-konvertering. Det
  beviser, at transporten ikke forvanskede opfølgningen; det afgør ikke alene den
  separate ASR's ordvalg.
- **Kæde, invarianter og falsificerbar hypotese:** Beviset skal fortsat kræve
  `U1 → R1 → A1 → done → U2 → R2 → A2 → done` i samme conversation og generation,
  med eksakt ancestry, item-/response-id, rolle, type, status og nul ekstra response-
  eller tool-items. Hypotesen er kun, at `conversation.item.added` for assistant-itemet
  og `response.output_item.added` er to start-observationer uden dokumenteret indbyrdes
  totalorden; begge skal ligge efter `response.created` og før
  `response.output_item.done`. Den diagnostiske transcript-afvigelse er en separat
  inputbevisakse og må hverken omskrives til “Læg”, bruges til runtime-routing eller
  fejlagtigt klassificeres som tekst-/promptkontraktfejl.
- **Mindste plan og eksplicitte ikke-mål:** Ret kun evaluatorens eventorden og dens
  testfixture til den faktisk observerede rækkefølge. Bevar transcript-afvigelsen
  synlig og fail-closed, indtil den kan klassificeres med den bevarede lyd; ingen betalt
  provider-genkørsel er nødvendig for eventorden. Ingen ændring af `ThinSession`,
  Realtime-wire, prompt, tool-schema, model, reasoning, Voice PE, firmware, gain, VAD,
  resampling, playback, timeout, teardown eller rearm er mål.
- **Planlagte regressioner, gates og rollback:** Bevis begge lovlige rækkefølger af de
  to start-events. Afvis stadig manglende, stale, duplicate eller ekstra events samt
  enhver start-event før `response.created` eller efter `response.output_item.done`.
  Kør den fokuserede oracle-suite og `scripts/dev fast`; en uafhængig reviewer skal
  kontrollere, at ingen ID-, ancestry-, conversation-, generation- eller done-kant er
  svækket. Hvis en ugyldig mutation bliver grøn, rulles evaluatorændringen tilbage.
  Produktionsartifact v1.13.55 ændres eller geninstalleres ikke af denne
  evaluatorrettelse; næste produktbevis er 10/10 ubrudte fysiske cyklusser på samme
  installerede bits.
- **Faktisk evaluator-delta og resultater:** Oraklet kræver nu
  `user < response.created < begge item-start-events < output-item.done < response.done`
  uden at opfinde en indbyrdes orden mellem de to start-events. Den faktisk observerede
  orden var rød før rettelsen og er grøn bagefter; begge lovlige ordener består for
  både tekst- og lydtarget, mens hver start-event efter `output-item.done` fortsat
  afvises. Den fokuserede chain-suite er grøn **16/16**, og den samlede
  `scripts/dev fast --base origin/main` er grøn på **42,6 s** med Ruff,
  formatteringskontrol, mypy, hele pytest-suiten og diff-check. Uafhængigt afsluttende
  review fandt **P0=0, P1=0 og P2=0**. Ingen runtime-, prompt-, schema-, audio-, VAD-,
  firmware- eller lifecyclefil er ændret. Den ene autoritative
  `scripts/dev release --base origin/main` er grøn på **42,9 s**. Rettelsen er alene
  kilde-/evalværktøj; den installerede v1.13.55 skal ikke erstattes for dette delta.

### Aktiv beslutning 1. september — afvist VAD skal være terminal før næste mic-open

- **Observeret fejl og stærkeste direkte evidens:** Den installerede exact-v1.13.54-
  protokolprobe åbnede én `gpt-realtime-2.1`-session og fuldførte bootstrapresponsen. Efter
  forced commit, user-item og delete-ACK publicerede adapteren karantænen som opløst uden
  en terminal `speech_stopped`. Probe-fase 2 sendte derefter frisk PCM ind i providerens
  fortsat aktive VAD-spændvidde; derfor kom ingen ny `speech_started`. Efter den
  konfigurerede stilhed kom en legitim sen stopkant, men adapteren havde allerede
  slettet sin span og lukkede kl. 16:08:10 med `speech_stopped for unknown item`.
  Changed-ID er dokumenteret tilladt efter manuel commit, men live-start-ID'et blev ikke
  bevaret, så den eksakte ID-relation foregives ikke. De
  4,669 sekunder fra den forced-committede inputtransskription til fejlen matcher
  semantic-VAD plus probens friske stilhed. Proben stoppede korrekt som
  `provider-or-protocol-failure`; Golden Chain og 10/10 blev ikke åbnet.
- **Kæde, invarianter og falsificerbar hypotese:** crossed fysisk/provider-input under
  lukket answer-gate → nul response/tool/playback → provider-VAD skal bringes til én
  autoritativ terminal stopkant → hvert resulterende user-item skal slettes med eksakt
  ACK → først derefter må samme sessions `LOUNGE_WINDOW` åbne. OpenAIs officielle
  kontrakt siger, at manuel commit under aktiv VAD bryder start-/stop-item-id-ligheden;
  den siger ikke, at selve stopkanten kan foregives afsluttet. Hypotesen er derfor, at
  den eksisterende forced-commit-specialcase pensionerer spanen for tidligt og lader
  næste fysiske lyd blive dens hale.
- **Mindste plan og ikke-mål:** Erstat den falske forced-commit-terminal med én bounded,
  indholdsneutral nul-PCM-drænvej, mens den eksisterende fysiske state-gate er lukket.
  Provideren skal selv levere natural `speech_stopped`/commit/item; det eksakte afviste
  item slettes og ACKes, før karantænen opløses. Nul-PCM er protokolmekanik og må aldrig
  indeholde Voice PE-frames, skabe response/tool/playback eller åbne en ekstra session.
  Manglende terminal stop/commit/delete-ACK lukker samme session bounded fail-closed.
  Ingen firmware-, gain-, VAD-type/eagerness-, prompt-, model-, reasoning-, schema-,
  værktøjs-, playback-, timeout-, teardown-, rearm- eller lokal semantikændring er mål.
- **Planlagte regressioner, gates og rollback:** Den eksakte live-rækkefølge skal være
  rød før rettelsen og grøn bagefter: crossed start → nuldræn → natural stop → matching
  commit/item/delete-ACK → frisk start/stop i samme generation → præcis én korreleret
  response. Dæk stop før/efter commit, duplicate/stale/out-of-order events, manglende
  stop, fresh PCM før resolution, reconnect, Talk-paritet og trace-sandhed. Kør `fast`,
  relevant sammensat lifecycle, ét afsluttende `release` og uafhængigt adversarial
  review. Derefter ét PR/merge/install og én ny eksplicit prisgodkendt live-probe. Hvis
  natural terminal cleanup ikke kan bevises på rigtig provider uden fysisk mic-læk eller
  en ekstra session, rulles deltaet tilbage og crossed span lukker fail-closed; der
  tilføjes ingen ny timing-, gain-, prompt- eller fraseroutingpatch.
- **Faktisk kandidatdelta og lokale resultater:** v1.13.55 sender ikke længere manuel
  commit på en afvist aktiv VAD. Adapteren sender kun 20 ms nulrammer op til den
  konfigurationsafledte grænse og joiner den eksakte drain-task ved natural
  `speech_stopped`, før stop, item-sletning eller næste tur kan fortsætte. Manglende
  terminalkant, fremmed ID, duplicate stop/delete-ACK eller uordnet cleanup lukker
  fail-closed; duplicate matching commit/item er idempotente og kan ikke opløse
  karantænen tidligt.
  Proben tæller alle faktiske providerbytes, inklusive intern nul-PCM, og reserverer
  samme silence-bound i både karantæne- og friskfasen. Semantic VAD-grænserne er
  `high=2,25 s`, `auto/medium=4,25 s` og `low=8,25 s`; low-regressionen beviser 413
  20-ms-frames per fase og samlet 24,52 s maksimal providerlyd. En blokeret-send-
  regression beviser, at ingen append kan fuldføres efter stopbarrieren. Den målrettede
  owner/probe/adapter/lifecycle-suite er grøn **78/78**; ACK-watchdoggens tre tidligere
  fixed-sleep-tests er event-baserede og grønne **90/90** over 30 gentagelser. Den
  samlede `scripts/dev fast --base origin/main` er grøn på **43,2 s** med Ruff,
  format-check, mypy, hele pytest-suiten og diff-check. Firmware, gain, fysisk
  lydtransport, VAD-konfiguration, prompt, model, reasoning, schema, værktøjer,
  playback, timeout, teardown og rearm er fortsat byte-/adfærdsmæssigt uden for deltaet.
  Uafhængigt afsluttende Ultra-review fandt **P0=0, P1=0, P2=1** og gav GO til
  merge/install samt én ny prisgodkendt live-probe. Det ene P2 er kun diagnostisk:
  den fysiske trace gemmer allerede lokal karantæne, commit/delete, provider-PCM og
  offsets, men ikke de fire nye rå VAD-/nuldrænlabels. Det ændrer ingen gate og kan
  tilføjes i en senere ren observabilitetsrelease; v1.13.55 må ikke udvides for det.
  Den ene autoritative `scripts/dev release --base origin/main` er grøn på **43,0 s**
  med Ruff, format-check, mypy, hele pytest-suiten og diff-check. Exact-commit-CI,
  ARM64-image, merge, installation og den nye live-probe mangler fortsat.

### Aktiv beslutning 1. september — proben skal kunne startes uden browseromgåelse

- **Observeret fejl og stærkeste direkte evidens:** Den installerede v1.13.53 har den
  maskintestede, ingress-begrænsede `POST /api/eval/protocol-owner`, men panelet har
  ingen synlig kontrol, som kan sende den kanoniske prisbekræftelse. Efter brugerens
  eksplicitte `$5`-godkendelse afviste browserens URL-sikkerhed en scriptnavigation;
  proben blev derfor ikke startet, og intet API-budget blev brugt. Direkte LAN-adgang
  gav korrekt 403 og er ikke en tilladt triggervej.
- **Kæde, invarianter og hypotese:** bruger ser fast prisloft → eksplicit klik → præcis
  `application/json`-body `{"max_cost_usd":5}` gennem HA-ingress → eksisterende
  ingress-/framingkontrol → eksisterende eval-lock og højst én probe → eksisterende
  statuspoll. Hypotesen er alene, at en synlig knap over den allerede testede route
  lukker workflow-hullet. Browserbeskyttelse, ingresskrav, canonical body og
  sideeffektfri probe skal bevares.
- **Ikke-mål:** ingen ændring af `ThinSession`, Realtime-adapter, VAD, lyd, firmware,
  prompt, model, reasoning, schema, værktøjer, playback, timeout, teardown, rearm eller
  budgetberegning. Ingen skjult automatisk probe og ingen genbrug af en tidligere
  godkendelse.
- **Faktisk UI-delta og regressioner:** Panelet har præcis én synlig
  `Test sikker Realtime-svarstyring`-knap. Et fysisk klik låser alle evalknapper, sender
  den eksakte kanoniske body og genbruger den eksisterende `run_id`-poller samt
  generationssikre oplåsning. GO-visningen kræver exact
  `complete/ok/GO_TO_RELEASE_GATE/protocol-owner-proven`; alt andet vises som blokeret
  og siger fortsat, at fysisk Golden Chain og 10/10 mangler. Start→poll-integration,
  canonical body/content-type, single-trigger, busy, disabled-state og fail-closed
  rendering er grønne. Panel+probe er **66/66**, fokuseret web er **19/19**, og leadens
  fokustest er **21/21**. `scripts/dev fast --base origin/main` er grøn på **42,6 s**
  med Ruff, format-check, mypy, hele pytest-suiten og diff-check. Uafhængigt review af
  kode/UI fandt **P0=0, P1=0 og P2=0**; et efterfølgende dokumentreview fandt to P1-
  statusmodsigelser, som denne opdatering lukker uden produktionskodeændring. Første
  `release`-forsøg afslørede derefter en eksisterende test-race: `IDLE` publiceres
  bevidst før teardownens asynkrone attention-release og rearm, mens tre nye response-
  close-tests brugte `IDLE` som fuld slutbetingelse. Ingen runtime blev ændret; de tre
  tests venter nu også på eksakt rearm og bevarer assertions om præcis én release og én
  rearm. Den oprindelige måltest er grøn **50/50** i separate processer, og de tre
  naboer er grønne **60/60**; Ruff og format-check er grønne.
- **Releasegate, installeret resultat og rollback:** Den autoritative `release` var grøn
  på **42,4 s**. UI-deltaet blev merged som exact main
  `a026e9431b9efb801e3951fea5feae5103cf827b`; CI/ARM64-image blev grøn, og v1.13.54
  blev installeret. Det eksplicitte fysiske klik nåede den korrekte ingress-route med
  entydig framing og startede præcis én probe, så UI-scope er bevist. Proben fandt
  derefter en separat runtime-protokolfejl og stoppede blokeret; den åbner derfor ikke
  den fysiske canary. Hvis knappen kan starte uden et nyt fysisk klik, eller ingress-
  framing afviger, rulles UI-deltaet tilbage. Golden Chain og 10/10 er fortsat **0/1**
  og **0/10** og arves aldrig fra v1.13.53.

### Aktiv beslutning 1. september — kun accepteret fysisk tur må skabe providerrespons

- **Observeret fejl og stærkeste direkte evidens:** I exact v1.13.52-trace
  `20260901T101334-410` kom en ny provider-`speech_started` under `THINKING`. Thin
  registrerede `half_duplex_input_discarded` og sendte `input_audio_buffer.clear`, men
  providerens VAD-spændvidde forblev aktiv gennem fysisk playback. Efter mic-gaten igen
  åbnede, voksede provider-PCM-offsettet, og den forsinkede stop/commit-kant oprettede
  et nyt user-item og en automatisk respons med `get_time`. Der fandtes ingen ny
  accepteret lokal `speech_started`. Samme conversation og item-ancestry var intakte;
  dette er provider-turn-ejerskab, ikke mistet kontekst, audio-generation-replay,
  heartbeat, teardown eller rearm.
- **Hele berørte kæde og nærliggende races:** accepteret fysisk start → stop → provider-
  commit/user-item → ét svar → fysisk playback → ekkohale → åbent opfølgningsvindue.
  En start over den lukkede answer-gate skal derimod karantæneres, afsluttes og få sit
  eksakte item fjernet, før opfølgningen åbner. Nærliggende fejlveje er delayed/duplicate/
  stale start, stop, commit og delete-ACK; providerrespons uden lokalt request-id;
  tool-call fra en afvist respons; timeout eller semantic close under karantæne;
  reconnect og Talk/full-duplex-paritet.
- **Berørte invarianter, hypotese og ikke-mål:** én wake ejer én session; kun en
  accepteret tur må eje respons og værktøjer; Voice PE er half-duplex; Realtime ejer
  fortsat sprog, kontekst, værktøjsvalg og semantisk close; fire sekunders reel stilhed
  ejer kun mekanisk close. Den falsificerbare hypotese er, at
  `create_response: true` gør provideren til en konkurrerende response-owner, mens
  `input_audio_buffer.clear` fejlagtigt blev behandlet som VAD-reset. Ingen firmware-,
  gain-, VAD-type/eagerness-, prompt-, model-, reasoning-, schema-, playback-, timeout-,
  teardown-, rearm- eller lokal semantikændring er mål.
- **Faktisk implementeret kandidatdelta:** Voice PE beholder semantic VAD, men bruger
  `create_response: false` og `interrupt_response: false`. Providerens item-id,
  generation og commit bindes til den fysiske talespændvidde. Kun et accepteret stop
  efter matching commit må sende præcis ét korreleret `response.create`. En crossed
  start må aldrig svare eller kalde værktøjer; dens aktive buffer afsluttes, det eksakte
  item slettes med korreleret ACK, og opfølgningsgaten forbliver lukket indtil
  karantænen er tom. Én bounded input-span-ledger ejer commit-/item-/delete-ACK;
  `ThinSession` accepterer eller afviser turen, mens provideradapteren alene sender
  wire-eventet. Initiale og efterfølgende tool-/schema-/close-responses arver samme
  `(root_item_id, turn_id, provider_generation)` og et unikt request-id; numerisk
  metadata serialiseres som kanoniske decimale strenge efter providerkontrakten.
  Ukorreleret providerrespons, child-event eller cleanup-fejl lukker fail-closed. Talk
  beholder sin eksplicitte full-duplex-kontrakt og bruger samme response-owner-kontrakt.
- **Historiske lokale regressioner og review:** v1.13.53-regressionen kørte den rigtige
  OpenAI-adapter gennem `ThinSession`, men kodificerede den nu live-modbeviste antagelse,
  at forced commit + item + delete-ACK kunne afslutte VAD uden `speech_stopped`. Den var
  derfor grøn uden at bevise providerens terminale VAD-tilstand. v1.13.55 erstatter
  denne test med crossed start → bounded nuldræn → natural matching stop → eksakt
  commit/item/delete-ACK → frisk accepteret tur i samme generation → præcis én ny
  `response.create`, uden ghost tool eller playback.
  Dertil er accepted/rejected ownership, typed Talk, child/tool-responses, stale,
  duplicate, out-of-order, reconnect, timeout mod semantic close og trace-oraklet
  modtestet. Adversarial review fandt først P1-huller for forged response-start, stale
  child-events samt den officielle no-`speech_stopped`- og string-metadata-kontrakt;
  exact request/root/turn/generation-validering og regressioner lukkede hullerne. Den
  samlede provider-owner-/oracle-/probe-/Thin-suite er grøn **286/286**. Den skjulte
  ingress-rutes sikkerheds- og panelkontrakt er grøn **19/19**, og den isolerede
  protokolprobe er grøn **41/41**. Proben videresender og hasher den effektive aktive
  VAD-/noise-konfiguration, afviser ukendte eller uprissatte modeller før lock/socket
  og kan højst optage to lokalt budgetgodkendte responses under det faste $5-loft.
  `scripts/dev fast --base origin/main` er grøn på 41,9 s med Ruff, format-check,
  mypy, hele pytest-suiten og diff-check. Den smallere `lifecycle`-wrapper henviste som
  designet til `release`, fordi diffet også rører release-/dokumentationsflader; det er
  ikke en produkt- eller testfejl. Uafhængigt afsluttende Ultra-review af det frosne
  diff fandt **P0=0, P1=0 og P2=0**.
- **Live-resultat og resterende maskinelle gates:** Proben blev kørt på installeret
  v1.13.54 som `eval-1788271680-65640a`, brugte 171 tokens og estimeret `$0.009`, og
  stoppede ved en legitim sen `speech_stopped`, efter at den gamle regression allerede
  havde erklæret karantænen opløst. Resultatet er **NO-GO** og modbeviser manual commit
  som terminal. v1.13.55 skal derfor bevise `crossed start → bounded nuldræn → natural
  matching stop → exact item/delete-ACK → nul response → frisk tur i samme session →
  explicit response.create` mod rigtig provider. Den frosne v1.13.53-kandidat bestod den ene
  autoritative `scripts/dev release --base origin/main` på **42,5 s** med Ruff,
  format-check, mypy, hele pytest-suiten og diff-check. Den blev merged som exact main
  `3f548a222f487868552f5f2b7eba8047dcef0cda`; exact-commit-CI og ARM64-add-on-build
  blev grønne, og v1.13.53 blev installeret og startede med Voice PE samt HA/MCP.
  Proben kunne ikke startes legitimt fra det installerede panel, fordi triggerknappen
  manglede; derfor er v1.13.53 stadig **ikke provider- eller fysisk testklar** og
  supersedes kun af den UI-only v1.13.54. Den fokuserede semantiske 5×-preflight er
  ikke en erstatning for protokolproben og genkøres kun, hvis semantikscope eller ny
  ren fysisk evidens kræver den.
- **Fysisk gate og rollback:** Der køres ingen flere fysiske gentagelser på v1.13.52
  eller v1.13.54. Exact v1.13.55-artifact skal efter grøn installeret protokolprobe
  først bestå én
  armeret golden chain: 12 × 7 → 84;
  “Læg seks til” → 90 i samme session; “Tak, det var alt” → ét model-close; én teardown,
  én rearm og næste wake med frisk provider-generation. Derefter kræves 10/10 ubrudte
  cyklusser, fem med semantisk close og fem med fire sekunders reel stilhed. Hvis den
  officielle commit/delete-sekvens ikke kan bevises stabilt, må der ikke tilføjes
  timing-, gain- eller fraseplastre; crossed input skal i stedet lukke sessionen
  fail-closed. Den meget korte første tur med arabisk diagnosticering forbliver en
  separat ukendt wake-/audio-boundary-observation, som kræver gennemlytning af device-
  og providerlyd før enhver lyd- eller firmwareændring. Aktuel fysisk status for den
  aktive exact v1.13.54-kandidat er canary **0/1** og ubrudte cyklusser **0/10**; intet
  fysisk resultat arves fra v1.13.53.

### Historisk beslutning 1. september — idle-timeout må aldrig vinde over aktiv brugertale

- **Observeret fejl og stærkeste direkte evidens:** Trace `20260901T092200-847` åbnede
  opfølgningsgaten ved 7.253 ms, modtog et accepteret provider-`speech_started` ved
  8.098 ms og modtog intet `speech_stopped`/commit. Ved 13.127 ms lukkede ThinSession
  som `idle-fallback`; de 5.029 ms fra start til close matcher næste
  `HEARTBEAT_S=5.0`-tick. Teardown og korreleret rearm gennemførte rent. Dette beviser
  lokal timeoutfejl, men ikke hvorfor provider-VAD manglede stopkanten.
- **Hele kæden og nærliggende fejlveje:** fysisk followup-PCM → åben state-ejet mic-gate
  → provider-VAD-start → fortsat samme Realtime-session → enten matching VAD-stop og
  svar eller bounded fejl/close → teardown → rearm. Nærliggende races er start lige før
  idle-deadline, langsom `THINKING`/værktøjsrunde, half-duplex-input der straks ryddes,
  Talk/full-duplex `Interrupted`, duplicate/stale stop og teardown uden stopkant.
- **Berørte invarianter og falsificerbar hypotese:** Fire sekunders timeout betyder
  ubrudt stilhed i `LISTENING`/`LOUNGE_WINDOW`. Hypotesen er, at den eksisterende
  heartbeat forveksler “ingen ny provider-event” med stilhed, fordi den ikke gemmer en
  accepteret aktiv talespændvidde og ikke afgrænser idle-close til lyttestates. Et
  current start→stop-interval skal derfor overleve idle-deadlinen, mens ren stilhed
  fortsat lukker og den eksisterende max-session stadig er hård ydergrænse.
- **Ikke-mål:** ingen firmware-, gain-, VAD-, audio-, prompt-, model-, reasoning-,
  schema-, værktøjs-, playback-, teardown- eller rearmændring; ingen ny timer- eller
  lifecyclemotor og ingen lokal semantik.
- **Planlagte regressioner og gates:** reproducer fysisk
  `LOUNGE_WINDOW → speech_started → idle-deadline → speech_stopped`, deadline-racet,
  ren stilhed, langsom `THINKING`/værktøjsrunde, answer-gate-clear, Talk-paritet og
  reset ved wake/teardown. Trace-oraklet skal forstå det shippede `speech_started` og
  afvise close inde i et åbent start→stop-interval. Kør målrettet test, `fast`, én
  `lifecycle`, uafhængigt adversarial review og én `release`; ingen SafeEval, fordi
  Realtime-semantikken er uændret.
- **Rollback- og fysisk gate:** enhver ændring uden for timeout-owner/oracle/test/docs,
  enhver idle-close under aktiv tale eller manglende ren-stilhed-close stopper hele
  kandidaten. Efter exact-commit CI og installation kræves én frisk fysisk canary;
  først derefter må den tidligere 5+5-klassifikation eller 10/10 åbnes igen.
- **Faktisk v1.13.52-delta:** ThinSession gemmer én accepteret provider-VAD-spændvidde
  som mekanisk faktum, separat fra de fem produktstates. Talestart fjerner den aktuelle
  idle-deadline; matching stop rydder faktummet synkront efter Voice PE's mic-send-lock
  og går til `THINKING`. Idle-close kræver fortsat `LISTENING`/`LOUNGE_WINDOW`, ingen
  aktiv tale og en uændret udløbet deadline, som kun armeres ved wake, aktiv re-wake og
  fysisk followup-open. Provider-metadata kan ikke flytte den. Heartbeat-poll er 250 ms,
  så firesekundersvinduet har en bounded tolerance uden en ny timer. Trace-oraklet
  normaliserer shippet `speech_started` og afviser kun `idle-fallback` inde i åben tale;
  max-duration og explicit stop/error forbliver autoritative closere.
- **Faktiske fokuserede resultater og review:** Den eksakte feltsekvens, første tur,
  deadline-race bag mic-lock, ren stilhed, langsom THINKING/værktøjsrunde, provider-
  metadata, delayed/discarded start, max-session, Talk-paritet, 10 simulerede cyklusser
  og field-canary/oracle er grønne. Den uafhængige reviewer fandt først et P1-oraclehul,
  hvor legitime sikkerhedsclosere blev afvist; det er rettet med modtests. Refrosset
  slutreview er GO med P0=0, P1=0 og P2=0; reviewerens 242 fokuserede tests, Ruff,
  format, mypy og diff-check er grønne. `scripts/dev lifecycle` er korrekt ikke
  anvendelig på det samlede release-metadata-scope. Den stærkere autoritative
  `scripts/dev release --base origin/main` er grøn på 37,8 sekunder med Ruff, format,
  mypy, hele pytest-suiten og diff-check.
- **Efterfølgende fysisk status:** v1.13.52 blev siden merged, exact-main-bygget og
  installeret som dokumenteret øverst. Den fysiske trace `20260901T101334-410` gjorde
  kandidaten NO-GO på den senere response-owner-fejl og supersedede derfor denne
  historiske lokale godkendelse. Ingen bestået gate arves af v1.13.53.

### Historisk beslutning 30. august — bevis native Realtime-kontekst mod audiosemantik

- **Observeret fejl og stærkeste direkte evidens:** I den armerede trace
  `20260828T152317-683` svarede én provider-generation først 84 på tolv gange syv. På
  “Læg seks til.” henviste Realtime selv til 84, men fortolkede samtidig lydens seks som
  tres/uklart. En senere ikke-armeret prøve transskriberede diagnostisk “Med tallet seks
  oveni.”, mens Realtime svarede på “lyd 6”. Begge forløb brugte én lokal session; close,
  teardown og korreleret rearm var rene. Den diagnostiske transskription og Realtime-
  modellens direkte audioforståelse er separate processer og må ikke sidestilles.
- **Hele kæden og nærliggende fejlveje:** fysisk Voice PE-PCM → audio-generation →
  provider-user-item → response/conversation → assistant-item → fysisk playback →
  opfølgnings-user-item i samme provider-conversation. Nærliggende alternativer er
  forkert artifact/provenance, manglende provider-item-ancestry, schema-/promptkonflikt,
  native audiosemantik eller modelnondeterminisme. Mic-gate og stale transport åbnes kun
  igen, hvis en korreleret PCM-/generationstrace direkte placerer fejlen dér.
- **Berørte invarianter, hypotese og ikke-mål:** Realtime ejer fortsat sprog, matematik,
  kontekst og værktøjsvalg; PodVoice observerer kun mekanikken. Hypotesen er, at
  provider-konteksten består, mens den native model ikke stabilt fortolker den korte
  danske lyd. Ingen transcript-first vej, lokal semantik, frase-/matematikrouting,
  conversation-history replay, firmware-, gain-, VAD-, prompt-, reasoning-, schema-,
  lifecycle-, playback-, timeout- eller rearmændring er mål for denne kandidat.
- **Planlagte regressioner og sammensatte gates:** Observer alle provider-user- og
  assistant-items med conversation-, item-, response-, previous-item- og generation-id
  uden at ændre udgående wire eller gemme nyt indhold. Udvid exact PCM-replay med 1–5
  tekstkontroller og 1–5 audioforsøg under ét $5-loft, exact provenance og nul eksterne
  effekter. Dæk korrekt/brudt `U1 -> A1 -> U2`, duplicate/out-of-order/stale events,
  tool-items, Talk/typed og Voice PE/audio samt observer on/off-wireidentitet.
- **Stop og rollback:** En provenancefejl er BLOCKED, ikke produktevidens. Først en frisk
  exact trace og tekst/PCM-klassifikation må vælge næste ene adfærdsdelta. Enhver wire-,
  ACK-, dispatch-, latency-, playback- eller lifecycleændring fra observabiliteten
  ruller hele v1.13.51-deltaet tilbage. HA Green var 30. august ikke tilgængelig fra
  udviklingsmaskinen via Nabu Casa eller `homeassistant.local`, så live A/B og fysisk
  canary står åbne og må ikke foregives som resultater.
- **Faktisk v1.13.51-delta:** Providerobserveren er content-free, bounded og kun
  installeret i den ene eksplicit armerede samtale; den gendannes på normal teardown,
  connect-fejl og cancellation. Fysisk trace får version samt `rootfs-v1`-fingerprint,
  som bygges over den færdige runtime-rootfs inklusive base-runtime, installerede
  pakker, FLAC, modes og symlinks, men ikke foregiver at være en OCI-manifestdigest.
  Numerisk A/B kræver matching `rootfs-v1`, model, Prompt V7/hash, fuldt schemahash,
  room-context, turn-preset og OpenAI-noise før nogen providersocket åbnes. Begge ture
  kræver en komplet ordnet `U1 -> A1 -> U2 -> A2`-kæde med exact response/generation;
  tekst kræver request-ACK, lyd kræver audio-commit. Taloraklet afviser blandt andet
  184 som 84, 190 som 90, negation og modstridende tal. Sent transcript bevarer den
  allerede bundne ancestry; outputtekst og første lyd bindes til den afsluttede
  response; ukendt provider-usage stopper hele replayet fail-closed. Panelet kan kun
  vise grøn ved provenance-match og samtlige 5+5 beståede forsøg. Dockerfile er den
  eneste ændring uden for add-onens diagnostikkode: den skriver rootfs-fingerprintet
  ved build. Firmware og al frossen produktionsadfærd ovenfor er uændret.
- **Faktiske lokale resultater og review:** Den endelige målrettede suite har **509/509**
  grønne tests for evaluator, providerprotokol, audio trace, rootfs-identitet, Thin,
  Talk/panel og web. Ruff, formattering, mypy over 42 source-filer og diff-check er
  grønne. Første adversarial review fandt fire P1-huller i diagnosticeringen: sent
  transcript overskrev trace, ukendt usage kunne se gratis ud, modeloutput manglede
  responsebinding, og preset/noise manglede i provenance. Alle fire er rettet med
  falsificerende regressioner. Det første helt uafhængige slutreview fandt derefter to
  yderligere P1-huller: ekstra stale/duplicate/function-items kunne ligge ved siden af
  den forventede providerkæde, og en fejlet/cancelled eval-response uden usage kunne
  passere den normale terminalgren. Oraklet kræver nu den eksakte direkte-svarsekvens,
  og alle eval-terminalstatusser stopper på ukendt usage; de fire nye falsifikationer er
  grønne uden at ændre production-terminaladfærd. En tidligere fuld fast-gate på 1.094
  tests blev grøn på
  40,3 sekunder, men blev efterfulgt af disse rettelser og tæller derfor ikke som den
  endelige releasegate. Det endelige uafhængige review af det refrosne diff gav
  **GO med P0=0, P1=0 og P2=0**. Derefter bestod præcis én autoritativ
  `scripts/dev release --base origin/main`: Ruff, formattering, mypy og **1.113/1.113**
  tests grønne på **40,0 sekunder**. Exact-commit CI og ARM64-build står fortsat åbne.
- **Præcis kandidat- og fysisk status:** v1.13.51 er lokalt releasegodkendt, men endnu
  **ikke exact-commit-CI-godkendt, installeret, live-klassificeret eller fysisk golden**.
  Der findes endnu ingen frisk `rootfs-v1`-bundet Voice PE-trace, ingen betalt 5+5 A/B,
  ingen fysisk canary og ingen 10/10. HA Green er fortsat den eksterne grænse. Næste
  tilladte rækkefølge er PR/CI/ARM64 → én installation → frisk armeret trace → den
  sideeffektfrie 5+5-klassifikation. Først et
  `GO_TO_PHYSICAL_CANARY` åbner canary; alt andet stopper uden symptompatch.

### Historisk beslutning 28. august — timer-schema må ikke konkurrere med matematik

- **Observeret fejl og stærkeste direkte evidens:** Første tur blev transskriberet som
  “Hvad er tolv gange syv?”, svaret direkte uden værktøj og afspillet fysisk med
  `speech-stop -> audible = 1447 ms`. Opfølgningen blev korrekt transskriberet som
  “Læg seks til.” i samme provider-session, men modellen valgte `list_timers`; den
  ekstra værktøjsrunde gjorde `speech-stop -> audible = 3883 ms`. “Slut.” gav præcis ét
  `end_conversation`, én teardown og en korreleret rearm-ACK. Der blev ikke observeret
  et efterfølgende wake, så rearm-kontinuitet er fortsat ubevist.
- **Hele kæden og årsagsgrænsen:** Fysisk lyd → providertransskription → Realtime-
  kontekst → værktøjsvalg → værktøjsresultat → ekstra modelrespons → fysisk playback.
  Lydgrænsen leverede `[A, B]` som planlagt; fejlen opstod først ved Realtime-
  værktøjsvalget. Den oplevede “gamle samtale” må derfor ikke bruges som evidens for
  stale audio i denne trace.
- **Berørte invarianter og falsificerbar hypotese:** Realtime ejer fortsat matematik,
  opfølgning og værktøjsvalg. Timer-værktøjer må kun vælges ved en klar timerhensigt.
  Hypotesen er, at de brede beskrivelser af `set_timer`, `list_timers` og
  `cancel_timer` lader en kort numerisk opfølgning konkurrere med timerdomænet, selv om
  standardprompten allerede kræver direkte matematik uden værktøj.
- **Eksplicitte ikke-mål:** ingen lokal frase-, transcript- eller matematikrouting;
  ingen firmware-, gain-, VAD-, state-, mic-gate-, playback-, timeout-, teardown-,
  rearm-, HA/MCP- eller promptændring.
- **Planlagte regressioner, gates og rollback:** Præcisér kun timerdeklarationernes
  anvendelsesgrænse og test schemaet statisk. Kør derefter den eksisterende
  sideeffektfrie Realtime-sekvens mod hele produktionsværktøjskassen fem gange; kun den
  eksplicitte tidstur må kalde `get_time`, og ingen matematiktur må kalde timer- eller
  andre domæneværktøjer. Hårdt samlet prisloft er $5. En ulovlig tool-selection stopper
  kandidaten uden fysisk test. Rollback er hele schema-deltaet ved timerregression eller
  manglende forbedring; der må ikke tilføjes lokal semantik som plaster.
- **Faktisk v1.13.50-delta og lokal gate:** Kun beskrivelserne af `set_timer`,
  `list_timers` og `cancel_timer` er præciseret med den samme model-ejede grænse:
  seneste klare hensigt skal være en timerhandling; matematik og opfølgning til et
  ikke-timeremne er eksplicit uden for værktøjets formål. Standardprompten, dispatch og
  al mekanik er byteuændret. Den statiske schema-regression samt hele den hurtige gate
  med Ruff, formattering, mypy og fuldt testset er grøn på 38,9 sekunder.
- **Maskinel kandidatstatus:** Den fokuserede diagnose er nu én femturs-session med
  matematik → opfølgning → tid → ugedag → modelafslutning og kan køre fem friske
  sessioner under én samlet $5-grænse uden budgetprobe eller eksterne effekter. Tre
  positive timer-fixtures beviser samtidig `set_timer`, `list_timers` og `cancel_timer`
  mod de faktiske produktionsdeklarationer. Fast-gaten er grøn på 39,4 sekunder.
  Uafhængigt adversarial review genkørte den grøn på 38,7 sekunder og gav GO med
  P0=0/P1=0.
- **Resterende stop før installation/fysisk test:** Én releasegate på dette frosne diff,
  build/CI og installation mangler. Derefter skal den sideeffektfrie live-gate være 5/5
  på de installerede bits. Live-rapporten skal samtidig bevise den aktive prompt-
  identitet; en ukendt eller utilsigtet brugerdefineret prompt stopper kandidaten i
  stedet for at blive skjult af schemaændringen. Først derefter åbnes én fysisk canary;
  v1.13.50 er endnu ikke fysisk golden.

### Afsluttet beslutning 26. august — én state-ejet mic-gate per Realtime-tur

- **Observeret fejl og stærkeste direkte evidens:** Den armerede fysiske trace
  `20260826T154813-263` modtog først “Hvad er tolv gange syv?”, men Realtime valgte
  `get_time(fields=["weekday"])` og svarede “Det er onsdag”. Efter fysisk playback og
  echo-gate blev næste tur transskriberet som præcis samme matematikspørgsmål og gentog
  samme forkerte værktøjsrunde. Loggen viser til sidst én idle-teardown, to kørammer
  drænet ved rearm og en korreleret `recovered`-ACK. Lifecycle kom hjem; input-/tur-
  sandheden gjorde ikke.
- **Hele berørte kæde og nærliggende races:** fysisk audio-callback A kan være planlagt,
  men endnu ikke afviklet, når providerens `speech_stopped` afslutter tur A. Den
  eksisterende v1.13.48-generation skærer kun ved rearm og kan derfor ikke afvise en
  forsinket A-callback, der krydser THINKING/playback/echo-halen inden for samme
  Realtime-session. Den modsatte fejl er at skære ved wake og klippe same-breath-prefix,
  eller at åbne før fysisk playback-finish og sende højttalerekko som brugerlyd.
- **Berørte invarianter og falsificerbar hypotese:** Én wake ejer én Realtime-session;
  `State.LISTENING`/`LOUNGE_WINDOW` er de eneste fysiske mic-åbne states; alle øvrige
  states er mic-lukkede; hver forsinket callback fra en lukket audio-generation er
  inert; opfølgningen bevarer samme provider-generation. Hypotesen er, at én synkron
  audio-boundary ved `speech_stopped`, én ny boundary lige før opfølgningsgaten åbner og
  den eksisterende rearm-boundary giver providerinput `[A, B]` i stedet for `[A, A]`.
- **Eksplicitte ikke-mål:** ingen firmware-, gain-, VAD-, prompt-, reasoning-, tool-,
  playback-, HA/MCP-, Talk-semantik- eller lokal frase-/transcriptændring. Realtime ejer
  fortsat matematik, værktøjsvalg og `end_conversation`. Den fejlagtige `get_time` må
  ikke patches lokalt, før ren transport er bevist.
- **Bindende firesekunders produktkrav:** Planen ændrer samtidig den gemte/default
  opfølgnings-timeout fra otte til fire sekunder og UI-minimum fra fem til tre. Det er
  en eksplicit produktbeslutning, ikke en forklaring på stale-audio-fejlen og ikke en
  modelbeslutning. Regressionen skal bevise default/config/UI-værdien samt mekanisk
  close efter fire sekunders fysisk stilhed; den fysiske canary skal stadig nå en normal
  opfølgning inden for vinduet. Hvis den eksakte kandidat klipper en rettidig
  opfølgning, er kandidaten NO-GO og boundary-deltaet må ikke bortforklare timingfejlen.
- **Planlagte regressioner, gates og rollback:** Registreret native callback A skal
  kunne forsinkes over `speech_stopped` og blive afvist; callbacks under playback skal
  afvises efter opfølgningsboundary; umiddelbar frisk B efter åbning skal bevares én
  gang. Dæk queue-full, reconnect, duplicate playback-finish, samtidig timeout/close og
  Talk-paritet. Kør fokussuite, 30/30 sammensat lifecycle, fuld releasegate, uafhængigt
  adversarial review og én exact fysisk canary. Rollback er hele mic-/audio-boundary-
  deltaet ved klippet same-breath, død opfølgning, ekstra provider-session, LED/state-
  divergens eller teardown/rearm-regression. En gentaget stale/replay-fejl stopper
  videre symptompatching og udløser særskilt plan for at erstatte kun Thin-
  orkestreringen.
- **Faktisk v1.13.49-delta:** `VoicePELink.cut_audio_boundary(reason)` øger den allerede
  eksisterende callback-generation synkront og dræner køen. `ThinSession` bruger de fem
  eksisterende states som eneste Voice PE-mic-gate og skærer kun på første gyldige
  `speech_stopped`, efter current playback-lease/epoch er valideret ved ekkohalens slut,
  og gennem den eksisterende korrelerede rearm-ACK. En gammel ekkohale-task valideres
  før den må røre køen. Wake skærer aldrig. LED følger samme kæde; ufuldstændig fysisk
  teardown forbliver rød i stedet for falsk mørk readiness. Ingen `esphome/**`, firmware-
  ABI, gain, VAD, kanal, prompt, reasoning eller værktøjskontrakt er ændret.
- **Maskinelle resultater på den frosne kandidat:** Den eksakte callback
  A→boundary→B-regression, blocked provider-send ved speech-stop, samme-session
  math/follow-up-isolation, gammel echo-tail efter nyt wake, Talk A→B stop/truncate-
  races, Talk-transportfejl, LED/reconnect/fault, målrettet v10→v11-timeoutmigration,
  firmwarekontrakt og fail-closed trace-oracle er grønne. Hele releasegaten med Ruff,
  formattering, mypy og fuldt unit-/integrationstestsæt bestod på 38,8 sekunder.
  Uafhængigt adversarial lifecycle-review og separat firmware/LED/single-truth-review
  gav begge **GO med P0=0 og P1=0**. Exact-commit CI og ARM64-image står fortsat åbne
  efter commit; dette er maskinel testklarhed, ikke fysisk godkendelse.
- **Fysisk status:** **IKKE TESTET**. v1.13.49 er ikke golden, ikke 10/10 og ikke
  97/100, før exact artifact er installeret og den bindende canary plus ubrudte fysiske
  cyklusser er gennemført.

## Historisk evidens- og beslutningslog — udelukkende baggrund

Alt nedenfor bevares som årsags-, regressions- og rollback-evidens. Historiske ord som
“skal”, versionsplaner og kandidater er ikke længere aktive beslutninger og må aldrig
tilsidesætte den aktuelle v1.13.51-beslutning ovenfor, `docs/INVARIANTER.md`,
`docs/PRODUKTMÅL.md` eller `docs/ARKITEKTUR.md`.

### Historisk beslutning 26. august — sen gammel mic-frame krydsede næste wake

- **Observeret fejl og stærkeste direkte evidens:** På installeret exact v1.13.47 sagde
  brugeren “Okay Nabu, hvad er tolv gange syv?”. Tracens første provider-VAD-turn varede
  kun 276 ms, men blev transskriberet som hele den tidligere ytring “Hvad er klokken?” og
  udløste `get_time`. En senere rigtig ytring blev korrekt transskriberet som “Hvad er
  syv gange tolv?”, og “Læg seks til” blev også korrekt transskriberet, men kaldte
  fejlagtigt `end_conversation`. Device-, provider- og speakerlyd er gemt samlet som
  `20260826T145627-246`. En 276 ms turn kan ikke være den rapporterede fulde sætning;
  kandidaten er fysisk NO-GO.
- **Hele berørte kæde og nærliggende race:** samtale A → firmware
  `podvoice_stream_stop` køes → add-on dræner `_audio_q` → allerede in-flight native-
  API-audiocallback fra A ankommer efter drain → rearm → wake B → start bevarer med
  vilje same-breath-frames → A-frame bliver første lyd på den friske providersocket.
  Den nærliggende modsatte fejl er at dræne ved wake og derved klippe B's første ord.
  Providerens forurenede kontekst kan påvirke senere værktøjsvalg, men falsk semantic
  close skal måles særskilt efter ren lydtransport.
- **Berørte invarianter, hypotese og ikke-mål:** lyd fra generation A må aldrig nå B;
  samme-breath-input fra B må ikke mistes; én wake ejer én provider-generation; Realtime
  ejer fortsat betydning og `end_conversation`. Den falsificerbare hypotese er, at
  service-send + øjeblikkelig kødrain ikke udgør en transportbarriere, så en sen callback
  efter drain overlever til næste wake. Ingen gain-, VAD-, prompt-, tool-description-,
  playback-, budget- eller lokal semantikændring er mål.
- **Planlagte regressioner og rollback:** gengiv close A → drain → forsinket A-frame →
  rearm → wake B og kræv nul A-bytes på B's provider, samtidig med at B's 320 ms
  same-breath-prefix bevares. Dæk duplicate/failed stop, reconnect og Talk-paritet.
  Rettelsen skal ligge ved den mekaniske stop/rearm-generationsgrænse og må ikke være en
  tidsbaseret sleep. Rollback er hele grænseændringen ved mistet B-prefix, dead mic,
  ekstra stream/socket eller rearm uden fuld teardown. Først rød→grøn regression,
  relevant adapter/Thin-gate, adversarial review, fuld gate, exact install og én ny
  armeret fysisk canary kan åbne testen igen.
- **Faktisk kandidat v1.13.48:** den registrerede native audio-callback fanger en
  monoton audio-generation synkront, før aioesphomeapi planlægger dens coroutine. Kun
  den eksakte aktive `recovered`-ACK avancerer generationen og dræner køen, før Thin
  fortsætter. En forsinket A-callback bliver derfor inert; umiddelbar B-audio efter ACK
  bevares. Wrong/fault/duplicate ACK og drainfejl forbliver fail-closed. Firmware,
  ThinSession, Talk, Realtime-semantik, prompt, VAD, gain og playback er uændrede.
- **Maskinbevis og review:** callback-regressionerne går gennem de faktisk registrerede
  old/new native subscriptions og dækker fault→retry, reconnect, forsinket A og
  umiddelbar B. 191 relevante Voice PE/Thin/Talk-tests er grønne; fuld releasegate er
  grøn på 37,1 sekunder. Uafhængigt adversarial review gav GO med P0=0/P1=0. To
  eksisterende teardown-tests venter nu på det cleanup-resultat, de påstår at bevise,
  i stedet for et tidligere mellemstadie; det fjerner en observeret test-race uden at
  ændre runtime.
- **Præcis fysisk status:** v1.13.48 er maskinelt testklar, men ikke fysisk bevist og
  ikke golden. Næste og eneste feltgate er exact image/install og én armeret canary,
  der beviser ren første ytring, samme-session-opfølgning, model-close, én teardown,
  rearm og næste wake. Audio, der først dekodes efter ACK, kan kun afvises eller
  bekræftes af denne fysiske trace.

### Historisk installationsbeslutning — selvstændig ESPHome-kilde

- **Observeret fejl og stærkeste evidens:** HA's ESPHome Builder kan hente
  `esphome/podvoice.yaml` fra GitHub, men den shippede `external_components`-blok peger
  stadig på den lokale mappe `components`. En frisk HA-konfiguration fejler derfor med
  `Could not find directory '/config/esphome/components'`, før firmware kan kompileres
  eller flashes.
- **Berørt kæde og invarianter:** katalogopdatering → eksakt add-on-version → GitHub-
  firmwarepakke → ekstern `podvoice_audio`-komponent → ESPHome render/compile → USB-
  flash → reboot → automatisk native-API handshake og eksakt firmwarekontrakt. Runtime,
  lyd, VAD, gain, playback, teardown og rearm må være byteidentiske.
- **Falsificerbar hypotese og ikke-mål:** den lokale udviklerkilde er den eneste årsag;
  skift til ESPHomes Git-kilde på samme repo, den immutable v1.13.44-commit
  `385b71c4f1d3285f130390d8735849268427add3` og den eksplicitte sti
  `esphome/components` skal gøre en ren HA-build mulig uden kopierede filer. Der ændres
  ingen firmwareadfærd, secrets, prompt eller lifecycle.
- **Gate og rollback:** ren remote-package config/compile skal finde præcis
  `esphome/components/podvoice_audio`; diffet må kun ændre kildeleveringen, og en
  uafhængig reviewer skal kontrollere repo-layout, refresh/ref og rekursion. Rollback er
  hele kildeændringen ved ændret renderet firmware eller manglende komponent.
- **Historisk resultat:** en helt ny ESPHome 2026.6.2-workdir renderer den pinnede Git-
  komponent grønt, og den statiske regression afviser igen en aktiv lokal kilde.
  Uafhængigt adversarial review bekræfter ESPHomes `esphome/components`-opslag, ingen
  rekursion og korrekt komponentafgrænsning; den oprindelige mutable `main`-reference
  blev afvist og erstattet af immutable commit og eksplicit sti. HA Green byggede den
  pinnede produktionskonfiguration med ESPHome 2026.7.4. Factory-binaryens SHA-256 er
  `45351a57cd215ded3fee3e270215b156c6d873f5982211db4c6dfd42db78f306`; før flash blev
  den kontrolleret for `podvoice_reply_play`, `podvoice_reply_silence`,
  `correlated_reset_rearm_v2`, `correlated_playback_v2` og `podvoice_build_11344`.
  USB-flash til ESP32-S3 fuldførte med dataverifikation og hardware-reset. Uden add-on-
  genstart genfandt PodVoice derefter enheden via `.local`, gennemførte Noise-handshake,
  godkendte den eksakte firmwarekontrakt, anvendte mic channel 1/gain 16 og wake word
  `okay_nabu`. Loggen står nu på “wake detector recovered; awaiting first physical
  proof”. Det beviser installation og automatisk reconnect, ikke golden chain eller
  næste fysiske re-wake efter en afsluttet samtale.

### Frisk fysisk evidens 26. august — v1.13.44 NO-GO

- Tre fysiske wakes kl. 11.03.30, 11.03.58 og 11.04.23 åbnede hver en ny session og
  leverede mic-frames. De to første hørte “Hvad er tolv gange syv?” korrekt og
  afspillede svar fysisk. Brugeren forsøgte samtidig at hæve lydstyrken med puckens
  drejehjul. v1.13.44's private `podvoice_reply_player` er den nye ejer af Nabu-svar,
  mens firmware-scriptet `control_volume` fortsat kun ændrer `external_media_player`;
  fysisk svarlydstyrke og drejehjul har dermed ikke længere én dokumenteret ejer.
- Den konfigurerede firesekunders stilhedslukker udløste efter svarenes fysiske drain,
  før opfølgningen blev afleveret. Stilhedslukningen er ikke ændret i v1.13.43/44, men
  brugerens lydstyrkehandling gjorde vinduet praktisk utilstrækkeligt i denne prøve.
- Tredje wake blev delt af Realtime til “Ja.” og derefter “Hvad er klokken?”. Det første
  fragment havde allerede skabt en aktiv respons, så det andet udløste providerfejlen
  `conversation_already_has_active_response`. Det er en half-duplex/turn-boundary-fejl,
  ikke manglende mic-transport.
- Efter close kl. 11.04.40 meldte firmware igen `wake detector recovered; awaiting first
  physical proof`, men brugerens efterfølgende wake gav ingen `wake signal`. To tidligere
  re-wakes i samme forløb gør fejlen intermittent; de kan ikke godkende den tredje.
  Kandidaten forbliver NO-GO. Næste ændring skal forklare både rotary→privat reply-volume
  og den eksakte tredje teardown→reset→detector-eventkæde; gain, VAD, prompt og værktøjs-
  semantik må ikke tunes for at maskere dem.

### Historisk beslutning 26. august — bevar v1.13.43-adfærd og stop blandede kandidater

- **Beslutningsejer og eksakt baseline:** Lead Voice/Reliability Engineer. Den sidste
  kodebaseline før v1.13.44's private playback er v1.13.43 commit
  `8d4fc9cd521f564a6205359f610ba2761284fc74`. Den ejer rollback-sandheden for
  drejehjul → `external_media_player`, samme-session-opfølgning og 1.13.43's korrelerede
  rearm-reset. En erindret samtale eller et versionsnummer alene er ikke rollbackbevis.
- **Observeret procesfejl:** exact diff v1.13.43→v1.13.44 ændrede i én kandidat mindst
  provider/Realtimes terminale events, fysisk playbacktopologi og rearmens
  silence/drain-grænse. Den uafhængige forudgående review advarede specifikt om, at den
  private `podvoice_reply_player` var bredere og mere risikabel end den eksisterende
  `external_media_player`-vej. Maskingaten var grøn, men havde ingen fysisk rotary-
  regression. Det er en gatefejl, ikke acceptabel feltvarians.
- **Berørte invarianter og kæde:** fysisk rotary/master-volume → aktiv Nabu-player →
  fysisk reply start/drain → fuldt firesekunders opfølgningsvindue → samme Realtime-
  session → semantic close → én teardown → privat/public player silence → detector-
  reset → næste ægte wake. Playback-ejerskab må ikke kunne arves af fremmed HA-lyd, og
  rearm må ikke godkendes af `recovered` alene.
- **Falsificerbare hypoteser:** (1) volume-regressionen skyldes, at basefirmwarens
  `control_volume` kun muterer `external_media_player`, mens v1.13.44 afspiller Nabu på
  `podvoice_reply_player`; en fælles fysisk master-volume eller en eksakt tilbageførsel
  til 1.13.43-playeren skal få rotary-canary til at bestå. (2) Den intermittente tredje
  re-wake ligger efter v1.13.44's nye private-player drain eller i det uændrede
  stop/start-reset; kun en korreleret firmwaretrace må vælge mellem dem.
- **Én-delta-regel og rollback:** første kandidat må kun ændre playback/volume og skal
  enten bevare den private tokenkæde med reel rotary-paritet eller tilbageføre hele
  1.13.44-playbackdelen til exact v1.13.43. Den må ikke samtidig ændre rearm, VAD, gain,
  prompt, Realtime eller idle-timeout. En separat senere kandidat må kun ændre rearm.
  Hvis privat playback ikke kan bevise rotary, opfølgning og fremmed-HA-isolation i én
  kort canary, er rollback-grænsen exact 1.13.43-playback — ikke et hybridt mellemtrin.
- **Nye procesgates:** `scripts/candidate_scope.py` afviser flere uafhængige
  produktionsdomæner eller produktionskode uden en ændret regression. Den strikte
  `scripts/field_canary.py` kræver mindst fire fysiske ture, model-close, korrekt
  teardown/playback, et fysisk afsluttet svar før hver almindelig opfølgning, næste
  wake + frisk provider-session samt et eksplicit fysisk rotary-bevis. Ti fokustests
  er grønne; disse værktøjer ændrer ingen runtime.
  Udvikling og gates flyttes til en lokal usynkroniseret clone: samme exact diff tager
  ca. 0,02 s dér mod timeout over 20 s i Documents-worktreet.
- **Faktisk kandidat v1.13.45:** den private token-isolerede player beholdes, men får
  v1.13.43's eksakte volume-interval og increment. Hver ændring fra det fysiske
  drejehjuls `external_media_player` spejles til den private player; LED-callbacken,
  som `!extend` ellers ville erstatte, bevares eksplicit. Ved reply-start udføres volume
  og media-URL i to separate ESPHome-calls, fordi componentens URL-gren returnerer før
  volume ellers anvendes. Rearm, idle-timeout, VAD, gain, Realtime og lifecycle er
  uændrede.
- **Faktiske maskinresultater og review:** kandidat-scope klassificerer kun
  `physical_output` og består. 80 fokuserede kontrakt-/proces-tests er grønne;
  ESPHome-konfigurationen validerer mod de immutable components; hele releasepakken
  inklusive lint, format, mypy og test-suite er grøn på 42,2 sekunder i den lokale
  clone. Den uafhængige adversarial reviewer fandt først den ugyldige kombinerede
  volume+URL-call; efter opsplitning og ny regression gav samme reviewer GO uden
  P0/P1-findings.
- **Installeret kandidat og kontraktbevis:** main commit
  `672fbb02f9dcfdaa841609a336529fd7885ab8b9` er installeret som add-on v1.13.45 og
  OTA-flashet på Voice PE. Den 26. august kl. 12:07:59 annoncerede den genstartede puck
  `podvoice_build_11345`; add-on'en accepterede firmwarekontrakten, anvendte mic
  channel 1/gain 16 og satte wake word til `okay_nabu`. HA/MCP var samtidig forbundet
  med 19 værktøjer. Dette beviser kandidatidentitet og maskinel readiness, ikke fysisk
  samtaleadfærd.
- **Resterende usikkerhed og fysisk gate:** v1.13.45 er fortsat fysisk ubevist og derfor
  NO-GO som release. Én kort canary skal bevise dial under aktivt svar, mindst tre
  almindelige svar med samme-session-opfølgning, model-close, præcis teardown og næste
  ægte wake/friske session. Hvis den fejler rotary eller opfølgning, tilbageføres hele
  playbackdelen til exact v1.13.43; rearmfejlen må først ændres i en separat kandidat
  efter korreleret fysisk trace.
- **Fysisk canary-resultat 26. august ca. 12:20 — NO-GO og rollback udløst:** drejehjulet
  ændrede lydstyrken under Nabus svar, så v1.13.45 beviser rotary-paritet. Samme-session-
  opfølgningen fejlede derimod: efter det korrekte svar på »Hvad er tolv gange syv?«
  absorberede echo-shield 382 mic-frames frem til 12:21:07, men »læg 6 til« producerede
  hverken provider-`speech_started` eller transcript. Den lokale femsekunders
  idle-fallback lukkede først kl. 12:21:13; Realtime kaldte ikke `end_conversation`.
  En ny wake kl. 12:21:29 åbnede en frisk session og svarede, så dette spor beviser
  hverken semantisk fejllukning eller manglende efterfølgende rearm. Den falsificerbare
  årsag er den v1.13.44-introducerede private playbacktopologi/echo-gate-grænse, som
  v1.13.45 beholdt. I henhold til den forhåndsdefinerede rollback-grænse tilbageføres
  nu hele playbackdelen til exact v1.13.43; der laves ikke endnu en lokal timinghybrid.
- **Lead-beslutning efter canary og adversarial review:** den delvise playback-rollback
  er erstattet af en fuld restore af den Voice PE-relevante produktionsruntime til
  exact v1.13.43. Det omfatter firmware, `VoicePELink`, `ThinSession`, Realtime-
  integration, runtime-config og deres kontrakttests. Kun den fjernede parallelle
  simulator, immutable component-pin samt test/trace/buildinfrastruktur afviger; de
  ændrer ikke den fysiske samtalevej. Rearm optimeres først som et separat delta efter
  en frisk fysisk baseline.
- **Faktisk kandidat v1.13.46 og maskinbevis:** version/build-id er alene løftet til
  `1.13.46`/`podvoice_build_11346`, så installerede restore-bits kan bevises. Fokuseret
  firmware/VoicePE/Thin/Talk-gate er grøn, lifecycle-manifestets 259 tests er grønne,
  hele releasegaten er grøn på 36,7 sekunder, og ESPHome-konfigurationen validerer mod
  de immutable kilder. Den generelle
  single-domain-scope-gate klassificerer bevidst restore-diffet som tre domæner; det er
  ikke en ny blandet featurekandidat, men en eksplicit total rollback godkendt af lead
  og underlagt uafhængigt diff-review.
- **Præcis gate-status:** v1.13.46 er ikke fysisk bevist, ikke golden og ikke release-
  godkendt. Næste gate er exact-commit CI/image, installation og én frisk fysisk kæde,
  som også beviser auto-connect og ny wake efter rearm. Først derefter laves en isoleret
  rearm-kandidat; når golden chain, rearm og auto-connect er bevist på samme bits,
  etableres 1.14-linjen og 10/10 ubrudte fysiske cyklusser køres.

### Historisk beslutning 26. august — næste wake blev falsk afvist af fast 15k-reservation

- **Observeret fejl og stærkeste direkte evidens:** Den installerede exact v1.13.46-
  kæde gennemførte fem Realtime-responskanter i samme session. Providertranscriptet
  indeholdt ordret `Læg seks til.`, modellen kaldte `end_conversation` på `Tak, det var
  alt.`, fysisk farvel blev afspillet, og én teardown/rearm sluttede kl. 13.46.30. En ny
  fysisk wake kl. 13.46.33 blev registreret med `active=False`, åbnede en ny lokal
  samtalegeneration og blev derefter afvist **før providersocket** med
  `rate_limit_capacity · provider token capacity is insufficient for a voice session`.
  Samme lokale afvisning gentog sig kl. 13.46.46. Det beviser rearm og næste wake, men
  afviser golden chain, fordi den nye Realtime-session ikke blev oprettet. Brugerens
  første wakeforsøg gav intet observeret wake-event og forbliver en separat fysisk
  wake-usikkerhed; firmwarefølsomhed må ikke ændres uden lyd-/wake-bevis.
- **Hele berørte kæde og nærliggende races:** completed usage/rate-snapshot i gammel
  generation → model-close → exact release af gammel production-lease → firmware-rearm
  → ny wake/mic-latch → `OpenAIRealtime.connect()` → ny production-owner → session-
  update/socket → første sideeffektfrie modelrespons → eventuel tool/farvel-kapacitet →
  playback/teardown/rearm. Stale release/rate/usage fra gammel generation, samtidig
  eval, duplicate wake/connect, connectfejl, provider-429 og underfinansieret toolrunde
  skal forblive fail-closed og exactly-once.
- **Berørte invarianter, falsificerbar årsag og ikke-mål:** Én wake må eje højst én
  production-generation/socket; eval og production forbliver eksklusive; HA/MCP og
  lifecycle-værktøjer må kun frigives efter completed autoritativ usage og eksakt
  follow-up-kapacitet. Årsagen er den faste admission i `production_started(tokens=15000)`:
  efter lease-release beholdt den autoritative rullende bucket sandt mindre end 15.000,
  selv om én frisk sideeffektfri første respons kunne være mulig. Den nye generation
  skal derfor eje `min(15000, floor(available))`, mens dens cap for atomisk senere top-up
  forbliver 15.000. Ingen bucket-reset, magisk 6k-grænse, ekstra probe, automatisk retry,
  ny socket, prompt-/schemaændring, firmware-, wake-, gain-, VAD-, playback- eller
  lifecycleændring er mål.
- **Planlagte regressioner og sammensatte gates:** Gammel session bruger bucket under
  15k → exact release → +2,6 s → ny generation får en partial lease uden overreservation
  og højst én socket. Duplicate start, stale release/rate/usage, connect/setup-fejl,
  diagnostic/eval-eksklusivitet, cold bucket og zero-capacity dækkes. En completed
  sideeffektfri første respons må bogføres/lukkes; et completed HA/MCP/`end_conversation`-
  forslag uden follow-up-kapacitet giver nul dispatch/commit og én teknisk teardown;
  gyldig current-generation top-up giver præcis én dispatch. Provider-429 giver ingen
  retry eller anden socket. Thin/Voice PE-integrationen skal bevise close A → wake B
  efter 2,6 s → ny providergeneration, og hele lifecycle-/releasegaten samt uafhængigt
  adversarial review skal være grønne før versionering.
- **Rollback-grænse og fysisk status:** Hele partial-leaseændringen rulles tilbage ved
  overreservation, tabt eksklusivitet, ekstra socket/retry, ekstern effekt uden reserve
  eller stale generationsejerskab. v1.13.46 forbliver fysisk NO-GO. En maskinelt grøn
  kandidat må kun åbne én ny fysisk canary; den overtager ingen baseline før første wake,
  samme-session-opfølgning, model-close, én teardown/rearm og umiddelbar næste wake med
  ny rigtig Realtime-session er samlet bevist.
- **Faktisk ændring og maskinresultat for v1.13.47:** `production_started()` giver én
  eksklusiv production-generation `min(15000, floor(available))`, men beholder dens
  15.000-cap til en senere atomisk top-up. Usage med forkert, lukket eller fremmed lease
  afvises før debit. Der er ikke tilføjet probe, retry, socket, bucket-reset eller nogen
  Voice PE-/Talk-lifecyclevej. 121 fokuserede budget-/Realtime-tests er grønne på under
  ét sekund; de nye regressioner dækker nul og partial kapacitet for HA, MCP og
  `end_conversation`, current-generation top-up, duplicate done, stale usage,
  provider-429, setupfejl, release og diagnostic-eksklusivitet. Ruff, format, mypy og
  diff-check er grønne. Uafhængigt adversarial diff-review gav P0=0, P1=0 og GO til
  commit/maskinel releasegate. Den første hurtiggate ramte worktreets langsomme lokale
  `.venv`; med den etablerede usynkroniserede værktøjsruntime blev hele testsuiten grøn,
  hurtiggaten sluttede på 37,0 sekunder og den fulde lokale releasegate på 38,4 sekunder.
- **Præcis kandidatstatus:** v1.13.47 er kun maskinelt reviewet og fortsat fysisk NO-GO.
  Den ændrer kun add-onen og kræver derfor ikke ny firmwareflash;
  `podvoice_build_11346` forbliver eksakt firmwarekontrakt. Først en grøn fuld gate,
  exact image/install og den ovenfor definerede fysiske canary kan flytte status.

### Historisk beslutningspost — provider-tail og fysisk playback-korrelation

- **Observeret fejl og stærkeste evidens:** en deterministisk reproduktion af
  `response.done(r) → response.created(r) → audio.delta(r) → response.done(r)` gav
  både `TurnComplete` og en stale `AudioChunk`, efterlod provideren aktiv og kan wedge
  næste tool-resultat. En almindelig completed respons uden PCM åbner opfølgning og kan
  gemme et uhørt assistant-transcript. Shippet firmware udsender samtidig kun boolske
  `podvoice_playback_started/finished/fault`; Thin-tests bruger syntetiske playback-id'er,
  som den fysiske adapter aldrig leverer. `simulate` kan fortsat aktiveres via shipped
  config/UI og importerer legacy `sim.py`.
- **Hele berørte kæde og nærliggende races:** provider response-id/status → audio og
  transcript → Thin turn-complete/history/followup → reply lease/id →
  firmware-ejet reply-play → privat announcement start/drain/fault → native API →
  playback finish → close/teardown/rearm. Nærliggende fejlveje er done-before-created,
  terminal tail, duplicate/out-of-order events, gammel finish efter ny arm, reconnect,
  missing/fremmed token, silent semantic end versus silent ordinary response, Talk-
  adapteren og dev-simulatoren.
- **Berørte invarianter:** lifecycle 3–5 og 10–13; Realtime-events efter terminal status
  skal være virkningsløse, kun korreleret semantic end må lukke stille, fysisk playback
  skal ejes af samme lease fra request til drain, og classic/sim må ikke kunne aktiveres
  fra produktion. Én wake/én session, opfølgninger og rearm må ikke ændres.
- **Falsificerbar årsagshypotese:** terminal response-id'er kontrolleres for sent i
  providerparseren; Thin skelner ikke ordinary zero-PCM completion fra lovlig silent
  semantic end; firmwareeventtypen kan ikke bære leaseidentitet; og simulatorflaget er
  blevet bevaret som produktionsindstilling. Tidlig terminal-afvisning, ordinary
  zero-PCM fail-closed, en tokenbærende entity fra firmware samt fjernet shipped
  simulate-aktivering skal lukke hullerne uden lokal semantik eller parallel runtime.
- **Planlagte regressioner og sammensatte gates:** eksakt fire-event provider-tail plus
  næste normale tool-resultat; ordinary zero-PCM må ikke gemmes eller åbne followup og
  skal fejle hørligt, mens korreleret silent semantic end fortsat lukker rent; source-
  kontrakt for nul shipped simulate-import/config/UI; token-match gennem
  expect→start→finish/fault og afvisning af missing/wrong/stale/duplicate/out-of-order
  token efter ny lease/reconnect; Talk-paritet; focused, lifecycle, fuld release,
  firmware render/config/compile og to uafhængige frozen reviews.
- **Ikke-mål og rollback:** ingen prompt-, gain-, VAD-, mic-channel-, resampling-,
  HA/MCP-, tool-, rearm- eller latencyændring. Dev-simulation må leve som separat
  test-entrypoint, aldrig shipped runtime. Rollback er hele provider/silent/sim/token-
  ændringen, hvis token kan krydse leases, Talk ændres, ordinary svar lukkes semantisk,
  eller firmware/add-on bits ikke har eksakt samme kontrakt/buildmarkør.

**Faktisk ændring og resultater for v1.13.44.** Providerparseren tombstoner nu både
events efter et terminalt response-id og et nyt response-id, der genbruger allerede
forbrugt request-metadata; den efterfølgende legitime tool-resultrespons bruger stadig
samme socket. Thin fejler ordinary completed uden PCM hørbart og uden transcript eller
followup, mens korreleret silent semantic end fortsat lukker stille. Tool-taskens
levetid kan ikke længere nulstille response-ejerskab før dens lydløse decision-
`TurnComplete`. Shipped simulate-config, runtime, console-fallback og modul er fjernet;
kun `tests/fakes/legacy_sim.py` er bevaret som testfixture.

Fysisk svarplayback bruger nu én procesrandomiseret og monoton token fra Thin-lease via
native API til firmware-ACK `token:started|finished|fault`; missing, wrong, stale,
duplicate, out-of-order og disconnect-events er inerte. Normale svar sendes med præcis
én device-ejet `podvoice_reply_play(token,url)`. Timer og diagnostik reserverer først et
auxiliary token, muterer derefter ReplyBus og starter samme private player, men deres
ACK'er når aldrig Thin. Den private FLAC-player har egen HTTP-kilde, resampler og mixer-
input; HA's offentlige media player kan derfor ikke levere falske reply-events. En
forladt auxiliary reservation udløber bounded, og ny reserve afvises under start/drain.
Cancel og ukendt orphan-recovery kvitteres først efter privat player-idle og fysisk tom/
stoppet resampler. Disconnect bevarer den ukendte lease; rearm udfører desuden sin egen
bounded silence/drain-gate før wake-recovery; adapterens 9 s og Thin-gatens 9,5 s
dækker firmwaregrænsen på 3 + 2 + 3 s. Firmware-reset med mismatchet exact cancel
falder via fault over i frisk tokenbåret orphan-silence ved næste retry. Wake stopper
auxiliary playback før Realtime-admission, og manglende stop afviser wake.

- **Lokale gates:** den auditerede lifecycle-manifestpakke er 163/163 grøn; fuld
  releasegate er grøn på 42,7 s med Ruff, format, mypy og hele pytest-suiten.
  Localhost-webregressionen beviser, at aktivt svar ikke kan overskrives af
  `test_speaker`. Preflight læser nu kun tre repræsentative filer i stedet for at
  hydrere hele det synkroniserede checkout; den tidligere 15 s timeout er elimineret.
- **Firmwarebevis:** ESPHome 2026.6.2 config og validation-only compile er grønne fra
  kilde-SHA-256 `fed87c0e510b7100192fa7fb98aaada32f70e2c8dec43a2917487de50775d6cb`.
  ELF indeholder `podvoice_build_11344`, `correlated_playback_v2` og
  `podvoice_playback_ack`. SHA-256 er OTA
  `4429da95127528b809576d902941a688ed9fd2607989f3fc335173ceff6ade38`, ELF
  `4c06e3445e2f3e1ae2b6d9e1a8a700e48a6ecd8550aa3e5d0cab15c54ff19672` og factory
  `b70e871347c3ce639457c4990b6445dbe3b319a5bf89cdbd0893dc100d85eace`.
- **Afvigelser og resterende usikkerhed:** første reviewer-loop falsificerede den
  tidsbaserede `armed → offentlig media-command`-løsning: en HA-announcement kunne
  arve tokenet. Det krævede den isolerede private FLAC-pipeline ovenfor; prompt, gain,
  VAD, HA/MCP og rearm-semantik blev ikke ændret. Validation-firmware bruger dummy-
  secrets og må ikke flashes. Kandidaten er ikke fysisk testklar før final frozen review,
  commit, exact-commit CI/ARM64 og installerbar artifact/digest; derefter kræves frisk
  fysisk golden chain og 10/10 ubrudte cyklusser. Rollback-grænsen ovenfor gælder.
- **Frozen review:** to uafhængige adversarial reviews er GO for exact commit/CI uden
  P0/P1 og scorer henholdsvis 97/100 og 98/100 maskinel confidence. Det er ikke fysisk
  releasebevis; exact-SHA CI/ARM64 er nu grøn, mens installerbar bitidentitet fortsat
  mangler.

### Historisk feltbeslutning 25. august — minimal Realtime-lifecycle uden overfit

**Observeret på installeret v1.13.41 kl. 13.28–13.29.** Voice PE åbnede én
Realtime-session. `get_time` lykkedes. Realtime modtog den korrekte transskription
“Hvad er tolv gange syv?”, men svarede `28`. To korrekte transskriptioner af “Læg seks
til.” førte til stadig længere forsvar for den forkerte modelkontekst. “Farvel.” gav
præcis ét `end_conversation`, et kort fysisk farvel, model-close, attention-release og
fysisk wake-rearm. Den armerede trace `20260825T132842-361` gemmer device-, provider- og
speakerlyd samt hele eventrækkefølgen.

- **Hele berørte kæde og nærliggende fejlveje:** fysisk wake → præcis én
  Realtime-generation → samme socket/kontekst gennem opfølgninger → direkte svar eller
  nødvendige domæneværktøjer → ét committed `end_conversation` → valgfri kort
  providerlyd eller eksplicit stille afslutning → én teardown → bounded fysisk rearm →
  næste wake. Nærliggende races er delayed/unrelated `TurnComplete`, modstridende
  lifecycle-kald i samme batch, forskellige duplicate end-kald, playback uden lyd,
  hængende provider/device/attention-close og den modsatte Talk-adapter.
- **Berørte invarianter:** Realtime ejer betydning og afslutningsvalg; Thin ejer kun
  mekanik og må aldrig fraseparse. Én wake må skabe én session. Kun den korrelerede,
  completed terminalrespons må bekræfte semantic end. Lifecycle-signaler skal være
  entydige, og teardown/rearm skal have præcis én ejer og en hård tidsgrænse.
- **Falsificerbar årsagshypotese:** produktionsvejen er én og grundlæggende rigtig, men
  modelkontrakten gentager afslutningsreglen i systemprompt, reserved tool og
  domæneværktøj og overstyrer providerens batchform. Samtidig mangler Thin fire
  serverhåndhævede grænser: close-response-korrelation, atomisk afvisning af mixed
  wait/end, afvisning af flere end-kald og bounded teardown. Fjernes dubletterne og
  håndhæves disse grænser, skal rå eventpermutationer blive deterministiske, mens en
  lille live matrix stadig lukker “Farvel”, “Tak, det var alt” og “Stop samtalen”, men
  ikke “Tak”, “stop musikken” eller en ny opgave.
- **Bindende minimal kontrakt:** wake åbner én Realtime-session; første tur og 0..N
  naturlige opfølgninger deler præcis den samme socket og samtalekontekst uden nyt wake;
  Realtime svarer direkte eller kalder kun nødvendige værktøjer;
  et entydigt `end_conversation` lukker. Har den korrelerede terminalrespons lyd,
  afspilles den færdig; har den ingen lyd eller fejler, lukkes der stille uden lokal
  semantik eller falsk playback-fejl. Derefter udføres én bounded teardown og én rearm.
  “Stop musikken” er en domænehandling; “stop samtalen/Nabu” er semantic end.
- **Planlagte regressioner og gates:** korreleret response-id/generation; stale,
  duplicate og out-of-order completion; atomisk mixed wait/end og duplicate-name-end;
  terminalrespons med farvel, completed uden lyd og failed uden lyd; hung provider,
  device og attention med total teardown-deadline; samme tests for Voice PE og Talk;
  ti simulerede lifecycle-cyklusser. Den lokale `lifecycle-smoke` må kun bevise disse
  mekaniske egenskaber og skal normalt køre på få sekunder til højst to minutter. En
  lille live close-matrix beviser kun modelvalget. Fuld SafeEval, øvrige funktioner,
  CI/ARM64 og fysisk golden chain er separate senere gates.
- **Ikke-mål og rollback:** ingen lokal fraseliste, transcript-veto, calculator eller
  anden semantikmotor; ingen `continue_conversation`, parallel runtime, audio/VAD/gain,
  firmware-, HA/MCP- eller funktionsændring. Matematik er ikke længere lifecycle-bevis.
  Ved uløst P1, forskel mellem Talk og Voice PE, ukorreleret close eller stille close
  uden et committed `end_conversation` forbliver kandidaten NO-GO og rulles tilbage
  samlet før fysisk test.
- **Faktisk ændring og maskinel status for v1.13.42:** samme-session-opfølgninger er
  bevaret og promptlåst. Terminal request, source call-id, response-id, socket-generation,
  PCM og completion er nu én korreleret kæde; stale, duplicate, superseded og raw
  done-before-created-events fejler lukket. Kun eksakt terminal PCM kan blive farvel;
  ellers lukkes stille. Silence, cachet fejllyd, teardown og første rearm deler én samlet
  deadline, og hvert rearm-retry er bounded. Voice PE og Talk har parallelle mekaniske
  regressioner. Hurtig lifecycle-gate: 54 selectors, 118/118 cases på 10,02 s;
  Thin: 122/122; providergrænser: 89/89; tidligere samlet prompt/eval/UI-gate: 352/352.
  Ruff, format og mypy er grønne. Uafhængigt adversarial recheck af det uversionerede
  runtime-snapshot fandt P0=0/P1=0 og gav GO for maskinel testklarhed; versions-/docsændring
  ændrer ikke runtime. Resterende usikkerhed er den lille rigtige Realtime-close-matrix,
  rigtige Realtime-close-matrix og fysisk Voice PE-kæde. Kandidaten blev 25. august
  installeret fra det opdaterede HA-katalog som v1.13.42. Opstartsloggen viste
  `PodVoice gatekeeper v1.13.42`, HA/MCP-forbindelse med 19 værktøjer og fungerende
  `GetLiveContext`, `PodVoice ready — rooms: ['r0']`, succesfuldt Voice PE-handshake,
  firmwarekontrakt OK, mic-tuning og wake word `okay_nabu`. Den er derfor installeret
  og klar til næste gate, men var på dette tidspunkt **ikke live-close-matrix-, fysisk
  golden-chain- eller releasegodkendt**.

- **Frisk fysisk evidens for v1.13.42 kl. 15.24–15.25:** én wake åbnede én
  Realtime-session. `12 × 7` gav korrekt `84`; opfølgningen “Læg seks til” gav korrekt
  `90`; datoen blev hentet korrekt; den senere reference til det tidligere regnestykke
  bevarede konteksten og bad fornuftigt om præcisering mellem `84` og `90`. Afslutningen
  gav præcis ét committed `end_conversation`, en kort fysisk farvelrespons, én
  model-close, media stop og attention-release. Add-on-loggen registrerede derefter
  `wake continuity proven`, men ingen ny wake blev observeret, og ejerens umiddelbare
  efterfølgende “Okay Nabu” virkede ikke. Det er stærkere fysisk modbevis end ACK'en:
  samtaledelen er grøn, men lifecycle/golden chain er **NO-GO**.
- **Ny falsificerbar rearm-hypotese:** firmwaregrenen for kontinuitet accepterer
  `podvoice_detector_continuity_proven`, den brede tilstand
  `micro_wake_word.is_running()` og fire nye mikrofonframes som fysisk bevis. Det
  beviser et levende mic-sourceflow, men ikke entydigt at modellen står i
  `DETECTING_WAKE_WORD` og faktisk kan genkende næste wake. Den nuværende automatiske
  regression gengiver samme antagelse statisk og kan derfor ikke opdage denne
  falsk-grønne tilstand. Før ny fysisk kandidat skal readiness enten få et stærkere
  firmwarebevis eller degraderes ærligt, og den observerede ACK-uden-ny-wake-kæde skal
  være en regression. Ingen gain-, VAD-, prompt- eller semantikændring er indiceret af
  denne fejl.
- **Historisk rearm-korrektionsgrænse:** hele kæden er afsluttet fysisk playback →
  `podvoice_stream_stop` → provider/attention-close → én firmware-rearm → næste
  detektion → én ny session. Berørte invarianter er exactly-once teardown/rearm,
  firmwareejet fysisk wake og sand readiness. Den minimale plan er at fjerne den
  falsk-grønne kontinuitetsgren som autoritet, gennemføre én bounded og observerbar
  detektor-reset ved rearm, holde latch lukket ved stop/start-/audio-timeout og kun
  rapportere reset som `recovered`; en virkelig efterfølgende wake er fortsat eneste
  grønne bevis for den nye detektorinstans. Regressionerne skal afvise mic-progress,
  `STARTING`/`STOPPING`, stale/duplicate ACK, disconnect og timeout som `proven`, bevise
  én reset/én latch-open/én add-on-rearm per teardown og bevare den modsatte Talk-
  adapter. Firmware-render/compile, fokuseret lifecycle-suite, fuld statisk/testgate,
  uafhængigt adversarial review, artifact-identitet og fysisk wake → dialog → close →
  ny wake er sammensatte gates. **Ikke-mål:** ingen ændring af gain, VAD, lydtransport,
  Realtime, prompt, semantik, playback eller stilhedslukning. Rollback er hele firmware-
  og kontraktændringen, hvis reset ikke når stabil operationelt gul readiness bounded,
  skaber duplicate wake/session eller den nye fysiske wake fortsat fejler.
- **Adversarial stop-the-line under v1.13.43-arbejdet:** første cross-session-orakel
  bandt kun næste wake og provider-connect via rum og tid. En afvist wake A kunne derfor
  efterlade beviset åbent, så en senere wake/session B fejlagtigt gjorde A grøn. Samme
  review viste, at et kendt mic-forward-fault (`down`) kunne overskrives til
  `degraded` af en vellykket detektor-reset. Kandidaten forbliver NO-GO, mens
  wake-attempt, history-session og frisk provider-generation bindes med ét nonce,
  samtlige early-return-/fejlveje invaliderer netop dette forsøg, bevisvinduet udløber,
  og mic-fault forbliver `down` indtil en faktisk vellykket mic-start. Regressionerne
  skal falsificere wake A → early return → wake/session B, uændret provider-generation,
  flere firmware-buildmarkører og statusopgradering efter mic-start-fejl.
- **Andet adversarial stop-the-line:** timeout/fejl i mic-stop, provider-close,
  heartbeat-stop eller attention-release kunne stadig efterfølges af firmware-rearm.
  Det strider mod invariant 7 og kunne åbne næste latch oven på gammel fysisk eller
  provider-tilstand. Rettelsesgrænsen udvides derfor kun til mekanisk teardown:
  rearm blokeres, readiness forbliver `fault`, nye wakes afvises, og den samme
  close-owner genkører hele teardown bounded før én rearm. Det strikte trace-orakel
  skal kræve `teardown_complete` før rearm og afvise enhver teardown-/mic-fejl.
- **Faktisk ændring og maskinel status for v1.13.43:** firmware-rearm er nu én
  tokenkorreleret, bounded detektor-reset med `recovered`/`fault`; add-on accepterer
  aldrig ACK som fysisk `proven`, kræver eksakt buildmarkør `podvoice_build_11343` og
  afviser stale, duplicate, disconnectede og fremmede ACK'er. Thin rearmer kun efter
  bekræftet fysisk silence, mic-stop, provider-close, heartbeat-stop og
  attention-release. En fejl
  holder latch og readiness lukket, afviser nye wakes og genkører hele teardown før
  præcis én rearm. Den næste fysiske callback bindes med nonce til netop den nye
  history-session og en større provider-generation; rejected/early/nonphysical
  forsøg, udløbet bevis og senere sessions kan ikke retroaktivt gøre tracen grøn.
  Mic-forward-fault forbliver `down` indtil en faktisk vellykket mic-start.
  Lifecycle-manifestet har 71 eksplicitte selectors og kører på cirka 10 sekunder;
  den fulde lokale gate (Ruff, format, mypy og hele testsuiten) er grøn på 37,1 s i
  den rene Python 3.12-runtime. ESPHome config og en frisk compile af de aktuelle bits
  er grøn; ELF indeholder både `correlated_reset_rearm_v2` og
  `podvoice_build_11343`. Validation-only OTA-artifact har SHA-256
  `8e21eb11d201db800d9bc0d7647d60149473ab8af39a9edcff75358a841dcd2d` og må ikke
  flashes, fordi det er bygget med dummy-valideringsnøgle. Uafhængigt review har nul
  P0/P1; kandidatstatus er GO til rigtig build/install og én frisk fysisk
  golden-chain-gate, men fortsat NO-GO til golden-label/release. Resterende usikkerhed
  er operationel ESPHome `STARTING` versus rigtig detectorfunktion og kan kun lukkes
  af den korrelerede fysiske kæde teardown → reset → næste “Okay Nabu” → ny
  provider-session; derefter kræver lifecycle-release stadig 10/10 ubrudte cyklusser.
- **Tredje adversarial stop-the-line:** frozen review fandt, at native reconnect efter
  en returneret men ufuldstændig close kunne omgå full-teardown-retry og kalde rearm,
  at en stray wake-callback kunne male readiness grøn før samme gate, og at resultatet
  fra fysisk `silence-device` ikke indgik i `teardown_complete`. Kandidaten er igen
  NO-GO, indtil reconnect kun afleverer ejerskab til full-teardown-retry, callbacken
  afvises før readiness-promotion, fysisk silence indgår i gaten/retryes, og
  cross-session-TTL bruger monotont ur. Ovenstående maskinelle resultat er derfor
  historik for pre-fix-diffen, ikke kandidatgodkendelse.
- **Tredje stop-the-line er lukket på frozen diff:** reconnect afleverer nu kun
  ufuldstændig teardown til den single-flight full-teardown-retry; en callback under
  samme tilstand afvises før readiness-promotion. Fysisk silence er en reel gate, og
  den shippede Voice PE-adapter returnerer kun succes, når både required reply-cancel
  og announcement media-player STOP er køet; manglende target/client eller exception
  forbliver fejl og bevarer `_announcing`. Den integrerede fail→success-regression
  beviser nul tidlig rearm, to rigtige adapter-stopforsøg og præcis én senere rearm.
  Den endelige fulde gate er grøn på 37,1 s, focused causal suite er 227/227 grøn,
  `git diff --check` er grøn, og to uafhængige frozen reviews finder P0=0/P1=0 med
  henholdsvis **97/100** og **96/100** maskinel confidence. v1.13.43 er derfor **GO
  til rigtig build/install og én frisk fysisk golden chain**, men fortsat NO-GO til
  golden-label/release, indtil den installerede buildmarkør, fysisk playback-finish,
  teardown/reset og den næste wake→provider-session er bevist på samme kandidat.

### Historisk feltbeslutning 25. august — falsk semantisk close på matematisk opfølgning

**Observeret på installeret v1.13.39 kl. 11.42.** Voice PE åbnede én
Realtime-session. Første tur brugte `get_time`; næste tur “Hvad er tolv gange syv?”
blev besvaret korrekt med `84`. På den kontekstafhængige opfølgning gemte den
asynkrone diagnostiske transskription “Læg seks til.”, men Realtime kaldte
`end_conversation`, sagde farvel og lukkede. Fysisk playback, én teardown og wake-rearm
gennemførte rent. Turen er rød: det korrekte svar var `90` eller, ved usikker lyd, en
opklaring — aldrig afslutning. Audio-trace var ikke armeret i denne samtale; der findes
derfor intet eksakt provider-PCM fra feltfejlen, som må foregives matchet eller replayet.

- **Hele berørte kæde:** rearmet mic-gate → fysisk opfølgningslyd → providerens rå
  audiotolkning → automatisk tool-valg → `end_conversation`-resultat → farvel-playback
  → teardown/rearm → næste wake. Transcriptet kommer fra en separat asynkron
  transskriptionsmodel og beviser derfor ikke alene, hvad Realtime-modellen hørte.
- **Berørte invarianter:** Realtime ejer semantisk afslutning; PodVoice må ikke indføre
  frasebaseret close/anti-close eller en parallel semantikmotor. Thin må kun udføre den
  mekaniske close præcis én gang efter et gyldigt modelkald. Samme session og kontekst
  skal overleve naturlige opfølgninger.
- **Falsificerbar hovedhypotese:** Realtime-audiomodellen forveksler den fonetisk korte
  danske fortsættelse med afslutningshensigt, og den reserverede tool-beskrivelses brede
  positive regel om et høfligt wrap-up efter en opgave øger risikoen. Den er kun støttet,
  hvis tekstkontrollen svarer `90`, mens den eksakte provider-PCM gentagne gange vælger
  `end_conversation`; ellers skal event-/kontekst- eller prompt/tool-kontrakten undersøges.
- **Planlagte regressioner og sammensatte gates:** bevar eksisterende tekstkontrol og
  skaf først en ny, samtykket audio-trace, hvis den eksakte normaliserede transskription
  matcher en kanonisk sikker eval-ytring. Kør derefter tre friske, uafhængige replays af
  target-turnens eksakte provider-PCM med matchende model, produktionsprompt,
  byte-identisk tool-schema og rumkontekst; gem response-/call-id, diagnostisk transcript
  og usage.
  Enhver rettelse skal bevare eksplicit afslutning, høflighed uden close, matematik
  `84 → 90`, wait-for-user, almindelige domæneværktøjer, Talk/Thin og fysisk lifecycle.
  Derefter focused gate, fuld suite/static, uafhængig adversarial review, exact ARM64
  artifact og én frisk fysisk golden chain. 10/10 starter først efter denne kæde.
- **Ikke-mål og rollback:** ingen lokal fraseliste, transcript-veto, obligatorisk
  `continue_conversation`, to-respons-vej, lyd/VAD/gain/firmware-, playback-, DHCP- eller
  HA/MCP-ændring. Hvis lydreplay ikke reproducerer årsagen, stoppes prompt/tool-
  ændringen; v1.13.39 forbliver installeret som diagnostisk, men ikke testgodkendt.

**Historisk minimal produktbeslutning.** Der findes direkte fysisk eventevidens for samme
session, de to korrekte svar, det efterfølgende committed `end_conversation`-kald,
farvel-playback, teardown og rearm samt den separate diagnostiske transskription “Læg
seks til.”. Der findes **ikke** eksakt provider-PCM for target-turnen, fordi audio-trace
ikke var armeret. Hovedhypotesen er derfor fortsat falsificerbar, ikke bevist: den brede
positive sætning i `end_conversation`-deklarationen om et høfligt wrap-up efter en
afsluttet opgave kan gøre den foregående opgaves afslutning til fejlagtigt positivt
close-bevis, selv om den seneste korte tur plausibelt fortsætter konteksten.

Den mindste planlagte produktændring er én variabel: fjern den brede positive sætning
fra den reserverede tool-beskrivelse og gør eksplicit, at en tidligere opgaves
afslutning aldrig i sig selv er end-intent; den seneste tur skal selv klart afslutte.
Den observerede tekstsekvens `Hvad er tolv gange syv?` → `Læg seks til.` tilføjes som
tekst-/live-eval-diagnostik med forventet `84 → 90`, men må ikke kaldes lydækvivalent
eller fysisk reproduktion. Ikke-mål er uændret: ingen frase- eller transcript-veto,
ingen `continue_conversation`-/to-respons-vej, ingen promptomskrivning og ingen ændring
af Realtime-eventrækkefølge, Thin-lifecycle, playback, teardown eller rearm. Rollback-
grænsen er den ene tool-description-diff, hvis betalt Realtime-validering ikke reducerer
false-close uden samtidig at bryde eksplicit semantisk close.

**Faktisk evalgrundlag.** Audio-replay af en
kontekstafhængig scenarietur åbner en frisk Realtime-session for tekstkontrollen og hver
af de tre PCM-prøver. Den seeder tidligere ture som **kanonisk scenarietekst** i samme
session og kræver, at hver expectation og session-id består, før target-PCM må sendes;
rapporten siger eksplicit, at den fysiske prefix-lyd ikke er replayet.
Fejler én seed-tur, sendes target slet ikke, og rapporten klassificerer
`context-seed-failure`; en isoleret tur tre kan derfor ikke længere se grøn ud uden tur
et og to. Rapporten bevarer seed-turenes usage, committed call-/response-/batch-id'er og
providertrace ved siden af kontrol og trials. Alle seed- og target-ture tælles i de
eksisterende token-/responskanter, og den
prospektive grænse plus faktisk usage forbliver under det hårde samlede loft på $5.

Reviewerens første NO-GO er lukket fail-closed i evalvejen: en trace uden matchende
kildemodel, prompt-source/version/hash, tool-schemahash eller rumkonteksthash må ikke
åbne providerreplay eller blive grøn; gamle traces uden provenance afvises. En
kontekstuel target kræver eksakte provider-sample-offsets. Hver PCM-prøves nye
diagnostiske transcript skal være ikke-tomt og eksakt normaliseret lig den kanoniske
ytring, ellers får prøven `audio-transcript-missing` eller
`audio-transcript-mismatch`. Scenariets tekstkontrol bruger nu det observerede ordvalg
“Læg seks til.” og forventer `90`; det er en diagnostisk tekstklasse, ikke en påstand om
lydækvivalens. Uden armed PCM fra feltkørslen findes stadig ingen fysisk replay-fixture.

**Faktisk minimal produktændring, endnu ikke testlåst eller releasegodkendt.** Kun den
reserverede `end_conversation`-beskrivelse er ændret: tidligere opgaveafslutning er ikke
close-bevis, og en kort seneste tur, som plausibelt fortsætter, korrigerer, præciserer
eller refererer til det foregående svar, skal besvares eller afklares. Systemprompt,
Realtime-runtime, Thin-lifecycle, lyd, firmware og værktøjsdispatch er urørte. Thin
gemmer desuden kun de allerede anvendte model-, prompt- og rumkonteksthashes som
trace-provenance; det ændrer ingen samtaleadfærd. Den tidligere fokuserede
eval-harness/audio-trace/replay-endpoint-pakke var **155/155** grøn på 3,00 s, men det er
ikke resultat for den nye tool-description-diff. For den nye diff er den målrettede
prompt-/tool-/eval-/oracle-/Thin-gate **30/30** grøn på 4,79 s; Ruff check var grøn på
0,01 s, mypy for `thin.py` og `eval_harness.py` var grøn på 0,32 s, og `diff --check` er
ren. Ingen betalt provider blev kaldt. Uafhængigt adversarial review gav derefter GO
til live-eval med 0 P0/P1. Den billige P2-lukning ændrer kun evalprofilen: historiske
`arithmetic-followup` bevarer “Og læg seks til.”, observerede
`arithmetic-followup-observed` bevarer “Læg seks til.” som en separat eksakt tekstcase,
og `explicit-short-close` tilføjer den korte positive kontrol “Farvel.”. Den selektive
close-valideringsprofil omfatter desuden `semantic-close` og den eksisterende
`low-risk-action-then-close`, så task→close-batchrækkefølgen fortsat bevises. Profilen er
præcis disse fem scenarie-id'er og **8 ture** i alt. En lille betalt kørsel af netop denne
profil er stadig obligatorisk, fordi deterministiske tests ikke kan bevise, at
Realtime-modellens tool-valg faktisk ændres, eller at naturlig eksplicit close bevares.
P2-ændringen tilføjer ingen produktionsadfærd. Dens fokuserede
manifest-/admission-/oracle-/context-gate er **11/11** grøn på 0,47 s; Ruff check var
grøn på 0,01 s, mypy for `eval_harness.py` var grøn på 0,30 s, og `diff --check` er ren.
Den genåbner endnu ingen fysisk gate.

### Historisk feltbeslutning 25. august — Voice PE strandet på cachet DHCP-adresse

**Observeret på installeret v1.13.38 efter strømudfald og HA Green-genstart.** Voice PE
stod sandt offline i PodVoice, og ESPHome Builder viste først `No status`. PodVoice-loggen
viste, at add-on-containeren ikke kunne opløse `podvoice-pe-0a7e7a.local`, valgte den
cachede adresse `192.168.86.162` og fik `Connect call failed` mod ESPHome API-port 6053.
ReconnectLogic fortsatte derefter mod samme numeriske klientadresse uden recovery.

En USB-reset og ubrudt serielog beviste en sund firmwareboot: nul mislykkede bootforsøg,
Voice Kit 1.3.1, fuldført setup, Wi-Fi SSID `Banana-split`, signal omkring -30 dBm og ny
DHCP-adresse `192.168.86.193`. Den installerede add-on fandt ikke denne adresse selv.
Som kontrolleret feltworkaround blev rumadressen midlertidigt sat til `.193`; efter en
PodVoice-genstart gennemførte klienten resolve, TCP-connect og Noise-handshake, verificerede
firmwarekontrakten, genanvendte mic channel 1/gain 16 og `okay_nabu`, og panelet viste
`Voice PE: forbundet - wake afprøves`. Workarounden er ikke en produktrettelse: næste
DHCP-skift kan gentage fejlen.

- **Hele berørte kæde:** puck-boot og DHCP → navne-/adresseopdagelse i add-on-netværket →
  APIClient/ReconnectLogic-ejerskab → Noise-handshake → entities/services/subscriptions →
  mic/wake-konfiguration → sand link/readiness → første wake. Ingen Realtime-session eller
  HA/MCP-effekt må åbnes under adresseflytningen.
- **Berørte invarianter:** VoicePELink er eneste native-API-adapter; én fysisk puck må have
  højst én aktiv klient/reconnect-ejer; panelet bliver kun grønt efter et ægte fuldført
  handshake; reconnect skal genopbygge subscriptions, firmwarekontrakt, mic tuning og
  wake word uden at skabe duplicate callbacks eller en parallel runtime.
- **Falsificerbar årsag:** når `.local` ikke kan opløses ved `start()`, konstrueres
  `APIClient` én gang med cachet numerisk adresse. Senere retries kan ikke udskifte klientens
  target, selv om puckens DHCP-adresse har ændret sig. En test med cache `.162`, afvist
  forbindelse og efterfølgende discovery `.193` skal derfor forblive offline på gammel kode
  og gennemføre præcis ét frisk handshake på rettelsen.
- **Bindende retning:** behold det stabile `.local`-navn som enhedsidentitet, men gør
  numeriske fallbackadresser generationsbundne og udskiftelige efter en connection-shaped
  fejl. Adressekilden skal være lokal og identitetsbundet; en ny klient/reconnect-generation
  må først overtage efter den gamle er stoppet og må kun publicere link efter fuld Noise-
  handshake og firmwareverifikation.
- **Planlagte regressioner/gates:** startup med valid cache; stale cache → ny adresse → én
  handshake; aktiv disconnect efter DHCP-skift; discovery-stale/duplicate/out-of-order;
  auth/PSK-fejl må ikke rotere blindt; close/reconnect-race; ingen dobbelt subscriptions eller
  callbacks; link forbliver falsk indtil fuld connect; reassert af mic/wake/firmwarekontrakt;
  Thin opposite-adapter/lifecycle-regression. Derefter focused, fuld unrestricted suite,
  Ruff/format, mypy, diff-check og uafhængigt adversarial review før build/install.
- **Rollback og ikke-mål:** ingen firmwareflash, prompt-, audio-, VAD-, playback-, Realtime-,
  HA/MCP- eller semantic-lifecycleændring. Ingen fast IP eller ubegrænset subnetscan som
  produktløsning. Ved uklar identitet eller uafsluttet gammel generation forbliver linket
  offline frem for at forbinde til en vilkårlig ESPHome-enhed.

**Faktisk lokal v1.13.39-ændring og resultat.** `VoicePELink` ejer nu én
generationsbundet klient og recovery-ejer. En connection-shaped fejl mod en cachet IP
starter native `.local`-discovery med tværgenerations-backoff `1/2/5/10/30/60`.
Gammel klient lukkes før næste generation. Noise, eksakt enhedsnavn, device-info,
firmwarekontrakt, subscriptions, mic channel/gain, wake word og fysisk rearm skal alle
bestå før linket publiceres; kun den autentificerede peer caches atomisk. Forkert
enhedsnavn evikterer cache, mens reel PSK/auth-fejl ikke roteres blindt. Stale callbacks
og forsinket recovery er inerte.

Uventet fysisk linktab lukker en aktiv `ThinSession` præcis én gang. Teardown ejer
rearm, så samtidig reconnect hverken fortsætter en session med manglende lyd, genstarter
gammel mic eller dobbelt-rearmer. Talk og prompt/Realtime/værktøjer/HA/MCP/lyd/VAD/
playback/firmware er uændrede.

Den sammensatte regression beviser `.162` → `.193` → gammel ejer lukket → præcis ét
subscriptionsæt → mic channel/gain + wake word → fysisk rearm → først derefter
link-ready og cache `.193`; senere `.200` genfindes. En separat regression beviser
capped backoff, én resolver-/klientejer og senere recovery. Pauset teardown/reconnect
beviser én providerlukning og én rearm.

Gates på de frosne kildebytes: **46/46 fokuserede** grønne; fuld unrestricted pytest
**exit 0** inklusive HTTP/WebSocket; Ruff og format (**91 filer**) grønne; mypy
**42 kildefiler** grøn; scoped `git diff --check` ren. Worktreeens cloud-dehydrerede
Python-runtime hang før collection, så fuldsuiten blev kørt mod samme kildebytes i et
frisk, låst Python 3.12-miljø. Uafhængig adversarial review finder nul P0/P1 og scorer
**97/100**. Dette er softwarebevis: v1.13.39 skal bygges og installeres, rummet sættes
tilbage til `podvoice-pe-0a7e7a.local`, og den eksisterende stale `.162`-cache skal
automatisk ende på `.193` med første wake, før den fysiske gate genåbnes.

### Fysisk golden-chain-forsøg 23. august — v1.13.38, ikke bestået

Den første friske fysiske kæde efter den grønne maskinegate åbnede én Realtime-session,
svarede korrekt `84` på den første tur, bevarede sessionen gennem opfølgningen og
lukkede senere semantisk med fysisk farvel, teardown/rearm og en vellykket ny wake.
Opfølgningen kan dog ikke godkendes: den kendte ytring “Og læg seks til” blev gemt som
“Hold sekste”, og modellen svarede `72` i stedet for det korrekte `90`. Den efterfølgende
friske session hørte “Hvad er to plus to?” og svarede korrekt `4`, hvorefter
`end_conversation`, farvel-playback og wake-rearm gennemførte rent.

Forsøget er derfor **rødt**, selv om brugeren oplevede den mekaniske kæde som flydende.
Et korrekt første svar og ren lifecycle kan ikke opveje semantisk afvigende fysisk
input. Den armerede trace gemte device/provider/speaker-lyd for forsøget, men den
aktuelle revisionsvej kan ikke hente WAV-filerne uden en separat browser-sessioncookie;
historikkens konkrete transcript/svar er allerede tilstrækkeligt til at afvise forsøget.
Næste tilladte forsøg bruger en tydeligere, stadig kontekstafhængig opfølgning og skal
have semantisk konsistent transcript, korrekt `90`, samme session og den samme fulde
close/rearm/new-wake-kæde. 10/10 forbliver blokeret.

Det næste forsøg gav korrekt `84` og derefter korrekt `90` i samme session og lukkede
rent via modelsemantik. Det tæller alligevel ikke som golden chain: en forudgående
kort fejlopstart forbrugte den armerede lydtrace, den korrekte sessions opfølgning blev
stadig gemt som det tvetydige “Læg sekste”, og der kom ingen efterfølgende ny wake efter
den korrekte sessions rearm. Dette er et nyttigt fysisk delbevis, men ikke en grøn kæde.

### Feltstop 23. august — v1.13.37 kunne ikke se det syntetiske områdenavn

**Observeret på eksakt installeret CI/ARM64-artifact; ingen automatisk retry.**
SafeEval `eval-1787501209-667292` gennemførte 30/36 mulige providerkanter og bestod
seks af syv scenarier uden 429. Low-risk-turnen kaldte først det produktionsschema-
gyldige `HassTurnOn(area="stuen", domain=["light"])` og derefter
`HassTurnOn(area="Evalrum", domain=["light"])`. Begge blev afvist af den lokale
fixture, som alene kendte `area="stue"`; tredje tool-batch ramte korrekt finality-
loftet før dispatch, så fixtureeffekter forblev nul. Rapporten brugte $0,145 og 327,52
sekunders pacing.

- **Falsificeret præmis og stærkere årsag:** `stue` var ikke eksponeret i providerens
  schema. Admission sender den byte-identiske produktionsdeklaration med fri
  area-string; canonical fixture og scenarioexpectation er server-side. Samtidig
  injicerede den semantiske evaldriver den synlige rumkontekst `Evalrum`, hvilket
  forklarer modellens andet forslag præcist. At begge forslag nåede fixture mismatch
  frem for schemafejl beviser, at et påstået enum aldrig var på wire.
- **Bindende minimalændring:** den semantiske SafeEval-rumkontekst navngiver nu det ene
  syntetiske basisområde eksplicit og med små bogstaver: `stue`. Den skjulte fixture
  forbliver præcis `area=stue`; `stuen`, `Evalrum`, `name=stue`, scalar-domain, ekstra
  felter og duplicates forbliver røde. Rumkontekstprofil og hash gemmes i rapporten.
  Ingen fuzzy alias, enum-overlay, global prompt-/produktionsschemaændring eller højere
  edge-loft.
- **Næste bounded gate:** den eksisterende eksplicitte scenario-selector må køre kun
  `low-risk-action-then-close`. Rapporten skal vise præcis dette coverage-scope og
  `selected_ok=true`, `profile_complete=false` og
  `release_preflight_passed=false`; `ok` følger release-preflight og må derfor ikke
  blive sandt for et subset. En grøn målrettet kørsel er ikke fuld profilbevis.
- **Rollback og ikke-mål:** produktionsprompt, schema/hash/dispatch, providerpacing,
  prisloft, audio/VAD, Thin, HA/MCP, firmware og lifecycle er frosne. Ved nyt model-loop
  forbliver scenariet rødt frem for at udvide fixture eller cap.

**Faktisk lokalt resultat på frosne bits:** den semantiske SafeEval-driver viser nu
det ene syntetiske basisområde som `stue`; den eksisterende fixture forbliver eksakt
`area="stue", domain=["light"]`, og regressionsmatricen holder `stuen`, `Evalrum`,
`name`, scalar-domain, ekstra felter og duplicates røde. Rapporten gemmer både
rumkontekstprofil/hash og scenariemanifesthash uden at ændre produktionsprompt,
produktionsschema/hash, dispatch eller edge-loft.

Målrettet scope er fail-closed adskilt fra releasebevis:
`selected_ok` beskriver kun de valgte scenarier, `profile_complete` beskriver det
krævede fulde selector-scope, `coverage_complete` falder ved terminalt delresultat, og
`release_preflight_passed`/`ok` kræver alle tre. Rapporter gemmes bounded pr. run-id;
subset og audio-replay kan ikke overskrive seneste fulde kandidat, en fejlet fuld
kørsel tilbagekalder den, og ændret prompt/schema/kontekst/scenariemanifest gør ældre
fuldt bevis stale. Panel/API bruger samme konjunktion og viser målrettet resultat som
delbevis, ikke samlet grønt.

Gates før feltkørsel: **338/338 fokuserede**, **857/857 fulde unrestricted**,
Ruff-format/Ruff-check grøn, mypy **42 filer** grøn og `git diff --check` ren.
v1.13.38 blev derefter bygget i GitHub CI inklusive ARM64, installeret og startet med
19 atomisk admitted HA/MCP-værktøjer, 26 samlede deklarationer, vellykket
`GetLiveContext` og Voice PE-firmwarekontrakt OK.

**Faktisk installeret live-resultat:** fuld SafeEval
`eval-1787503600-2aaa0e` bestod alle **7/7 scenarier og 12/12 ture**.
`selected_ok`, `profile_complete`, `coverage_complete`,
`release_preflight_passed` og `ok` er alle sande; status og klassifikation er
`complete`. Low-risk-turnen kaldte præcis
`HassTurnOn({"area":"stue","domain":["light"]})`, fik ét lokalt `ok`, kaldte
derefter `end_conversation` og lukkede semantisk. Web kaldte én tilladt eksakt query;
følsom handling oprettede én lokal challenge og blev godkendt præcis én gang i næste
tur. Alle response-statusser var completed; schema-korrektioner og provider-retries
var nul. Forbrug: **125.410 tokens**, **$0,2341568** og **322,36 s** bounded
rate-limit-pacing, under $5-loftet.

Efter run: `diagnostic_active=false`, sessions/virkelige tool-kald/attention er nul,
r0 er IDLE/forbundet/ikke ducked, og MCP er current/ready med generation 4, 26
deklarationer og ingen fejl. Hjem, web, musik, tid og timere er synlige; vejr mangler
fortsat sandt. SafeEval har bevist maskinel routing/finality og nul virkelige effekter,
men ikke fysisk wake, playback eller rearm. Én frisk fysisk golden chain må først
startes efter den samtidige uafhængige slutscore på mindst 97/100.

### Feltstop 23. august — v1.13.36 målte fixturestavning frem for semantisk kontrakt

**Observeret på eksakt installeret CI/ARM64-artifact; ingen automatisk retry.**
SafeEval `eval-1787499427-4fb6ef` gennemførte arithmetic, alle tre time-ture,
semantic-close og pacinggaterne. Rapporten brugte 12/12 reserverede ture, 120.296
faktiske tokens, $0,1755 og 318,98 sekunders pacing. Tre scenarier blev røde:

- Web kaldte `google_web_sogning` med de schema-gyldige queries
  `FC København seneste kamp resultat` og `FCK latest match result`. Begge blev lokalt
  afvist, fordi fixturen kun kendte `FCK seneste kamp`; modellen rapporterede derefter
  webfejl.
- Sensitive-confirmation kaldte først `EvalUnlockDoor(name="hoveddør")`, som fixturen
  afviste, og derefter `name="hoveddøren"`, som korrekt skabte én challenge. Næste tur
  godkendte den én gang med præcis én lokal fixtureeffekt.
- Low-risk-action kaldte først `HassTurnOn(area="stue", domain=["light"])` og derefter
  `HassTurnOn(name="stue", domain=["light"])`; begge blev fixtureafvist. En tredje
  tool-batch ramte korrekt det normale tre-response-loft før dispatch, så effekter
  forblev nul. Fejlen er et per-turn model-loop/finality-stop, ikke globalt tokenbudget.

- **Berørte invarianter:** SafeEval må kun returnere lokale, eksplicit deklarerede
  fixtureudfald og aldrig fuzzy-matche, coerce eller kontakte HA/MCP. Produktionsprompt,
  fuldt produktionsschema, schemahash, runtime-dispatch og tre normale responsekanter
  er frosne. Den eval-følsomme fixture er fortsat udelukket fra schema-korrektion: et
  ikke-kanonisk argument stopper terminalt uden ToolCall, output, challenge eller
  effekt; gentagne kald skal fortsat gøre scenariet rødt.
- **Falsificerbar årsag:** den hidtidige oracle kræver én eksakt argumentdict per tool,
  selv når produktionsschemaet med vilje tillader fri søgetekst. Det gør en sikker,
  semantisk korrekt query til en kunstig tool-fejl og fremkalder model-retry. Omvendt
  er adgangs- og HA-mål ikke fritekst-fixtures: de skal have én syntetisk kanonisk
  identitet, så eval aldrig foregiver rigtig target-resolution.
- **Planlagte regressioner:** web accepterer kun tre navngivne fuld-dict-cases og
  graderen accepterer præcis ét kald med én af dem, ét `ok`-udfald og korrekt svar.
  Forkert klub, future-query, ekstra felt, tom query, to tilladte kald og mismatch plus
  heldigt svar er røde. EvalUnlockDoor er eval-only låst til `hoveddøren`; `hoveddør`
  stopper terminalt med nul schema-korrektion/ToolCall/output/challenge/effekt. Kun det
  eksakte kald kan skabe én challenge og næste tur godkende én gang. Den syntetiske HA-
  testverden hedder kun `stue`; `name=stue`, `area=stuen`, scalar-domain, ekstra felt
  og duplicates er røde.
- **Rollback og ikke-mål:** edge-loftet hæves ikke. Ingen produktionsschema-, hash-,
  dispatch-, prompt-, provider-, lyd-, VAD-, Thin-, firmware-, HA/MCP- eller lifecycle-
  ændring. Hvis den finite oracle ikke kan bevises eksakt og sideeffektfri, beholdes
  v1.13.36 NO-GO.

**Faktisk lokalt resultat, endnu ikke versioneret/bygget/installeret/live.** Web-oraclet
har nu præcis tre eksplicitte fuld-dict-fixtures. `tool_args_any` accepterer kun ét
faktisk kald med én af de tre dicts; beslutning og `ok`-udfald skal fortsat forekomme
præcis én gang, og svaret skal fortsat sige, at FCK vandt 2-0. Forkert klub, future-
query, tom query, næsten-match, ekstra felt, to ellers tilladte kald og heldigt svar
efter fixtureafvisning er røde.

Den eval-only følsomme deklaration eksponerer kun enum-værdien `hoveddøren`.
`hoveddør` stoppes derfor terminalt af den eksisterende sensitive no-correction-grænse
med nul ToolSchemaCorrection, output, ToolCall, challenge og effekt. Det eksakte kald
kan fortsat oprette én serverholdt challenge, som kun næste tur kan godkende én gang.
Produktionssnapshot, produktionshash og produktionsdispatch er byte-/adfærdsmæssigt
uændrede.

Den syntetiske HA-testverden har nu ét dokumenteret basisområdenavn: `stue`.
Kun `{"area":"stue","domain":["light"]}` får det lokale succesresultat;
`name=stue`, `area=stuen`, scalar-domain, ekstra felter og duplicates er røde. Det
normale tre-response-loft er uændret; terminalteksten siger nu sandt
`eval model response-edge limit exhausted before final answer` frem for at ligne et
globalt providerbudgetproblem.

Frosne lokale gates: **329/329 focused**, **843/843 unrestricted full** inklusive
HTTP/WebSocket, Ruff check og format grønne for 91 filer, mypy grøn for 42 sourcefiler
og `git diff --check` grøn. Uafhængigt adversarial review, versionering, CI/ARM64,
installation og én frisk SafeEval er fortsat åbne; v1.13.36 forbliver derfor NO-GO
for fysisk golden chain.

### Feltstop 23. august — v1.13.35 genberegnede ikke pacing efter nyt snapshot

**Observeret på eksakt installeret CI/ARM64-artifact; ingen automatisk retry.**
SafeEval `eval-1787498165-272088` bestod arithmetic og de første to time-ture. Efter
en completed response med `total_tokens=5695` blev et gyldigt sent snapshot accepteret
med `remaining=18632`. Den næste completed kant efterlod lokalt `remaining=13653` og
eval-owned `3637`. Før næste brugertur beregnede den atomiske capacity-check derfor
én vent på `2,019 s` for target `15000`. **34,851 ms** efter den foregående done
ankrede endnu et gyldigt nedadgående snapshot `remaining=11485`. Efter den allerede
beregnede vent var den nye recheck kun nået til `remaining=12844`; runtime stoppede
med `diagnostic_capacity · rate_limit_capacity · eval response cannot preserve
production headroom`. Der blev ikke sendt en ny response, udført effekt eller prøvet
igen hos provideren.

- **Hele berørte kæde:** turn-preflight → atomisk capacity-check → lokal bounded sleep
  under nøgle-eksklusiv diagnostic → samtidig gyldigt nedadgående provider-snapshot →
  atomisk recheck → højst én `response.create`. Et snapshot under ventetiden kan gøre
  den tidligere wait-beregning for kort; næste beregning skal derfor bruge den nye
  locked ledger og samme hårde run-deadline.
- **Berørte invarianter:** live-eval er gensidigt eksklusiv med produktion og bruger
  `production_headroom=0`; lokalt simuleret fysisk headroom er ikke en sikkerhedsgrænse.
  Hver klientstyret responsekant skal være admitted umiddelbart før wire. Vent før wire
  er pacing, ikke provider-retry. 429 forbliver terminal; cancellation, lease-tab,
  nonwaitable state eller deadline giver nul create/effekt.
- **Falsificerbar årsag:** `prepare_response_capacity()` gør præcis én wait og én
  recheck. Den accepterede downward anchor under sleep er korrekt, men ændrer target-
  underskuddet efter at wait allerede er fastlagt. Fejltekstens “production headroom”
  er historisk og falsk for denne sti; konkret var protected headroom nul.
- **Planlagte regressioner:** den eksakte sekvens `13653 → wait 2,019 s → snapshot
  11485 → recheck 12844` skal genberegne en ny bounded wait og derefter sende præcis én
  create. Flere nedadgående snapshots må forlænge pacing uden wire-retry; deadline,
  cancellation, lease-tab og nonwaitable state stopper før wire. En provider-429 efter
  en faktisk create forbliver terminal uden retry.
- **Rollback og ikke-mål:** ingen margin, fast ekstra sleep, lease-refund eller ændring
  af prompt, model, audio, VAD, Thin, HA/MCP, firmware eller fysisk lifecycle. Hvis den
  recomputede loop ikke kan bevises bounded af samme run-deadline, beholdes v1.13.35
  NO-GO.

**Faktisk lokalt resultat, endnu ikke versioneret/bygget/installeret/live.**
`prepare_response_capacity()` genberegner nu den atomiske capacity-state efter hver
bounded sleep, indtil samme responsekant enten er admitted eller den eksisterende
run-deadline, cancellation, lease-tab eller nonwaitable state stopper før wire. Det er
lokal pacing før requesten, ikke provider-retry. Den eksakte feltregression udfører
første vent fra `remaining=13653`, accepterer under sleep snapshot `11485`, rechecker
omkring `12844`, beregner endnu én vent og sender derefter præcis én
`response.create`. Flere nedadgående snapshots er dækket uden fast margin eller
ubegrænset loop.

De tre nabogates bruger nu samme ene capacity-seam: typed text ejer ikke længere en
dobbelt fail-fast-precheck før den eksakte response-create-callback; audio-replay
afventer den bounded preparer før PCM/VAD; og SafeEval tool-batches afventer minimum
feedbackkapacitet før lokal fixtureeffekt, hvorefter den eksisterende context-derived
follow-up-gate stadig gælder. Deadline, cancellation, lease-tab og nonwaitable state
giver nul wire/fixtureeffekt. Fejltekst og arkitekturdokument siger nu sandt, at
diagnostikken er nøgle-eksklusiv og bruger `production_headroom=0`.

Frosne lokale gates: **313/313 focused**, **827/827 unrestricted full** inklusive
HTTP/WebSocket, Ruff check og format grønne for 91 filer, mypy grøn for 42 sourcefiler
og `git diff --check` grøn. Uafhængigt adversarial review fandt nul kendte P0/P1;
v1.13.36 er versioneret lokalt, mens CI/ARM64, installation og én frisk SafeEval er
fortsat åbne; v1.13.35 forbliver derfor NO-GO
for fysisk golden chain.

### Feltstop 23. august — v1.13.34 afviste et entydigt sent completion-snapshot

**Observeret på eksakt installeret CI/ARM64-artifact; ingen automatisk retry.**
SafeEval `eval-1787495167-f34dcd` modtog en completed response
`resp_EG3SG…` med typet usage `total_tokens=5812`. **38,21 ms** senere ankom en gyldig
token-rate-event med `remaining=5204` og `reset_seconds=52.193`. Tracen klassificerede
den sandt positionelt som `late_after_done`, men runtime afviste den som ledger-anchor
og beholdt lokalt `remaining=15269`. Næste responsekant blev derfor admitted med
`target=9396`; OpenAI afviste den med `limit=40000`, `used=34532`, `requested=5764`
og `retry_after=0,444 s`. Kørselen stoppede terminalt uden retry eller rigtig ekstern
effekt; fysisk test blev ikke startet.

- **Hele berørte kæde:** completed `response.done` + autoritativ usage → gyldig
  positionsløs token-rate-event → providerledgerens monotone anchor → atomisk
  capacity-wait/recheck → højst én `response.create` → providerterminal eller næste
  completed response → diagnostikteardown. Eventet har ikke response-id og må derfor
  aldrig bindes ved nærhed alene, når en ny response allerede er pending/created.
- **Berørte invarianter:** hver klientstyret responsekant skal admitted mod den nyeste
  kausalt forsvarlige kapacitet; gyldig providertelemetri må ikke kasseres, når dens
  placering er entydig; ambiguous/stale/duplicate/cross-generation-events må ikke øge
  kapacitet; 429 er terminal uden retry; diagnostiklås, $5-loft, SafeEval-isolation og
  nul rigtig HA/MCP-effekt bevares.
- **Falsificerbar hypotese:** på samme socketgeneration uden pending eller aktiv næste
  response er en gyldig, event-id-bærende token-rate-event efter én completed response
  det nyeste absolutte providersnapshot. Den må ikke kaldes response-id-kausal, men kan
  sikkert forankre ledgeren nedad og dermed forhindre false-admission. Den eksisterende
  generelle `late_after_done`-afvisning kasserer dette strengere snapshot. Hvis et nyt
  response allerede er registreret som pending/created, er samme placering tvetydig
  og skal fortsat afvises; en præcis aktiv response beholder den eksisterende
  starttelemetri-seam. Under en endnu uafsluttet capacity-wait er snapshotten fortsat
  nedadgående input til den obligatoriske atomiske recheck.
- **Påkrævede regressioner:** eksakt `done → 38,21 ms → valid rate → target 9396`
  skal forankre `remaining=5204`, vente/rechecke og sende præcis én response; den samme
  late event med næste pending/created skal være `ambiguous_previous_or_next` og inert.
  Duplicate, gammel generation og event efter close er inerte; usage og snapshot må
  ikke dobbeltdebitere; provider-429 forbliver terminal uden wire-retry. Rapportens
  positionslabel skal være sand og må ikke kaldes response-id-kausal.
- **Rollback og ikke-mål:** ved uafklaret association beholdes terminal NO-GO frem for
  fast margin, blind ventetid eller retry. Prompt V6, model, lyd, gain, VAD, firmware,
  playback, Thin-lifecycle, HA/MCP og værktøjspolitik er frosne. Implementeringen må
  kun ændre rate-eventens entydige late-completion-seam, ledger-anchor og tilhørende
  bounded observations-/regressionstests.

**Faktisk lokalt resultat, endnu ikke versioneret/bygget/installeret/live.** En
completed response åbner nu en generationsbundet engangsseam for ét gyldigt,
event-id-bærende token-snapshot, men kun mens der ikke er en nyere registreret
`response.create` eller en aktiv response. Snapshotten mærkes fortsat positionelt
`late_after_done`, tilskrives ikke retroaktivt til den completed eller næste response
og kan kun stramme den atomiske ledger: remaining, limit og refill-hastighed kan aldrig
stige. Seamen forbliver åben gennem en eventuel capacity-wait, så dens obligatoriske
slutrecheck ser en snapshot, der ankommer under ventetiden; den lukkes atomisk før
request-registrering og wire-I/O. Når en deferred tool-result-response oprettes inde i
selve provider-readeren, kan readeren ikke samtidig konsumere den allerede kølagte
snapshot. Den eval-eksklusive admission klemmer derfor den uobserverede completion-
kapacitet til nul og bruger den samme bounded refill-wait plus slutrecheck; den gætter
ikke en millisekundventetid og ændrer ikke produktionsvejen. Første gyldige snapshot
forbruger seamen; exact/different duplicate,
non-completed status, pending create, sendefejl, korreleret 429, stale generation,
close/reconnect og teardown er inerte. En præcis aktiv response beholder den eksisterende
starttelemetri, så senere responses ikke dobbeltdebiteres.

Den eksakte feltregression debiterer først usage 5.812 til lokal remaining 15.269,
modtager 38,21 ms senere snapshot 5.204/reset 52,193, venter atomisk på target 9.396,
rechecker og sender præcis én `response.create`; der er ingen retry. Højere observeret
limit kan ikke hæve hverken øjeblikkelig kapacitet eller fremtidig refill, mens et lavere
limit strammer begge. En særskilt rå inline-regression beviser `done → fast tool-result
→ late rate kølagt bag readeren → konservativ wait/recheck → præcis én create`; den
senere læste rate mærkes sandt som tvetydig og kan ikke finansiere requesten bagud.
Frosne lokale gates efter den sidste safetyrettelse: **304/304 focused**, scoped Ruff
check og format, scoped mypy og `git diff --check` grønne. Den ubegrænsede full suite,
uafhængigt review, versionering,
CI/ARM64, installation og én frisk SafeEval er fortsat åbne; kandidaten er derfor
fortsat NO-GO for fysisk golden chain.

### Feltstop 23. august — v1.13.33 afviste schema-ugyldig HA-domain før effekt

**Observeret på eksakt installeret CI/ARM64-artifact; ingen automatisk retry.**
SafeEval `eval-1787489397-3f58f2` gennemførte arithmetic-, time-, semantic-close-,
web- og sensitive-approval-forløbene uden 429 eller rigtig ekstern effekt. I
`low-risk-action-then-close` genererede modellen et `HassTurnOn`-kald med
`domain: "light"`, mens den aktuelt annoncerede Home Assistant-deklaration kræver en
array. Runtime afviste derfor kaldet før `ToolCall`, SafeEval-fixture og enhver rigtig
HA/MCP-dispatch med: `tool arguments failed schema at domain: 'light' is not of type
'array'`. Diagnostiklåsen blev frigivet; fysisk test blev ikke startet.

- **Berørte invarianter:** modelargumenter er altid utroværdige; deklareret schema og
  runtimevalidering skal være samme kontrakt; en schema-korrektionsrunde må aldrig
  dispatches som værktøj eller udvide mål, domæner eller effekt; SafeEval må kun acceptere eksplicitte,
  schema-gyldige fixturevarianter; fejl må give nul rigtig effekt, ingen automatisk
  transport-/provider-retry og højst én bounded schema-korrektion.
- **Falsificerbar hypotese:** GPT-Realtime-2.1 understøtter function calling, men ikke
  Structured Outputs, så schema-ugyldige argumenter kan forekomme. Prompt V6 tillader
  én schemafejlskorrektion, men runtime kasserer i dag det ugyldige kald terminalt uden
  et sanitiseret `function_call_output`; modellen får derfor ingen mulighed for den
  lovede korrektion. Samtidig er eval-fixturen forkert modelleret: “lyset i stuen” er
  et områdekald og skal bruge `area: "stuen", domain: ["light"]`, ikke
  `name: "stuen"` som om rummet var én entitet.
- **Påkrævet regression:** admission accepterer kun den eksakte schema-gyldige
  område-fixture og afviser scalar-domain som canonical fixture. Et råt ugyldigt
  modelkald giver nul `ToolCall`/fixture/rigtig effekt og højst én sanitiseret
  schema-korrektionsresponse til samme call-id under de eksisterende capacity-, ACK-,
  deadline- og $5-gates. Et efterfølgende korrekt array-kald udføres præcis én gang før
  completed-gated `end_conversation`; andet ugyldigt, stale/duplicate/cross-response,
  cancel eller 429 stopper terminalt uden yderligere retry. Thin og SafeEval skal dele
  samme Realtime-kontrakt, og udtømt korrektion klassificeres som model-/tool-contract-
  fejl, ikke providerudfald. Full suite, Ruff, mypy, uafhængigt review, nyt CI/ARM64 og
  installation kræves før én ny live-kørsel.
- **Rollback og ikke-mål:** behold streng schemaafvisning frem for coercion,
  schema-løsning, promptændring eller løs fixturematching. Prompt V6, model, lyd, gain, VAD, firmware,
  playback, Thin-lifecycle, HA/MCP-discovery og fysisk adfærd er frosne.

**Faktisk lokalt resultat, endnu ikke versioneret/bygget/installeret/live.** Den fælles
Realtime-provider udsender nu en særskilt `ToolSchemaCorrection` kun for ét enkelt,
deklareret, ikke-reserveret schema-ugyldigt kald i en completed response med gyldig
usage og kapacitet. Eventet er aldrig et `ToolCall`: Thin og SafeEval returnerer ét
bounded, sanitiseret `function_call_output` på samme call-id uden adapterdispatch,
kasserer eventuel værktøjspreamble og lader den næste schema-gyldige proposal passere
de normale commit-, policy-, approval-, ACK- og capacity-gates. Andet ugyldigt kald,
blandet batch, lifecycle-/approvalværktøj, eval-følsom fixture, manglende kapacitet,
429, ACK-fejl eller teardown stopper terminalt. Den normale tre-kants turngrænse får
kun én mekanisk fjerde kant, når den typede korrektion faktisk er observeret; pris- og
deadlinebudgettet reserverer konservativt denne mulighed på forhånd.

SafeEval-rumtesten bruger nu den produktionsrealistiske fixture
`{"area":"stuen","domain":["light"]}`. Den følsomme `EvalUnlockDoor`-deklaration er
uændret låst til påkrævet `{"name":<string>}`. Regressionen gennemfører den fulde
syntetiske sekvens ugyldig scalar → sanitiseret korrektion → gyldigt `HassTurnOn` →
`end_conversation` → farvel med fire reelle providerkanter, præcis én lokal
fixtureeffekt og nul rigtig HA/MCP-effekt. Preamble, duplicate/output-item-rækkefølge,
mixed batch, anden fejl, capacity/429, ACK, teardown, reset og shared Thin-adapter er
dækket. Frosne gates: **255/255 focused**, **802/802 unrestricted full** inklusive
HTTP/WebSocket, Ruff check og format grønne for 91 filer, mypy grøn for 42 sourcefiler
og `git diff --check` grøn. Den resterende usikkerhed er kun feltadfærd: GPT-Realtime-
2.1 skal på eksakt bygget artifact faktisk bruge den ene korrektion og fuldføre hele
Prompt V6-profilen. Installeret v1.13.33 forbliver NO-GO; næste gate er versionering,
CI/ARM64, installation og præcis én ny sideeffektfri live-preflight.

### Feltstop 23. august — v1.13.32 mangler rate-snapshot-proveniens

**Observeret på eksakt installeret CI/ARM64-artifact; ingen automatisk retry.**
SafeEval `eval-1787486814-7a4d94` bestod `arithmetic-followup` i samme session med
svarene 84 og 90 og korrekte topniveauer. I `time-followup` gennemførte modellen fem
responsekanter og valgte kun den lokale `get_time`-fixture. Den sjette kant blev
afvist med `TPM limit=40000, used=35073, requested=5757, retry=1,245 s`.

- De to gemte arithmetic-responses havde provider-total 5.533 og 5.566, og begge
  havde `residual=0`. Runtime-loggen viste desuden fem completed time-responses med
  totalsummerne 5.623, 5.613, 5.676, 5.709 og 5.774; alle havde `residual=0`.
- Rapporten sluttede korrekt som `diagnostic-capacity`, `coverage_complete=false`,
  uden retry eller næste scenarie. Den viste 33.720 faktisk registrerede tokens,
  $0,0561008 og 55,666 sekunders pacingventetid. Dette budgettal udelader usage fra den
  afbrudte tur og kan derfor ikke sammenlignes direkte med providerens `used=35073`.
- Ingen rigtig HA-, MCP-, PodConnect-, musik- eller timerhandling blev udført. Den
  eksklusive diagnostiklås blev frigivet terminalt; fysisk wake/rearm er ikke bevis.
- **Falsificeret hypotese:** De gemte responses viser, at topniveau-minus-detaljer
  ikke forklarer afvigelsen på disse kanter. Rettelsen af den officielle usage-kontrakt
  forbliver nødvendig, men er ikke tilstrækkelig til en grøn fuld preflight.
- **Uafklaret kausalitet:** v1.13.32 loggede ikke de rå `rate_limits.updated`-
  tokenfelter eller deres before-created/active-rækkefølge, og den afbrudte scenario-
  observation blev ikke gemt. OpenAI-eventet har intet response-id. Feltbeviset kan
  derfor endnu ikke skelne mellem forkert lokal snapshot-association, providerens
  interne completion-justering, nylig/ekstern samme-nøgletrafik eller en ufuldstændig
  lokal rapportaggregation.
- **Berørte invarianter:** hver responsekant skal admitted kausalt; providerfejl og
  budgettilstand skal være revisionsbare; ingen 429 må skjules med retry; afbrudte
  scenarier må ikke kassere det evidensspor, der kræves for årsagsanalyse; ingen
  diagnostisk fixture må nå en rigtig adapter.
- **Næste afgrænsede ændring:** tilføj bounded, sanitiseret per-edge proveniens med
  monotontid, response-id, created/done, rå token-limit/remaining/reset, ledger før/
  efter, parsed usage-total, admission target/wait og terminal provider used/requested/
  retry. Gem også den afbrudte partial observation. Ændr ikke pacingmatematikken ud fra
  denne kørsel; en ny live-kørsel må først ske efter frozen tests/review/CI/ARM64.
- **Rollback og ikke-mål:** behold terminal NO-GO frem for fast buffer, blind ekstra
  ventetid eller automatisk retry. Prompt V6, model, lyd, gain, VAD, firmware,
  playback, Thin-lifecycle, HA/MCP og værktøjspolitik er frosne.

**Lokalt instrumenteringsresultat, endnu ikke versioneret/bygget/installeret/live.**
Ingen pacingberegning eller provideradmission er ændret. Eval-only tracing gemmer nu
højst 128 sanitiserede, monotont ordnede rækker per tur: atomic capacity-check/wait/
recheck, pre-wire/sent request-id, created response-id og request-match, positional
rate-event med rå gyldige tokenfelter, pending-count/ids, duplicate/ambiguous/late-
klassifikation, done-status/usage/rate-count og strukturerede 429-tal uden rå
providertekst. Recorderens fravær eller fejl ændrer ikke wire, pacing eller terminal
adfærd; Voice PE/Talk bruger de oprindelige ikke-allokerende budgetveje.

Failed, timeoutede og pre-wire-afbrudte ture bærer deres bounded partial observation
ind i rapporten. Dermed gemmes alle fem completed `time-followup`-kanter og deres lokale
fixture-outcomes før en sjette 429. Den nye rapport viser særskilt completed trace-total,
budget-total og forskellen. Dette retter også feltfortolkningen: `33720` var arithmetic
`11099` plus kun de første fire time-kanter `22621`; den femte completed kant `5774`
blev kasseret af den gamle fejlrapport. Alle completed responses før 429 summerede
derfor til `39494`, så `35073-33720=1353` var en sammenligning af forskellige
populationer og er **ikke** et bevist provider/lokalt gap. Selve false-admission er
fortsat uafklaret, indtil de nye rate-/ledger-rækker findes fra eksakt installerede bits.

Frosne lokale gates: **160/160 focused**, **790/790 unrestricted full** inklusive lokale
HTTP/WebSocket-integrationer, Ruff grøn, mypy grøn for 42 sourcefiler og
`git diff --check` grøn. Uafhængigt adversarial review finder ingen åben P0/P1 i denne
instrumenteringsslice, men scorer den 94/100, fordi root cause og pacing bevidst ikke er
ændret. Kandidaten er fortsat NO-GO for fysisk test indtil version/build/CI/ARM64,
installation og en ny SafeEval-trace er uafhængigt vurderet.

### Feltstop 23. august — v1.13.31 forklarede ikke hele providerens rullende forbrug

**Observeret på eksakt installeret CI/ARM64-artifact; ingen automatisk retry.**
v1.13.31 startede korrekt med Voice PE, 19 HA/MCP-værktøjer og vellykket
`GetLiveContext`. SafeEval `eval-1787484610-a49ab1` fastholdt Prompt V6/default og de
forventede schemahashes. `arithmetic-followup` bestod begge ture i samme
Realtime-session med svarene 84 og 90. En senere sideeffektfri værktøjsopfølgning blev
afvist af OpenAI med `TPM limit=40000, used=35743, requested=5692, retry=2,152 s`.

- Rapporten klassificerede fejlen som `diagnostic-capacity`, satte
  `coverage_complete=false` og fortsatte ikke til næste scenarie. Lokalt registreret
  forbrug var 33.455 tokens, $0,065332 og 55,073 sekunders pacingventetid.
- Forskellen mellem providerens `used=35743` og det lokale `actual_tokens=33455` er
  **2.288 tokens**. Den forrige kontinuerlige refill rettede epoch-jump-fejlen, men
  feltbeviset falsificerer, at completed-response-usage alene beskriver hele den
  kapacitet, providerens næste responsekant reserverer imod.
- Ingen rigtig HA-, MCP-, PodConnect-, musik- eller timerhandling blev udført:
  `/api/status` viste efter stop `diagnostic_active=false`, 0 sessions, 0 tool calls og
  HA/MCP oppe med 26 deklarationer. Voice PE blev frigivet; fysisk wake/rearm er ikke
  brugt som bevis i denne maskinelle kørsel.
- **Berørte invarianter:** providerfejl skal være kausalt korrelerede og synlige;
  eval må ikke skjule 429 med retry; hver klientstyret `response.create` skal være
  sikkert admitted; diagnostiklåsen skal frigives terminalt; diagnostiske fixtures må
  aldrig nå rigtige adaptere; maskinelt grønt må ikke udledes af et delvist scenarie.
- **Falsificerbar hovedhypotese:** Realtime-providerens rullende TPM-regnskab omfatter
  reservation/overhead, som ikke findes i den lokale sum af `response.done.usage`,
  eller den lokale debit/refill binder en autoritativ snapshot til den forkerte
  responsekant. Før rettelse skal rå feltevents og officiel kontrakt skelne mellem
  outputreservation, cached/input-usage, protokoloverhead og ekstern samme-nøgletrafik.
- **Påkrævet regression:** reproducer `used=35743`, lokal completed usage 33.455,
  `requested=5692` og 2,152 s uden at gætte en fast margin; bevis atomic admission ved
  hver initial og deferred tool-result-responsekant, korrekte before/active/late/
  manglende rate-events, flere efterfølgende debits, timeout/teardown og nul wire-send,
  fixtureeffekt eller retry ved utilstrækkelig kapacitet. En ny live-kørsel må først
  ske efter frozen focused/full/lint/mypy, uafhængigt review og nyt CI/ARM64-artifact.
- **Rollback:** v1.13.31 forbliver installeret men live-preflight må ikke genkøres og
  fysisk golden chain må ikke begynde. Ved usikker årsag bevares terminal 429 og den
  sideeffektfrie NO-GO i stedet for at sænke gaten eller tilføje en blind buffer.
- **Frosne ikke-mål:** Prompt V6, model, lyd, gain, VAD, firmware, playback,
  Thin-lifecycle, HA/MCP-discovery og produktionsværktøjspolitik ændres ikke.

**Lokalt implementeringsresultat, endnu ikke versioneret/bygget/installeret/live-kørt.**
Den officielle Realtime-kontrakt gør topniveauets `total_tokens`, `input_tokens` og
`output_tokens` til den samlede usage for en completed response. Den hidtidige parser
ignorerede disse felter og summerede kun tekst-/lyddetaljer. Parseren kræver og
validerer nu ikke-negative heltal, `total=input+output`, at topniveauet ikke er mindre
end detaljerne, og at cached er en delmængde. Providerledger, responsekapacitet og
SafeEvals faktiske tokenloft bruger `total_tokens`; modalitetsdetaljer bevares til pris,
og en uklassificeret input-/outputrest prises konservativt med den dyreste relevante
modalitet. Image-input kan ikke forsvinde fra prisloftet.

Hver eval-response gemmer nu et sikkert observationsobjekt med response-id,
topniveauets tre totalsummer, detaljesum og input-/outputrest i rapporten og en
tilsvarende sanitiseret loglinje. Den gamle v1.13.31-rapport gemte ikke topniveauet, så
de 2.288 tokens er **ikke retrospektivt bevist** som denne rest; ekstern samme-nøgle-
trafik eller anden providerbaseline er fortsat en falsificerbar alternativ forklaring.
Den næste live-kørsel kan nu skelne dem per response.

Rå regressioner beviser blandt andet: detaljesum 33.455/topniveau 35.743 og næste kant
5.692 giver præcis `(35743+5692-40000)/(40000/60)=2,1525 s` plus den eksisterende
50 ms grænsemargin og præcis én wire-send; malformed/manglende/modstridende totalsummer
fejler lukket; topniveau større end detaljesummen kan ikke frigive en staged
værktøjseffekt uden kapacitet til resultatet; duplicate completion debiterer ikke igen;
en budgetejet direkte produktionsresponse uden gyldige topniveauer fejler terminalt,
så en senere tur ikke kan admitted på stale kapacitet; residual, cached og image
dobbelttælles ikke og bliver ikke gratis. Focused-, full-, Ruff- og mypy-gaten er nu
kørt: **221/221 focused**, **772/772 unrestricted full**
inklusive lokale HTTP/WebSocket-integrationer, Ruff grøn, mypy grøn for 42 sourcefiler
og `git diff --check` grøn. Uafhængigt adversarial review, versionering, CI/ARM64-build,
installation og en frisk fuld live-eval er fortsat åbne gates; kandidaten er derfor
fortsat NO-GO for fysisk golden chain.

### Feltstop 23. august — v1.13.30 preflight ramte TPM på en responsekant

**Observeret, ingen automatisk retry.** Add-on-kataloget leverede v1.13.30, og den
installerede kandidat startede korrekt: loggen viste versionslinjen, 19 atomisk
admitterede HA/MCP-værktøjer, et vellykket `GetLiveContext` og en godkendt Voice PE-
firmwarekontrakt. Den eksplicit startede SafeEval `eval-1787479390-7aa3ed` tog den
nøglebrede diagnostiklås og frigav den igen terminalt.

- Prompt V6/default og de effektive, produktions- og reserverede schemahashes blev
  fastholdt i rapporten. Første scenarie `arithmetic-followup` bestod begge ture med
  svarene 84 og 90, samme Realtime-session og typet usage.
- Næste scenarie valgte det lokale SafeEval-værktøj `get_time` på completed
  responsekanter. Ingen rigtig HA-, musik- eller timerhandling blev udført.
- En efterfølgende `response.create` blev afvist med
  `TPM limit=40000, used=34805, requested=5769, retry≈861 ms`. Kørselen klassificerede
  det som `diagnostic-capacity`, satte `coverage_complete=false`, stoppede før næste
  tur/scenarie og genforsøgte ikke.
- Faktisk registreret forbrug før stop var 33.792 tokens og **$0,0772896**, langt under
  det prospektive $5-loft. Den fulde profil for web, approvals, værktøjsrækkefølge og
  semantisk close blev ikke gennemført og giver derfor ikke 97/100.
- **Falsificerbar regressionshypotese:** Den lokale reset-aware pacing tillod flere
  produktionsformede responsekanter i samme scenariesession tættere end providerens
  rullende TPM-vindue kunne bære. Den eksakte feltsekvens er flere completed
  `get_time`-beslutning/resultatkanter efter den synlige resetventetid, derefter 429 på
  næste result-response med kun 574 tokens over loftet. Før ny live-kørsel skal en rå
  regression bevise pacing før hver responsekant i samme session, inklusive
  tool-resultat/follow-up, uden at acceptere 429 eller indføre automatisk retry.
- **Frosne ikke-mål:** Prompt, model, lyd, gain, VAD, firmware, playback,
  Thin-lifecycle, HA/MCP-discovery og produktionsværktøjspolitik ændres ikke ud fra
  denne kapacitetsfejl.

**Lokalt implementeringsresultat, endnu ikke versioneret/installeret/live-kørt.** Den
eksakte feltmatematik viste et rullende token-bucket-problem: `34805 + 5769 - 40000 =
574`, og `574 / (40000/60) = 0,861 s`. Providerledgeren refiller derfor nu kontinuerligt
med det dokumenterede TPM-loft/60 på hvert monotont read/debit; en gyldig
`rate_limits.updated` forankrer remaining, men `reset_seconds` bruges aldrig som slope.
En eval-only callback genbekræfter atomisk den fulde eller kontekstafledte kapacitet ved
den sidste lokale grænse før **hver** klientstyret `response.create`, inklusive normal,
hurtig og deferred tool-result/follow-up. Den genbruger ikke completed edges og retryer
ikke en 429. En planlagt refillventetid vækkes ind i collectorens private mekanik, så den
er uden for 20-sekunders semantisk timeout, men fortsat inden for kørselsdeadline og
synlig `rate_limit_wait_s`. Worst-case-deadlinen følger nu alle 36 mekanisk mulige
responsekanter og vises dynamisk som omtrent 41 minutter; normalprofilen forventes
kortere.

Rå regressioner dækker feltets 574-token underskud, officiel near-full/reset-permutation,
senere debits uden epoch-jump, valid rate før/under response, malformed/manglende og
unsolicited late rate, initial og tool-result-create, fast og normal tool-marker-
rækkefølge, atomic recheck-fejl uden wire-send, timeout-credit og stale target ved close.
Resultater på det frosne lokale træ: **201/201 focused**, **599/599 non-socket** og
**753/753 fuldt testsæt** grønne; Ruff, mypy for 42 sourcefiler og `git diff --check` er
grønne. Der er ikke kørt live API, installeret, committed eller pushed. Kandidaten er
fortsat **NO-GO** indtil uafhængigt adversarial review, byg/CI og én ny rigtig Prompt
V6-live-preflight på de præcise byggede bits; fysisk golden chain følger først derefter.

### Feltstop 22. august — v1.13.29 havde en unødvendig separat providerprobe

**Observeret fejl og daværende lead-beslutning.** Den installerede v1.13.29 afsluttede
preflight før semantisk eval, fordi en ekstra throwaway Response ikke modtog den
forventede `rate_limits.updated`. Feltsekvensen var `session.updated` →
`response.created` → samme `response.done(completed)` uden en logget gyldig rate-event.
Det falsificerer rate-telemetri som obligatorisk cold-admission-autoritet.

- **Valgt safety-model:** Den separate providerprobe, probelease, probesocket,
  proberapport og probepris fjernes helt. Første rigtige, sideeffektfrie semantiske
  evalrespons er providerpreflight og bruger den eksakte produktionsprompt, hele det
  frosne schema og kun `SafeEvalTools`. `rate_limits.updated` er valgfri pacingtelemetri.
- **Mekaniske grænser:** Den nøglebrede, modeluafhængige diagnostiklås, et nyt lokalt
  40.000-token/60-sekunders vindue per diagnostik/model, completed response med typet
  usage på hver kant, causal tool-resultatkapacitet, højst tre responsekanter per tur,
  hard deadline og prospektivt $5-loft. Gammel providertelemetri genbruges ikke.
- **Hele kæden:** panelstart → diagnostiklås → prompt/schema/fixtureadmission → første
  semantiske evalsession → første `response.create` → optional rate-event → completed
  `response.done` med typet usage → fortsat scenario eller terminal diagnostik. Der
  findes ingen ekstra providerresponse før den faktiske assistenttest.
- **Fail-closed:** Manglende/malformed usage, timeout, ikke-completed response og
  provider-429/capacity stopper hele kørslen før næste tur, scenarie eller efterfølgende
  fixtureeffekt. Eval-fixtures er lokale og kan ikke skabe en rigtig ekstern effekt;
  der er ingen automatisk retry. Alle leases frigives terminalt.
- **Ikke-mål:** Prompt, model, lyd, VAD, firmware, playback, Thin-lifecycle, HA/MCP og
  produktionsværktøjspolitik ændres ikke. Kandidaten er NO-GO, indtil frozen focused,
  full, lint, mypy, uafhængigt review, CI/ARM64 og rigtig Prompt V6-live-eval er bevist.
- **Faktisk lokal korrektion og resultat:** Throwaway-API, probelease, probesocket,
  probepris og proberapport er slettet. Første semantiske response ejer preflighten.
  Exact diagnostic-owner, tværmodelserialisering, completed+usage uden rate-event,
  malformed/manglende usage, 429, timeout/non-completed, reset og terminal release er
  dækket. Provider/eval/panel-fokus er **141/141**, hele repoet **742/742**, Ruff,
  formattering, scoped mypy og diff-check er grønne. Uafhængigt frozen review fandt
  ingen åben P0/P1; CI/ARM64 og rigtig Prompt V6-live-eval står fortsat åbne, så
  kandidaten er stadig NO-GO for fysisk test.

### Feltstop 22. august — v1.13.28 live-preflight og HA-readiness

**Dette er observerede resultater og daværende beslutning før rettelse.** Der må ikke køres
flere blinde preflight-genforsøg eller fysisk golden chain på v1.13.28.

- Første sikre providerbudget-probe sluttede som
  `rate_limit_capacity · provider budget probe response did not complete (incomplete)`.
  OpenAIs officielle kontrakt begrænser `incomplete` til `max_output_tokens` eller
  `content_filter`. PodVoice parsede den konkrete `status_details.reason`, men
  eval-harnessen og runtime-loggen kasserede den, så den afsluttede kørsels eksakte årsag
  kan ikke rekonstrueres. Proben var sideeffektfri og brugte ingen HA-/MCP-værktøjer.
- Proben var hårdt begrænset til otte outputtokens. Den falsificerbare hovedhypotese er,
  at GPT-Realtime-2.1 brugte tokenloftet, inklusive eventuelle reasoningtokens. En ny
  instrumenteret probe med et fortsat lille, eksplicit loft skal vise den autoritative
  reason; `content_filter` skal fortsat fejle lukket.
- Et efterfølgende eksplicit run fik en completed probe og åbnede den rigtige eval, men
  endte senere med `provider token headroom is insufficient for eval plus production`.
  Loggen viser flere completed evalresponser og derefter en response uden synlig terminal
  kant. Dette må ikke klassificeres som blot pacing eller saldo, før den præcise
  response-/budgetkæde er korreleret og watchdogens slutresultat er bevist.
- Standardprofilen har syv friske scenariesessioner. Med den dokumenterede Tier-1-
  guard kræver seks mulige resetmellemrum alene mindst cirka 363 sekunder, mens v1.13.28
  afslutter hele kørslen efter 300 sekunder. Det er en deterministisk deadlinefejl.
  Alle scenarier bevares; kandidaten skal bruge autoritative resetkanter og et beregnet,
  synligt hard-limit, der også indeholder turn- og connect-timeouts. Ingen grøn profil
  opnås ved at springe scenarier over.
- Budgetleasen på 15.000 tokens er i v1.13.28 både sessionslås og kumulativ beholdning.
  Hver completed respons trækker fra den gennem hele samme Realtime-socket, og en
  provider-reset fylder den ikke op. En legitim sekvens som direkte svar → værktøj →
  værktøj/farvel kan derfor ramme 6.000-token-resultatgaten, selv når providerens nye
  vindue har rigelig kapacitet. Rettelsen skal adskille eksklusivt sessionsejerskab fra
  per-response rolling headroom; ingen sideeffekt frigives uden kausalt reserveret
  kvitterings-/farvelkapacitet.
- Ved samme add-on-opstart returnerede Home Assistants Supervisor/Core MCP- og
  service-endpoints HTTP 502. Panelets manglende hjem/web/vejr er derfor et sandt
  øjebliksbillede af den nye sessions værktøjsliste, men **ikke** bevis for forkert
  eksponering eller permanent manglende integration. Automatisk MCP-recovery og
  readiness-sandhed auditeres separat; ingen HA-konfiguration ændres blindt.
- **Berørte invarianter:** eval må være sideeffektfri og må aldrig overlappe en
  produktionssession på den delte providerpulje; providerfejl skal være korrelerede og synlige; kun aktuelt opdagede
  deklarationer må kaldes; HA-recovery må ikke kræve add-on-/Voice PE-genstart.
- **Frosne ikke-mål:** produktionsprompt V6, model, lyd, gain, VAD, firmware, playback,
  semantisk afslutning, timeout, teardown og rearm ændres ikke i korrektionen.
- **Accept før ny live-kørsel:** rå tests for begge incomplete-reasons, præcis
  response-/usage-korrelation, nul semantiske trials og nul værktøjseffekt ved probe-
  fejl, bounded eksplicit genkørsel, autoritativ reset-aware pacing samt et matematisk
  tilstrækkeligt og stadig hårdt samlet tidsloft for hele syv-scenarieprofilen.
  HA-fejlen kræver en separat recovery-regression fra den observerede 502-rækkefølge.
- Før cold-proben må de valgte scenariers eksakte produktionsværktøjer og kanoniske
  fixtureargumenter valideres mod det frosne deklarationssnapshot. Manglende, omdøbt,
  duplikeret eller schema-inkompatibelt værktøj giver en struktureret capability-block
  med nul providerforbrug. Der må ikke bruges løse navnehints, syntetiske
  produktionstools, stille scenario-skip eller rigtige HA-sideeffekter for at gøre
  preflight grøn.

#### Lead-beslutning — live-preflight er eksklusiv diagnostik

- **Falsificeret designantagelse:** Et lokalt 15.000-token "produktionsheadroom" kan
  ikke garantere en samtidig fysisk Realtime-session, når providerens egen reservation
  for en produktionsformet evalrespons allerede har reduceret `remaining` under dette
  niveau. At afbryde evalen bagefter kan forhindre sideeffekter, men kan ikke tilbageføre
  providerens allerede brugte input-/outputkapacitet.
- **Valgt kontrakt:** Den manuelt/eksplicit startede live-preflight ejer én bounded,
  gensidigt eksklusiv diagnostiklease. Den må kun starte, når ingen Voice PE-/Talk-
  session er aktiv. Nye produktionssessioner under kørslen afvises straks med præcis
  `diagnostic_busy`, følger den normale fejl-teardown og rearmes én gang; de køer eller
  konkurrerer aldrig skjult med evalen. Panelet viser, at Nabu testes og ikke er fysisk
  klar. Leasen frigives ved success, fejl, timeout, klientafbrydelse og add-on-stop.
- **Hvorfor:** Med samme OpenAI-projekt/rate-limit-pulje findes ingen lokal mekanisme,
  der kan bevise øjeblikkelig produktionskapacitet efter en vilkårligt stor provider-
  reservation. Sand parallel drift kræver en separat evalprojekt-/nøglepulje og er et
  senere selvstændigt designvalg; den opfindes ikke i denne kandidat.
- **Berørte invarianter:** én provider-ejer ad gangen; eval er sideeffektfri; fysisk
  wake må aldrig blive hængende; teardown/rearm er exactly-once; readiness er sand.
  Prompt, model, audio, gain, VAD, firmware, playback og semantisk close forbliver
  frosne.
- **Obligatoriske regressioner:** aktiv produktion → eval nul sockets; aktiv eval →
  Voice PE og Talk får `diagnostic_busy`, nul provider-connect og én ren rearm/fejl;
  eval success/fejl/timeout/cancel/add-on-stop frigiver låsen; næste wake virker; ingen
  HA/MCP/PodConnect-sideeffekt; UI viser aldrig fysisk klar under diagnostik.

#### Historisk recovery-beslutning — HA/MCP efter Supervisor-start

- **Årsagen er nu feltbekræftet:** Den uændrede installerede v1.13.28 genvandt selv
  forbindelsen ved det gamle ti-minutters probeinterval. Loggen viser 502-svar kl.
  10:04:55 og derefter kl. 10:15:03 successfuld initialize (200), notification (202),
  `tools/list` (200), 19 HA-værktøjer samt et vellykket `GetLiveContext`; panelets
  runtime havde derefter 26 deklarationer inklusive PodConnect og
  `google_web_sogning`. Integration og eksponering manglede altså ikke. Fejlen var et
  transient Supervisor/Core-opstartsvindue, som den gamle 600-sekunders retry gjorde
  synligt i ti minutter.
- **Falsificerbar årsag:** Hvis de observerede 502-svar er et kort Supervisor/Core-
  opstartsvindue, skal hurtige, begrænsede discovery-genforsøg hente samme konfigurerede
  Assist/MCP-værktøjer uden add-on- eller Voice PE-genstart. Fortsætter 502 efter
  backoffvinduet, skal panelet vise det aktuelle endpoint, sidste fejl og næste forsøg;
  det må ikke påstå, at integrationen mangler.
- **Valgt mekanik:** Discovery ejer ét generationsbundet snapshot. Fejl forsøges igen
  efter omtrent 1, 2, 5, 10 og 30 sekunder og derefter højst én gang pr. minut. Et
  succesfuldt komplet `tools/list` erstatter snapshot atomisk for **næste**
  Realtime-session; en allerede åben session beholder sit accepterede schema. Der
  oprettes ingen parallel samtalemotor eller HA Assist-samtale.
- **Degraded sandhed:** Den aktuelle installation hoster web, HassMedia og PodConnect-
  data bag HA/Supervisor. Under et HA-udfald kan kun samtalen, lokal tid og lokale
  timere garanteres. Nye sessioner får local-only, indtil recovery lykkes; gamle
  deklarationer udføres ikke blindt. `PRODUKTMÅL` er præciseret tilsvarende. Uafhængig
  drift for web/musik kræver senere egne adapters og er ikke en skjult del af denne
  rettelse.
- **Naborisici:** samtidige refreshes, stale succes efter nyere fejl/succes,
  add-on-teardown under backoff, forkert MCP API-id/endpoint, delvis tool-liste,
  tidligere succes vist grøn mens værktøjet nu er væk, og timertekst fejlklassificeret
  som musik. Readiness skal vise generation, hentet-tid, endpoint/API-id, seneste fejl
  og retrytilstand.
- **Regressioner før resultat:** den eksakte `502, 502, succes`-sekvens; vedvarende 502
  med bounded tidsplan; stop/teardown uden lækket task; stale/overlappende svar; aktiv
  session uændret mens næste session får nyt snapshot; nuværende fravær må ikke blive
  grønt af gammel historik; lokale timere må ikke tælle som musik.
- **Rollback:** Recoverybølgen er add-on-only og må rulles tilbage samlet. Ved én
  schema-/sessionmutation eller retry-loop beholdes v1.13.28's konservative degraded-
  visning frem for at kræve manuel HA-konfigurationsændring eller genstart som produktvej.

- **Observeret fejl:** Trace `20260821T103257-225` havde diagnostisk “Hvad er
  klokken?”, men Realtime kaldte intet værktøj og gav et irrelevant fysisk svar.
- **Stærkeste evidens:** Korreleret Voice PE-trace med device-/provider-/speakerlyd,
  playback-finish, teardown og rearm. Den diagnostiske tekst beviser ikke, hvad den
  native audiomodel forstod.
- **Hel kæde under audit:** Fysisk wake → mic-latch/device-PCM → provider-PCM →
  accepteret Realtime-session/prompt/værktøjsskema → modelbeslutning → FLAC-playback →
  ekkogate → idle/semantisk close → teardown/rearm → næste wake.
- **Falsificerbar hypotese:** Et fremtidigt replay med OpenAIs egne VAD-grænser, samme
  dokumenterede værktøjsskema og et delt TPM-budget kan afgøre, om fejlen følger lyden
  konsekvent eller varierer i modellen. Den nuværende replay kan kun give diagnostik.
- **Nærliggende fejlveje:** Forkert lydudsnit, ændret værktøjsskema, eval-sideeffekt,
  schema-overload, TPM/rate-limit, stale trace, forkert rumkontekst og forveksling af
  providerbevis med fysisk puckbevis.
- **Frosne ikke-mål:** Promptens almindelige V6-adfærd, model, gain 16, VAD, noise, firmware,
  announcement-playback, semantisk afslutning, timeout, teardown og rearm ændres ikke.
- **Faktisk ændring i v1.13.27-kandidaten:** Providerens tool-kandidater frigives kun
  efter en korreleret, completed respons; schemas og ACKs valideres fail-closed;
  følsomme handlinger kræver en server-ejet, næste-tur-bundet engangsgodkendelse;
  HA-mål opløses frisk og dispatches som det samme kanoniske mål; og ét fælles
  providerbudget beskytter tool-resultat/farvel mod TPM-udtømning. Prompt V6 ændrer kun
  den minimale approval-protokol. Audio, gain, VAD, firmware og playback er uændrede.
- **Maskinel evidens:** 634/634 tests, Ruff, format, mypy og diff-check er grønne efter
  cold-start- og response-korrektionsbølgen. GitHub CI-run `32482026582` bestod på
  commit `2c09042`, inklusive den komplette `linux/arm64` add-on-containerbuild.
- **Uafhængig review:** NO-GO for replay som beslutningsbevis. De nuværende
  `provider_sample_offset` afspejler tidspunktet, hvor eventet behandles, ikke OpenAIs
  autoritative `audio_start_ms`/`audio_end_ms`; den kendte v1.13.25-trace mangler
  værktøjsskema-hash; og evalens TPM-pacing er ikke koordineret med aktive fysiske
  sessioner. Installation alene er GO som reversibel diagnostik uden firmwareændring.
- **Afvigelse fra planen:** Panelet kan vise et bestået audio-replay, selv når
  `schema_match` er ukendt. Resultatet må derfor ikke bruges til at godkende årsag,
  prompt, lydkæde eller fysisk golden chain.
- **Næste gate:** Installér præcis v1.13.28-artifactet og kør den sikre cold-probe og
  Prompt V6-live-eval. Først derefter køres én frisk golden chain samt 10/10
  ubrudte fysiske cyklusser. Det gamle replay forbliver diagnostisk og kan ikke godkende
  lydårsagen.
- **Rollback/grænse:** v1.13.11 forbliver fysisk baseline. v1.13.28 overtager ingen
  fysisk gate, før live-eval, image-build, frisk golden chain og 10/10 er bestået.

## Officiel OpenAI-kontraktaudit 21. august

En ny read-only audit har sammenholdt den aktive Realtime-implementation med OpenAIs
aktuelle officielle dokumentation for conversations, server-/client-events, tools,
VAD, transcription, rate limits, costs og GPT-Realtime-2.1. Tre uafhængige reviews er
samlet af lead. **Auditten udvider stop-the-line fra replay til runtime-værktøjssikkerhed.**
Ingen runtimekode, prompt, lyd, VAD eller firmware blev ændret under auditten.

### Historisk udviklingsbeslutning — providerfinalitet og serverautorisation

**Beslutning taget før releasegodkendelse; nedenstående er krav og hypoteser, ikke
opnåede resultater.** Kandidaten forbliver stop-the-line og må ikke installeres som
normal runtime eller åbnes for fysisk golden chain, før resultatafsnittet senere kan
dokumentere alle gates som bestået.

- **Observeret/auditeret fejl:** `response.function_call_arguments.done` kunne starte
  HA-/lifecycle-sideeffekter før owning `response.done`; følsomme handlinger havde kun
  promptbeskyttelse; tool-output og flere causale client-events manglede korreleret ACK.
- **Falsificerbar implementeringshypotese:** Hvis værktøjskandidater stages per
  providerrespons og kun frigives atomisk efter eksplicit `status=completed`, og hvis
  alle sideeffekter passerer en server-ejet, sessions-/tur-/argumentbundet policy, kan
  cancelled, malformed, stale og uautoriserede kald give præcis nul sideeffekter uden at
  ændre Realtime-ejet sprogforståelse eller den fysiske half-duplex-kæde.
- **Berørte invarianter:** Livscyklus 3, 4, 6, 9, 10 og 12 samt ejerskabet “Realtime
  vælger; serveren autoriserer; Thin ejer samtalen”. Særligt skal en batch med en
  godkendelseskrævende handling og `end_conversation` forblive åben; en low-risk handling
  plus semantisk afslutning må først lukke efter samlet resultat og fysisk farvel.
- **Valgt retning:** Provider-neutrale tool-events får response-/batchidentitet.
  Kandidater valideres og registreres samlet før første dispatch. Højrisiko afgiver en
  serverholdt challenge; en senere, completed-gated intern approval-beslutning må kun
  frigive den eksakte gemte handling én gang i samme session. Ingen lokal fraseliste
  eller diagnostisk ASR-tekst må godkende eller afvise brugerens mening.
- **Schema-/capability-sandhed:** Et dynamisk værktøj må ikke annonceres, hvis dets
  schema ikke kan valideres af runtime. Enten bruges fuld standardsvalidering, eller
  deklarationen filtreres før `session.update`, og capability markeres degraded med
  årsag. Mid-turn “annonceret men umulig” er ikke acceptabelt.
- **ACK-/readiness-sandhed:** Kun accepteret `session.updated` må betyde provider-klar.
  Tool-output skal være item-kvitteret før `response.create`; fejl på create, truncate
  og clear skal korreleres til deres operation og fejle lukket.
- **Frosne ikke-mål:** Promptens almindelige samtale-, routing-, sprog- og lydpolitik,
  model, audio, gain, VAD, firmware, playback-lease, timeout, teardown og wake-rearm må
  ikke tunes i kandidaten. Den eneste tilladte promptændring er den minimale protokol
  for det nye reserverede `approve_action`: Realtime må efter en klar semantisk
  bekræftelse på den umiddelbart næste tur sende det eksakte serverudstedte challenge-id,
  men må aldrig gentage eller ændre den oprindelige handling. Ændringen versionsmærkes
  særskilt og kræver prompt-contract- samt semantisk eval; den må ikke bruges til at
  tune de kendte input-/svarfejl. Den seneste irrelevante tidsrespons og det gamle
  replaybevis er fortsat uløste og må ikke erklæres repareret af
  værktøjssikkerhedsarbejdet.
- **Maskinel gate:** Rå providerpermutationer skal dække completed/cancelled/failed/
  incomplete/manglende status, late/duplicate/cross-response call-id, malformed schema,
  multi-call atomik og ACK-fejl. Thin/Talk/Voice PE-kontrakten skal dække approval på en
  senere tur, expiry/replay/sessionteardown, følsom handling plus close, tool-round-
  ordering og næste wake. Alle eksisterende tests, typecheck, lint, build og uafhængig
  adversarial review skal være grønne med mindst 97/100 og nul P0/P1.
- **Rollback:** Ændringen er add-on-only og må ikke kræve firmwareflash. Enhver failed
  gate kasserer kandidaten samlet; v1.13.11 forbliver fysisk baseline. Der pushes ingen
  release/version og udføres ingen fysisk test, før ovenstående er dokumenteret som
  faktiske resultater i et separat afsnit.

#### Historisk delresultat — fælles providerbudget før eksklusiv diagnostik

Det historiske auditfund nedenfor om ignoreret `rate_limits.updated` var korrekt for den
installerede baseline. Punkterne dokumenterer den tidligere headroom-model og dens
maskinelle delresultat; modellen er nu **falsificeret og erstattet** af den bindende
eksklusive diagnostikkontrakt ovenfor. De må ikke bruges som aktuel releasepåstand.

- Voice PE og Talk tager ved provider-connect straks en 15.000-token
  produktionslease gennem hele socket-generationen. Den venter aldrig bag eval og
  bevarer kapacitet til første svar plus en mulig tool-/farvelopfølgning. Kendt
  utilstrækkelig kapacitet fejler før socket og sideeffekt; ukendt budget tillader højst
  én produktionssession og ingen eval.
- Hver preflight-/replay-prøve reserverer 15.000 tokens plus 15.000 tokens uberørt
  produktionsheadroom. Kun én eval-prøve kan være aktiv per nøgle/model. En fysisk eller
  Talk-session kan starte under den aktive prøve; næste prøve afvises, indtil
  produktionen er lukket.
- Providerens token-`limit`, `remaining` og `reset_seconds` afstemmes på et monotont ur.
  Completed `response.done` debiterer tekst-/lydinput og -output på den eksakte
  generation/evallease én gang. Et staged produktionsværktøj frigives kun, når usage er
  eksplicit, typet og ikke-negativ, og samme lease fortsat ejer mindst 6.000 tokens til
  tool-resultat/farvel; ellers udsendes nul `ToolCall`/`ToolRoundComplete` og dermed nul
  sideeffekt. Duplicate terminalevents, stale generationer, reconnect, fejl og teardown
  kan ikke frigive den aktuelle lease eller debitere samme respons igen. Ingen afsluttet
  tur autogenkøres.
- Nye samtidigheds-/permutationstests dækker eval→produktion, to evals, ukendt og
  utilstrækkeligt budget, providerreset, forbrug, duplicate terminalevent og idempotent
  release. Hele den aktuelle suite bestod 622/622 uden sandboxens loopback-begrænsning;
  Ruff og mypy bestod for de berørte provider-/evalfiler.

Som en bevidst konservativ P2-begrænsning er produktionskapaciteten serialiseret: et
samtidigt Talk-/andet-rum-forsøg afvises straks i stedet for at blive køet. Den aktive
ene samtale ændres ikke; parallelle rum kræver en senere selvstændig kapacitetsgate.

Dette er maskinel kontraktevidens, ikke live provider-, fysisk lyd- eller
releasegodkendelse. Prompt, model, audio, gain, VAD, firmware og playback er uændrede;
v1.13.11 forbliver fysisk baseline, og kandidatens samlede adversarial review/build og
fysiske gates er fortsat åbne.

#### Historisk cold-start-korrektion — efterfulgt af eksklusiv diagnostik

**Dette er feltfejl og plan før rettelse, ikke et opnået resultat.** Den installerede
v1.13.27 afviste den sikre preflight med
`rate_limit_capacity · live eval requires an authoritative provider token budget` på
en frisk add-on-proces, selv om ingen fysisk samtale var aktiv.

- **Direkte evidens og kæde:** Panelets preflight → `LiveEvalService` → første
  evalreservation → afvisning før Realtime-connect. Ingen Response blev oprettet, ingen
  `rate_limits.updated` kunne derfor ankomme, og evalen kunne aldrig etablere den
  autoritet, den krævede. Fysisk Voice PE, playback, teardown og rearm blev ikke berørt.
- **Officiel kontrakt og falsificerbar årsag:** OpenAI dokumenterer, at
  `rate_limits.updated` først udsendes ved begyndelsen af en Response og allerede
  afspejler dens outputreservation. Kravet om autoritativt remaining **før den første
  Response** er derfor cirkulært. Hypotesen er, at én separat, minimal og kasseret
  diagnostic Response kan etablere autoriteten, hvorefter den første rigtige evalprøve
  åbnes i en ny session under den normale fulde reservation. Hvis providerens event
  udebliver, må ingen rigtig evalprøve starte eller bestå.
- **Berørte invarianter/naborisici:** Eval må ikke reducere fysisk headroom; produktion
  må aldrig vente bag eval; kun én eval/produktion må eje de nuværende leases;
  manglende, stale eller malformed rate-event skal fejle lukket; bootstrap må ikke
  kunne gentages mellem prøver eller blive stående efter timeout/teardown.
- **Planlagte regressioner:** cold-start probe → autoritativ event og completed
  Response → ny rigtig evalsession; manglende/malformed event eller providerfejl → hele
  run fejler; fysisk wake under proben får sin 15k reservation og stopper efterfølgende
  eval; to prober serialiseres; lavt autoritativt remaining stopper næste prøve; lease
  frigives én gang ved timeout/fejl.
- **Frosne ikke-mål og rollback:** Prompt, model, audio, gain, VAD, firmware, playback,
  tool-policy og lifecycle ændres ikke. Rettelsen er add-on-only. Hvis fysisk headroom
  eller fail-closed-grænsen ikke kan bevises maskinelt, beholdes feltfejlen som NO-GO
  frem for at genindføre ubegrænset evalpacing.

**Faktisk ændring og maskinelt resultat:** Cold-start bruger nu én dedikeret ephemeral
Realtime-session og en out-of-band `response.create` med `conversation: none`, tekst-only,
ingen tools, `tool_choice: none` og højst 64 outputtokens. Feltets 8-token-probe sluttede
`incomplete`; 64 er fortsat bundet af den separate 2k-lease. Output kasseres; både en
gyldig `rate_limits.updated` og en completed `response.done` kræves før socket og lease
lukkes. Først derefter tager en **ny** Realtime-session den normale autoritative
evalreservation. Manglende/malformed rate-event, timeout og providerfejl fejler lukket.
Hele jobbet ejer den nøglebrede, modeluafhængige diagnostiklås fra før proben til sidste
teardown; Voice PE og Talk får `diagnostic_busy` uden provider-socket, og panelet viser
Nabu som midlertidigt utilgængelig. En transient fejl kan genprøves af et senere
eksplicit run, men aldrig automatisk eller samtidigt. En completed probe kan kun
attestere den rate-event, parseren bandt til samme Response og socketgeneration; en
tidligere incomplete probes snapshot kan ikke genbruges af en senere completed probe
uden sin egen rate-event.

Sessionsejerskab og rolling responsekapacitet er adskilt: en autoritativ reset genfylder
den eksakte aktive lease, tre-turs same-session-forløb paces uden for den semantiske
turn-timeout. Før en toolsideeffekt frigives, reserveres nu den afsluttede responses
eksakte gentagne input/outputkontekst plus højst 2 KiB værktøjsresultat, 1.024 nye
outputtokens og 512 tokens protokol-/specialtokenmargin; utilstrækkelig capacity giver
nul `ToolCall`. Under den eksklusive
diagnostik kan en response-start med 14k remaining derfor fortsætte, når den konkrete
kausale opfølgning faktisk kan rummes; der simuleres ikke samtidig fysisk headroom. Den
beregnede full-profile-deadline
omfatter alle 11 mulige inter-turn-resetkanter, ikke kun nye sockets. Proben rapporterer
actual usage/pris separat fra de semantiske evalture og ellers sit konservative
2k/$0,128-makspris-loft. Hver semantisk tur har desuden et mekanisk loft på tre
providerresponser; en tredje tool-loopkant stoppes før ny fixtureeffekt eller en fjerde
Response. Full-profile har dermed 36 mulige responsekanter, men et prospektivt $5-loft
stopper før næste tur. En custom prompt over 32 KiB blokerer kun live-eval før
diagnostiklås/socket; produktionsprompten ændres byte-identisk.

Replayets særskilt fakturerede `gpt-live-transcribe` reserveres nu fra eksakt
PCM-varighed × lydgentagelser til $0,017/minut før diagnostiklås/socket. Det vises som
`transcription_budget` og indgår i samme $5-loft; tekstkontrollen koster ingen
transskription. Produktionsmåleren lægger konservativt faktisk videresendt
mikrofonvarighed til som en særskilt post, exactly once ved teardown.

Web-routingens oracle kræver nu både den kanoniske
`google_web_sogning(query="FCK seneste kamp")` og fixtureudfaldet `ok`. Et afvist kald
med forkerte argumenter kan derfor ikke blive grønt, selv hvis modellen bagefter
hallucinerer det forventede 2-0-svar.

Den gamle `eval_harness --live`-CLI er pensioneret: den kunne ikke levere det eksakte
frosne produktionsværktøjssnapshot, som den korrekte admission kræver. Den fejler nu
struktureret før service, budgetlease og provider-socket; live-preflight kan kun startes
fra add-on-panelets autentificerede Test-fane.

Den seneste fokuserede gate er **275/275 grøn** for providerbudget, rå Realtime,
eval/probe, tool-commit, Voice PE-/Talk-diagnostic teardown, UI-kontrakt og settings-
regressioner. Den separate HA/Thin/Realtime-gate er **300/300 grøn**, og den brede
lokale suite gav **726 grønne** tests; kun to console-tests blev blokeret af sandboxens
forbud mod localhost-bind. Ruff, formattering, scoped mypy og diff-check er grønne.
Uafhængig slutreview finder nul kendte P0/P1 og scorer den lokale kandidat **93/100**.
Den komplette socket-aktiverede CI-suite, ARM64-image og live-feltbevis står fortsat
åbent. Den
installerede v1.13.28 er feltfejlet og må ikke genbruges som bevis for korrektionen.

Headroom-/overtagelsesadfærden i dette historiske delresultat er efterfølgende afvist:
en allerede startet providerrespons kan have brugt pladsen, før lokal kode kan afbryde
den. Den aktuelle kandidat skal derfor erstatte den med den dokumenterede eksklusive
diagnostiklås. De tidligere 135/135- og 681/681-tal godkender ikke denne efterfølgende
kontraktændring; den fokuserede gate ovenfor er stadig ikke live- eller fysisk bevis.

#### Samlet maskinelt resultat for v1.13.27-kandidaten

- Providerens `function_call_arguments.done` er kun staging. Først en korreleret
  `response.done(status=completed)` registrerer hele batchen atomisk, og en eksakt
  `ToolRoundComplete(response_id=...)` må frigive den. Cancelled, failed, incomplete,
  ukendt status, malformed JSON/schema, duplicate/late call-id og manglende commit giver
  nul dispatch og nul semantisk close.
- `session.updated` er readiness-grænsen. Preconnect-lyd tømmes i rækkefølge, og tool-
  output, `response.create`, clear og truncate har generationbundne event-id'er, ACKs,
  fejlkorrelation og watchdogs.
- `ExecutionPolicy` validerer og autoriserer uafhængigt af prompten. Følsomme handlinger
  bliver serverholdte challenges og kan kun udføres én gang efter en klar beslutning på
  den umiddelbart næste tur i samme session. Ændrede argumenter, session, tur, udløb,
  replay eller et andet input fejler lukket. En højrisikohandling plus afslutning holder
  samtalen åben; en godkendt lavrisikohandling udføres før farvel.
- HA-mutationer bruger frisk, autoritativ målresolution. Det mål, der autoriseres, er
  det samme eksakte entity-id, der dispatches. Områder, navne, klima, private læsninger,
  inverse lock/cover/valve-handlinger og argument-smuggling har særskilte regressions.
- Eval bruger de samme reserverede deklarationer, resultatformater, approval-policy og
  commitgrænser som produktion, men faste sideeffektfrie fixtures. Rapporten skelner
  effektivt evalschema, produktionsschema og reserved-kontrakten.
- Uafhængig adversarial review efter grøn ARM64-CI: **95/100**, fordelt 25/25
  providerfinalitet, 29/30 autorisation/HA, 19/20 ACK/readiness/budget, 15/15
  lifecycle/adapters og 7/10 releaseevidens. Der er nul kendte P0/P1; live Prompt V6-
  eval på de eksakte produktionsdeklarationer er sidste maskinelle gate til 97/100.
- Endelig maskinel gate på commit `47100d7`: **622/622 tests**, Ruff, formattering,
  mypy og diff-check grønne lokalt og i CI; GitHub byggede desuden add-on-image til
  `linux/arm64`. Det er nødvendigt softwarebevis, ikke live/fysisk releasegodkendelse.

### Historiske releaseblokkere — maskinelt lukket i v1.13.27-kandidaten

Punkterne nedenfor beskriver de fejl, auditten fandt i v1.13.26. De er bevaret som
årsags- og regressionshistorik, men er **ikke** aktuelle P0/P1-fund i den nye kandidat.
Completed-gaten, serverautorisationen, korrelerede ACKs, streng status/schema-validering
og det fælles providerbudget er nu dækket af rå eventpermutationer og den samlede suite.

1. **P0 — et annulleret eller ufuldstændigt modelsvar kan nå at udføre et værktøj.**
   PodVoice sender i dag `response.function_call_arguments.done` direkte videre til
   `ThinSession` og værktøjsrouteren. OpenAI dokumenterer, at eventet også udsendes,
   når en respons afbrydes, bliver ufuldstændig eller annulleres; det autoritative
   slutpunkt er den altid udsendte `response.done`, hvis `status` skal være
   `completed`. Den senere oprydning kan ikke fortryde en allerede udført HA-handling
   eller semantisk afslutning. Kald skal derfor stages per `response_id` og må først
   frigives efter en completed `response.done`; alle andre statusser kasserer dem.
2. **P0 — følsomme handlinger har kun promptbeskyttelse.** Prompten kræver bekræftelse
   før blandt andet oplåsning, alarm fra, beskeder og køb, men routeren kan udføre et
   deklareret HA-/MCP-kald uden et server-ejet approval-token. OpenAI beskriver netop
   function tools som stedet, hvor applikationen ejer forretningslogik,
   adgangskontrol og approval checks. Der kræves en deterministisk, sessions- og
   argumentbundet godkendelsesbarriere i applikationen; prompten må kun eje den
   naturlige dialog, aldrig selve tilladelsen.
3. **P1 — causalt vigtige WebSocket-operationer mangler kvittering og korrelation.**
   Typed Talk-input venter allerede korrekt på sit præcise item-ACK. Tool-output,
   `response.create`, `conversation.item.truncate`, input-clear og flere øvrige
   operationer har derimod intet klient-`event_id`, og tool-output anses for leveret,
   før `conversation.item.created` bekræfter det. En providerafvisning bliver dermed
   ofte kun en loglinje og senere timeout. Samme ACK/error-kontrakt skal gælde alle
   operationer, der kan ændre tur, værktøjsresultat eller samtalekontekst.

### Dokumenterede P1/P2-fund

- Ugyldig JSON i funktionsargumenter bliver til `{}` og dispatches. Protokol- eller
  schemafejl skal fejle lukket med nul sideeffekter.
- OpenAI-readiness publiceres ved socket-connect, før `session.updated` har bevist den
  effektive konfiguration. UI og traces skal skelne socket, `session.created` og
  accepteret `session.updated`.
- Providerens `rate_limits.updated` ignoreres. Eval bruger et lokalt Tier-1-budget,
  som ikke koordineres med fysiske sessioner eller øvrig projekttrafik.
- `response.done` uden officiel status behandles som completed af hensyn til gamle
  fakes. Produktion skal fejle lukket på manglende/ukendt status; fakes skal følge den
  officielle kontrakt.
- Diagnostiske inputtranscripts mister `item_id`; OpenAI garanterer ikke completion-
  rækkefølge på tværs af ture. Det kan forvride historik og bevis, men transcriptet
  ejer fortsat hverken værktøjsvalg eller semantisk afslutning.
- Replay bruger lokal event-modtagelsestid som lydgrænse og kasserer OpenAIs
  autoritative `audio_start_ms`/`audio_end_ms`. Derfor er eksisterende replay kun
  diagnostik, ikke årsags- eller releasebevis.
- Den viste pris mangler den separat fakturerede live-transskription. Langvarige
  sessioner har desuden ingen eksplicit målt context-/truncation-politik.
- Timer- og dynamiske MCP-schemas valideres ikke tilstrækkeligt server-side. Modellen
  understøtter function calling, men ikke Structured Outputs; schemas er derfor ikke
  en erstatning for runtimevalidering.

### Det, der er korrekt og skal bevares

- Backend-WebSocket, 24 kHz mono PCM16, `output_modalities=["audio"]`,
  `gpt-realtime-2.1`, lav reasoning, automatisk tool choice og sessionslængden under
  OpenAIs 60-minuttersgrænse er gyldige valg.
- `session.updated` bruges allerede til at frigive buffered audio og typed input;
  fejlen er readiness-påstanden omkring det, ikke selve bufferingen.
- Voice PE's `interrupt_response=false` er en bevidst og korrekt half-duplex-kontrakt.
  Talk stopper lokal afspilning og bruger truncate ved barge-in som foreskrevet for
  WebSocket-klientstyret playback.
- Inputtransskriptionen er korrekt behandlet som asynkron diagnostik og ikke som det,
  den native audiomodel nødvendigvis hørte.
- Den normale tool-resultatsekvens — `function_call_output` med samme `call_id`,
  derefter én `response.create` — følger API'et; den mangler blot ACK/error-sikkerhed.

### Oprindelig gate efter auditten — gennemført maskinelt

Completed-bundet tool-staging, server-ejet approval, event-ID/ACK-fejlgrænser,
provider-sand readiness og et fælles rate-limitbudget er nu implementeret og maskinelt
testet. Den næste bindende gate er derfor ikke mere kode på disse hypoteser, men
reproducerbar releaseevidens: add-on-image, live Prompt V6-eval og fysisk Voice PE.
Audio-replay/proveniens er fortsat et separat uløst diagnosespor. Promptens almindelige
adfærd, gain, VAD, firmware og playback må fortsat ikke ændres for at maskere det.

## Historisk feltstatus 21. august

Den installerede v1.13.25 registrerede efter en manuel Voice PE-genstart en rigtig
fysisk wake kl. 09.57.53. Realtime-socketen nåede `provider_connected` efter 1.341 ms,
men lukkede 116 ms senere som den generiske `error:connection`. Den faste fejllyd blev
fysisk afspillet, teardown gennemførte én gang, og firmware kvitterede `wake_rearmed`
83 ms efter playback-finish. Pucken og wake-motoren var dermed operationelle igen;
prøven fejlede i providerleddet og tæller ikke som golden chain.

Brugeren identificerede samtidig en sandsynlig manglende OpenAI-saldo. v1.13.25
bevarede ikke den præcise providerfejlkode i status og kunne derfor ikke skelne
`insufficient_quota` fra 429, ugyldig nøgle eller netværksbrud. Årsagen må ikke kaldes
endeligt bevist ud fra den generiske trace alene.

Efter saldoen var genoprettet gennemførte v1.13.25 en ny fysisk tur. Wake, én
Realtime-session, fysisk playback, ekkogate, idle-close og wake-rearm fungerede;
rearm kom 95 ms efter close-request. Inputtet blev imidlertid observeret som
“Åh, bagklappen”, og Realtime forsøgte derfor korrekt ud fra sin opfattelse at sætte
køkkenhøjttaleren på pause. Brugeren havde muligvis holdt en pause efter wakefrasen.
Turen beviser provider- og lifecycle-recovery, men ikke korrekt same-breath-input og
tæller hverken som golden chain eller som grundlag for gain-/VAD-tuning. Næste fysiske
prøve skal have armeret device- og providerlyd og én naturlig ytring uden kunstig pause.

Den aftalte, pausefri prøve kl. 10.32 blev optaget som trace
`20260821T103257-225` og **fejlede også golden chain**. Den diagnostiske
transskription var denne gang ordret “Hvad er klokken?”, men Realtime kaldte intet
værktøj og svarede irrelevant, at den ikke kunne række eller flytte ting i den
fysiske verden. `session.updated` var accepteret med `gpt-realtime-2.1`, dansk
transskription, Prompt V5 og responsive VAD. Den mekaniske kæde bestod: playback
startede 2.750 ms efter speech-stop, playback-finish frigav ekkogaten, idle-close
gennemførte, og wakeword blev rearmet efter 91 ms. Device- og provider-sporet havde
samme peak på 29,06 %, nul clipping og et ordret diagnostisk input; det er ikke i sig
selv et lyttebevis for den native audiomodel.

Umiddelbart efter bestod den isolerede, sikre Realtime-preflight alle fire scenarier
med samme model og Prompt V5, herunder `Hvad er klokken?` →
`get_time(fields=["time"])`, tidsopfølgninger, web-routing og semantisk afslutning.
Det placerer fejlen i den fysiske audio-native beslutning eller den konkrete lyd, som
Realtime modtog — ikke i en generelt manglende `get_time`-deklaration. Preflighten
brugte dog den daværende reducerede sikre eval-liste og udelukker derfor ikke overload
eller konkurrence i hele produktionsskemaet. Prompt, gain, VAD og lifecycle må ikke
ændres ud fra denne ene tur.

v1.13.26 er den afgrænsede statuskandidat. Den bevarer providerens seneste fejlkode,
klassificerer saldo/kredit, rate-limit, nøgle, timeout og forbindelse separat og sender
ændret årsag live til panelet, selv når servicefarven er uændret. Voice PE viser separat
offline, forbundet/afprøves og fysisk wake-klar. Kandidaten lukker desuden en gammel
konfigurationsrest: fysisk Voice PE er nu ubetinget half-duplex ved både settings-,
config- og buildergrænsen; kun Talk-adapteren kan vælge browser-duplex. Den ændrer ingen
prompt, model, værktøjsrouting, gain, VAD, firmware eller playbacksekvens og kræver ingen
firmwareflash. Kandidaten tilføjer en isoleret diagnose: seneste provider-WAV kan
genafspilles tre gange i friske Realtime-sessioner sammen med en tekstkontrol. Alle fire
kørsler eksponerer den aktive prompt, rumkontekst og hele produktionsskemaet, men bruger
en sikker lokal værktøjsrouter uden HA-, MCP- eller PodConnect-sideeffekter. Nye traces
gemmer samplegrænser og værktøjsskema-hash; den eksisterende
`20260821T103257-225`-trace kan kun bruge den eksplicit markerede legacy-estimering for
første tur. Kandidaten er maskinelt grøn med 509 tests, Ruff, formatkontrol, mypy og
panel-script-parsing. GitHub CI's ARM64 add-on-containerbuild er grøn; kun en ekstra
lokal Docker-containerbuild blev ikke kørt, fordi den lokale Docker-motor var stoppet.

## Officiel milepæl

**v1.13.11 er PodVoices første fysisk virkende half-duplex-version.**

Den betegnelse betyder præcist, at én frisk Voice PE-kæde har gennemført:

```text
wake
  → én Realtime-session
  → korrekt første svar
  → korrekt opfølgning i samme session
  → GPT Realtime valgte end_conversation på “Tak, det var alt”
  → “Farvel” blev fysisk afspillet
  → én teardown og wake-rearm (~99 ms)
  → en ny wake åbnede en ny Realtime-session
```

Det er den første evidens for, at grundarkitekturen virker i rummet — ikke bare i Talk,
en fake eller CI. Den tidligere serie af døde wake-låse og frasebaserede lukninger er
dermed ikke længere den gældende arkitektur.

Den samme trace havde dog en diagnostisk inputtransskription på “Bag” for første
tidsforespørgsel. Realtime valgte alligevel det rigtige tidsværktøj og gav det rigtige
svar. Milepælen beviser derfor lifecycle-kæden og en fungerende fysisk samtale, men **ikke**
stabil ord-/intentgenkendelse. Den må aldrig bruges som lydkvalitetsbaseline alene.

## Hvad betegnelsen ikke betyder

| Niveau | Status |
|---|---|
| Én fysisk golden chain | **Bestået på v1.13.11** |
| Automatisk lifecycle-gate, 10/10 | Bestået i tests; skal altid genkøres på kandidat |
| Fysisk Voice PE-gate, 10/10 ubrudt | **Mangler; daværende fysisk bevis er 1/10** |
| Svartid p90 ≤ 2,5 s | Ikke bevist; de seneste ture ligger omtrent 2,3–2,9 s |
| Fuld funktionsmatrix | Ikke godkendt |
| 7 døgn + Gemini/Alexa-benchmark | Ikke gennemført |

Vi må derfor sige “første virkende version”. Vi må endnu ikke sige “release-godkendt
10/10”, “færdigt produkt” eller “bedre end Gemini/Alexa på alt”.

## Den shippede produktionsvej

```text
Voice PE firmware
  → VoicePELink
  → ThinSession
  → OpenAI Realtime + eksponerede værktøjer
  → ReplyBus/FLAC announcement
  → firmware playback_started/playback_finished
  → atomisk teardown
  → fysisk wake-rearm
```

Voice PE er half-duplex. Talk bruger samme `ThinSession`, men browserens full-duplex I/O
er kun software-/providerdiagnostik og ikke fysisk puckbevis. Classic, stock HA Assist og
direct PCM er ikke produktionsveje.

## Kandidat- og evidenshistorik

v1.13.12 er truth-hardening oven på den beviste v1.13.11-baseline. Den gør mislykket
mic-start/-stop synlig, venter på fysisk fejllyd, binder stopmålinger og historik til
sessionen, rydder alle lydspor og forbyder netværks-TTS i et mekanisk farvel-fallback.
Kandidaten er publiceret på `main` med grøn CI og kræver kun add-on-opdatering, ikke en
firmwareflash. Den fejlede den fysiske prøve `20260819T123836-240`: første ytring blev
observeret som “Nu er klokken”, næste ytring var tom, og Realtime gav derfor to forkerte
svar. Playback, idle-close og wake-rearm gennemførte korrekt. Samme kanal, gain, VAD,
støjvalg og firmware var aktive som i den tidligere prøve, og 1.13.12 ændrede ikke prompt,
transskriptionsmodel eller audio-forwarding. Fejlen er derfor foreløbig klassificeret som
**ustabil fysisk inputforståelse**, ikke som bevist lifecycle-regression.

v1.13.12 erstatter ikke den officielle baseline. Ingen feature-, latency- eller UI-udvikling
fortsætter, før inputfejlen er forklaret, en frisk golden chain består uden tomt eller
semantisk afvigende input, og derefter 10 ubrudte fysiske cyklusser består.

v1.13.13 er den næste softwarekandidat. Den erstatter den overlappende 1.13.12-prompt
med Prompt V2, tilføjer et provider-neutralt og mekanisk tavst `wait_for_user`-signal
for baggrundstale og binder tavse værktøjsrunder til præcis session, tur og kald. Den
ændrer ikke firmware, gain, VAD, pre-roll, mic-gate, playback eller wake-rearm. Grøn CI
er kun softwarebevis; kandidaten overtager først den officielle baseline efter den
samme friske golden chain og den efterfølgende ubrudte 10/10-gate.

Den fysiske V2-prøve `20260819T145100-102` bekræftede
`prompt_source=default`, `prompt_version=2`. Klokkeslæt og opfølgende ugedag var
korrekte i samme Realtime-session. Første klare “Tak, det var alt for nu” blev dog
fejlroutet til det forrige `get_time`-værktøj og gentog “Det er onsdag”. Ved andet
forsøg valgte modellen korrekt `end_conversation`, men OpenAI Tier-1 ramte 40.000 TPM,
da næste respons forsøgte at reservere 5.521 tokens. Den cachede “Farvel”-fallback blev
fysisk afspillet, close gennemførte én gang, og wake blev rearmet efter cirka 99 ms.
Trace viste bagefter en falsk `missing-start-or-finish`, selv om både playback-start og
-finish allerede var bevist. Prøven er derfor **ikke** en bestået golden chain, men den
beviser, at V2 var aktiv, at inputtet var forståeligt, og at fallback/lifecycle kom hjem.

v1.13.14 afgrænsede `get_time` til den seneste
brugerturs faktiske tids-/datohensigt, styrker den semantiske wrap-up-routing uden
frasematching, sætter Realtime `max_output_tokens=1024`, fjerner watchdoggens falske
playback-fault efter et bevist start/slut-par og gør rød fejl-LED midlertidig. Efter
fejllyd, teardown og fysisk rearm går ringen tilbage til mørk IDLE. Kandidaten ændrer
ikke firmware, gain, VAD, pre-roll, mikrofonport eller half-duplex-ejerskab.

Den fysiske v1.13.14-prøve `20260819T153836-401` havde ren lyd, korrekt klokkeslæt og
korrekt opfølgende ugedag i samme Realtime-session. Den klare afslutning “Tak, det var
alt for nu” blev også transskriberet korrekt, men GPT sagde “Selv tak, det var så lidt!”
uden at kalde `end_conversation`. Playback sluttede normalt; samtalen lukkede først på
idle-fallback cirka 7,3 sekunder senere. Det var derfor en semantisk beslutningsfejl,
ikke en mikrofon-, gain-, playback- eller wake-fejl.

v1.13.15 krævede én eksplicit
Realtime-beslutning: domæneværktøj for handling/opslag, `continue_conversation` for
direkte svar eller opklaring, `end_conversation` for afslutning eller `wait_for_user`
for ikke-henvendt tale. En maskinel live Talk-prøve stoppede kandidaten før fysisk test:
første tekst kunne forsvinde, når provider-opkoblingen tog længere end en fast 300 ms
ventetid, og Realtime kunne vælge `continue_conversation`, sige “Lad mig lige regne det
kort igennem” og aldrig levere svaret 84. Kandidaten er derfor ikke testklar.

v1.13.16 lod Talk vente på den virkelige provider-ready-grænse før første tekst blev
sendt. `continue_conversation` blev ændret til en
mekanisk to-respons-kontrakt: beslutningsresponsens lyd kasseres, det interne resultat
registreres, og præcis én efterfølgende respons med `tool_choice=none` skal levere hele
svaret. Dermed kan svaret hverken erstattes af en mellemreplik eller starte en ny
lifecycle-loop. Promptversionen er 4. Firmware, gain, VAD, pre-roll, mic-gate, playback
og wake-rearm er uændrede.

Den maskinelle live-preflight den 20. august stoppede v1.13.16 før fysisk test. Efter en
frisk Talk-forbindelse gav direkte matematik et fuldt svar efter
`continue_conversation`, tids-/ugedagsværktøjet virkede, semantisk afslutning kaldte
`end_conversation` én gang, og en ny samtale kunne åbnes efter lukning. En naturlig
matematisk opfølgning brugte dog kun den sikkert etablerede kontekst i én af to gyldige
gentagelser. Desuden viste en gammel Talk-socket fortsat "online", selv om den første
tekst aldrig nåede `ThinSession`, og browseren kunne vise/rydde tekst under afslutning,
før serveren havde accepteret turen. Talk kalder i denne kandidat stadig
`brain.send_text()` direkte og undertrykker sendefejl; den skrevne vej ejer derfor ikke
en autoritativ `ThinSession`-tur og kan ikke bruges som releasebevis.

v1.13.16 har dermed bevist, at den nye to-respons-mekanik kan levere et komplet svar,
men **live-preflighten er ikke bestået, og fysisk golden chain må ikke startes på denne
kandidat**. Den næste kandidat skal først indføre fælles tur-ejerskab, serverkvittering,
korrelerede session-/tur-/playback-id'er og sand forbindelsesstatus. Prompt V4,
firmware, gain, VAD og lydkæde fryses under denne mekaniske rettelse. v1.13.11 forbliver
den officielle fysiske baseline.

v1.13.17 blev bygget grønt i CI, installeret og kørt mod den rigtige Realtime-provider
den 20. august. Preflighten stoppede korrekt før fysisk test: `session.updated` blev
accepteret, men OpenAI afviste det første tekst-item med `string_above_max_length`, fordi
PodVoice dannede `pv_` plus 32 hashtegn — 35 tegn i alt mod providerens maksimum på 32.
Der blev ikke oprettet noget modelsvar. Fejlen er dermed transportmekanisk og har intet
med dansk, prompt, TPM, gain eller Voice PE at gøre. **v1.13.17 er ikke testberettiget.**

v1.13.18 rettede item-længden og blev installeret den 20. august. Realtime accepterede
`session.updated`, og der kom ingen item-afvisning, men preflighten stoppede med
“OpenAI did not acknowledge the typed conversation item”. Den efterfølgende
protokolaudit fandt årsagen: providerlaget ventede kun på den ældre
`conversation.item.created`, mens den aktuelle GA-protokol sender
`conversation.item.added` for et klientoprettet item. Der blev fortsat ikke oprettet et
modelsvar. **v1.13.18 er derfor ikke testberettiget.**

v1.13.19 blev installeret og live-preflightet den 20. august. GA-kvitteringen virkede:
matematikken gav 84 og opfølgningen 90; tid og opfølgende ugedag var også korrekte.
Rapportens promptidentitet afslørede dog, at den aktive prompt var en nøjagtig kopi af
den gamle Prompt V2, ikke den indbyggede V4. De to gennemførte scenarier brugte 28.700
tokens, hvorefter semantic-close og web-routing blev startet uden pause tæt på kontoens
40.000 TPM-vindue og timede ud uden en gyldig semantisk dom. De to fejl må derfor ikke
klassificeres som produktfejl eller bestået evidens. **v1.13.19 er ikke testberettiget.**

v1.13.20 var den foregående softwarekandidat. Alle egne og normaliserede Realtime-
item-id'er er nu præcis højst 32 tegn, og en eksplicit itemafvisning fejler øjeblikkeligt
uden `response.create`. Providerlaget accepterer både den aktuelle
`conversation.item.added` og den ældre kompatibilitetsevent. Hvert create-kald har et
korreleret `event_id`, så en uvedkommende recoverable providerfejl ikke kan afvise den
ventende tur. Den tidligere audit fandt og lukkede desuden tre nærliggende sandhedshuller:
preflighten bruger nu faktisk gemt prompt, effektive model og stemme; rapporten bærer
promptkilde/version/hash og tool-schema-hash; og Talk afviser ubundet tekst- eller
command-id-længde før wake/provider. Eval-oraklets tid- og sportskrav er desuden gjort
strengere, så en tvetydig delstreng eller forkert kampretning ikke kan give falsk grøn.

Den præcise gamle V2-hash migreres nu til V4 ligesom andre gemte standardprompter;
egentlige brugerændringer bevares. Preflighten holder et konservativt 30.000-token
rullende vindue, reserverer 10.000 TPM til almindelig brug og viser sin automatiske
rate-limit-pause. Total-run-budgettet er 80.000 tokens og $0,25, så fire friske scenarier
kan fordeles over flere minutter uden at blive fejldiagnosticeret som semantikfejl.

Den 20. august består kandidaten lokalt med **476 tests**, inklusive reelle lokale
HTTP/WebSocket-tests, plus Ruff, formatteringskontrol og mypy for 39 kildefiler. Prompt
V4, firmware, gain, VAD, pre-roll og fysisk half-duplex er uændrede. v1.13.20 nåede
live-preflight, men leverede ikke en bevaret slutrapport og blev derfor aldrig fysisk
testklar.

1.13.20's installerede preflight gav ikke en gyldig slutrapport. Den fler-minutters
evaluering blev holdt inde i ét Ingress-HTTP-kald; et efterfølgende request så den
stadig aktive serverkørsel og panelet erstattede den med “kører allerede”. Det er en
jobtransportfejl, ikke bevis for bestået eller fejlet semantik.

v1.13.21 var den foregående softwarekandidat. Preflighten ejes nu af add-on-processen
som et baggrundsjob med fast id og bevaret resultat. Panelet starter én gang og poller;
reload, midlertidigt nettab eller et genforsøg kan ikke annullere jobbet eller starte en
parallel kørsel. Provider-connect har et otte-sekunders loft, hele jobbet et
femminutters loft, og alle åbne evalressourcer lukkes også ved tidlig opkoblingsfejl og
add-on-stop. TPM-softgrænsen er 25.000, så 15.000 tokens holdes fri til én målt normal
PodVoice-session. Kandidaten ændrer ikke prompt V4, firmware, gain, VAD, pre-roll,
mic-gate, playback eller wake-rearm. Den er først fysisk testberettiget efter grøn CI,
installation og en fuld bevaret live-rapport med `prompt_source=default` og
`prompt_version=4`. Lokalt er **484 tests**, alle 10 panel-scripts, Ruff,
formatteringskontrol og mypy for 39 kildefiler grønne; de reelle lokale
HTTP/WebSocket-tests blev kørt uden sandboxens portblokering.

Den installerede 1.13.21-preflight `eval-1787221960-a23d2f` overlevede en reel
panelreload og bevarede hele slutrapporten. Den brugte `gpt-realtime-2.1`, den
indbyggede Prompt V4 med hash `84ff3a0c…`, syv provider-kvitterede ture og 52.165
tokens med 163 sekunders automatisk TPM-pause. Matematik/opfølgning, tid/ugedag og
semantisk afslutning bestod. Web valgte korrekt `google_web_sogning` og svarede “FCK
vandt 2-0”, men oraklet krævede de bogstavelige talord “to” og “nul”. Rapportens eneste
røde tur var derfor en dokumenteret falsk negativ, ikke en produktfejl.

**v1.13.22 var den senest installerede softwarekandidat.** Web-oraklet accepterer den korrekte
FCK-sejr med cifre eller danske talord, men bevarer vinderretningen, så et omvendt
resultat stadig fejler. Panelet viser desuden den præcise finding under hver rød tur.
Produktionsprompt, model, tool-kontrakt, Voice PE-firmware og lifecycle er byte-/logisk
uændrede. Lokalt er **486 tests**, Ruff, formatteringskontrol, mypy for 39 kildefiler
og alle 10 panel-scripts grønne; de reelle HTTP/WebSocket-tests er kørt uden
sandboxens portblokering. CI-kørsel `32360366628` bestod både testjob og ARM
add-on-build, og 1.13.22 er installeret og kører i Home Assistant.

Den installerede preflight `eval-1787222997-bf8511` bestod **4/4 scenarier og 7/7
ture** på `gpt-realtime-2.1` med den indbyggede Prompt V4. Den beviste matematik og
opfølgning, tid/ugedag, almindelig høflighed uden falsk lukning, modelsemantisk
afslutning og korrekt web-routing/svar. Rapporten brugte 52.255 tokens, estimeret
$0,078 og 162 sekunders automatisk TPM-pause. Den efterfølgende rigtige Talk/Thin-test
bestod 84 → opfølgning → 90 i samme session, semantisk Farvel/lukning og et nyt
klokkesvar i en frisk session. En indledende prøve med faste browserpauser nåede at
ramme idle-fallback og åbnede derfor en ny session; den tæller ikke som produktfejl og
dokumenterer, at automatiske Talk-tests skal vente på serverevents frem for faste
sekunder.

Kandidaten blev dermed **maskinelt adgangsgodkendt til én fysisk golden chain**, men den
fysiske prøve `20260820T131337-909` afviste den. Voice PE observerede korrekt “Hvad er
tolv gange syv?”, hvorefter Realtime først kaldte det obligatoriske
`continue_conversation` og den tvungne anden respons svarede “7 gange 7 er 49.” På
opfølgningen kaldte Realtime `end_conversation`, før den asynkrone diagnostiske
transskription “Læg sekste.” ankom, og sagde “Farvel, vi tales ved.” uden en reel
afslutningshensigt. Fysisk playback, én teardown og wake-rearm på 98 ms virkede, men
semantikken fejlede. **v1.13.22 er derfor fysisk afvist og ikke testklar.**

**v1.13.23 er den senest installerede, men nu maskinelt afviste kandidat.** Den fjerner den obligatoriske
fortsættelsesbeslutning og den tvungne to-respons-vej. Realtime bruger automatisk
værktøjsvalg: direkte spørgsmål besvares i én respons, domæneværktøjer bruges kun ved
behov, og `end_conversation` forbliver den eneste modelsemantiske lukningsautoritet.
Firmware, gain, VAD, pre-roll, half-duplex, playback og rearm ændres ikke i denne
kandidat. Lokalt er 483 tests, Ruff, formatteringskontrol og mypy for 39 kildefiler
grønne. Commit `f64e526` er pushed til `main`; CI-kørsel `32364539944` bestod både
testjob og ARM add-on-build, og 1.13.23 er installeret og kører i Home Assistant.

Den installerede live-preflight `eval-1787226288-e7a8d8` bestod **4/4 scenarier og
7/7 ture** på `gpt-realtime-2.1` med `prompt_source=default`, Prompt V5 og prompt-hash
`a94586b7…`. De direkte regneture svarede 84 og derefter 90 i samme session med tomme
værktøjsbeslutninger og uden ekstra modelrespons. Tidsopslaget brugte `get_time`, mens
ugedagsopfølgningen genbrugte resultatet direkte i samme session. Almindeligt “Tak”
holdt samtalen åben; den klare afslutning kaldte præcis `end_conversation` og lukkede.
FCK-spørgsmålet brugte `google_web_sogning`. Rapporten brugte 35.104 tokens, estimeret
$0,091 og 107 sekunders automatisk TPM-pause. Første modellyd lå på 861–1.112 ms for de
direkte og lokale ture; web lå på 2.802 ms. Dette er browser/provider-evidens, ikke
fysisk Voice PE-playback.

En efterfølgende rigtig Talk/Thin-kæde fandt en deterministisk playback-race og stoppede
fysisk test. Providerens svar var færdiggenereret kl. 14:00:37.126, browserens playback
startede først 859 ms senere, men den gamle faste 500 ms-regel havde allerede åbnet næste
tur. Da det gamle svar sluttede under den nye `get_time`-tur, blev slut-eventet anvendt
på globale felter og afkortede det nye svar. Det er en lifecycle-/playbackfejl, ikke en
prompt-, model-, gain-, VAD- eller danskfejl. **1.13.23 er derfor ikke testklar.**

**v1.13.24 er den installerede, maskinelt beståede kandidat.** Den erstatter tidsreglen med én playback-
lease per svar, bundet til session, tur, output-item og playback-id. Ny brugerlyd og
skrevet input forbliver gated gennem ventet start, fysisk afspilning og ekkohale. Kun
matching start→finish kan åbne opfølgningen; stale, dublerede, omvendte og manglende
events kan ikke ændre en nyere tur. Manglende start genprøver samme lease én gang og
lukker derefter rent. Talk håndhæver samme id/rækkefølge, og fysiske traces bærer nu
session-/tur-/playback-id, så oraklet kan afvise krydset ejerskab.

Lokalt er **489 tests** grønne, inklusive reelle HTTP/WebSocket-tests uden sandboxens
portblokering. Ruff, formatteringskontrol og mypy er grønne. Commit `12c2eed` er pushed
til `main`, og CI-kørsel `32370186433` bestod både testjob og ARM add-on-build.
v1.13.24 blev derefter installeret i Home Assistant den 20. august 2026.

Den installerede Talk/Thin-preflight bestod en serverkvitteret sammenhængende kæde:
15 + 27 gav 42; opfølgningen “gang resultatet med to” gav 84 i samme Realtime-session;
`get_time` gav korrekt dato, og ugedagsopfølgningen genbrugte konteksten og svarede
torsdag. `end_conversation` blev kaldt præcis én gang, farvel blev afspillet og sessionen
lukket; en efterfølgende regnetur åbnede en frisk session og svarede korrekt. Talk viste
først klar efter de korrelerede browser-playback-events. En indledende ugyldig prøve,
hvor testdriveren ventede cirka 20 sekunder på grund af versalfølsom tekstmatching og
dermed ramte den normale idle-timeout, er kasseret og tæller ikke som produktfejl.

Dette er stærk browser/runtime-evidens, men ikke fysisk Voice PE-bevis. Kandidaten er
derfor først klar til den korte fysiske golden chain; den er ikke lifecycle-
releasegodkendt, før samme bits derefter består 10/10 ubrudte fysiske cyklusser. Prompt
V5, `gpt-realtime-2.1`, firmware, gain, VAD og pre-roll er uændrede.

Den friske fysiske golden chain den 20. august 2026 er **afvist**. Trace
`20260820T165000-859` beviste den nye playback-mekanik: én wake og én Realtime-session,
tre turbundne playback-leases, korrekte start/slut-par, fysisk farvel, én teardown og
wake-rearm efter 99 ms. Opfølgningen nåede provider-kæden komplet og blev diagnostisk
transskriberet ordret som “Og hvilken ugedag er det?”. Realtime kaldte `get_time`, som
returnerede `weekday: torsdag`, men svarede forkert “Det er uge 34.” Golden chain fejler
derfor på semantisk resultatgrunding, selv om lifecycle består. Første turs diagnostiske
tekst var desuden “Backschrauben”, mens native Realtime valgte korrekt tidsværktøj og
svarede med klokkeslættet; denne tur er høre-mæssigt ukendt, indtil device- og
providerlyden er gennemlyttet. En efterfølgende frisk wake gav korrekt dato og lukkede
igen; det ændrer ikke den afviste gate. **Start ikke 10/10 på v1.13.24.**

**v1.13.25 var korrektionskandidaten og er nu installeret.** Realtime ejer fortsat betydning og
værktøjsvalg, men `get_time` kræver nu, at modellen vælger ét eller flere præcise
tidsfelter: `time`, `date`, `weekday` eller `week_number`. Værktøjet returnerer kun de
valgte felter med et fokuseret dansk svargrundlag. Der er ingen lokal ordliste,
frasegenkendelse eller deterministisk hensigtsrouting. Eval-oraklet kontrollerer både
værktøjsnavnet og modellens feltargument og afviser nu eksplicit `week_number` som svar
på en forventet `weekday`. Lyd, Prompt V5, `gpt-realtime-2.1`, firmware, gain, VAD,
half-duplex, playback, teardown og rearm er uændrede. Dens aktuelle fysiske evidens og
afgrænsningen til v1.13.26 står øverst i dette dokument.

Den fulde gate omfatter Ruff, formatteringskontrol, mypy for 39 kildefiler, parsing af
alle 10 panel-scriptblokke og reelle lokale
HTTP/WebSocket-tests. Testmiljøet blev bevidst lagt i `/private/tmp` efter den kendte
Documents/iCloud-låsning af projektets gamle venv.

## Adgangskrav før næste udvikling

1. Før fysisk test skal næste kandidat bestå automatiske regressionssuiter og en rigtig
   live Talk-kæde gennem en serverkvitteret `ThinSession`-tur: direkte matematik →
   opfølgning → tidsværktøj → opfølgning → semantisk afslutning. Første tekst må ikke
   tabes, UI må ikke vise en uaccepteret tur som afleveret, og hver direkte tur skal give
   ét fuldt svar uden lifecycle-værktøj eller ekstra modelrespons.
2. Opdatér derefter add-on til den beståede kandidat og gentag den korte golden chain. Den første klare
   afslutning skal vælge `end_conversation`; de almindelige ture skal svare direkte,
   mens opslag kun må bruge deres relevante domæneværktøj. Et bevist playback-start/slut-
   par må ikke efterfølges af `playback_fault`; afslutningen skal ende med mørk IDLE og
   fungerende wake.
3. Kontrollér at den nye trace fortsat viser `prompt_source=default`,
   `prompt_version=5`, og at Realtime accepterer `max_output_tokens=1024` og
   sessionens automatiske værktøjsvalg. Et korrekt
   svar tæller ikke som bestået, hvis kendt testinput bliver tomt eller semantisk forvansket.
4. Kør 10 ubrudte fysiske lifecycle-cyklusser på samme kandidat. Ingen gain-, VAD-,
   prompt- eller UX-tuning midt i serien.

## Bindende roadmap efter adgangskravet

1. **Udviklingsprioritet 1 — total hastighedsoptimering.** Mål den oplevede fysiske kæde
   fra `speech_stopped` til `playback_started`, og vis hvert delstræk separat. Optimer
   kun den største målte flaskehals ad gangen. Enkle ture skal nå p50 ≤ 1,2 s og p90
   ≤ 1,8 s; stretchmålet er p50 så tæt på 1,0 s som muligt. Eksterne opslag måles
   særskilt, så langsom web/HA ikke skjuler PodVoices egen transporttid. Et earcon eller
   “det tjekker jeg” tæller ikke som første meningsfulde svar.
2. **Udviklingsprioritet 2 — ét diskret “jeg har hørt dig”-signal.** Først når
   latency-gaten er fysisk bestået og låst, må et ca. 80 ms firmwarelokalt signal ved
   `UserSpeechStopped` bygges som en tredje, isoleret mixerindgang. Det må køre parallelt
   med Realtime, aldrig bruge announcement-vejen og aldrig ændre mic-gate, VAD,
   playback-telemetry, ekkoskærm, semantisk lukning eller rearm.
3. **Udviklingsprioritet 3 — automatisk HA/MCP-recovery.** Hvis
   HA-værktøjsforbindelsen fejler, fortsætter
   samtale, tid, web og musik, mens PodVoice forbinder igen. Hjem og vejr bliver
   automatisk aktive igen uden reload eller genstart, og panelet viser den konkrete
   fejl samt recovery-status.
4. **Udviklingsprioritet 4 — fuld fysisk funktionsmatrix.** Dansk, hjem, vejr, web,
   musik, timere og
   opfølgninger køres med de faste antal og korrekthedskrav i `docs/PRODUKTMÅL.md`.
5. **Udviklingsprioritet 5 — samlet UI-gennemgang.** Hele panelet gennemgås funktionelt
   og visuelt på mobil,
   HA-app og desktop: readiness-sandhed, fejlhandlinger, Talk, indstillinger, test,
   historik, dansk sprog, accessibility og browseradfærd skal bestå deres UI-gate.
   Felt-TODO 21. august: Tryk på Voice PE-knappen gav ingen synlig handling, status
   eller fejlfeedback. Kontrollen skal spores fra klik til backend-resultat og altid
   vise udfald; observationen må ikke fortolkes som en wake-/Realtime-fejl.

Derefter følger 7-døgns stabilitet og den målte Gemini/Alexa-sammenligning.

Latency og feedback må ikke udvikles i samme kandidat: først måles og låses den hurtige
baseline, derefter tilføjes feedback som en separat, fuldt reversibel feature. Fuld
duplex, barge-in og nye motorer er ikke en del af denne rækkefølge.
