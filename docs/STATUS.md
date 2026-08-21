# PodVoice-status — én aktuel sandhed

Senest opdateret: 2026-08-21.

## Aktiv lead-beslutning

**Beslutningsejer:** Lead Voice/Reliability Engineer. **Fysisk baseline:** v1.13.11.
**Aktiv softwarekandidat:** v1.13.27 (endnu ikke committed/pushed). **Aktuel gate:**
maskinel kontrakt bestået, men kandidaten er endnu ikke release- eller fysisk
godkendt. Uafhængig adversarial score er **93/100 med nul kendte P0/P1**; de resterende
point kræver live Realtime-eval, add-on-image og fysisk Voice PE-bevis på de samme bits.

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
- **Frosne ikke-mål:** Promptens almindelige V5-adfærd, model, gain 16, VAD, noise, firmware,
  announcement-playback, semantisk afslutning, timeout, teardown og rearm ændres ikke.
- **Faktisk ændring i v1.13.27-kandidaten:** Providerens tool-kandidater frigives kun
  efter en korreleret, completed respons; schemas og ACKs valideres fail-closed;
  følsomme handlinger kræver en server-ejet, næste-tur-bundet engangsgodkendelse;
  HA-mål opløses frisk og dispatches som det samme kanoniske mål; og ét fælles
  providerbudget beskytter tool-resultat/farvel mod TPM-udtømning. Prompt V6 ændrer kun
  den minimale approval-protokol. Audio, gain, VAD, firmware og playback er uændrede.
- **Maskinel evidens:** 622/622 tests, Ruff, format, mypy og diff-check er grønne efter
  seneste budgetfix. CPython 3.12/musllinux-aarch64 kan resolve alle pinned runtimehjul,
  inklusive `jsonschema`; en komplet add-on-containerbuild mangler stadig.
- **Uafhængig review:** NO-GO for replay som beslutningsbevis. De nuværende
  `provider_sample_offset` afspejler tidspunktet, hvor eventet behandles, ikke OpenAIs
  autoritative `audio_start_ms`/`audio_end_ms`; den kendte v1.13.25-trace mangler
  værktøjsskema-hash; og evalens TPM-pacing er ikke koordineret med aktive fysiske
  sessioner. Installation alene er GO som reversibel diagnostik uden firmwareændring.
- **Afvigelse fra planen:** Panelet kan vise et bestået audio-replay, selv når
  `schema_match` er ukendt. Resultatet må derfor ikke bruges til at godkende årsag,
  prompt, lydkæde eller fysisk golden chain.
- **Næste gate:** Commit/push de eksakte kandidatbits, lad ARM64 add-on-image bygge,
  kør den sikre Prompt V6-live-eval, og først derefter én frisk golden chain samt 10/10
  ubrudte fysiske cyklusser. Det gamle replay forbliver diagnostisk og kan ikke godkende
  lydårsagen.
- **Rollback/grænse:** v1.13.11 forbliver fysisk baseline. v1.13.27 overtager ingen
  fysisk gate, før live-eval, image-build, frisk golden chain og 10/10 er bestået.

## Officiel OpenAI-kontraktaudit 21. august

En ny read-only audit har sammenholdt den aktive Realtime-implementation med OpenAIs
aktuelle officielle dokumentation for conversations, server-/client-events, tools,
VAD, transcription, rate limits, costs og GPT-Realtime-2.1. Tre uafhængige reviews er
samlet af lead. **Auditten udvider stop-the-line fra replay til runtime-værktøjssikkerhed.**
Ingen runtimekode, prompt, lyd, VAD eller firmware blev ændret under auditten.

### Aktiv udviklingsbeslutning — providerfinalitet og serverautorisation

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

#### Faktisk delresultat — fælles providerbudget

Det historiske auditfund nedenfor om ignoreret `rate_limits.updated` var korrekt for den
installerede baseline. Den aktive, endnu ikke releasegodkendte kandidat har nu én
procesbred koordinator per envejs-hashet API-nøgleidentitet og model:

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
- Uafhængig adversarial review: **93/100**, fordelt 25/25 providerfinalitet, 29/30
  autorisation/HA, 19/20 ACK/readiness/budget, 15/15 lifecycle/adapters og 5/10
  releaseevidens. Der er nul kendte P0/P1; manglende point er live/image/fysisk bevis.
- Endelig lokal maskinel gate på de aktuelle bits: **622/622 tests**, Ruff, formattering,
  mypy og diff-check grønne. Det er nødvendigt softwarebevis, ikke releasegodkendelse.

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

## Aktuel feltstatus 21. august

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
| Fysisk Voice PE-gate, 10/10 ubrudt | **Mangler; aktuelt fysisk bevis er 1/10** |
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
