# Changelog

## 1.13.48 — gammel mikrofondata kan ikke krydse rearm-grænsen

- Native audio mærkes ved callback-modtagelsen med den aktuelle mekaniske generation.
  Eksakt korreleret `recovered`-ACK avancerer grænsen og dræner allerede køet lyd, før
  ThinSession vækkes; en gammel planlagt callback kan derfor ikke forgifte næste wake.
- Lyd fra den nye generation umiddelbart efter ACK bevares, så same-breath-starten ikke
  klippes. Wrong/fault/duplicate ACK, retry, reconnect og drainfejl er fail-closed.
- Dette er add-on-only. Firmware, gain, VAD, wake, playback, prompt, Realtime-semantik,
  værktøjer, ThinSession og Talk er uændrede.

## 1.13.47 — næste wake får ét ærligt providerforsøg

- En ny production-generation ejer nu den faktisk resterende del af den eksisterende
  15.000-token reservation i stedet for at blive afvist lokalt, blot fordi den rullende
  kapacitet er under hele maksimumreservationen.
- HA/MCP, `end_conversation` og alle andre afsluttede værktøjsforslag forbliver
  fail-closed, indtil den samme generation har autoritativ usage og eksakt kapacitet til
  opfølgningen. Der tilføjes ingen budgetprobe, retry, ekstra socket eller bucket-reset.
- Stale usage fra en lukket generation kan ikke debitere den næste generations
  reservation. Setupfejl, provider-429, duplicate terminalevents og teardown frigiver
  fortsat den eksakte lease højst én gang.
- Dette er en add-on-only ændring. Firmware, wake, gain, VAD, playback, prompt og
  lifecycle er uændrede; den installerede `podvoice_build_11346` er fortsat den krævede
  firmwareidentitet.

## 1.13.46 — fysisk samtaleruntime gendannet fra den beviste 1.13.43-baseline

- Hele den Voice PE-relevante produktionsruntime er gendannet fra exact v1.13.43
  commit `8d4fc9cd521f564a6205359f610ba2761284fc74`: public
  `external_media_player`, samme-session-opfølgning, Realtime-adapter, teardown og
  korreleret detector-reset/rearm.
- v1.13.44/45's private reply-player, playback-token/cancel/drain-state machine og
  provider/playback-hybrid er fjernet samlet. Der er ikke ændret gain, VAD,
  idle-timeout eller prompt i restore-kandidaten.
- Den parallelle produktionssimulator forbliver fjernet. Immutable ESPHome-component-
  pin, maskintrace, hurtig udviklingsgate og konservativ felt-canary bevares som
  ikke-parallel test-/buildinfrastruktur.
- Kandidaten er kun maskinelt testklar. Den skal stadig bevise naturlig opfølgning,
  model-close, én teardown/rearm, næste wake og automatisk Voice PE-forbindelse fysisk.

## 1.13.45 — den private Nabu-player følger igen det fysiske drejehjul

- Drejehjulets `external_media_player`-volume spejles live til den token-isolerede
  `podvoice_reply_player`, også mens et Nabu-svar afspilles.
- Den private player bruger præcis samme increment/min/max som den fysisk virkende
  v1.13.43-player. Ved svarstart udføres volume og media-URL som to separate ESPHome-
  calls, fordi `SpeakerSourceMediaPlayer` ellers returnerer efter URL-handlingen og
  ignorerer volume i samme call.
- Rearm, idle-timeout, gain, VAD, Realtime, prompt, værktøjer og semantik er uændrede.
- Kandidaten skal bestå den korte fysiske rotary/opfølgnings/re-wake-canary. Ved fejl er
  exact v1.13.43 commit `8d4fc9cd521f564a6205359f610ba2761284fc74`
  playback-rollbackgrænsen.

## 1.13.44 — terminale events og fysisk playback bindes til samme svar

- Realtime-events for et allerede terminalt response-id eller et nyt response-id med
  genbrugt request-metadata kan ikke genåbne responsen, sende sen lyd eller transcript
  videre eller blokere den næste tool-result response.
- En almindelig completed respons uden PCM behandles som en uhørt providerfejl og
  åbner ikke opfølgning eller historik. Kun den separat korrelerede semantiske
  afslutningsrespons må lukke stille.
- Hvert Thin-samtalesvar får et proces-randomiseret, monotont token fra Thin-lease
  gennem native API og firmware til en tokenbærende start/finish/fault-ACK. Manglende,
  fremmede, dublerede, out-of-order og gamle ACK'er kan ikke flytte en nyere samtale.
- Normale svar starter med én firmware-ejet play-service på en intern FLAC-player med
  egen HTTP-kilde, resampler og mixer-input. HA's offentlige media player kan dermed
  ikke afgive falske reply-start/-finish-events; en forladt reservation udløber bounded.
  Cancel, reconnect-orphan og rearm bliver først grønne efter privat player-idle og en
  fysisk tom/stoppet resampler.
- Timer og højttalerdiagnostik bruger samme fysiske output-arbitrering med eget token,
  men uden Thin-callback. Wake stopper først sådan lyd; ReplyBus muteres aldrig under
  en anden ejer. Manglende svarstart fejler efter ét forsøg uden usikker gen-announce.
- Den konfigurerbare legacy-simulator og dens parallelle runtime er fjernet fra den
  shippede add-on. Udviklingsfixtures findes kun under testtræet.
- Gain, VAD, prompt, værktøjssemantik, rearm-kontrakt og half-duplex-transport er
  uændrede.

## 1.13.43 — rearm kan ikke længere være falsk grøn

- Firmware genåbner ikke længere wake-latchen ud fra et sticky tidligere wake,
  `micro_wake_word.is_running()` og passive mikrofonframes. Hver teardown udfører én
  bounded stop/start-reset; en vellykket reset er kun gul `recovered`. Kun den næste
  virkelige wake-callback gør readiness grøn.
- Rearm-service og firmware-ACK er korreleret med et proces-randomiseret, derefter
  monotont token over en dedikeret diagnostisk text-sensor. En forsinket, dubleret,
  replayet eller tidligere proces-ACK kan derfor ikke godkende et senere retry. Den nye
  `correlated_reset_rearm_v2`-capability og ACK-entitet gør, at add-onen afviser gammel
  firmware fail-closed. Den kandidatbundne `podvoice_build_11343`-identitet skal også
  matche, så en ældre firmware med genbrugte del-capabilities ikke kan blive admitted.
- Ukendt eller manglende rearm-resultat kan ikke længere oversættes til `proven`.
  Golden-chain-oraklet kræver nu en ægte efterfølgende wake efter teardown/rearm;
  firmware-ACK alene er ikke længere nok.
- Rearm kræver nu vellykket fysisk silence, mic-stop, provider-close, heartbeat-stop
  og attention-release. Fejl holder latch og readiness lukket og genkører hele
  teardown; reconnect og stray wake-events kan ikke omgå ejerskabet. Voice PE's
  playback-stop er fail-closed og kræver både reply-cancel og køet media-player STOP.
- Den næste wake bindes med nonce til én ny history-session og en stigende
  provider-generation. Early, stale, nonphysical og udløbne forsøg kan derfor ikke
  gøre en senere session retroaktivt grøn.
- Gain, VAD, lydtransport, Realtime, prompt, semantik og stilhedslukning er
  uændrede.

## 1.13.42 — én session gennem opfølgninger, én korreleret afslutning

- Én wake åbner fortsat én Realtime-session, og første tur plus alle naturlige
  opfølgninger deler samme socket og samtalekontekst indtil semantisk afslutning.
- `end_conversation` er bundet fra det præcise modelkald gennem request, response-id,
  socket-generation, terminal PCM og completion. Stale, dublerede, superseded og
  out-of-order events kan ikke lukke en nyere tur eller afspilles som farvel.
- Et korreleret kort farvel afspilles færdigt; manglende eller fejlet terminallyd lukker
  stille. Det lokale cachede farvel og de gentagne lifecycle-promptregler er fjernet.
- Silence, eventuel cachet fejllyd, provider/device/attention-teardown og første rearm
  deler én deadline; hvert senere rearm-forsøg har også en hård timeout.
- Voice PE og Talk deler de samme regressioner. Den hurtige lifecycle-gate dækker 118
  deterministiske cases på cirka 10 sekunder. Den korte sideeffektfrie Realtime-profil
  tester samme-session-kontekst, `Farvel`, `Tak, det var alt`, `Stop samtalen` og
  `Stop musikken` som anti-close-kontrol uden en rigtig musikhandling.

## 1.13.41 — hurtig selektiv test af samtaleafslutning

- Test-fanen har nu én tydelig knap til den eksisterende, navngivne SafeEval-profil
  med fem scenarier og otte ture for matematiske opfølgninger og semantisk afslutning.
- Knappen genbruger den eksisterende sideeffektfrie live-eval, jobpolling og
  diagnostiklås med samme hårde samlede prisloft på $5. Den fulde preflight er uændret.
- Produktionsprompt, Realtime-runtime, værktøjsdispatch, lyd, lifecycle, playback,
  teardown og rearm er uændrede.

## 1.13.40 — korte opfølgninger forbliver åbne

- Realtime-værktøjet `end_conversation` kræver nu, at den seneste brugertur selv klart
  afslutter samtalen. En tidligere afsluttet opgave er aldrig i sig selv lukkeevidens.
- En plausibel kort fortsættelse, korrektion, præcisering eller reference skal besvares
  eller afklares og må ikke fejlfortolkes som et høfligt farvel.
- SafeEval dækker både `Og læg seks til.` og den fysisk observerede tekstdiagnostik
  `Læg seks til.`, plus kort farvel og handling-efterfulgt-af-afslutning. Diagnostikken
  gør ingen påstand om lydækvivalens, fordi feltfejlens provider-PCM ikke blev gemt.
- Ingen fraseliste, transcript-veto, ekstra semantikmotor, runtime-lifecycle,
  playback-, teardown- eller rearm-adfærd er tilføjet.

## 1.13.39 — Voice PE genfinder sin identitet efter DHCP-skift

- Voice PE kan erstatte en stale cachet IP med frisk native `.local`-opdagelse uden
  parallelle klienter. Recovery bruger bounded `1/2/5/10/30/60` sekunders backoff.
- Ny adresse caches først efter Noise-handshake, eksakt enhedsnavn, firmwarekontrakt,
  subscriptions, mic channel/gain, wake word og rearm. Forkert enhed fejler lukket.
- Fysisk linktab lukker en aktiv Voice PE-samtale præcis én gang. Reconnect under
  teardown kan ikke fortsætte gammel mic eller dobbelt-rearme; Talk er uændret.
- Regressionerne dækker den observerede `.162 → .193`-kæde, et senere `.200`-skift,
  stale callbacks, capped recovery og én teardown/rearm. Lokal gate: 46/46 fokuserede,
  fuld unrestricted pytest exit 0 samt Ruff, format, mypy og diff-check.

## 1.13.38 — synlig SafeEval-kontekst og sand delteststatus

- Den semantiske SafeEval-test viser nu eksplicit modellen, at det eneste syntetiske
  basisområde hedder `stue`. Den eksakte lokale fixture er uændret; `stuen`,
  `Evalrum`, navne-selector, scalar-domain, ekstra felter og dubletter forbliver røde.
- Målrettede scenariekørsler rapporterer særskilt valgt resultat, fuldt profilscope,
  gennemført dækning og release-status. En grøn deltest kan aldrig vises eller gemmes
  som en fuld maskinel preflight.
- Rapporter bevares bounded pr. run-id. Ændringer i prompt, model, schema,
  scenariemanifest eller syntetisk kontekst gør ældre fuld evidens stale; audio-replay
  kan ikke overskrive releasebeviset.
- Produktionsprompt, produktionsschema, dispatch, providerpacing, edge-loft, lyd, VAD,
  Thin, HA/MCP, firmware og lifecycle er uændrede. Lokal gate: 338/338 fokustests og
  857/857 fuld suite samt Ruff, format, mypy og diff-check.

## 1.13.37 — SafeEval måler semantik uden skjulte literal-fælder

- Web-fixturet accepterer tre eksplicitte, schema-gyldige FCK-søgeformuleringer som
  fulde argument-dicts. Beståelse kræver stadig præcis ét kald, ét `ok`-resultat og
  det korrekte svar; dubletter, andre klubber, fremtidige kampe og ekstra felter er røde.
- Den eval-følsomme dørlås eksponerer nu kun den eksakte fixtureværdi `hoveddøren`
  som enum. Andre mål stopper terminalt uden schema-korrektion, challenge eller effekt.
- Den syntetiske HA-testverden definerer området som grundformen `stue`. Kun
  `area=stue, domain=[light]` kan give fixture-succes; navn, bøjningsvariant og scalar
  domain forbliver afvist.
- Produktionsschema, schema-hash, dispatch, Prompt V6, model, edge-loft, lyd, VAD,
  Thin, HA/MCP, firmware og lifecycle er uændrede. Lokal gate: 329/329 fokustests og
  843/843 fuld suite samt Ruff, format, mypy og diff-check.

## 1.13.36 — kapacitetsventen genberegnes før wire

- SafeEval genberegner nu den atomiske Realtime-kapacitet efter hvert bounded wait.
  Hvis et nyt autoritativt snapshot sænker saldoen under ventetiden, beregnes kun den
  resterende lokale ventetid; der sendes stadig højst én `response.create` og udføres
  intet provider-retry.
- Den eksakte v1.13.35-sekvens er dækket: `remaining=13653` → vent → nyt snapshot
  `11485` → ny bounded vent → atomisk godkendelse → præcis ét wire-send. Deadline,
  cancellation, lease-tab og nonwaitable state stopper før wire og effekt.
- Tekst, audio-replay og SafeEval-værktøjsfixtures bruger samme capacity-seam. Audio
  gates før PCM/VAD, og værktøjsfixtures kræver feedbackkapacitet før lokal effekt.
- Prompt V6, model, lyd, VAD, Thin, HA/MCP, firmware, playback og fysisk lifecycle er
  uændrede. Lokal gate: 313/313 fokustests og 827/827 fuld suite samt Ruff, format,
  mypy og diff-check. CI/ARM64, installation og fuld live-preflight er fortsat åbne.

## 1.13.35 — providerens sene kapacitetssnapshot gates før næste response

- Et gyldigt, unikt token-snapshot efter en completed response kan nu forankre den
  lokale ledger én gang, når samme socket-generation stadig er helt idle. Pending,
  aktive, dublerede, stale og ikke-completed varianter forbliver inerte.
- Den hurtige interne tool-resultatvej fejler konservativt til nul disponibel
  completion-kapacitet, mens readeren ikke kan dræne socketkøen. Den eksisterende
  bounded pacing og atomiske slutkontrol tillader derefter præcis én response uden
  retry eller ekstra værktøjseffekt.
- Feltsekvensen fra v1.13.34 er reproduceret: completed usage 5.812, sent remaining
  5.204 og næste target 9.396 giver wait/recheck før ét wire-send. Remaining, limit
  og refill kan kun bevæges konservativt ved den sene forankring.
- Prompt V6, model, lyd, VAD, firmware, Thin, playback, HA/MCP og den fysiske
  lifecycle er uændrede. Kandidaten kræver fortsat CI/ARM64, installation og én fuld
  grøn Prompt V6-preflight før fysisk golden chain.

## 1.13.34 — én sikker schema-korrektion før værktøjsdispatch

- Et enkelt schema-ugyldigt, deklareret og ikke-reserveret Realtime-værktøjskald kan
  nu få ét sanitiseret fejlresultat på det eksakte call-id. Kaldet bliver aldrig til
  et `ToolCall`; anden fejl, mixed batch, manglende ACK/kapacitet, 429 eller teardown
  stopper terminalt uden rigtig værktøjseffekt eller automatisk provider-retry.
- SafeEval tester nu “tænd lyset i stuen” som det produktionsrealistiske områdekald
  `area=stuen, domain=[light]`. En syntetisk fuldkæde beviser ugyldigt scalar-kald →
  korrektion → gyldigt rumlys → semantisk afslutning → farvel med præcis én lokal
  fixtureeffekt og nul rigtig HA/MCP-effekt.
- En schema-korrektion får én særskilt fjerde responsekant med prospektiv pris- og
  deadline-reservation. Normale ture er fortsat begrænset til tre kanter.
- Prompt V6, model, lyd, gain, VAD, firmware, playback, HA/MCP-policy og fysisk
  lifecycle er uændrede.
- Lokal kandidatgate: 255/255 fokustests og hele repoets 802/802 tests samt Ruff,
  mypy for 42 sourcefiler og diff-check er grønne. CI/ARM64-image, installation og én
  fuld Prompt V6-live-preflight er fortsat åbne.

## 1.13.33 — revisionsbar Realtime-rateproveniens

- SafeEval gemmer nu et bounded, sanitiseret spor for hver responsekant: monotontid,
  request-/response-id-korrelation, positional `rate_limits.updated`, atomisk lokal
  budgettilstand før og efter admission, faktisk ventetid, usage-total og strukturerede
  429-tal. Ingen prompt, lyd, værktøjsargumenter eller providerfritekst gemmes.
- Afbrudte scenarier bevarer completed responses, lokale fixture-resultater og den
  terminale fejl. Rapporten viser trace-total og budget-total særskilt, så en partial
  response ikke længere kan forsvinde eller ligne et providerregnskabsgab.
- Feltkørslen på v1.13.32 er korrigeret: 33.720 tokens var arithmetic plus de første
  fire time-responses; den femte completed response på 5.774 tokens var udeladt fra
  rapporten. Alle completed responses summerede til 39.494. Den underliggende
  admission-årsag er ikke gættet eller ændret.
- Observeren er passiv og bounded til 128 rækker. Production uden observer bruger den
  oprindelige ikke-allokerende vej, og wire-output er regressionstestet identisk med
  observer slået til, fra og fejlende.
- Prompt V6, model, pacingmatematik, $5-loft, retry-politik, Thin, lyd, gain, VAD,
  firmware, playback, HA/MCP og produktionsværktøjspolitik er uændrede.
- Lokal kandidatgate: 160/160 fokustests og hele repoets 790/790 tests samt Ruff,
  mypy for 42 sourcefiler og diff-check er grønne. CI/ARM64-image, installation og én
  rigtig fuld Prompt V6-live-preflight står fortsat åbne.

## 1.13.32 — autoritativ Realtime-usage på hver response

- `response.done.usage.total_tokens`, `input_tokens` og `output_tokens` er nu den
  bindende kapacitets- og pacingkilde. Modalitetsdetaljer bruges som prisopdeling, ikke
  længere som en ufuldstændig erstatning for providerens total.
- Manglende, negative eller indbyrdes modstridende totaltal fejler lukket i både
  SafeEval og budgetterede Voice PE-/Talk-responses. En handling frigives aldrig ud fra
  en mindre tekst/lyd-detaljesum, hvis providerens total kræver mere resultatkapacitet.
- Reasoning-, image- og andre ukategoriserede tokens bevares som synlig residual og
  prissættes konservativt. Evalrapporten gemmer response-id, topniveau, detaljesum og
  residual per response, så næste feltkørsel kan skelne intern residual fra ekstern
  samme-nøgletrafik.
- Feltmatematikken fra v1.13.31 er regressionstestet: lokal detaljesum 33.455,
  provider-total 35.743 og næste request 5.692 giver én 2,1525-sekunders ventetid plus
  guard og præcis ét wire-send. Der er fortsat intet automatisk 429-retry.
- Prompt V6, model, SafeEval-fixtures, $5-loft, diagnostic lock, Thin, lyd, gain, VAD,
  firmware, playback, HA/MCP og produktionsværktøjspolitik er uændrede.
- Lokal kandidatgate: 221/221 fokustests og hele repoets 772/772 tests samt Ruff,
  mypy for 42 sourcefiler og diff-check er grønne. CI/ARM64-image, installation og én
  rigtig fuld Prompt V6-live-preflight står fortsat åbne.

## 1.13.31 — korrekt pacing på hver Realtime-responsekant

- Den observerede v1.13.30-fejl (`used=34805`, `requested=5769`, `retry=861 ms`)
  er omsat til en rå regression. Providerbudgettet modellerer nu Tier-1 som en
  kontinuerligt refillende token bucket med TPM/60 i stedet for et falsk helt
  minutskifte.
- Eval genbekræfter kapaciteten ved den sidste lokale grænse før hver billable
  `response.create`, også ved normale, hurtige og deferred tool-resultater i samme
  Realtime-session. Den kontekstafledte follow-up-grænse bevares frem til wire-send.
- Dokumenterede kapacitetsventetider tæller ikke som modellens 20-sekunders semantiske
  timeout, men forbliver under den samlede hard deadline og vises i rapporten.
  Worst-case-deadlinen omfatter alle 36 mekanisk mulige responsekanter.
- `rate_limits.updated` forankrer remaining atomisk, men `reset_seconds` bruges ikke
  som refill-hastighed. Manglende/malformed/stale telemetry, atomic recheck-fejl, 429,
  timeout og teardown forbliver fail-closed uden automatisk retry.
- Prompt V6, model, SafeEval-fixtures, $5-loft, Voice PE/Talk-lås, Thin, lyd, gain,
  VAD, firmware, playback og produktionsværktøjspolitik er uændrede.
- Lokal kandidatgate: 201/201 fokustests, 599/599 non-socket og hele repoets 753/753
  tests samt Ruff, mypy for 42 sourcefiler og diff-check er grønne. CI/ARM64-image,
  installation og én rigtig fuld Prompt V6-live-preflight står fortsat åbne.

## 1.13.30 — sand live-preflight uden throwaway-probe

- Live-preflight kører som en eksplicit, gensidigt eksklusiv systemdiagnose. Voice PE
  og Talk kan ikke åbne en konkurrerende Realtime-session, og panelet viser tydeligt,
  at Nabu testes. Låsen frigives ved success, fejl, timeout og stop.
- Den separate cold-probe og dens ekstra fakturerede throwaway Response er fjernet.
  Første sideeffektfrie semantiske response er preflight under den nøglebrede
  diagnostiklås. `rate_limits.updated` er valgfri pacingtelemetri; ved fravær bruges et
  nyt konservativt lokalt vindue, og gammel rate-authority kan ikke pace et nyt run.
- Hele Prompt V6-profilen har et synligt tidsloft, højst tre responsekanter per tur og
  et prospektivt loft på 5 USD. Separat faktureret live-transskription medregnes for
  lyd-replay; manglende provider-usage fejler lukket.
- Eval validerer de eksakte aktuelle produktionsdeklarationer før providerforbrug og
  sender det fulde frosne schema. Webtesten kræver både de kanoniske argumenter og et
  vellykket fixture-resultat, så et heldigt hallucineret svar ikke kan bestå.
- Tool-resultat/farvel reserveres ud fra den afsluttede responses faktiske kontekst,
  bounded resultat, maksimalt output og protokolmargin, før en sideeffekt frigives.
- HA/MCP genforbinder efter Supervisor-opstart med bounded backoff og en ny komplet
  handshake. Snapshot publiceres atomisk og må højst indeholde 64 værktøjer, 24 KiB per
  præcis Realtime-wiredeklaration, 96 KiB samlet og schema-dybde 20.
- Readiness viser faktiske roller: hjemmelæsning er ikke hjemmestyring, og pause,
  volumen eller privat historik er ikke det samme som at kunne søge og starte musik.
- Prompt V6, model, gain, VAD, firmware, fysisk playback og den almindelige
  samtalelifecycle er uændrede. Ingen firmwareflash er nødvendig.
- Lokal kandidatgate: 141 provider/eval/panel-fokustests og hele repoets 742 tests samt
  Ruff, formattering og scoped mypy er grønne. CI/ARM64-image, live Prompt V6-preflight
  og de fysiske golden/10x-gates står fortsat åbne.

## 1.13.28 — autoritativ cold-start af live-evalbudget

- En frisk add-on kan nu etablere OpenAIs autoritative tokenbudget uden den cirkulære
  fejl, hvor eval krævede `rate_limits.updated`, før den første Response kunne oprettes.
- Cold-start bruger én separat ephemeral Realtime-session og én kasseret out-of-band
  tekstresponse med højst 8 outputtokens, ingen værktøjer og ingen adgang til HA, MCP,
  PodConnect, lyd eller playback. Både `rate_limits.updated` og completed
  `response.done` kræves, før en ny rigtig evalsession må starte.
- Den fysiske produktionsvej beholder 15.000 tokens headroom og venter aldrig bag en
  probe eller eval. En fysisk session under proben stopper den efterfølgende eval.
- Rate-reservationen bindes til den eksakte Response. Providerens allerede reserverede
  remaining dobbeltdebiteres ikke, mens en senere Response uden sit eget rate-event
  debiteres konservativt. Tool-sideeffekter er fortsat gated før dispatch.
- Timeout, malformed/manglende rate-event og providerfejl fejler lukket, men en senere
  eksplicit brugerstart må prøve igen. Der findes ingen automatisk retry-løkke.
- Probe-forbrug vises særskilt som faktisk usage/pris eller et konservativt loft på
  2.000 tokens / 0,128 USD og tæller aldrig som en semantisk evalbeståelse.
- Maskinel kandidatgate: 634/634 tests samt Ruff, formattering, mypy og diff-check.
  Prompt V6, model, audio, gain, VAD, firmware, playback, teardown og rearm er uændrede.
  CI/ARM64, rigtig cold-probe/live-eval og de fysiske gates står fortsat åbne.

## 1.13.27 — completed værktøjer, serverautorisation og causal feedback

- Realtime-funktionskald er nu kun kandidater, indtil deres egen providerrespons er
  afsluttet som `completed`. Hele batchen valideres og committes atomisk; cancelled,
  incomplete, failed, malformed, duplicate, stale og ukorrelerede kald udfører nul
  sideeffekter.
- Tool-output, `response.create`, input-clear og truncate har generationbundne
  event-id'er, præcise ACKs, fejlkorrelation og watchdogs. Provider-readiness publiceres
  først efter accepteret `session.updated`, og same-breath-bufferen tømmes i rækkefølge.
- En ny server-ejet execution policy beskytter følsomme handlinger. Den eksakte
  kanoniske handling kan kun godkendes én gang på den umiddelbart næste tur i samme
  session; ændrede argumenter, replay, udløb og teardown fejler lukket.
- HA-mutationer autoriseres mod frisk state og dispatches til samme eksakte entity-id.
  Område/navn-intersektion, klima, private læsninger, lock/cover/valve-inverser og
  argument-smuggling er dækket af regressions.
- Voice PE, Talk og den sikre eval bruger samme completed-batch- og approval-kontrakt.
  Eval bruger fortsat kun faste lokale fixtures og kan ikke udføre HA-, MCP- eller
  PodConnect-sideeffekter.
- Ét fælles providerbudget giver produktion prioritet over eval. En tool-batch frigives
  kun med autoritativ usage og reserveret kapacitet til resultat eller farvel, så en
  handling ikke kan udføres uden causal tilbagemelding.
- Prompt V6 ændrer kun approval-protokollen. Model, audio, gain, VAD, firmware,
  announcement-playback, teardown og wake-rearm er uændrede. Opdateringen kræver ingen
  firmwareflash.
- Maskinel kandidatgate: 622/622 tests samt Ruff, formattering, mypy og diff-check.
  Fysisk baseline forbliver v1.13.11; v1.13.27 kræver stadig live eval, add-on-image,
  frisk golden chain og 10/10 før releasegodkendelse.

## 1.13.26 — levende readiness og præcise OpenAI-fejl

- Test-fanen kan nu genafspille den præcise 24 kHz-lyd, som blev sendt til OpenAI i
  seneste armerede samtale. Én tekstkontrol og tre friske audio-sessioner bruger den
  aktive prompt, model, rumkontekst og hele produktionslisten af værktøjsdeklarationer,
  mens alle værktøjsresultater er faste og ingen HA-, MCP- eller PodConnect-handling kan
  udføres. Resultatet skelner kontraktfejl, stabil lydforståelse, lydspecifik fejl og
  modelvariation.
- Nye lydbeviser gemmer sample-præcise grænser for device-, provider- og svarsporet samt
  hash af det eksakte værktøjsskema. Replay kan derfor ikke kalde et andet udsnit eller
  et andet værktøjssæt for samme bevis. Ældre spor kan kun replayes sikkert på første
  tur før fysisk playback og markeres eksplicit som estimeret udsnit.
- Panelet viser nu `wake-klar`, `forbundet - wake afprøves` og `offline` som tre
  forskellige Voice PE-sandheder. En rå native forbindelse er ikke længere det samme
  som bevist wake-readiness.
- OpenAI-status skelner mellem standby, senest accepterede Realtime-session, manglende
  saldo/kredit, midlertidig ratebegrænsning, afvist API-nøgle, timeout og netværksfejl.
- Serviceårsag og kilde sendes live over panelets eventstrøm, også når farven ikke
  ændrer sig. Den periodiske nøglekontrol må ikke længere overskrive en konkret
  runtimefejl med det upræcise “API-nøgle fundet”.
- TalkHub implementerer samme service-statuskontrakt som det globale StatusHub. En
  OpenAI-readinessopdatering med årsag og kilde kan derfor ikke længere afbryde en
  Talk-samtale ved wake.
- Fysisk Voice PE er strukturelt half-duplex ved settings-, config- og buildergrænsen.
  En gammel eller rå `full_duplex=true`-værdi kan ikke sænke puckens ekkogate; kun den
  særskilte Talk-adapter bruger browser-duplex.
- Produktionsprompt, modelvalg, værktøjsrouting, firmware, gain, VAD,
  playbackrækkefølge, teardown og wake-rearm er uændrede.

## 1.13.25 — Realtime vælger det præcise tidsfelt

- Realtime ejer fortsat hele forståelsen og vælger nu ét eller flere eksplicitte
  tidsfelter: klokkeslæt, dato, ugedag eller ISO-ugenummer. Der er ingen lokal
  frasegenkendelse eller deterministisk hensigtsrouting.
- `get_time` returnerer kun de modelvalgte felter og et fokuseret dansk svargrundlag.
  Et ugedagsspørgsmål får derfor ikke længere en konkurrerende klokkeslæts-summary,
  dato eller et ugenummer, som modellen kan forveksle med svaret.
- Den sikre live-eval kontrollerer både værktøjsnavn og modelvalgte argumenter og
  skelner eksplicit mellem ugedag og ugenummer. Prompt, Realtime-model, lyd, firmware,
  VAD, gain, half-duplex, playback, teardown og rearm er uændrede.

## 1.13.24 — fysisk playback ejer sin egen tur

- Fjerner den faste 500 ms overgang fra færdig modelgenerering til ny lyttetilstand.
  `response.done` betyder ikke, at højttaleren er færdig; kun det korrelerede fysiske
  playback-finish efterfulgt af ekkohalen må åbne næste tur.
- Hvert svar får én playback-lease bundet til samtale, tur, output-item og playback-id.
  Et gammelt, dubleret, manglende eller omvendt playback-event kan ikke åbne mikrofonen,
  afkorte et nyt svar eller lukke en ny tur.
- Manglende playback-start genprøver præcis samme svar og samme lease én gang og lukker
  derefter rent med en synlig fejl. Kæden fejler aldrig åbent til falsk lytning.
- Talk kræver nu præcis playback-id og rækkefølgen startet → færdig. Browserfejl og
  autoplay-blokering kan ikke længere udgive sig for normal fysisk afslutning.
- Fysiske trace-events bærer nu session-, tur- og playback-id, og trace-oraklet afviser
  playback, der krydser ejergrænsen. Prompt, model, gain, VAD og firmware er uændrede.

## 1.13.23 — én naturlig Realtime-respons per direkte tur

- Fjerner det interne `continue_conversation`-værktøj og den obligatoriske ekstra
  modelrespons, som den fysiske 1.13.22-trace viste kunne forvanske et korrekt hørt
  “Hvad er tolv gange syv?” til svaret “7 gange 7 er 49.”
- Realtime bruger nu `tool_choice=auto`: direkte svar og opklaringer leveres i samme
  respons; kun nødvendige domæneværktøjer, `wait_for_user` og den modelsemantiske
  `end_conversation`-beslutning forbliver.
- Prompt V5 og live-evalueringen kræver direkte svar uden lifecycle-værktøj. En gemt,
  urørt Prompt V4 migreres automatisk; reelle brugerdefinerede prompter bevares.
- Firmware, gain, VAD, pre-roll, mic-gate, FLAC-playback, teardown og wake-rearm er
  uændrede.

## 1.13.22 — semantisk korrekt web-orakel

- Den fulde, bevarede 1.13.21-livepreflight beviste Prompt V4 og bestod matematik,
  opfølgninger, tid/ugedag og semantisk afslutning. Web valgte også det korrekte
  `google_web_sogning` og svarede korrekt “FCK vandt 2-0”, men oraklet krævede
  bogstaveligt ordene “to” og “nul” og gav derfor en falsk rød rapport.
- Web-oraklet bedømmer nu den samme betydning med enten cifre eller talord og bevarer
  samtidig retningen: “Silkeborg vandt 2-0 over FCK” kan ikke bestå som en FCK-sejr.
- Panelet viser nu den konkrete finding under en fejlet tur, så et korrekt svar ikke
  længere kan stå rødt uden forklaring.
- Produktionsprompt, model, værktøjsrouting, firmware og fysisk lifecycle er uændrede.
- 486 tests, Ruff, formatteringskontrol, mypy og panel-script-parsing er grønne.

## 1.13.21 — genoptagelig preflight med sand jobstatus

- Den installerede 1.13.20-preflight blev korrekt startet, men det fler-minutters
  arbejde levede inde i ét langt Ingress-HTTP-kald. Et afbrudt eller genprøvet kald
  kunne derfor annullere arbejdet eller overskrive den aktive kørsel med den misvisende
  besked “kører allerede”. En sådan besked er ikke et semantisk evalresultat.
- Add-on-processen ejer nu evalueringen som ét baggrundsjob med et fast `run_id`.
  Startkaldet returnerer straks, panelet poller status, og reload, midlertidigt nettab
  eller et dobbeltklik genoptager samme job. Det færdige resultat bevares i processen.
- Eval-providerens opkobling har nu samme otte-sekunders loft som produktionsmotoren,
  hele jobbet har et femminutters loft, og et opkoblingssvigt rydder altid sin session.
  Add-on-stop annullerer jobbet eksplicit og lukker det rent.
- Evalgrænsen er sænket fra 30.000 til 25.000 TPM. Dermed forbliver cirka 15.000 af
  Tier-1-vinduets 40.000 tokens ledige til én målt almindelig PodVoice-session.
- Prompt V4, firmware, gain, VAD, pre-roll og fysisk half-duplex er uændrede.

## 1.13.20 — korrekt aktiv prompt og Tier-1-sikker preflight

- Den installerede 1.13.19-preflight beviste GA-item-kvitteringen: direkte matematik
  og opfølgning samt tid og ugedag bestod. Den afslørede samtidig, at `/data` stadig
  indeholdt en byte-identisk kopi af den gamle Prompt V2. Dens dokumenterede hash
  migreres nu som en gammel standard til Prompt V4; enhver faktisk egen prompt bevares.
- Fire friske eval-sessioner gentog prompt og værktøjsskema så hurtigt, at de første to
  allerede brugte 28.700 tokens og pressede de næste mod OpenAI Tier-1's 40.000 TPM.
  Preflighten har nu et konservativt 30.000-token rullende vindue med automatisk pause,
  10.000 tokens fri til en rigtig samtale og synlig ventetid i rapporten.
- Total-run-budgettet er skilt fra TPM-vinduet: højst 80.000 faktiske tokens og $0,25.
  Testen kan derfor gennemføre alle fire isolerede sessioner uden at forveksle
  rate-limit med en semantisk fejl eller sulte den almindelige assistent.
- Prompt V4's indhold, firmware, gain, VAD, pre-roll og fysisk half-duplex er uændrede.

## 1.13.19 — GA-korrekt Realtime-kvittering

- Den installerede 1.13.18-preflight beviste, at OpenAI accepterede sessionen og det
  32-tegns item-id uden en providerfejl, men PodVoice ventede på den ældre
  `conversation.item.created`-event. Den aktuelle GA-protokol kvitterer klientoprettede
  items med `conversation.item.added`. Providerlaget accepterer nu den aktuelle event
  og bevarer kompatibilitet med den ældre event under protokolmigration.
- Hvert tekst-item har nu også et korreleret klient-`event_id`. En samtidig, men
  uvedkommende recoverable Realtime-fejl kan derfor ikke længere afvise den ventende
  Talk-tur; kun en fejl knyttet til præcis create-eventen gør det.
- Der er tilføjet regressioner for begge ACK-navne, streng item-korrelation og
  uvedkommende providerfejl. Prompt V4, firmware, gain, VAD, pre-roll og den fysiske
  half-duplex-kæde er fortsat uændrede.

## 1.13.18 — providergyldige Talk-id'er og reproducerbar preflight

- Den første installerede 1.13.17-preflight afslørede, at det korrelerede Realtime-
  item-id var 35 tegn, mens OpenAI højst accepterer 32. Både `ThinSession` og
  providergrænsen producerer og håndhæver nu et deterministisk 32-tegns-id; lange eller
  ugyldige eksterne id'er normaliseres defensivt.
- En eksplicit providerafvisning af et ventende tekst-item fejler nu straks med den
  rigtige årsag og kan aldrig skjules som en senere generisk ACK-timeout eller starte
  `response.create`.
- Preflighten bruger nu den faktisk aktive gemte prompt, effektive model og stemme.
  Rapporten indeholder promptkilde, promptversion samt prompt- og tool-schema-hash, så
  et bestået run kan knyttes til præcis den konfiguration, der blev prøvet.
- Oraklet er strammet: tidsfixturen kan ikke bestå på den tvetydige delstreng
  “klokken er to”, og sportsresultatet skal udtrykkeligt bevare, at FCK vandt.
- Talk afviser tekst over 2.000 tegn og command-id'er over 128 tegn før samtalen åbnes.
  Firmware, prompt V4, gain, VAD, pre-roll og den fysiske half-duplex-kæde er uændrede.

## 1.13.17 — autoritative Talk-ture og maskinel release-preflight

- Skrevet Talk-input går nu altid gennem `ThinSession`. Browseren får først en accepteret
  tur, når Realtime har accepteret sessionen, oprettet præcis det korrelerede bruger-item
  og kvitteret med providerens item-event; først derefter oprettes modelsvaret.
- Talk-protokol v2 adskiller WebSocket, engine-readiness, samtaletilstand og inputaccept.
  Alle events har ordnet sekvens samt connection-, session-, turn- og playback-id, og
  gamle sockets eller playback-kanter kan ikke ændre den aktuelle samtale.
- Talk viser ikke længere brugerens tekst optimistisk. Afviste eller tabte beskeder
  bliver stående i feltet med en konkret fejl, og browseren kalder ikke en rå åben socket
  “online”. Et ping/pong-lease opdager desuden sovende mobil-/HA-webviews.
- En sikker Realtime-preflight kører produktionsmodel og prompt mod faste testværktøjer
  uden adgang til HA, MCP, PodConnect eller hjemmets tilstand. Testfanen viser direkte
  svar, opfølgning, tid, web-routing, semantisk lukning samt afgrænset token/prisforbrug.
- En streng trace-oracle og et lokalt acoustic-HIL-grundlag kan maskinelt afvise manglende
  provider, playback, lukning, rearm, omvendte events og ugyldige lydfixtures. Talk kan
  sammenlignes med Voice PE's fælles lifecycle, men tæller fortsat aldrig som fysisk bevis.
- Firmware, prompt V4, gain, VAD, pre-roll og den fysiske half-duplex-kæde er uændrede.
  Kandidaten skal bestå live-preflight før en ny fysisk golden chain og 10/10-serie.

## 1.13.16 — providerklar Talk og garanteret endeligt svar

- En live 1.13.15-prøve fangede to fejl før fysisk test: Talk kunne sende første tekst
  efter en fast 300 ms ventetid, selv om Realtime endnu ikke var klar, og dermed tabe
  beskeden. Talk afventer nu den faktiske `session.updated`-/provider-ready-grænse.
- Realtime valgte korrekt `continue_conversation` på “Hvad er tolv gange syv?”, men
  sagde kun “Lad mig lige regne det kort igennem” og leverede aldrig 84. Antagelsen om
  beslutning og komplet svar i samme respons er derfor fjernet.
- `continue_conversation` registreres nu som et almindeligt internt værktøjsresultat.
  Beslutningsresponsens preamble kasseres, hvorefter providerlaget opretter præcis én
  endelig respons med `tool_choice=none`. Den respons kan kun levere svaret og kan ikke
  starte endnu en lifecycle-loop.
- Promptversion 4 beskriver samme to-respons-kontrakt. Firmware og den fysiske
  half-duplex-kæde er uændret. Kandidaten kræver fortsat live Talk-preflight, fysisk
  golden chain og derefter 10/10 fysiske cyklusser.

## 1.13.15 — eksplicit Realtime-beslutning på hver brugertur

- Feltprøven `20260819T153836-401` beviste en ren lyd- og playback-kæde, men GPT
  svarede “Selv tak, det var så lidt!” på den klare afslutning uden at kalde
  `end_conversation`. Samtalen lukkede derfor først på idle-timeout. Denne kandidat
  gør den manglende semantiske beslutning umulig at skjule som almindelig svartekst.
- Hver ny brugertur kræver nu et eksplicit Realtime-værktøjsvalg: et reelt værktøj
  for handling/opslag, `end_conversation` for afslutning, `wait_for_user` for
  ikke-henvendt tale eller det nye interne `continue_conversation` for et direkte
  svar/opklarende spørgsmål. Der er fortsat ingen lokal frase- eller ASR-routing.
- `continue_conversation` siger hele det korte svar i den samme Realtime-respons.
  PodVoice holder lyden privat, indtil den providerbeviste fortsættelsesbeslutning er
  registreret, og publicerer derefter svaret. Der oprettes ingen ekstra modelsvarsrunde.
- Almindelige værktøjsresultater får fortsat `tool_choice=auto`, så flertrinsarbejde
  virker. Efter et semantisk end-signal får den afsluttende svarrunde derimod
  `tool_choice=none`, så den siger ét farvel uden at starte en ny lifecycle-loop.
- Promptversion 3 beskriver præcis samme firedelte kontrakt. Fortsættelses-, vente- og
  slutsignaler er interne, tur- og sessionsbundne og kan aldrig sendes til HA/MCP.
- Dette er en ren add-on-opdatering. Firmware, gain, VAD, pre-roll, mic-gate,
  playback og wake-rearm er uændrede. Kandidaten er først godkendt efter en ny fysisk
  golden chain og derefter 10 ubrudte Voice PE-cyklusser.

## 1.13.14 — korrekt afslutningsrouting og afgrænset TPM

- `get_time` er nu semantisk afgrænset til den seneste brugertur. Et tidligere
  klokke-/ugedagsopslag må ikke få Realtime til at gentage tidsværktøjet, når den nye
  tur i stedet tydeligt afslutter samtalen. `end_conversation` forbliver modellens
  eneste afslutningsautoritet; der er ikke tilføjet fraser eller lokal tekstmatching.
- Realtime-sessionen sætter `max_output_tokens` til 1.024. PodVoices svar er højst to
  korte sætninger, så loftet bevarer god plads til lav reasoning og værktøjskald, men
  reducerer OpenAI-serverens outputreservation med 75 procent fra API-standardens
  4.096 tokens per respons. Modellen er fortsat GPT-Realtime-2.1.
- Et fysisk `playback_started` + `playback_finished` kan ikke længere efterfølges af
  PodVoices syntetiske `missing-start-or-finish`-fejl, mens den atomiske close-task
  stadig venter på sin næste event-loop-tur.
- Rød LED vises kun, mens en teknisk fejl afspilles. Efter den afgrænsede fejllyd,
  teardown og wake-rearm går pucken sandt tilbage til mørk IDLE i stedet for at se
  permanent fastlåst ud.
- Regressionerne gengiver felttrace `20260819T145100-102`: forkert genbrugt tidsværktøj,
  TPM-fejl under semantisk farvel, fysisk fallback, falsk playback-fault og rearm.
- Dette er en ren add-on-opdatering. Firmware skal ikke flashes; fysisk golden chain
  og derefter 10/10 er fortsat release-gaten.

## 1.13.13 — dansk Prompt V2 og tavs baggrundstur

- Realtime får en ny dansk systemprompt med én entydig beslutningsrækkefølge for
  lydforståelse, opfølgninger, værktøjsrouting, resultatsandhed, sikkerhed og semantisk
  afslutning. En gemt 1.13.12-standardprompt migreres automatisk, mens en ægte
  brugerdefineret prompt bevares.
- Det reserverede `wait_for_user`-signal lader Realtime klassificere baggrundstale og
  tale, der ikke er rettet mod Nabu, uden et oplæst svar. Det er provider-neutralt,
  kan ikke sendes videre til Home Assistant og kan ikke lukke samtalen.
- En tavs tur bindes til dens præcise kald, sessionsepoch og brugertur. Forsinkede eller
  blandede værktøjsresultater kan derfor ikke gøre næste rigtige tur tavs, lukke den
  eller genoplive en fejlet provider-respons.
- `end_conversation` forbliver Realtime-modellens eneste semantiske afslutningssignal.
  Thin ejer fortsat kun fysisk playback, præcis én teardown og præcis én wake-rearm.
- Hver lydtrace registrerer aktiv promptkilde, promptversion og SHA-256, så en fysisk
  prøve kan bevise, hvilken prompt der faktisk kørte.
- Dette er en add-on-kandidat uden firmwareændringer. Den er først fysisk godkendt,
  når en frisk golden chain og derefter 10 ubrudte Voice PE-cyklusser består.

## 1.13.12 — én officiel baseline og hårdere fysisk sandhed

- `docs/STATUS.md`, `AGENTS.md`, produktmål og arkitektur skelner nu præcist mellem
  v1.13.11 som første fysisk virkende half-duplex-version, den endnu åbne 10/10-gate
  og det fulde produktmål. Historiske planer og Classic/direct-kode kan ikke længere
  læses eller bygges som en parallel produktionsretning.
- Add-on-builderen konstruerer ubetinget `ThinSession`; den døde Classic-fallback og
  dens imports er fjernet fra produktionsentrypointet.
- Mislykket Voice PE mic-start/-stop/keepalive er ikke længere et ignoreret boolsk
  resultat. Fejlen bliver synlig, lukker rent og kan ikke efterlade en grøn men døv
  samtale.
- En talt teknisk fejl venter på firmwarebevist playback-start/-slut før teardown,
  med en afgrænset timeout. Semantisk farvel-fallback er strengt cache-only og kan
  aldrig indføre et skjult 15-sekunders TTS-netværkskald i lukningen.
- Stop-latens er bundet til den aktive session og kun armeret ved faktisk lyd. Historik
  gemmer eksplicit session-id, og trace-oprydning fjerner nu også gamle speaker-WAV'er.

## 1.13.11 — semantisk afslutning bliver altid hørbar

- En eksplicit `response.done.status=failed` bæres nu gennem den provider-neutrale
  kontrakt. En fejlet Realtime-respons med nul lydtokens kan derfor aldrig længere
  tælle som et færdigt eller fysisk afspillet svar.
- Når Realtime allerede har valgt det reserverede semantiske `end_conversation`, men
  den efterfølgende farvel-lyd fejler, afspiller PodVoice et forvarmet “Farvel.” i den
  samme assistentstemme. GPT ejer fortsat betydningen; fallbacken ejer kun den sikre
  transport af en beslutning, modellen allerede har truffet.
- Teardown venter også på fallbackens faktiske `playback_finished`, hvorefter provider,
  mikrofon, musikdæmpning og wake-latch lukkes/genåbnes præcis én gang. Voice PE og
  Talk kører samme regression fra feltforløbet 19. august.

## 1.13.10 — rearm kræver levende mikrofonlyd

- Firmwarekvitteringen `wake_rearmed` kræver nu både ubrudt detektorkontinuitet,
  kørende microWakeWord og nye fysiske mikrofoncallbacks efter rearm. ESPHomes brede
  `is_running()`-signal kan derfor ikke længere åbne næste samtalelås alene, mens
  wake-motoren reelt står i `STARTING` eller `STOPPING`.
- Hvis det raske kontinuitetsbevis ikke består, gennemfører firmwaren én afgrænset
  stop/start-recovery og kræver igen frisk mikrofonfremdrift. Kun derefter åbnes
  samtalelåsen som gul `recovered`; timeout/fault lader den forblive lukket og udløser
  add-onens synlige, begrænsede retry-forløb.
- Det fysiske frame-counter-signal er atomisk på tværs af ESP32's audio- og API-tasks.
  Firmwarekontrakten kræver den nye markør `physical_rearm_audio_progress_v1`, så en
  ny add-on aldrig kalder gammel, svagere firmware klar.
- Samtalehistorikken tidsstempler nu brugerens tur ved den faktiske
  `speech_stopped`-grænse og sorterer på dette tidspunkt. En sent leveret Realtime-
  transskription kan derfor ikke længere få Nabús svar eller “Farvel” til at stå før
  den brugerbesked, der udløste det.

## 1.13.9 — én sammenhængende half-duplex-kontrakt

- Voice PE og OpenAI Realtime følger nu samme half-duplex-kontrakt. Realtime får
  `interrupt_response: false`, når puckens mikrofon lokalt er lukket under svarlyd;
  den tidligere blanding af lokal mic-gate og server-side automatisk afbrydelse kunne
  afkorte svaret og efterlade VAD permanent i lytte-tilstand.
- Mikrofonframes holdes nu tilbage allerede fra modelsvarets start, ikke først når
  højttaleren melder fysisk playback. En VAD-start, der krydser denne grænse, rydder
  Realtime-inputbufferen uden at annullere svaret. Talk-browseren bevarer eksplicit
  full-duplex og browserens ekkofjernelse.
- Regressionen gengiver feltsporet fra 18. august: speech-start 139 ms før fysisk
  playback, et afkortet svar på 330 ms og en session, der ellers blev hængende i
  LYTTER. Den samlede test kræver nu, at svaret overlever, inputbufferen ryddes, og en
  efterfølgende tur kan gennemføres.
- `docs/INVARIANTER.md` er den autoritative tværgående kontrakt. `AGENTS.md` og
  `CLAUDE.md` kræver, at den læses før ændringer i lyd, VAD, Realtime, firmware eller
  samtalelivscyklus. Grøn CI er fortsat ikke fysisk godkendelse.

## 1.13.8 — kontinuerlig wake-sandhed og hurtigere Realtime-start

- En fysisk wake-detektion er nu den eneste kilde til firmwarebeviset for en sund
  wake-motor. Efter normal samtalelukning genbruges den allerede kørende detektor og
  kun samtalelåsen åbnes; den raske inference-task bliver ikke længere tvangsgenstartet.
- Stop/start er isoleret som recovery. Recovery åbner igen for wake, men rapporteres
  særskilt som ikke-fysisk-verificeret, fordi ESPHome 2026.6.2's offentlige
  `is_running()` ikke kan skelne `STARTING` fra `DETECTING_WAKE_WORD`. Panelet/add-onen
  må derfor ikke vise et grønt readiness-bevis, som firmwaren ikke faktisk har. Kold
  recovery er gul og operationel; fault/timeout er rød med serialiseret automatisk
  retry. Første virkelige wake efter recovery løfter status til grøn.
- Et gammelt kontinuitetsbevis nulstilles ved enhver reconnect-ejet detektorstart, så
  `STARTING` aldrig kan arve grønt bevis fra en tidligere detector-instans.
- Voice PE-køen og Realtime beholder nu op til tolv sekunders privacy-gated lyd under
  DNS/TLS/session-opstart. Ved ekstrem backpressure beholdes slutningen af spørgsmålet
  frem for gammel wake/pre-roll, så værktøjsintentionen ikke klippes væk.
- Wi-Fi power save er slået fra på den strømforsynede Voice PE. ESPHome dokumenterer,
  at standardtilstanden `LIGHT` reducerer forbindelsespålideligheden; PodVoice vælger
  stabil native-API-lyd og lavere lokal jitter frem for irrelevant strømbesparelse.
- GPT Realtime 2.1 kører eksplicit med `reasoning.effort: low`, OpenAI's anbefalede
  startpunkt for responsive production voice agents med værktøjsvalg.
- Den eksterne `voice_kit`-komponent er fastlåst til samme Voice PE 26.6.0-commit som
  den vendorede hardwarebase; et nyt build kan ikke længere trække vilkårlig `dev`-kode.
- Release-gaten kører nu ti komplette samtaler i stedet for ti kunstige `stop()`-kald:
  én wake/én Realtime-session, fysisk afsluttet første svar, naturlig opfølgning i samme
  session, modelsemantisk `end_conversation`, fysisk afsluttet farvel, præcis én teardown
  og præcis én wake-rearm i hver cyklus.

## 1.13.7 — fysisk rearm og intakt første ord

- Wake-motoren tvangsgenstartes nu efter hver afsluttet samtale. Add-on'en viser først
  `wake_rearmed`, når firmwaren selv har kvitteret efter stop/start-cyklussen; et
  gennemført API-kald tæller ikke længere som fysisk bevis.
- Wake-grænsen bevarer en dokumenteret, begrænset 320 ms akustisk bro. Det undgår at
  klippe starten af `Hvad ...` ved naturlig same-breath tale uden at genindføre den
  tidligere 1,5 s pre-roll med hele `Okay Nabu`.

## 1.13.6 — ren lydgrænse ved wake

- Voice PE nulstiller nu sin lokale rullende lydbuffer præcis ved den fysiske
  wake-detektion. Selve “Okay Nabu”, rumlyd og eventuel musik fra før wake bliver
  derfor aldrig sendt ind som den første Realtime-brugertur.
- Al lyd efter wake sendes straks. Add-onens separate tre-sekunders preconnect-buffer
  bevarer spørgsmålet, mens Realtime-sessionen åbner; den gamle 1,5 sekunders
  pre-wake-kompensation er dermed ikke længere en del af samtalelyden.
- API-start/keepalive forbliver idempotent og må aldrig nulstille aktiv tale. En ny
  firmwaremarkør, `wake_audio_boundary_v1`, gør den fysiske kontrakt synlig og forhindrer
  add-onen i at kalde ældre wake-forurenet firmware klar.
- Feltbeviset bag rettelsen: første same-breath-input blev “Can I track shoppen?” og
  udløste fejlagtigt musikværktøjet, mens den efterfølgende tur i samme session blev
  transskriberet korrekt. Gain, dansk Realtime-konfiguration og generel mikrofonkvalitet
  kan derfor ikke forklare netop denne kantfejl.

## 1.13.5 — Realtime ejer samtalens betydning

- GPT Realtime afgør nu semantisk, om brugeren tydeligt vil afslutte samtalen, og
  udsender et internt `end_conversation`-signal. PodVoice matcher ikke længere
  “farvel”, faste fraser eller ASR-aliaser for at gætte brugerens hensigt.
- Signalet er bundet til den aktuelle brugertur, går aldrig gennem HA/MCP og lukker
  ikke direkte. Først det efterfølgende korte afslutningssvar og Voice PE's fysiske
  playback-finish må udløse den atomiske teardown og wake-rearm.
- Uklart input, et almindeligt “tak”, omtalte slutord og gamle værktøjssvar kan ikke
  lukke en ny tur. Ny tale ophæver en uafsluttet modelbeslutning.
- Blandede ønsker som “sluk lyset, og så er jeg færdig” samler alle værktøjsresultater
  før præcis ét slutsvar. Langsomme HA-kald kan derfor ikke skabe dobbelt svar eller
  dobbelt lukning.
- 1.13.4's lokale frase-/aliasfortolkning er erstattet og må ikke bruges som den
  godkendte kandidat. Firmwaredelen med fysisk playback-telemetri bevares og kræver
  stadig flash sammen med denne add-on-version.

## 1.13.4 — tur-sikker lukning og fysisk svarslut

- “Farvel” kan nu ankomme både før og efter Realtime melder svaret færdigt. Lukningen
  samler evidensen på den samme brugertur og kan kun bekræftes én gang; et sent eller
  støjramt slutord kan ikke længere lukke en efterfølgende samtale. Feltvarianten
  “Tube” kræver et selvstændigt farvel fra modellen på samme tur og lukker aldrig alene.
- Alle samtidige lukkeveje går gennem én atomisk transaktion. Timeout, knap, stop og
  model-farvel kan derfor ikke dobbeltlukke Realtime, frigive musik eller rearmere
  wakewordet flere gange.
- Voice PE-firmwaren armerer kun playback-telemetri for PodVoices eget næste svar.
  Timere og andre HA-announcements kan ikke flytte samtalens LED eller ekko-gate.
  Start udsendes først efter observeret ANNOUNCING; slut først når den dedikerede
  announcement-resampler er tom og stoppet. Stop/teardown nulstiller en ubrugt arm,
  og manglende drain lukker rent som en synlig fejl i stedet for at forgifte næste tur.
- Firmwarekontrakten kræver `podvoice_playback_events_v1` og handlingen
  `podvoice_reply_expect`. Denne version kræver derfor både add-on-opdatering og flash
  af `esphome/podvoice.yaml`, før fysisk playback, Farvel og wake-rearm kan godkendes.
- Nye regressioner dækker begge eventrækkefølger, forsinket playback-start, mistet
  playback-slut, ASR-kandidater på tværs af ture og tre samtidige lukkeårsager.

## 1.13.3 — målt livscyklus og robust felt-farvel

- Feltprøven viste en specifik dansk ASR-fejl: to selvstændige “Farvel” blev begge
  transskriberet som “Kom ind.”. Aliaset lukker aldrig alene; det bliver kun accepteret,
  når Realtime uafhængigt svarer med et rent farvel. Dermed lukker og rearmer den
  observerede samtale uden at genindføre de falske luk på “Klar” og FCK-spørgsmål.
- Testfanen viser nu automatisk en let samtaletidslinje for hver session: wake,
  Realtime-forbindelse, tale/VAD, transskription, værktøjstid, modellyd, fysisk
  afspilning, lyskommando, lukning og wake-rearm. Mikrofon- og højttalerlyd optages
  fortsat kun efter et udtrykkeligt klik på “Optag næste samtale”.
- Hjem/vejr via HA MCP er noteret som næste driftsrunde: en død `tools/list`-session
  skal genoprettes automatisk med begrænset backoff uden at tage tid, web eller musik
  med ned.

## 1.13.2 — mikrofonen forbliver levende efter wake

- Den første 1.13.1-runtime viste wake og derefter elleve sekunders total stilhed.
  `stop_after_detection: true` stoppede microWakeWord-komponenten, som også ejer den
  mikrofonlivscyklus den passive PodVoice-tap er afhængig af. Komponenten kører nu
  fortsat, mens en firmware-lås sikrer præcis ét wake-event indtil teardown rearmer.
- Pre-roll-ringbufferen blev tidligere nulstillet på hvert idle-loop, så dens angivne
  1.500 ms aldrig kunne eksistere før wake. Med en tilsluttet PodVoice-klient ruller
  bufferen nu lokalt bag privacy-gaten. `stop_streaming()` nulstiller den én gang ved
  teardown, så ingen lyd fra en gammel samtale kan krydse ind i den næste.
- Et add-on-reconnect i idle lukker altid mic-forward og rearmer firmware-låsen. Dermed
  kan et netværksbrud midt i en samtale ikke efterlade en online men døv puck.

## 1.13.1 — samme åndedrag, værktøjssvar og næste wake

- Voice PE beholder nu 1,5 sekunders lyd lokalt før wake-signalet, så spørgsmålet i
  “Okay Nabu, hvad er klokken?” ikke bliver skåret ned til det sidste ord, mens
  wake-modellen træffer sin beslutning. Lyden forlader fortsat ikke enheden før wake.
- Et eksplicit `ToolRoundComplete`-event adskiller værktøjsbeslutningen fra det
  efterfølgende svar. Opfølgninger som “Og hvilken ugedag er det?” bliver derfor
  afspillet i stedet for at blive holdt skjult som en mellemregning.
- Wake-modellen stopper efter præcis én detektion. Når Realtime-session, mic-forward,
  svarlyd og musik-ducking er lukket, kalder add-onen den nye firmwarehandling
  `podvoice_rearm_wake_word`. Næste “Okay Nabu” afhænger dermed ikke af implicit
  firmwaretilstand.
- Firmwarekontrakten kræver `deterministic_rearm_v1`, og regressionstesten beviser ti
  wake→dialog→luk→rearm-cyklusser samt at add-on-shutdown ikke efterlader en ejerløs
  aktiv wake-motor.

## 1.13.0 — én wake, én PodVoice-kanal, én Realtime-session

- Den pinnede Voice PE-base er vendored med upstream commit og SHA, fordi ESPHome
  sammenfletter anonyme triggerlister. Wakeword og centerklik starter nu aldrig stock
  HA Assist; firmwaren renderer én wake-trigger og nul `voice_assistant.start`.
- `podvoice_channel_v1` åbner mikrofonen lokalt og udsender præcis ét PodVoice-event.
  Add-onen opretter én Realtime-session, holder alle opfølgninger i den og lukker både
  socket og mic-forward ved farvel, stop, timeout eller fejl.
- Modellens `end_conversation`-tool er fjernet. Transporten lukker kun på eksakte hele
  slutfraser, så felttransskriptionerne “Klar” og “Kig FCK seneste kamp” ikke længere
  kan udløse falsk “Farvel” eller tavshed.
- Talk og Voice PE kører samme `ThinSession`-lifecycle; kun browserens versus puckens
  lydadapter er forskellig. En regressionstest kører samme forløb gennem begge.
- Classic og direct kan ikke genaktiveres af gamle settings. Produktion er thin,
  half-duplex og den dokumenterede announcement-svarvej.
- Automatisk gate beviser 10 wake→session→luk→rearm-cyklusser uden ekstra provider-
  connect, stock RUN_END eller kontrol-announcement.

## 1.12.28 — samme wake behandles én gang, næste wake rearmes

- `same_breath_v1`-firmwaren rapporterer samme fysiske wake både som det tidlige
  `wake_okay_nabu`-event og cirka 300 ms senere som stock-VA `handle_start`.
  Add-onen bruger nu det tidlige event som den ene wake og beholder `handle_start`
  som fallback, hvis eventet mangler. En samtale åbnes derfor ikke og re-wakes igen
  på samme “Okay Nabu”.
- Hver teardown sender en idempotent `RUN_END` til Voice PE, så en strandet stock-VA
  ikke kan fortolke næste wake som STOP og gøre wakewordet tavst.
- Grundtesten lukker stadig hver målt samtale, men uden at starte en ny announcement-
  tone på den delte højttalerpipeline. Panelet er overgangssignalet mellem testparrene;
  næste wake kan rearmes uden at vente på en medieafspiller-timeout.

## 1.12.27 — hver fysisk testsamtale isoleres

- Når ejeren har hørt begge svar og bedømmer en samtale, lukker testpanelet den
  aktive Voice PE-session rent, før næste målevindue starter. Et sent “farvel”,
  lounge-state eller en lukke-latency kan derfor ikke havne i næste tests evidens.
- Hvis sessionen ikke kan lukkes, armeres næste test ikke; panelet viser fejlen i
  stedet for at fortsætte med sammenblandede målinger.

## 1.12.26 — grundtesten forstyrrer ikke længere opfølgningen

- Den guidede fysiske test viser nu begge sætninger i hver af ti samtaler på
  forhånd. Brugeren rører ikke panelet mellem hovedspørgsmålet og opfølgningen,
  så testens eget klik/læseophold ikke konkurrerer med det otte sekunder lange
  opfølgningsvindue.
- En samtale kan kun bedømmes “korrekt”, når historikken faktisk indeholder både
  to brugerudsagn og to hørbare svar. Gate-latensen er den langsomste af de to
  ture, så en hurtig åbning ikke kan skjule en langsom opfølgning.
- Wake-instruktionen er entydig: sig “Okay Nabu, …” i én sammenhæng og vent ikke
  på et wake-bip. Tur-bippet efter svaret er fortsat signalet til opfølgningen.

## 1.12.25 — Realtime bruges som hjerne, half-duplex gøres pålidelig

- De to gain-16-traces beviser, at Voice PE kan levere både et korrekt første
  spørgsmål og en hel AGF-opfølgning. Standard-turtagningen er derfor flyttet fra
  energi-baseret `server_vad` til OpenAIs `semantic_vad` med auto-eagerness, så en
  naturlig pause ikke bliver en tom mikrotur. `speech_stopped` og `committed` for
  samme tur deduplikeres samtidig til én fysisk grænse.
- Realtime vælger fortsat selv værktøjet. På den bufferede announce-vej holdes hver
  modelrespons nu adskilt, så en promptstridig “Jeg tjekker…”-indledning kasseres,
  hvis samme respons ender i et tool call. Kun resultatets svar og turlyden når den
  færdige FLAC; LED'en er den umiddelbare tænker-feedback.
- `get_time` returnerer et tale-klart dansk klokkeslæt (`et minut i seks`, `halv
  tre`, `kvart i seks`) i stedet for at bede modellen fortolke `17:59`, som i den
  fysiske trace blev til “sytten nioghalvfems”.
- HA-/PodConnect-værktøjerne sættes nu før Realtime-sessionens `session.update`.
  En integration, der er blevet genindlæst, er dermed synlig i den aktuelle
  samtale i stedet for én samtale senere.
- Den armerede lydtrace gemmer nu også den eksakte færdige 24 kHz svar-PCM, der
  sendes til højttaleren. En skrattende start kan dermed placeres i modeloutput,
  tool-sammenføjning eller den fysiske decoder i stedet for at gættes ud fra mic-input.
- Den første pålidelige puck-version forbliver half-duplex: echo-shieldet er oppe
  under fysisk afspilning, opfølgninger åbner straks bagefter, og lokal wake/stop
  kan stadig hushe et svar. Fuld duplex er fortsat en særskilt fysisk AEC-gate.

## 1.12.24 — lydbeviset lukker den første målte fejl

- Den første fysiske trace målte Voice PE ved skrivebordet til RMS 79,5, peak 8,85 %
  og nul clipping på gain 4. Runtime-baselinen er derfor sat tilbage til gain 16,
  som giver cirka 12 dB mere talesignal og stadig omtrent 9 dB peak-headroom i den
  målte samtale. Værdien påføres igen ved hver forbindelse og overlever reboot.
- Skratten i starten findes allerede i Voice PE's 16 kHz PCM og er bevaret, men
  ikke skabt, af 24 kHz-resamplingen. Provider-støjfilteret forbliver derfor slukket;
  problemet skal løses ved kilden i stedet for med endnu et destruktivt filter.
- Lydtracens tool-event brugte `name` både som eventnavn og værktøjsdetalje. Det
  crashede provider-læseren ved det første `podconnect_recently_played`-kald og
  lignede en forbindelsesfejl. Signaturen er gjort kollisionsfri og regressionstestet.

## 1.12.23 — mål den fysiske lyd før næste tuning

- Test-fanen kan nu armere præcis én lokal Voice PE-samtale som lydbevis. Normal
  drift optager aldrig, en armering bruges kun én gang, optagelsen stopper med
  samtalen eller efter højst 60 sekunder, og kun de fem seneste beholdes i `/data`.
- Samme samtale gemmes ved begge relevante grænser: valgt/gainet 16 kHz PCM fra
  pucken og de eksakte 24 kHz PCM-bytes efter resampling, umiddelbart før de sendes
  til OpenAI. RMS, peak, clipping, varighed og frameantal vises i panelet.
- En millisekund-tidslinje binder wake, provider-connect, VAD, transskription,
  værktøjer, svarlyd, fysisk afspilning, echo-gate og lukkeårsag sammen. Dermed kan
  tabte førsteord, forurenede opfølgninger og falske `farvel` placeres i det rigtige
  led uden flere blinde gain-/promptændringer.
- Grundtesten har nu den særskilte dom “Kan ikke testes nu”, så manglende
  PodConnect-/musikopsætning ikke registreres som en høre- eller svarfejl. En
  blokeret funktion kan fortsat ikke gøre den samlede grundgate grøn.

## 1.12.22 — én fysisk grundtest før flere lokale lapper

- Test-fanen guider nu ejeren gennem én fast baseline på 20 danske sætninger:
  wake i samme åndedrag, opfølgning, tid/matematik, sport/web, lokalt vejr, HA-lys,
  PodConnect/Spotify, timer, aktuelle nyheder og ren lukning.
- Hver sætning kræver en fysisk dom: korrekt, forkert hørt, forkert svar eller intet
  skete. Et grønt tool-kald kan derfor ikke længere få et irrelevant svar til at se
  godkendt ud.
- Resultatet gemmer den faktiske transskription, det hørte svar, states, svartid samt
  tool-argumenter og det bundne resultat, GPT modtog. Grundgaten kræver mindst 19/20,
  nul irrelevante/stonne svar, simpelt p90 højst 2,5 s og opslag p90 højst 8 s.
- Tool-loggen viser nu et begrænset query/resultat-bevis i stedet for kun `-> ok`, så
  en forkert sports-query eller irrelevant søgekilde kan diagnosticeres direkte.

## 1.12.21 — naturlig wake-sætning og hurtigere værktøjsflow

- Voice PE starter nu den privatlivsgatede mikrofonstrøm ved den lokale
  “Okay Nabu”-detektion, før den officielle startlyd og 300 ms-pause. Realtime
  forbinder parallelt med resten af brugerens sætning, og de første lydframes
  bevares gennem opkoblingen. “Okay Nabu, hvad er klokken?” kan derfor siges som
  én naturlig ytring uden en indlært pause.
- En afbrudt ESPHome-forbindelse nulstiller nu altid en eventuelt strandet lokal
  Voice Assistant-kørsel ved genforbindelse. Det forhindrer næste wake i at ramme
  upstream-firmwarens STOP-gren og se helt død ud.
- Realtime stop-på-tale bruger OpenAIs dokumenterede 500 ms-baseline i stedet for
  700 ms. Den bundne inputkø er udvidet til hele den otte sekunders
  opkoblingsgrænse, så et langsomt net ikke bevarer spørgsmålets start og taber
  slutningen.
- Værktøjer kaldes straks uden “Det tjekker jeg”-fyld. Gul tænker-LED er den
  umiddelbare status; hurtige svar går direkte til resultatet.
- En urørt gemt 1.12.20-prompt migreres automatisk, så den gamle “tal først,
  kald bagefter”-regel ikke overlever opdateringen i `/data`.
- Firmwaren annoncerer `same_breath_v1`. Ældre pausekrævende firmware vises nu
  ærligt som degraderet i stedet for grøn og “verificeret”.
- Wake-bippet er som standard slået fra: cyan ring er det øjeblikkelige
  lyttesignal, capture starter uden højttalerforurening, og den officielle ekstra
  300 ms-pause forsvinder. HA's eksponerede Wake sound-switch kan stadig slås til
  live ved et konkret tilgængelighedsbehov.

## 1.12.20 — sandfærdigt, tilgængeligt kontrolpanel

- Panelet viser kun OpenAI som verificeret efter en virkelig Realtime-forbindelse;
  en konfigureret API-nøgle er ikke længere lig med en grøn driftsstatus.
- Hjem, Tal, Test, Historik og Indstillinger har nu en klar dansk
  informationsarkitektur, komplette tastaturtabs, synligt fokus, 44 px touchmål,
  responsivt layout og tekstlige statusnavne, der ikke kræver farvesyn.
- Talk starter kun en samtale efter vellykket mikrofonadgang, skelner mellem de
  almindelige iPhone-/browserfejl og frigiver alle mikrofonspor ved Afslut eller
  når siden forlades.
- Den uverificerede påstand om øjeblikkelig stop under tale er fjernet. Delvist
  udfyldte rummappings blokerer nu gemning i stedet for at blive slettet lydløst.

## 1.12.19 — PodConnect Control bruges som Spotify-autoritet

- PodVoice opdager nu PodConnect Controls faktiske Home Assistant-services og
  annoncerer kun de installerede `podconnect_recently_played`,
  `podconnect_top_tracks` og `podconnect_liked` til Realtime GPT. Kald går gennem
  HA's dokumenterede `return_response`-API til PodConnects egne
  `{tracks:[{name,artist,uri}]}`-resultater — ingen webomvej, automation eller
  duplikeret Spotify-klient.
- "Hvad var det sidste nummer?" routes eksplicit til første resultat fra
  `recently_played`; `GetLiveContext` er kun aktuel `media_player`-state og må ikke
  bruges som en falsk historikvej. Mangler PodConnect Control, eksponeres værktøjet
  slet ikke, og assistenten skal fejle ærligt.
- Talk viser nu komplette vendinger i stedet for rå transcript-deltas. OpenAIs
  asynkrone inputtranscript kan derfor ikke længere splitte "Det tjekker jeg" rundt
  om brugerens boble; værktøjsforløbet vises som bruger → kort kvittering → værktøj
  → svar.

## 1.12.18 — én dokumenteret dansk lydkæde for Talk og Voice PE

- **Kvalitet er igen standarden:** `gpt-realtime-2.1` er nu standardhjerne. OpenAI
  beskriver 2.1 som modellen med højeste reasoning og forbedret alfanumerisk
  genkendelse/støj-/afbrydelsesadfærd; `2.1-mini` er den destillerede pris- og
  hastighedsvariant og findes fortsat som det eksplicitte `force_mini`-valg.
- Den separate panel-/log-transcript bruger nu OpenAI Docs' anbefalede
  `gpt-live-transcribe`, `languages:["da"]` og dansk kontekst for navne, klubber og
  akronymer. Transcriptet er diagnostisk vejledning; Realtime-modellen hører lyden
  direkte og kan have forstået noget andet.
- **Kildespecifik støjbehandling:** Voice PE channel 1 har allerede XMOS AEC+IC+NS,
  så dens ekstra OpenAI-filter er som standard slukket. Talk slår browserens NS og
  AGC fra, beholder ekkoannullering og bruger præcis én OpenAI `far_field`-pass.
- Talk beder om 24 kHz direkte. Browserfallbacken bruger nu intervalmiddel i stedet
  for den dokumenteret skadelige nearest-neighbour-decimering, og den faktiske
  sample rate/NS/AGC/AEC-konfiguration logges ved hvert mic-start.
- **Talk-værktøjsvisningen var falsk:** serveren sendte et fladt result, mens UI'en
  læste `ev.result`; derfor blev alle kald vist som ✕ og den virkelige MCP-fejl
  skjult. Talk viser nu det faktiske `{ok, summary/data/error}`-resultat.

## 1.12.17 — ASR-input tilbage til dokumenteret Voice PE-baseline

- PodVoice re-assert’er nu den dokumenterede inputkæde på hver Voice PE-connect:
  XMOS channel 1 uden AGC, mic gain 4 og OpenAI `far_field`. Sidstnævnte blev
  korrigeret i 1.12.18, fordi channel 1 allerede indeholder XMOS noise suppression.
  En tidligere default på `mic_gain=16` kunne overstyre firmwarebaselinen og give
  “bytes flyder, men dansk bliver fonetisk vrøvl”.
- OpenAI input-transskription logges nu som `turn: input transcript '...'`. Den er en
  separat ASR-diagnose, ikke ordret sandhed om Realtime-modellens egen lydforståelse.
- Panelets Advanced → Mic quality viser den dokumenterede baseline, men stop-under-svar
  er bevidst parkeret som separat hardware-interrupt-opgave.

## 1.12.16 — stuetest viser næste handling

- `/api/acceptance` returnerer nu en kort `next_action`, så panelet siger hvad der
  konkret skal rettes eller gentestes i stedet for kun at vise røde checks.
- Stuetest-panelet viser “Næste handling” under statuslinjen. Grøn basis-evidens
  minder stadig om, at den fysiske oplevelse skal vurderes før PodVoice kaldes færdig.

## 1.12.15 — panelet viser turn-cue som ja/nej

- `/api/acceptance` viser nu eksplicit `turn_cue=ja/nej` i turtagningsdetaljen.
  Hvis den fysiske stuetest fejler på “hvornår er det min tur?”, skal panelet nu
  pege direkte på om bip-markøren blev set, i stedet for kun at vise state-listen.

## 1.12.14 — stuetest beviser tur-bip, og musikspørgsmål må bruge web korrekt

- Hub state-events markerer nu, når follow-up-fasen blev nået med den hørbare
  turn-cue (`turn_cue=true`). `/api/acceptance` kræver den markør efter frisk
  stuetest, så “dæmpet cyan” alene ikke længere kan ligne et bevist tur-bip.
- Thin-engine-testen kobler nu den faktiske reply-stream-tone til hub-evidensen:
  svar → turn-tone → `LOUNGE_WINDOW` med `turn_cue=true`.
- Musikprompten er nu præciseret: PodConnect/HA er autoritet for Spotify-bibliotek,
  historik og “hvad spiller der”, men web er korrekt til ekstern viden om en sang,
  kunstner, album, koncert, genre eller tekstbetydning.

## 1.12.13 — musik er HA-first, men PodConnect-aware

- Produktmålet og bruger-dokumentationen beskriver nu PodConnects reelle split:
  Control-integrationens HA `media_player`/`podconnect.*`-services er standardvejen
  til Spotify-søgning, bibliotek, historik og normal transport, mens Speakers-add-on'et
  fortsat ejer ducking, restore og account-agnostic stop/release.
- Defaultprompten instruerer Realtime GPT i samme kontrakt, så den ikke bruger web til
  Spotify-bibliotek eller hjemmets aktuelle afspilning og kun går uden om HA, når
  PodConnect Speakers' fysiske stop/release er den rigtige flade.
- Panelets setup-hint for manglende musikværktøjer peger nu på PodConnect Control/HA
  for musikkommandoer og PodConnect Speakers URL/token for ducking/stop/release.

## 1.12.12 — stuetest beviser også turntaking-faser

- Hubben gemmer nu seneste room state transitions med timestamps (`LISTENING`,
  `THINKING`, `AI_SPEAKING`, `LOUNGE_WINDOW`, `IDLE`).
- `/api/acceptance` kræver efter frisk stuetest, at runnet har set en lyttefase, en
  tænke/talefase og en afslutnings-/follow-up-fase. Det er software-beviset for den
  LED/bip-turntaking, der stadig skal verificeres fysisk på Voice PE.
- State-evidens filtreres også efter “Start frisk stuetest”, så gamle state-skift ikke
  kan gøre en ny test grøn.

## 1.12.11 — latency tæller også kun efter frisk stuetest

- Room status gemmer nu `last_latency_ts` sammen med `last_latency_ms`.
- Når “Start frisk stuetest” er brugt, tæller `/api/acceptance` kun latency målt
  efter baseline. En gammel svartidsmåling kan derfor ikke længere gøre det fysiske
  testbevis grønt.

## 1.12.10 — frisk stuetest-baseline uden at slette historik

- Panelet har nu “Start frisk stuetest”. Den sætter et baseline-tidspunkt og
  metric-baseline uden at slette historik eller nulstille runtime-data.
- `/api/acceptance` tæller derefter kun historik, tool-events og metric-delta efter
  baseline. Dermed kan gamle samtaler eller gamle tool-kald ikke få en ny fysisk test
  til at se grøn ud.
- `/api/stuetest/start` gør baseline-starten testbar og scriptbar.

## 1.12.9 — panelet viser selve stuetesten

- Nyt `/api/stuetest` eksponerer den kanoniske fysiske Voice PE-testmatrix som data:
  turtagning, AGF/web, lokalt vejr, opfølgning, hjemmestyring, musik og stop/lukning.
- Panelets “Stuetest-evidens” viser nu både testscriptet og beviskortet samme sted.
  Det gør næste live-test mindre tilfældig: først læses den konkrete sætning, bagefter
  ses hvilke evidenspunkter der faktisk blev grønne.

## 1.12.8 — panelet guider HA-first opsætning

- Tool-capabilities returnerer nu `missing`, `setup_hints` og `sources`, så panelet kan
  forklare præcis hvilke HA/MCP-evner der mangler: MCP/exposed entities,
  Gemini-/søgeagent, HA weather og PodConnect/media-værktøjer.
- Panelets advarsel bruger backendens hints i stedet for en hårdkodet tekst. Det gør
  Home Assistant til den praktiske opsætningskilde for hjem, vejr og musik — også når
  capability-logikken ændres.

## 1.12.7 — Home Assistant er førstevalg for hjemmet

- Standardprompten siger nu eksplicit, at Home Assistant er autoriteten for hjemmets
  enheder, rum, sensorer, vejr, scripts, scener, musikstatus og eksponerede
  værktøjer. Realtime skal bruge HA/MCP først for hjem/placering og først bruge
  web/søgning til verden udenfor eller som fallback.
- Vejr dér hvor familien er, er nu promptet som `HA/weather først`; web er kun
  fallback eller til et andet sted.
- En gemt 1.12.6-standardprompt migreres automatisk til den nye standard, mens reelle
  brugerændringer stadig bevares.

## 1.12.6 — stuetest kræver konkrete værktøjsbeviser

- Hubben gemmer nu de seneste konkrete tool-navne og resultater, ikke kun samlede
  tællere. Dermed kan panelet vise om Realtime faktisk kaldte web/søgning, musik
  eller et HA/MCP-hjemmeværktøj.
- Panelet viser nu `Vejr` som sin egen kapabilitet ved siden af tid, hjem,
  web/søgning, musik og timere.
- `/api/acceptance` kræver nu separat evidens for hjemmestyring, web/søgning,
  vejr og musik/media. Et ensomt `get_time`-kald kan derfor ikke længere få
  stuetestens værktøjsdel til at se grøn ud.
- Classic- og thin-engine skriver begge tool-evidens til hubben, inklusive
  `end_conversation` i thin, så “stop/farvel” også kan ses som modelstyret handling.

## 1.12.5 — stuetest-metrics må ikke lyve

- `false_barges` var incrementet i thin-engine, men manglede i hub'ens metrikliste og
  blev derfor aldrig talt. Den tæller nu korrekt.
- Thin-engine tæller nu tomme men succesfulde tool-resultater som `tool_empty`, ligesom
  den ældre engine, i stedet for at blande dem sammen med `tool_ok`.
- Panelets Metrics-sektion viser nu alle de tællere, der bruges til stuetest og soak:
  tool calls/ok/empty/error, watchdog-aborts og musik-duck/restore.

## 1.12.4 — stuetesten får et beviskort

- Nyt `/api/acceptance` samler status, capabilities, metrics og historik til et
  konservativt stuetest-beviskort. Det kan vise “mangler evidens” eller
  “basis-evidens findes”, men erstatter ikke den fysiske matrix i `docs/PRODUKTMÅL.md`.
- Panelets forside viser samme beviskort: services, Voice PE-forbindelse, tool-
  kapabiliteter, fysisk samtalehistorik, opfølgningsform, værktøjskald og målt
  svartid. Formålet er at forhindre grøn mavefornemmelse uden faktisk logbevis.

## 1.12.3 — panelet viser om web og musik faktisk findes

- `/api/status` og `/health` viser nu de aktuelle tool-kapabiliteter: tid, timere,
  Home Assistant, web/søgning og musik — plus de konkrete toolnavne Realtime får.
- Panelet viser en gul advarsel, hvis web/søgning eller musikstyring ikke er
  eksponeret via Home Assistant/MCP. Dermed er “Home control er grøn” ikke længere
  falsk bevis for, at AGF/websøgning eller PodConnect-musik kan bruges.
- Tests dækker både capability-klassificering i ToolRouter og status/health-output.

## 1.12.2 — wake åbner rigtigt til Realtime

- Mikrofonframes fra de første sekunder efter wake buffres nu, indtil OpenAI Realtime
  har accepteret `session.update`. Det lukker feltfejlen hvor “Okay Nabu hvad er
  klokken” kun virkede, hvis man holdt en kunstig pause efter wake-ordet.
- Et nyt `wake_okay_nabu` mens samtalen allerede er aktiv, skifter nu tilbage til
  “lytter”, nulstiller idle-vinduet og bevarer den samme Realtime-samtale. Det skal
  føles som “jeg prøver igen”, ikke som en død assistent.
- Regressionstests dækker både preconnect-lydbufferen og aktiv re-wake fra
  Voice PE-firmware-eventet.

## 1.12.1 — prompten håndterer dansk ASR-usikkerhed bedre

- Den observerede `AGF spille` → `give spil`-fejl er nu gjort eksplicit i
  systemprompten som en fonetisk ASR-usikkerhed: modellen skal spørge kort eller søge
  målrettet, ikke vælge et irrelevant hjemme-/vejrresultat.
- Der er stadig ingen deterministisk bypass i runtime. Realtime-modellen ejer fortsat
  fortolkning og værktøjsbrug; kontrakten er bare skærpet, så den ikke belønnes for et
  faktuelt men forkert svar.
- En gemt 1.12.0-defaultprompt migreres automatisk til den nye 1.12.1-default, mens
  reelle brugerændringer bevares.
- PodVoice-panelet viser nu den kørende version i toppen, og `/health` returnerer
  samme version. Dermed kan vi se forskel på “repo er opdateret” og “HA kører faktisk
  den nye add-on”.
- `docs/PRODUKTMÅL.md` har nu en kort stuetest-protokol for turtagning, AGF/websøgning,
  opfølgning, HA-kommandoer, musik, stop, LED og bip — den fysiske test er fortsat
  det der afgør, om kandidaten virker.
- De gamle Voice PE/Gemini-planer er markeret som historiske, så næste debugrunde ikke
  læser dem som kanonisk leveranceplan.

## 1.12.0 — ærlig turtagning, relevant værktøjsbrug og sikker direct-opstart

- Voice Assistants direct-svar har nu både sin egen resampler og sin egen mixer-source
  med endelig timeout. YAML, genereret C++ og fuld firmwarebygning er verificeret; en
  hel fysisk samtale mangler stadig, så standarden forbliver `announce`.
- Direct-opstarten har nu en eksplicit API-audio-handshake. En direct-TTS før første
  wake efter boot kørte ellers Voice Assistant i standard-UDP-tilstand og crashede
  enheden på en uåbnet socket. Kun firmware med både `direct_speaker_v3` og servicen
  `podvoice_direct_prepare` kan vælges automatisk; ældre kandidater falder tilbage til
  announce.
- Feltprøven 11. august fangede `AGF spille` som `give spil`: modellen valgte
  `GetLiveContext` og læste irrelevant vejr op. Prompten kræver nu semantisk relevans
  og opklaring: GetLiveContext er kun hjemmets tilstand, og et faktuelt men irrelevant
  værktøjsresultat må ikke siges højt.
- Turtagningen følger nu det, familien faktisk hører: ringen forbliver grøn til sidste
  svarbyte, et stille reverb-mellemrum + et kort stigende bip markerer "din tur", og
  opfølgningsvinduet er dæmpet cyan. Ny tale gør cyan klar igen. Lukketonen er gjort
  tydeligere; LED slukkes fortsat ved den fulde teardown.
- Den eksisterende Gemini-søgeagent via Home Assistant forbliver eneste søgevej. En
  konkurrerende OpenAI-søgefunktion blev afvist under review, fordi den kunne skygge
  HA-værktøjet og manglede en entydig routingregel.
- FLAC-streaming afslutter korte svar korrekt og lukker chunked HTTP-responsen; den
  tidligere testhang var en reel sluttilstandsfejl.
- Panelet viser rå IP-adresser som et gult problem ved rumfeltet og forklarer `.local`
  samt fast DHCP-reservation. Død transcript-JavaScript og den dobbelte lysforklaring
  er fjernet.
- Python 3.12-afhængigheder er låst, CI installerer runtime + dev sammen, og den
  målbare releasekontrakt står i `docs/PRODUKTMÅL.md`.

## 1.11.1 — hastefix: direktvejen efterlod pucken hængende, tilbage til den beviste vej

**Symptomet du så:** intet svar, og ringen der spandt blåt i det uendelige.

**Årsagen, fra puckens egen log:**

```
15:24:43.960  State IDLE -> STREAMING_RESPONSE
15:24:45.723  End of audio stream received
15:24:45.723  State STREAMING_RESPONSE -> RESPONSE_FINISHED   ← og aldrig længere
```

Der står aldrig *"Speaker has finished outputting all audio"*. Enheden når `RESPONSE_FINISHED`, men kommer aldrig videre, fordi den venter på, at højttaleren melder sig færdig — og den højttaler er **delt med medieafspilleren**, som holder den kørende. Derfor kom `reply_played` aldrig, og derfor blev `voice_assistant_phase` hængende på 5 ("svarer"). Den blå spinner var pucken, der troede, den stadig talte.

Jeg efterprøvede kontrakten på hardwaren før udrulning — tjenester, event-typer, wake-ord — men **jeg havde ikke hørt den sige en hel sætning over direktvejen.** Det var netop dét forbehold, jeg skrev, og det var netop dér, fejlen sad. Kontrakten var rigtig; adfærden var ikke.

- **`speaker_path` er tvunget tilbage til `"announce"`** — den vej, der har virket hele tiden. Settings-version 6 kasserer et gemt `"auto"` fra 1.11.0, så opgraderingen faktisk lander.
- `"auto"`/`"direct"` findes stadig som bevidst tilvalg, så firmware-fejlen kan testes, når den er rettet.
- Ny regressionstest låser standarden fast.

Firmwaren behøver ikke flashes om. Den nye 2b-firmware er bagudkompatibel og kører announce-vejen fint — de to ekstra triggere ligger bare ubrugte, indtil den delte højttaler er løst.

## 1.11.0 — Setup er tre felter; resten er maskinens arbejde, ikke ejerens

Din kritik var berettiget: jeg havde præsenteret motorrummet som valg.

- **Hverdag** står nu øverst med de tre indstillinger, der er en reel præference: **wake word**, **luk efter stilhed**, **musikvolumen mens du taler**.
- **Hardware — sat én gang**: PSK og rum.
- **Avanceret** (foldet sammen) rummer nu motor, model, stemme, afbrydelsesstil, maks. samtalelængde og mini-model — sammen med systemprompt, PodConnect/MCP, Sikkerhed og Diagnostik.

Intet er slettet, og ingen `id` er ændret, så alle gemte værdier og alle 17 felter fungerer uændret. Efterprøvet ved at sammenholde DOM'en med panelets feltliste (17/17, ingen dubletter) og ved at åbne siden i en browser.

## 1.10.0 — wake word i UI'et, duplex gated af hardwaren, og et testmiljø der betyder noget

- **Wake word kan nu vælges** (Okay Nabu / Hey Jarvis / Hey Mycroft). Firmware-action + panelmenu. Påføres ved **hver** forbindelse, så den overlever en strømafbrydelse — samme lektion som forstærkningen i 1.6.0. "Okay Chat" kræver stadig en trænet model.
- **To defaults ville have gjort hele 2b-flashen virkningsløs**: både settings og Config stod stadig på `speaker_path="announce"`. Med v5-oprydningen ville de være faldet tilbage dertil, og flashen havde ikke ændret noget — uden en fejlmeddelelse nogen steder. Begge er nu `"auto"`.
- **`full_duplex` afvises nu på mikrofonkanal ≠ 0.** Duplex kræver ekkoannullering, og kun XMOS-kanal 0 har den. Flaget var en nøgen bool, der slog skjoldet fra uanset kanal — det var sådan 0.92-0.95 sendte en puck, der afbrød sig selv.
- **Playout-uret er nu begrænset af virkeligheden**: på direktvejen kan den "hørte" position ikke overstige de bytes, der faktisk er afleveret. Det er dét tal, modellen får ved en afbrydelse, så en fejl her omskriver dens hukommelse om samtalen.
- **Testmiljøet var Python 3.9** på et projekt, der kræver 3.12. Det manglede `asyncio.timeout` og `aioesphomeapi`, så syv tests fejlede af rene miljøårsager — og enhver "suite grøn"-påstand herfra var delvis meningsløs. Genopbygget: **271 tests grønne, ægte, for første gang.**

## 1.9.1 — et stoppet direkte svar må aldrig efterlade mikrofonen døv

Fundet under gennemgang af min egen 1.9.0: pumpen lukkede strømmen inde i sin egen `except asyncio.CancelledError`. `CancelledError` arver fra `BaseException`, så en anden annullering smutter forbi `suppress(Exception)`, og `TTS_STREAM_END` blev sprunget over. Enheden ville så sidde i STREAMING_RESPONSE, aldrig nå RESPONSE_FINISHED, aldrig sende `reply_played` — og skjoldet ville blive oppe for evigt: en permanent døv mikrofon, uden en linje i loggen.

Lukningen sker nu fra en task, der **ikke** er den, som annulleres, efterfulgt af en garanteret frigivelse af skjoldet.

## 1.9.0 — direktvejen: enheden FORTÆLLER os nu, hvornår svaret sluttede

Ekko-skjoldet holder op med at gætte og begynder at vide.

- **Firmware** (to triggere, isolerede): `on_tts_start` låser resampleren til 24 kHz per svar, og `on_tts_stream_end` sender `reply_played`. Enheden fyrer den fra `RESPONSE_FINISHED`, som den kun når, når `speaker_buffer_size_ == 0 && !has_buffered_data() && !is_running()` — altså når **sidste byte har forladt DAC'en**.
- **Hvorfor 0.67 spillede chipmunk** (fundet i den pinnede C++, ikke gættet): add-on'en sendte `TTS_START` med et **tomt** data-map, og handleren afbryder på `if (text.empty()) return;` *før* den fyrer `on_tts_start` og *før* `speaker_->start()`. Rate-låsningen, som 0.67 selv havde skrevet, kørte derfor aldrig; resampleren beholdt de 48 kHz, som den delte `external_media_player` sidst satte, og 24 kHz-svaret kørte i dobbelt tempo. Én tom dict.
- **Vejen vælges af enheden**, ikke af en gemt indstilling: firmwaren annoncerer `reply_played`, og add-on'en retter sig efter det. 0.70's totale stilhed er nu uopnåelig via konfiguration.
- **Tempostyring er obligatorisk**, ikke kosmetik: enhedens `on_audio` dropper **hele** chunken ved bufferoverløb (16 KB), hvilket taber ord lydløst. Forspringet er 0,15 s.
- **Kendt omkostning**: `request_stop()` gør intet for højttalervejen (hele grenen er `#ifdef USE_MEDIA_PLAYER`), så en afbrydelse lader de op til 0,15 s, der allerede ligger i enhedens buffer, spille færdig. Puckens lokale wake-ord-hush skærer stadig ved ~51 ms.

## 1.8.0 — ekko-skjoldet holder nu HELE svaret: det stolede på en melding, der kan udeblive

Loggen 16:42 viste selv-afbrydelsen på fersk gerning igen:

```
16:42:23  svaret begynder at afspille
16:42:27  mic level ~426        ← mikrofonen sender MENS den taler
16:42:28  barge-in (speech_started)
          truncated at 0ms      ← svaret dræber sig selv
```

- **Rodårsagen**: skjoldet hvilede på, at enheden MELDER "jeg afspiller". Kommer den melding sent — eller slet ikke — falder skjoldet efter for-armens 1,5 sekund, mens svaret stadig lyder i rummet. Så hører modellen sig selv, opfatter det som en afbrydelse, og kapper sit eget svar ved 0 ms hørt.
- **Fixet**: vi HAR selv genereret hver eneste byte af svaret, så vi ved præcis hvor langt det er (24 kHz, 16-bit). Skjoldet holdes nu oppe i den **byte-beregnede varighed** — en kilde der ikke kan udeblive. Melder enheden alligevel "færdig", tror vi den (bedre evidens) og frigiver med det samme; melder den intet, bærer beregningen skjoldet hele vejen.
- Ny regressionstest: et to-sekunders svar er beskyttet **uden en eneste melding fra enheden**.

Mikrofon-forstærkningen (16) og kanal 1 er sat igen live — de gik tabt, da firmware-flashen genstartede pucken, hvilket er præcis det, 1.6.0's automatiske gensætning forhindrer fremover.

ruff + mypy rene; hele suiten grøn.

## 1.7.0 — advarslen om mistet forbindelse gav forkert råd og råbte for tidligt

Panelet skrev: *"Mistet forbindelsen til Voice PE — brug enhedens .local-navn, ikke en IP"* — mens hosten **bevidst** var en IP-adresse, netop fordi .local ikke kan slås op inde i add-on'ets container. Rådet var altså ikke bare unyttigt, det var forkert. Og afbrydelsen varede få sekunder (en genflash) og helede sig selv.

- Advarslen venter nu **20 sekunder** og siger kun noget, hvis enheden STADIG er væk. Et blink under en genstart eller en wifi-hikke skal ikke lære familien at ignorere feedet.
- Teksten passer nu til situationen: står der en IP, foreslår den at tjekke strøm og netop den adresse; står der et navn, foreslår den at skifte til IP.

ruff + mypy rene; hele suiten grøn.

## 1.6.0 — mikrofon-indstillingen overlever nu en strømafbrydelse (+ tre fund fra 1.5-loggen)

Ejeren spurgte: "er der andre dele tunet til noget gammelt og forkert?" Ja — og ét var kritisk:

- **KRITISK: mikrofon-forstærkningen levede kun i hukommelsen.** Firmwarens indbyggede standard er gain 4; de 16, vi justerede os frem til, lå i puckens RAM. Ved næste strømafbrydelse ville den lydløst falde tilbage — og transskriptionen ville blive dårligere igen, uden at nogen forstod hvorfor. Kanal og forstærkning er nu **rigtige indstillinger**, der sendes til enheden ved HVER forbindelse. Indstillingen er sandheden, ikke firmwarens gamle standard.
- **Falsk alarm fjernet**: "SILENT — wrong firmware channel?" fyrede ved helt almindelig stilhed mellem to spørgsmål (mic level ~13 er tavshed, ikke en død kanal). Den advarsel råbte ulv hvert femte sekund og skjulte de ægte. Nu advarer den kun, hvis en HEL samtale er gået uden rigtigt signal — som er den ægte død-kanal-signatur.
- **"Den stopper pludseligt"** står i loggen: `client-side idle fallback (7s quiet) — closing`. Luk-vinduet er din egen indstilling (6 s). Uret starter nu først, når rummet faktisk er stille — et svar, der stadig afspilles, tæller ikke som tavshed, så du får det fulde vindue til at svare.
- **Færre unødvendige opslag**: 1.1.0 gjorde den søge-glad, og loggen viser websøgning på næsten hver tur (~2 s hver gang). Prompten siger nu: slå kun op, når du faktisk mangler noget — ved du det allerede (eller har du lige fået det at vide i samtalen), så svar straks.

ruff + mypy rene; hele suiten grøn.

## 1.5.0 — korte sætninger blev hugget af: turdetektionen var tunet til et problem vi ikke har mere

Felttesten afslørede et klart mønster: LANGE sætninger transskriberes perfekt ("Hvordan gik det AGF i deres seneste kamp?"), KORTE bliver til volapyk ("Tailam", "Hej deva", "Men hvad?"). Og **samme mønster i Talk-fanen med en ren Mac-mikrofon** — to vidt forskellige mikrofoner kan ikke fejle ens, så årsagen lå et fælles sted: serverens turdetektion.

- **Tærsklen var sat til 0,7** for at forhindre, at assistentens eget ekko udløste en afbrydelse. Det job udfører ekko-skjoldet og puckens egen wake-ord-lytning nu — men den høje tærskel kostede stadig **starten af hver kort ytring**: detektionen udløste for sent, og kun 300 ms lyd blev gemt fra før. Derfor blev "Okay Nabu" til "Tailam".
- Nu: **tærskel 0,45** (fanger svag og kort tale fra første stavelse) og **800 ms forlyd** (intet klippes af). Den danske tålmodighed på 700 ms er uændret.

ruff + mypy rene; hele suiten grøn.

## 1.4.0 — lyd- og lys-UX er nu DESIGNET, ikke tilfældig

Ejeren: "Det er random pt." — korrekt. Feedbacken var aldrig blevet tegnet som ét forløb; hvert signal var opstået enkeltvis. Hele tidslinjen er nu bevidst, og hvert trin har ÉT lys og HØJST én lyd:

| Øjeblik | Ring | Lyd |
|---|---|---|
| "Okay Nabu" | Cyan med det samme | Kort "ding" (enhedens egen) |
| Du taler | Cyan | Stilhed — den lytter |
| Du er færdig, den arbejder | **Gul** | Stilhed (eller "Lige et øjeblik" ved opslag) |
| Den svarer | **Grøn** | Svaret |
| "stop" midt i | Cyan igen | Øjeblikkelig stilhed |
| **Samtalen lukker** | Slukket | **NY: kort, blid nedadgående tone** |
| Fejl | Rød | Den siger højt hvad der er galt |

- **Det store hul var lukningen**: ringen gik bare i sort, i stilhed. Man kunne ikke høre forskel på "den holdt op med at lytte" og "den døde" — og man kunne ikke høre, at mikrofonen var lukket igen. Det er både UX og privatliv. Nu er der en kort, blid tone, tydeligt mildere end fejltonen, så den læses som punktum og ikke som problem.
- Panelets forside viser nu HELE forløbet som en tabel, så familien kan læse sproget i stedet for at gætte.

1 ny regressionstest. ruff + mypy rene; hele suiten grøn.

## 1.3.0 — du KAN afbryde den midt i et svar: pucken har altid kunnet høre "stop"

Ejeren spurgte om wake-ordet kunne bruges til at stoppe talen. Undersøgelsen af firmwarens egen logik viste, at det allerede virker — vi har bare aldrig fortalt det, og modellen fik det aldrig at vide:

- **Firmwaren lytter efter wake-ord HELE tiden, også mens den taler** (micro_wake_word kører frit på den ekko-rensede kanal). Høres et wake-ord — **"stop"** eller **"Okay Nabu"** — mens et svar afspilles, stopper enheden lyden ØJEBLIKKELIGT, lokalt, uden at mikrofonen åbnes. Ægte afbrydelse uden duplex-risiko.
- **Hullet vi lukker nu**: add-on'et opdagede godt at lyden holdt op, men fortalte det ikke til modellen — så den troede familien havde hørt hele svaret, og byggede videre på noget, ingen havde hørt. Nu får modellen præcis den hørte position (samme mekanik som ved almindelig afbrydelse), ringen skifter til "lytter", og afbrydelsen tælles i panelets metrikker.
- Panelet forklarer nu tysse-genvejen, så familien kender den.

1 ny regressionstest. ruff + mypy rene; hele suiten grøn.

## 1.2.0 — lyset starter ikke længere "sent", og ringen siger nu hvornår den tænker

To lys-fejl, begge målt i felten:

- **"Lyset starter sent"**: vi malede ringen i samme øjeblik du sagde "Okay Nabu" — men 0,2 s senere sender vi RUN_END til pucken (så næste wake kan fyre), og FIRMWAREN slukker sin egen ring på det signal. Først 0,45 s senere malede vi igen. Resultatet var et glimt, et mørkt hul på et kvart sekund, og så lys — en 100 ms wake FØLTES langsom. Ringen holdes nu tændt hen over firmwarens nulstilling (tre billige genmalinger inden for 0,6 s), så lyset er der fra første øjeblik og aldrig blinker ud.
- **Ringen sagde aldrig "jeg tænker"**: den gule tilstand fandtes i koden, men blev aldrig brugt af den nye motor. Når du var holdt op med at tale, lyste ringen stadig cyan ("lytter"), mens den i virkeligheden arbejdede. Nu skifter den til gul, så rummet kan se forskel på *lytter*, *tænker* og *taler*.

Lyd-siden (ingen kode, live-justeret): mikrofon-forstærkningen står nu på 16 via runtime-servicen.

2 nye regressionstests. ruff + mypy rene; hele suiten grøn.

## 1.1.0 — "det ved jeg ikke" er ikke et svar: slå op i stedet for at trække på skuldrene

Felttest på den nye mikrofonkanal: "Hvor er de fra?" → *"Det er et fodboldhold, men jeg er ikke sikker på, hvor det kommer fra."* Modellen fulgte faktisk prompten (geografi = uforanderligt = svar fra egen viden), men den VIDSTE det ikke — og så gav den op i stedet for at bruge søgningen, den har.

- Prompten har nu en klar rækkefølge: **ved du det sikkert → svar; ellers → SLÅ OP; kun hvis opslaget fejler → sig at du ikke kan finde det.** Gælder også uforanderlige fakta. "Hvor kommer klubben fra?" skal give et svar, ikke et skuldertræk.

Lydsiden (ingen kode): mikrofonens forstærkning er hævet live 4 → 12 → 16 via de nye runtime-services. Effekten er målt i History: "klappen" blev til **"Hvad er klokken?"**, og korte ytringer som "Hvor de fra?" rammer nu korrekt.

ruff + mypy rene; hele suiten grøn.

## 1.0.0 — HASTEFIX: 0.98's adresse-liste brækkede forbindelsen til pucken

0.98 gav ESPHome-klienten en LISTE af adresser (navn + cachet IP). Klienten accepterede den — og lavede den om til teksten "['podvoice-pe-...local']", som den så forsøgte at slå op som ét værtsnavn. Resultatet: pucken kunne ikke nås AD NOGEN VEJ, heller ikke via en ren IP-adresse. Panelet sagde ærligt "offline", men årsagen var min egen ændring.

Lektien er den samme som med idle_timeout_ms: **at et bibliotek ACCEPTERER en værdi beviser ikke at den VIRKER.** Jeg testede kun at konstruktøren ikke smed en fejl.

- Klienten får igen ÉN adresse som almindelig tekst.
- Den cachede adresse bruges nu KUN når værtsnavnet ikke kan slås op i add-on'ets eget netværk (HA's container har typisk ingen mDNS — det er derfor .local kan virke fra en Mac og fejle inde i add-on'et).
- Testen er skærpet: den kræver nu en tekst-adresse, ikke bare "en værdi".

ruff + mypy rene; hele suiten grøn.

## 0.99.0 — Talk-fanens lyd blev ødelagt af vores egen omregning (og svar blev klippet midt i ordet)

Ejeren: "Bruger jeg Whisper Flow på samme maskine og afstand, hører den 100 %." Det var det afgørende spor — det var ikke mikrofonen, det var VORES lydvej i browseren:

- **Ingen omregning mere i Talk**: browseren optog 48 kHz, vi nedskalerede med den simpleste metode til 16 kHz (kraftig aliasing), og serveren skalerede så OP til 24 kHz igen. Dobbelt ødelæggelse af netop de frekvenser dansk tale bæres af. Nu optager browseren direkte ved OpenAI's egne **24 kHz** og lyden sendes urørt. Advarer synligt, hvis browseren nægter at give 24 kHz.
- **Svar blev klippet midt i et ord** ("Lad mig lige tjek" + "ke klokken for dig"): en tilstands-besked midt i talestrømmen lukkede taleboblen. Nu lukkes en boble kun ved en ægte tur-afslutning.
- Pucken sender 16 kHz (hardware-låst af mikrofonen, som wake-ordet deler) og opskaleres stadig — men opskalering uden aliasing er langt mildere end nedskalering, og resampleren er allerede rettet til at være sømløs hen over frame-grænser.

ruff + mypy rene; hele suiten grøn.

## 0.98.0 — fire fejl fra felt-loggen: rum-kontekst, mDNS-faldback, Talk-støj, medie-mål

Felttesten 14:35-14:36 gav fire konkrete fejl, alle rettet:

- **Musikkommandoer fejlede med "multiple targets"**: modellen vidste ikke hvilken højttaler den står ved, så HA afviste kaldet (`HassMediaSearchAndPlay FAILED`). Sessionen får nu rummets egen højttaler med i prompten ("brug ALTID name='Køkkenalrum HomePod'"), og prompten siger eksplicit at medie-kald KRÆVER et mål.
- **Pucken gik OFFLINE i minutter** fordi mDNS holdt op med at svare (`Name has no usable address`). Linket husker nu enhedens numeriske adresse og tilbyder BÅDE .local-navnet (overlever IP-skift) og den kendte adresse (overlever dødt mDNS) — den der svarer først vinder. Listeformen er verificeret direkte mod aioesphomeapi 45.3, ikke antaget.
- **Talk-fanen 404'ede på hver eneste ducking-puls** ("unknown room 'talk'") og slog sin egen puls ihjel. En browser-session ejer ikke et rums musik — den får nu en no-op i stedet.
- Advarslen om den forældede gemte prompt gentages ikke længere unødigt i loggen.

ruff + mypy rene; hele suiten grøn (+1 test).

## 0.97.0 — systemprompten lærte modellen at kalde værktøjer der ikke findes

Ejeren spurgte om prompten var i orden. Det var den ikke: den GEMTE prompt (3030 ord) beskrev hele det gamle værktøjs-univers — `list_home`, `list_services`, `home_call` — som blev SLETTET ved MCP-skiftet i 0.92. Modellen fik altså besked på at kalde værktøjer, der ikke eksisterer (0.88-klassen: prompten lover, værktøjskassen kan ikke). Selv kodens egen standardprompt havde ét levn tilbage.

- **Standardprompten renset**: sidste reference til et dødt værktøj fjernet (multi-room-linjen peger nu på hjemmets rigtige medie-værktøjer).
- **Generel beskyttelse — stærkere end hash-listen**: en gemt prompt, der nævner de pensionerede REST-værktøjer, droppes ved indlæsning med en tydelig advarsel i loggen. Hash-metoden fangede kun urørte standardprompter; denne fanger også dem nogen har redigeret. En ægte egen-skrevet prompt overlever uberørt (test).

ruff + mypy rene; hele suiten grøn (+2 tests).

## 0.96.0 — kode-revisionens dom: seks bekræftede fejl rettet, heraf én der forklarer HELE ugen

En fuld gennemgang af hver eneste modul (7 revisorer + adversariel verifikation af hvert alvorligt fund) fandt 74 punkter; 6 blev bekræftet som reelle. Den vigtigste er pinlig og præcis:

- **KRITISK — ekko-skjoldet var slået fra på PUCKEN og til i browseren: flagene var byttet om.** I 0.92 satte jeg `full_duplex=True` på det jeg troede var Talk-sessionen — det var puck-sessionen. Siden da har pucken kørt med åben mikrofon under sine egne svar, HARDKODET, hvor ingen indstilling (heller ikke 0.95's migrering) kunne nå det. Nu følger pucken indstillingen (skjold TIL), og Talk-fanen er duplex-øvebanen den skulle være. Ny test låser ledningsføringen fast, og loggen skriver nu "echo-shield=ON/OFF" ved hver samtale — fejlen var *dobbelt* lydløs.
- **KRITISK — lange svar blev hugget over midt i en sætning.** Luk-uret så på "genererer modellen?" i stedet for "kommer der lyd ud?" — og generering er færdig længe før afspilningen. Nu bruges enhedens egen afspilnings-sandhed (med et 3-minutters loft, så en hængende afspilning aldrig kan låse rummet), og "svaret er slut" tæller som aktivitet, så du får din fulde taletid. **Fejlen var maskeret af den første — de skulle rettes sammen.**
- **HØJ — efter "farvel" var huset dødt og musikken dæmpet i op til 7 sekunder** (og farvellen blev muligvis slet ikke hørt): luk-værktøjet blev talt som et "der kommer mere tale"-værktøj. Nu tælles kun værktøjer, hvis svar rent faktisk får den til at tale igen.
- **HØJ — panelet lyste grønt selv om pucken aldrig blev forbundet** (0.86-fejlen genopstået et andet sted): prikken blev sat ved opstart, ikke ved ægte forbindelse. Fjernet begge steder.
- **HØJ — "stop" efterfulgt straks af "Okay Nabu" kunne give en halvdød samtale** (musik på 100 %, mørk ring): et wake kunne smutte ind midt i en igangværende nedlukning. Wake venter nu på at lukningen er færdig (max 3 s, ellers afvises den højlydt).
- **HØJ — en gammel "farvel"-opgave kunne lukke den NÆSTE samtale** midt i et spørgsmål: opgaven havde ingen samtale-identitet. Den annulleres nu ved nyt wake og ved nedlukning, og bærer et samtale-stempel som bælte og seler.

3 nye regressionstests. ruff + mypy rene; hele suiten grøn.

## 0.95.0 — spøgelset fra 0.68: et gammelt full_duplex-flag havde slået ekko-skjoldet fra

Rodårsagen til "den afbryder sig selv / lyden brækker / farverne skifter ikke": i din gemte konfiguration lå `full_duplex: true` og `openai_turn: semantic_vad` fra 0.68-eksperimenterne. I 0.92+ betyder det flag "SLÅ EKKO-SKJOLDET FRA" — så pucken kørte med åben mikrofon under sine egne svar. Alle migreringer havde pænt bevaret indstillingen.

- **Settings v4**: et gemt `full_duplex` (og et gammelt `openai_turn`) nulstilles ved opgradering. Duplex kan KUN tændes bevidst efter matrix-C-gaten — aldrig arves fra gammel config. Regressionstest tilføjet.
- **LED-ringen virker igen**: vi maler ringen ved wake, men firmwaren nulstiller den 0,2 s senere på RUN_END (som vi selv sender for at frigøre næste wake). Ringen males nu igen bagefter.
- **Ingen 0-byte-svar mere**: en sen hentning efter samtalens luk fik serveret en tom lydfil, hvilket kan kile enhedens medieafspiller fast — og mens den tror den afspiller, er wake-ordet suspenderet (det er derfor "Okay Nabu" døde i perioder). Nu svares 204, og gen-annoncering springes over når samtalen er lukket.

ruff + mypy rene; hele suiten grøn.

## 0.94.0 — selv-afbrydelsen fanget på fersk gerning: hullet i skjoldet lukket + roligere barge-filter + hurtigere luk

Felt-loggen 11:20 viste kæden sort på hvidt: svar starter → 0,9 s efter fyrer "speech_started" → svaret dræbes ved 0 ms hørt → nyt svar genereres → 5+ sekunders død luft. Det var BÅDE "afbryder sig selv" OG "røv langsom" — samme fejl, to huller:

- **Skjold-hullet lukket**: for-armen dækkede kun 0,5 s efter announce, men lyd + mediestatus kommer først efter 0,8-1,1 s — det åbne vindue lod svarets egne første ord (eller din efterhængende stavelse) tælle som afbrydelse. Nu dækker for-armen 1,5 s, til mediestatussen tager over.
- **Roligere barge-filter**: 0,25 s → 0,6 s. Et "øhm", host eller ekko-blip dræber ikke længere svaret (det bufferede announce betyder at et filtreret blip koster NUL hørbart); en ægte afbrydelse varer altid længere og virker som før.
- **Hurtigere luk efter stilhed**: standard 25 s → 8 s (gulv 3 s) — og ejerens eget panel-felt kan sættes helt ned til 3-5 s.

ruff + mypy rene; hele suiten grøn.

## 0.93.0 — selvhelende hjemmestyring: én dårlig boot kan aldrig mere gøre den "lam"

Felt-fanget 20 minutter efter 0.92: HA Core tog sin ventende genstart, add-on'et bootede FØR HA's API var klar → tom værktøjsliste → "Jeg kan ikke nå hjemmets enheder" (ærligheden virkede!) — men tilstanden var PERMANENT til næste manuelle genstart. To fixes:

- **Proben selvhealer**: er værktøjslisten tom, gen-henter proben den (ved boot OG i 10-minutters-løkken) i stedet for at opgive. Testet: en fejlende tools/list ved boot heler nu sig selv med det samme.
- **Frisk værktøjsliste ved hvert wake**: samtalen får den AKTUELLE liste (ikke boot-øjeblikkets), så en HA-genstart midt på dagen aldrig efterlader samtaler uden hjemme-værktøjer.

ruff + mypy rene; hele suiten grøn (+1 regressionstest).

## 0.92.0 — ARKITEKTUR-releasen: 0.91 merged gated, alle modprøve-værn på plads

Den holistiske dom (docs/ARKITEKTUR.md) eksekveret — én pipeline, robusthed først:

- **0.91 merged**: OpenAI-only (Gemini slettet), gpt-realtime-2.1-mini standard, conservative-preset (server_vad 0.7/300/700 + far_field), MCP-hjemmestyring, prisstyring, −1.200 linjer.
- **idle_timeout_ms sendes ALDRIG** (modprøve A3): GA-docs definerer feltet som en GENPROMPT-trigger — modellen svarer SELV ved timeout, potentielt med tool-kald (uopfordret handling, Geminis dødssynd). Klient-idle er eneste lukker. Fyrer eventet alligevel, logges det højt i stedet for at lukke.
- **Hårdt config-værn (0.77-klassen lukket for altid)**: afvises session.update af ét eneste ukendt felt, dør provideren HØJLYDT (hørbar fejl + feltnavnet i loggen) i stedet for at køre videre uden prompt/tools/VAD.
- **Barge-kæden gjort duplex-klar men skjoldet består**: Interrupted fyrer nu ubetinget på speech_started (generering overhaler afspilning — den gamle gating gjorde hale-afbrydelse unåelig); sikkerheden bor i motorens guard (kun når noget faktisk spiller). End-phrase-fallbacken er gated mod rest-ekko af modellens eget "farvel".
- **Ægte MCP-probe** (modprøve A2): hjemmestyringen BEVISES ved at røre GetLiveContext — ved boot og hvert 10. minut. Tool-antal lyver ("lam men lyder rask"). Er hjemmet nede, siger assistenten det ÆRLIGT ved wake ("Jeg kan ikke nå hjemmets enheder lige nu") og fortsætter samtalen.
- **Stop-latens-metrik** (G1): loggen måler nu kommando→reelt-stille i ms ved hver afbrydelse/stop.
- **Talk-fanen = duplex-proving-ground**: browser-sessionen kører full_duplex (browser-AEC); pucken følger settings (default FRA til matrix-C-gaten består).
- Ny talt konto-fejl-linje; HANDOVER-idle-påstanden rettet.

VIGTIGT FØR OPDATERING (én gang): kør MCP-checklisten i HA FØRST — (1) Indstillinger → Enheder & tjenester → Tilføj integration → "Model Context Protocol Server"; (2) Indstillinger → Stemmeassistenter → Eksponér de enheder assistenten må styre. Uden dette er hjemmestyringen nede efter opdateringen (assistenten SIGER det ærligt, resten virker).

Firmware: uændret funktionelt — den flashede kanal-0-firmware ER den rigtige; ingen flash nødvendig.

ruff + mypy rene; hele suiten grøn.

## 0.91.0 — Pålideligheds-overhaul v2: OpenAI-only, MCP-hjemmestyring, prisstyring (fase 0–3)

Én pipeline, mindre kode, verificerede præmisser. Netto **−1.224 linjer** på tværs af fase 1–3.

**Fase 0 — præmisserne efterprøvet (docs/audio-path.md + docs/realtime-config.md):**
- Voice PE-firmwarens "unprocessed audio" er PR **#591** (opgaven pegede på #555 = en tastefejls-fix), og "unprocessed" betyder *uden AGC* — **stadig AEC-behandlet**. Begge XMOS-kanaler er AEC'ede; 0.83-ekkoet var rest-ekko, og 0.87's "kanal 1 er stum" skyldtes gain 1 uden AGC (mww bruger gain 4). "Raw"-testrækken er nåbar via `channels:[1]` + `gain_factor:4` (kommenteret i podvoice.yaml).
- OpenAI-provideren er GA-ren (beta blev fjernet 2026-05-12; alle event-navne verificeret). To forældede antagelser rettet: `idle_timeout_ms` FINDES (server_vad), og `gpt-4o-mini-transcribe` er den rigtige danske transskription.

**Fase 1 — selv-afbrydelsen:**
- Gemini-provideren, provider-vælgeren, google-genai og alle gemini_*-indstillinger er SLETTET. `openai_realtime.py` er hele provider-modulet (GPT-Live-1 = ny modelstreng + handlers dér).
- Default-model **gpt-realtime-2.1-mini** (udgivet 2026-07-06, distilleret og billig); 2.1 er opt-in; `force_mini` klemmer alle sessioner.
- **Afbrydelsesstil-presets** i Settings (live, ingen redeploy): *conservative* (server_vad threshold 0.45 / prefix 800 ms / silence 700 ms — blød dansk tale må ikke klippes; ekko-skjoldet bærer selvafbrydelsesbeskyttelsen) / *responsive* / *custom*.
- `full_duplex: true` virker nu i thin-motoren (ekko-skjold fra; AEC + preset bærer afvisningen) — promoveres KUN hvis 1.4-matricen består (docs/HANDOVER-v2.md).
- **Prisstyring:** hver response måles → `/data/podvoice-usage.json` + `sensor.podvoice_cost_today`/`_month` i HA; `idle_timeout_s` (25 s) og `max_session_min` (15) er indstillinger.

**Fase 3 — skrøbelig kode slettet:**
- ha_tools.py (734 linjer REST-bro + allowlist + discovery) er DØD. Hjemmestyring = **lokal MCP-klient** mod HA's indbyggede MCP-server på LAN'et (default via Supervisor-proxyen; `ha_mcp_url`/`ha_mcp_token` som fallback). Intet i hjemmet er internet-nåbart.
- Enheds-eksponering ejes af HA (Indstillinger → Stemmeassistenter → Expose); panelets entity-vælger er slettet. Websøgning = et HA-script eksponeret til Assist.
- Slutfrase-fallback (DA+EN) oven på modellens end_conversation: "stop/stille/vent" lukker NU; "tak, det var alt" lukker efter farvellet. (Referencen ha-realtime-assist er i øvrigt slettet fra GitHub — adfærden er porteret fra dokumentation.)
- Prompten omskrevet til MCP-verdenen (GetLiveContext, værktøjernes egne navne); gammel default-hash pensioneret.

**Fase 2 — wake-ord:** beslutning + runbook i docs/wake-word.md (custom microWakeWord først; repoet bor nu hos OHF-Voice); firmware-blok klar til den trænede model. Træning/felttest er Mads'.

Settings-migrering v3: gamle gemini_*/provider-nøgler og en gemt gpt-realtime-2 droppes én gang; rooms/prompt overlever. ruff + mypy rene; **320 tests grønne**.

## 0.90.0 — Talk-fanen kører nu den ÆGTE motor: klik = "Okay Nabu", samme regler, bevist

Før var Talk en rå bro udenom alle produktets regler (intet wake-gate, intet idle-luk, intet ekko-skjold, ingen end_conversation, egen lydvej) — så fanen kunne aldrig BEVISE noget. Nu er browseren en *enhed* på linje med pucken:

- **Mic-knappen ER wake-ordet**: klik kalder præcis samme wake() som "Okay Nabu" — samtale åbner, musik dukkes, mic-forward gates (privatliv: frames sendes KUN mens porten er åben, ligesom pucken).
- **Svaret er puckens svar**: browseren afspiller den SAMME reply-bus-FLAC-strøm, pucken henter — gennem et <audio>-element (som browserens ekkoannullering dækker), og dens afspil/slut-kanter driver ekko-skjoldet nøjagtig som puckens mediestatus.
- **Alle regler gælder**: værktøjer (nu synlige som 🔧-linjer — også i rummenes aktivitetsfeed), idle-luk, samtale-loft, "farvel" via end_conversation, stop-knap = at sige stop. Skriv tekst midt i samtalen — samme samtale.
- Ring-status (LED), tilstand (lytter/taler) og svartid vises live i fanen.

4 nye integrationstests beviser simulatoren: wake-knap = wake-ord (med mic-gate + duck), svar = bus-strømmen + skjold holder, luk når ud til browseren, tool-kald er synlige.

ruff + mypy rene; 278 tests grønne.

## 0.89.0 — 0.88 var en fejldiagnose: websøgningen FINDES, og England-svaret var KORREKT

Verificeret mod ESPN m.fl.: England slog faktisk Mexico 3-2 i VM-ottendedelsfinalen 5. juli. Assistentens svar i Talk-testen var altså et ÆGTE, korrekt live-opslag gennem hjemmets søgetjeneste (HA-tjeneste med returns_response, kaldt via home_call) — hele kæden dansk tale -> søgning -> korrekt svar VIRKEDE. 0.88 stemplede det som "opdigtet" og forbød søgevejen i prompten. Undskyld.

- VIDEN-sektionen genåbner søgevejen: verden udenfor hjemmet slås op via hjemmets søgetjeneste (list_services -> home_call med return_response). 'Det kan jeg ikke slå op her.' er nu KUN fallback når søgetjenesten mangler eller fejler — aldrig i stedet for at prøve. Digtning er stadig forbudt.
- 0.88-promptens hash er føjet til legacy-listen, så genåbningen reelt slår igennem.

(Release forsinket af maskinproblemer: disken var 98% fuld og iCloud-synk brød sammen (ContainerReset) og kvalte al fil-I/O i Documents — ~5 GB build-caches ryddet; overvej at holde repoet ude af iCloud-synk.)

ruff + mypy rene; 274 tests grønne.

## 0.88.0 — prompten lovede websøgning, værktøjerne har ingen: kontrakten er rettet

Talk-fane-testen afslørede en ÆGTE logik-fejl (uafhængig af mikrofon og firmware): spurgt om en fodboldkamp kaldte modellen hjemme-værktøjerne som "opslag" og DIGTEDE så et resultat. Rodårsagen var prompt-værktøjs-kontrakten: prompten bad den slå "nyheder, priser, websøgning" op — men værktøjssættet kan KUN nå hjemmet. Samme sygdom som firmware-kontrakten, ét lag oppe.

- **VIDEN-sektionen omskrevet**: "Du har INGEN internetadgang… Nyheder, sportsresultater, priser… kan du IKKE slå op — prøv ALDRIG med hjemme-værktøjerne, og digt ALDRIG et svar: sig straks 'Det kan jeg ikke slå op her.'" Hjemmets egne data (sensorer, vejrudsigt, musik) slås stadig op.
- Den gamle standardprompts hash er føjet til legacy-listen, så den nye prompt reelt tager over hos alle.
- **Talk-fanen mærket ærligt**: browserens ekko-annullering dækker ikke sidens egen afspilning — på højttalere hører modellen sig selv dér. Brug hovedtelefoner; pucken har sit eget ekko-skjold og er upåvirket.

Websøgning som RIGTIG feature (så den faktisk KAN svare på kampen) er en produktbeslutning til listen — det ville slå Gemini på ærlighed OG evne.

ruff + mypy rene; alle tests grønne.

## 0.87.0 — kanal 1 var stum for tale: tilbage til kanal 0 + mic-niveau i loggen

Felttesten (2026-07-06 12:17) var entydig: wake kom igennem, mic-frames flød — men OpenAI så IKKE ÉN hændelse på 12 sekunders tale (ikke engang speech_started). Kanal 1 bærer bytes, men intet talbart: den er wake-ordets specialkanal, ikke STT-kanalen. Kanal-1-eksperimentet var min fejlslutning — målingen vandt over teorien:

- **Firmware tilbage til kanal 0** (bevist: modellen forstod dansk på den i 0.83-testen). Ekkoet, som kanal 0 bærer, håndteres nu af 0.85's EKKO-SKJOLD — den kombination (kanal 0 + skjold) er den rigtige og har aldrig været testet endnu. Kommentaren i esphome/podvoice.yaml dokumenterer begge kanalers MÅLTE opførsel, så ingen "fikser" det tilbage.
- **Mic-NIVEAU i loggen**: "frames flyder" siger intet om indholdet. Thin logger nu lydniveauet hvert ~5. sekund af fremsendt audio — og flager eksplicit "SILENT: the model hears nothing (wrong firmware channel?)" ved dødt signal. Denne ene linje havde udpeget kanal-fejlen på 5 sekunder.

Kræver GENFLASH af firmwaren (sker over USB nu) + add-on-opdatering.

ruff + mypy rene; alle tests grønne (+1 ny).

## 0.86.0 — enheden flyttede IP-adresse, og ingen sagde noget: nu er link-status ÆRLIG

Felttest-diagnosen (2026-07-06): Voice PE'en fik NY IP af routeren efter firmware-genstarten (192.168.86.25 → 192.168.86.20). Add-on'et bankede trofast på den gamle, døde adresse — og derfor virkede "Okay Nabu" slet ikke. Værre: panelet VISTE GRØNT, fordi prikken blev sat ved opstart ("løkken kører"), ikke ved ægte forbindelse. Tre rettelser:

- **Ærlig link-status**: prikken/Connected følger nu ÆGTE connect/disconnect fra enheden. Ryger forbindelsen, går prikken rød og aktivitetsfeeden skriver "🔌 Mistet forbindelsen til Voice PE — tjek at host-navnet passer".
- **Rå-IP-advarsel**: står der en IP-adresse som Voice PE-host, advarer loggen ved opstart — brug enhedens .local-navn (fx podvoice-pe-0a7e7a.local), som selv finder enheden igen efter ethvert IP-skift.
- **DIT FIX NU**: sæt Voice PE-host til `podvoice-pe-0a7e7a.local` i Setup (eller den nye IP 192.168.86.20 som lappeløsning — .local-navnet er det holdbare).

Nye tests: link-status er sandfærdig (grøn kun efter ægte connect, rød ved tab); rå IP advarer, .local gør ikke.

ruff + mypy rene; alle tests grønne.

## 0.85.0 — den hører aldrig sig selv igen (ekko-skjold + ét sammenhængende svar + firmware-kanalfix)

Felttesten fangede det præcist: assistenten hørte SIN EGEN stemme gennem mikrofonen — transskriberede den som dig, svarede sig selv ("Velbekomme", "Farvel"×2), afbrød sig selv, og dit rigtige spørgsmål druknede. Tre rettelser:

- **Ekko-skjold (add-on)**: mens enheden afspiller et svar (+0,35 s efterklang), sendes mikrofonen IKKE til modellen, og køen drænes bagefter. Den kan fysisk ikke længere høre sig selv. Ærlig konsekvens indtil firmware-fixet er valideret: du kan ikke afbryde med stemmen MENS den taler (knappen virker) — men svarene er korte, og du bliver hørt i alle pauser.
- **Ét sammenhængende svar pr. tur**: "Lige et øjeblik…" og selve svaret spilles nu som ÉN afspilning (tool-pausen udfyldes med ro), i stedet for at svar nr. 2 kappede filler-sætningen midt i ordet. Og end_conversation beder ikke længere om et ekstra svar — kun ét "farvel".
- **Firmware-kanalfix (kræver genflash)**: vi tappede mikrofonkanal 0, men den ekko-rensede kanal er kanal 1 — BEVIS: upstreams wake-ord kører på kanal 1 og virker dokumenteret MENS højttaleren spiller (verificeret mod upstream 26.6.0). esphome/podvoice.yaml er rettet til channels: [1]. Efter genflash + validering kan skjoldet afløses af ægte fuld-duplex barge-in.

Nye tests: skjoldet blokerer mic under afspilning, tool-tur = én announce, end_conversation = intet ekstra svar.

ruff + mypy rene; alle tests grønne.

## 0.84.0 — firmware-kontrakten: mismatch mellem add-on og Voice PE kan aldrig mere være lydløs

Rodårsagen bag 0.82-klassen af fejl ("2. Okay Nabu gør ingenting") var ikke selve buggen — det var at add-on'et kaldte en firmware-service (`podvoice_va_abort`) som den flashede firmware slet ikke har, og at det fejlede LYDLØST. Den klasse af huller er nu lukket ved design:

- **Kontrakt-verifikation ved hver (gen)forbindelse**: add-on'et sammenligner nu ALT hvad det antager om firmwaren (services + media_player/LED/mute-entiteter) med hvad enheden faktisk publicerer. Match → én rolig log-linje med ESPHome-version og service-liste. Mismatch → tydelige "FIRMWARE MISMATCH"-advarsler der siger præcis hvad der mangler og hvad konsekvensen er.
- **Panelet viser det**: Voice PE-prikken går gul (degraded) og aktivitetsfeeden skriver "⚠️ Firmware-mismatch: mangler … — genflash Voice PE". Ingen felttest-gætteri.
- **Ingen lydløse service-kald**: et kald til en service firmwaren ikke har logges nu som en advarsel (én gang pr. forbindelse — genoprustet efter reflash) i stedet for at forsvinde sporløst.
- **Oprydning**: thin-motorens ekstra RUN_END ved wake er fjernet — den var overflødig (handle_start-ankeret fra 0.83 dækker ALLE wakes) og kunne i teorien race kørsels-opsætningen.

Nye tests: kontrakt OK / mismatch-er-højlydt / skip-advares-én-gang / reflash genopruster advarslen.

ruff + mypy rene; 270 tests grønne.

## 0.83.0 — repeated wake, made bulletproof: end the stock VA run in handle_start

0.82 ended the stock voice_assistant run from inside the thin engine's wake() — but that could be skipped by a race or a wake that's ignored. Moved to `handle_start` itself: now EVERY wake the device delivers ends its own stock run (RUN_END, scheduled with a 0.2 s delay so it never races the run's setup), independent of engine or state. The mic is unaffected (podvoice_audio is separate), so the conversation still hears you — and the device always returns to wake-detecting, so "Okay Nabu" works every single time. New unit tests prove every handle_start schedules the run-end.

(The log you shared was v0.80 — before this fix — and confirmed the diagnosis exactly: after the conversation closed cleanly at 10:24:24, the 2nd wake never reached the add-on at all.)

ruff + mypy clean; 266 tests green.

## 0.82.0 — the "2nd Okay Nabu does nothing" fix (traced, not guessed)

Full mechanism, verified in code + firmware:
1. The flashed (proven) firmware has no `podvoice_va_abort` service, so our `abort_va()` was a no-op.
2. The wake word starts the device's stock `voice_assistant` run; we drive audio via the independent `podvoice_audio` component and never ended that run — so it stayed "running".
3. The upstream micro_wake_word handler is `if voice_assistant.is_running: voice_assistant.stop  else: voice_assistant.start`. With the run stuck open, the 2nd "Okay Nabu" just STOPPED it instead of starting a new run → `handle_start` never fired → PodVoice never woke.

**Fix (add-on only, no reflash):** `abort_va()` now ends the stock VA run firmware-agnostically with a `RUN_END` event right after wake. The mic is unaffected (it comes from `podvoice_audio`, not the VA run), so the conversation still hears you — and the device returns to wake-detecting, so every subsequent "Okay Nabu" works. Plus wake-path logging on both the device link ("WAKE received") and the thin engine (why a wake was ignored, if ever) so any residual case is one glance in the log.

ruff + mypy clean; 264 tests green.

## 0.81.0 — CRITICAL: the thin engine went DEAF 25 seconds into every conversation

The History screenshot told the whole story: "you: Tak." / "you: Skål!" / "you: Det skal jeg godt godt godt" — textbook Whisper hallucinations on SILENCE — while the assistant set timers and switched things off in response to speech nobody spoke.

Root cause, matched to the device log's `dead-man timeout (25000 ms) — force-stopping mic forward`: the firmware's safety timer stops the mic-forward after 25 s without a fresh start command. The classic engine re-asserted it every 10 s; **the thin engine never got that keepalive**. So exactly 25 s into every thin conversation the assistant literally stopped hearing the room — the user talks about the Portugal match, the model receives silence, Whisper invents "Tak.", and the model acts on the inventions.

Fix: a keepalive task re-asserts the mic-forward every 10 s for the whole conversation, stops with it, and is covered by a regression test. (The garbled-hearing report was NOT mishearing — it was no hearing.)

ruff + mypy clean; 264 tests green.

## 0.80.0 — CRITICAL: the "locked, solid blue" bug — teardown was cancelling itself

Field test on 0.78: stuck solid-cyan ring, wake dead, music never restored, and the log's endless attention POSTs + "Unclosed client session". One precise bug behind all of it:

**The conversation teardown cancelled the very task running it.** stop()/fail paths run INSIDE the reader/heartbeat tasks; teardown cancelled all pipeline tasks including the current one, so at the first real network await the teardown was killed mid-way — everything after it silently skipped: the provider session never closed (leaked), the duck heartbeat never stopped (music stuck quiet FOREVER), the mic-forward never stopped, and the ring never turned off. The room looked "locked in a state" because it literally was: a half-dead conversation nothing could restart cleanly.

Fix: teardown never cancels the task performing it (the caller ends naturally). The test fakes now include SUSPENDING stream calls (the reason the suite missed this), and a regression test proves the full teardown completes when the close is self-initiated — verified to FAIL without the fix.

Note: the misunderstanding/random-answer part of the field report is a separate track — 0.79's rewritten prompt (not yet in that test) addresses response discipline; if mishearing persists on 0.80, the History tab's "you" lines will show exactly what it heard, which is the next diagnostic.

ruff + mypy clean; 263 tests green.

## 0.79.0 — the 10x prompt: assistant, not conversation partner

The system prompt was 3,358 words (~5,700 tokens) written for the RETIRED classic engine — no timers, no end_conversation, no open-conversation rules, no side-talk restraint, and "Svar ALTID" (actively harmful with an open mic). Rewritten from scratch for the thin era:

- **68% shorter** (1,087 words ≈ 1,850 tokens): realtime models follow short prompts better (our research: simple beats elaborate for language pinning), and every instruction now earns its tokens.
- **Identity first:** *"hjemmets stemmeassistent, ikke en samtalepartner — udfør, svar kort, ti stille"* — the owner's exact field feedback, as sentence one.
- **Thin-era native:** the open conversation (follow-ups, barge-in etiquette), ending via end_conversation on "farvel/stop/det var det", timers (minutes/seconds passed separately), and NEW: side-talk restraint — speech clearly not addressed to the assistant gets silence, or at most "Skal jeg hjælpe?".
- **All the hard-won gold kept, tightened:** language pinning w/ the radioavis test, proper-noun rules, numbers-as-words, fast-vs-slow acknowledgments, tool discipline (never guess field names, look up once), summary/data handling, empty≠error, know-vs-believe, and the full security-confirmation block (unchanged in substance — it weighs heaviest).
- **Migration:** a saved settings copy of ANY historical default prompt (16 revisions hashed from git) is auto-replaced by the new default on load; a genuinely customized prompt is always kept.

ruff + mypy clean; 262 tests green (new: legacy-prompt migration; prompt-constants consistency enforced).

## 0.78.0 — the latency release: stream every reply, ring lights WITH the sound, measure what we claim

A millisecond-by-millisecond audit of the whole chain (code + the owner's device log with real timestamps) found one dominant self-inflicted waste and two honesty gaps:

- **Thin always streams the reply now.** The buffered path waited for the ENTIRE generation before serving the first byte — 1-4 s of pure waste per reply. Thin now uses the smoothed streaming FLAC delivery (jitter prebuffer + silence-fill over generation gaps) unconditionally; classic keeps its opt-in. Expected effect: the answer STARTS while it's still being generated.
- **Prebuffer tightened 1.0 s → 0.4 s.** The silence-fill handles mid-reply generation gaps; the prebuffer only needs to cover LAN jitter — every extra millisecond there is pure added latency.
- **The ring is now simultaneous with the sound.** Green fires on the device's own ANNOUNCING edge (the moment audio physically starts), not at generation start; back to cyan the moment the sound ends. The LED now tells the ears' truth.
- **We measure instead of claim:** every reply logs `speech-stop -> audible = N ms` and feeds the panel's latency metric — the number the family actually feels.

**The honest physics** (what remains, and whose it is): end-of-speech detection ~0.4-0.6 s + model first-audio ~0.3 s are the provider's floor; our delivery is now ~0.5-0.7 s (prebuffer + FLAC + fetch + decode) and drops to ~0.1 s with the direct speaker path (2b, firmware validated healthy and ready to build). A literal 50 ms end-to-end is beyond ANY cloud voice product in 2026 — but sub-1.5 s speech-stop→first-word, with an instant ring, is now in reach and measurable.

ruff + mypy clean; 261 tests green.

## 0.77.0 — CRITICAL thin-engine fix: an invented API field was silently breaking everything

The field test exposed a serious bug I introduced. The device log named it:

```
openai realtime error: Unknown parameter: 'session.audio.input.turn_detection.idle_timeout_ms'
```

`idle_timeout_ms` does not exist in the OpenAI Realtime GA API — I trusted a research claim without verifying against the live server. Worse: one unknown parameter makes OpenAI **reject the ENTIRE session.update**, so the Danish system prompt, ALL tools (get_time, end_conversation, home control), and the turn-detection config (semantic_vad + interrupt_response) were **never applied**. Every symptom traced to this one bug:

- **Answered in English/Russian, rambling** — the terse Danish system prompt was thrown away, so it ran as a raw, verbose, English ChatGPT.
- **"I can't see the time"** — the tools were never registered.
- **Never closed / stayed blue** — end_conversation missing; only a 21 s client fallback closed it.
- **Sluggish, unstoppable barge-in** — interrupt_response never took effect.

**Fix:** the invented field is gone. The Danish prompt, tools and semantic-VAD interruption now actually apply. The client-side idle close is now the intended primary mechanism, tightened to **8 s** of true silence after the assistant stops. (The device firmware and audio path were healthy throughout — the log confirms wake, mic forward and FLAC playback all working.)

ruff + mypy clean; 261 tests green.

## 0.76.0 — the streamlined panel: one clear focus

The panel is rebuilt around the thin-client era — everything classic-era, experimental or redundant is GONE from the UI:

- **Home** (new default): is it working right now? Connection dots, each room's live state, the activity feed, the LED legend, and three metrics that matter (Sessions, Barge-ins, False barges). Plus the only instruction anyone needs: *"Say 'Okay Nabu', then just talk — it handles interrupting, follow-ups and knowing when you're done. Say 'farvel' or 'stop' to end."*
- **Setup**: exactly the eight things an owner actually sets — engine, provider, voice, Voice PE PSK, rooms, music ducking, home control — with System prompt, Simulation, PodConnect connection, Security and Diagnostics folded under Advanced.
- **Talk** and **History**: unchanged.

**Removed from the UI** (the backend keeps sane defaults): all VAD/turn-detection tuning for both providers, model-name fields, lounge/heartbeat/watchdog/VAD knobs, Audio path + Streaming replies, the Voice barge-in checkbox, the old Voice PE tab, four dead metrics, and the long how-to card. 1376 → ~1300 lines, every remaining field verified against the save/load wiring, all script blocks syntax-checked, rendered and screenshotted.

## 0.75.0 — the gap-closing release: model-owned goodbye, re-wake hush, timer ducking

Closing the ranked honest-gaps list from the scenario review:

- **The model now ends the conversation itself** (thin engine): a new `end_conversation` tool lets the AI understand ANY phrasing of "we're done" — stop, farvel, tak for hjælpen, det var det — say a short goodbye, and close. No word lists; this is the thin-native answer to the old closure machinery, and it also gives the physical button's intent a voice equivalent that always works.
- **Re-wake / button mid-conversation = hush, not chaos:** "Okay Nabu" out of habit (or the center button) while it talks now just silences the current reply and keeps listening — never a surprise close, never a double conversation.
- **Timer rings now duck the music** for ~5 s via a short-TTL attention lease — PodConnect auto-restores, zero bookkeeping. (Skipped when a conversation is already ducking.)
- **False-barge counter is visible** on the panel's metrics ("False barges (filtered)") — the KPI that tells us how the blip filter performs in YOUR room.
- **The Direct audio-path option is greyed out** in the panel until the firmware is re-validated (the backend has forced Announce since 0.70 — now the UI tells the truth too).

ruff + mypy clean; 261 tests green (new: model-ends-conversation, re-wake hush).

## 0.74.0 — thin engine hardened: the self-review pass (R1-R5)

A critical self-review of 0.73's thin engine against the beat-Gemini goal found five real holes. All closed, all tested:

- **R1 — stale-mic poisoning (the serious one):** the mic queue is shared across conversations, so up to ~4 s of the PREVIOUS conversation's tail became the FIRST audio of the next one — the same failure class as the 0.66 pre-roll bug, reborn. The queue is now drained at every wake.
- **R2 — blip-proof barge-in:** a speech blip (cough, clatter, echo residue) no longer silences the reply. speech_started starts a 250 ms debounce; if speech ends inside the window it's a false alarm (playback continues — the reply is already buffered on the device, so the server-side generation cancel costs nothing audible), sustained speech interrupts for real. False barges are counted in metrics ("false_barges") — the KPI the pros track.
- **R3 — idle fallback:** if the server-side idle signal ever fails to arrive (e.g. the `idle_timeout_ms` field being rejected by API drift), a client-side fallback closes the quiet conversation after 16 s. The music can never stay ducked forever.
- **R4 — stale reply audio:** a never-fetched previous reply can no longer lead the next one (bus cleared at each reply start).
- **R5 — announce-retry in thin:** if the device misses the announce, it's retried once and reported — same never-silently-deaf guarantee as classic.

ruff + mypy clean; 259 tests green (new: blip-vs-sustained barge-in, stale-mic drop at wake, client idle fallback).

## 0.73.0 — Track B: the THIN engine. The model owns the conversation.

The pivot (docs/PLAN-BEAT-GEMINI.md), delivered. Settings → **Conversation engine → Thin** (+ Save & restart) switches a room to the new engine; **Classic remains the default and the one-click fallback**.

**What Thin is:** one open conversation per wake. The mic streams to GPT-Realtime-2 for the whole conversation (and ONLY then — the wake gate is the privacy line); the server's semantic VAD owns turn-taking, interruption and "is the user done". No lounge windows, no closure word lists, no byte estimates, no gate-mute machinery — three states (asleep / conversation / error) instead of five plus timers.

**What that means in the room:**
- **Talk over it, it stops.** Barge-in is server-detected; the device is silenced instantly and the server is told exactly how many milliseconds you actually HEARD (`conversation.item.truncate` fed by the new playout clock) — so the assistant's memory matches your ears, and "hvad sagde du?" works honestly after an interruption.
- **Just keep talking.** After a reply the conversation simply stays open — follow-ups need no wake word and no artificial window. The SERVER decides when you're done (8 s of quiet) and the music comes back.
- **Music ducks once, calmly**, for the whole conversation — no per-turn pumping.
- **One audible failure mode:** anything dying mid-conversation (socket, reader, pump — watched by a 5 s pipeline heartbeat) says the error in the assistant's own voice and lands in clean IDLE. 20-minute conversation ceiling keeps clear of the provider's 60-minute hard cut.
- Tools/timers work unchanged (async dispatch; barge-in cancels in-flight calls via the server's cancellation signal).

**Cleanup:** the dead firmware sketches (voice-pe.yaml + four phase yamls + overrides-test) and the spikes/ folder are deleted; validate.sh now defaults to podvoice.yaml. The classic engine stays untouched until Thin has been field-stable — then the big deletion (state machine, lounge/VAD/closure machinery) follows.

ruff + mypy clean; 256 tests green (6 new thin end-to-end: full conversation incl. server-idle close, truncate-at-heard-position, tools, provider-death audibility, stop control, mute).

## 0.72.0 — recognition restored: the mic pre-roll fed the model un-ducked music

Field report on 0.70: "den fatter ikke hvad jeg siger". Root cause: the 0.66 mic pre-roll replays ~1.5 s of audio captured BEFORE the gate opens — but in that window the music is NOT yet ducked (ducking is the last step of the wake sequence). So every turn started with a second of raw room audio/music glued in front of your words, and the model tried to transcribe that. 0.64/0.65 understood you precisely because the model only ever heard from gate-open.

The pre-roll is now DEFAULT OFF (the only change to the audio-in path since 0.65 is gone from the hot path). It can only return after a duck-first redesign, validated on the device.

ruff + mypy clean; 244 tests green.

## 0.71.0 — timers: no more unit arithmetic in the model, and the ring says WHICH timer

Field feedback: the timer behaved as if hardcoded. Two real fixes:

- **The model no longer converts units.** `set_timer` used to take only `seconds`, forcing the voice model to compute "ti minutter" → 600 itself — the classic way a spoken duration silently becomes an hour. The tool now takes `minutes` and `seconds` as separate fields ("pass the duration EXACTLY as the user said it — do NOT convert"), and PodVoice does the arithmetic.
- **The ring announcement was one hardcoded phrase.** It now says which timer finished — "Din pasta-timer er færdig!" — synthesized in the assistant's own voice per label (cached); the generic line remains the fallback.

ruff + mypy clean; 244 tests green.

## 0.70.0 — revert the broken firmware (wake works again), speak fixed lines in the assistant's own voice

**Firmware rolled back and re-flashed.** The 0.67 direct-audio firmware broke two things on real hardware: wake ("Okay Nabu") stopped working, and the direct path played 24 kHz PCM at the wrong rate — a high-pitched, sped-up blip you couldn't even hear. Both are firmware faults I shipped without validating on the device. The firmware is reverted to the proven 0.66 announce-only overlay (no voice_assistant output override, no appended wake automations) and re-flashed over USB. **Wake and the buffered announce path work again.**

**Direct path forced off.** Until the direct firmware is genuinely validated on hardware, the add-on ignores a saved `speaker_path: direct` and always uses the announce path — a stray setting can't produce silence or chipmunk audio.

**Fixed spoken lines now use the assistant's OWN voice.** Per your point — we should say things with our AI voice, not a macOS robot. The error phrases and the timer chime are synthesized once via OpenAI `/v1/audio/speech` (`gpt-4o-mini-tts`, the same `marin` voice as replies, raw 24 kHz PCM straight into the announce path), cached in memory, and pre-warmed at startup so the first one is instant AND still plays when the live connection is what's down. Falls back to a plain tone only if no OpenAI key is set or synthesis fails. The old pre-rendered macOS clips are deleted.

**Recommended config (unchanged, now enforced where it matters):** Announce path, Streaming replies OFF, Voice barge-in OFF. That's the proven experience.

ruff + mypy clean; 243 tests green (speech synth/cache/fallback/voice-validation; error spoken in the assistant voice).

## 0.69.0 — stabilization: kill the self-reply loop (again), fix garbage transcription, drop the bad TTS

Field test of 0.68 exposed regressions I shipped too eagerly. This release walks them back to the proven base.

**The self-reply loop was back — and it's the transcription "garbage" too.** In streaming mode the "how long will it keep talking" estimate was set to just the 1 s prebuffer, so the follow-up window opened ~1.5 s into a 2-3 s reply; the lounge VAD then heard the reply itself and re-opened LISTENING, and the model transcribed its own voice as your words ("Velbekomme", "Det er sjovt at du kan…"). Fixed: the estimate is always the full reply length again, whether streaming or buffered.

**The mic pre-roll no longer corrupts follow-ups.** The 1.5 s run-up replay now fires ONLY on a cold wake (the gap between the cyan ring and the provider connecting) — never on a lounge re-open, where the buffer could hold the echo/tail of the reply just spoken and prepend it to your next sentence.

**Error audio is a clean tone, not robotic TTS.** The pre-rendered macOS clips were poor quality; they're gone from the shipped path. A distinct tone signals a problem without sounding broken. (Proper spoken Danish errors need neural TTS generated offline — a real follow-up, not compact-voice TTS.)

**Recommended stable config after this release:** Audio path **Announce**, Streaming replies **OFF**, Voice barge-in **OFF**. That's the hardware-proven buffered path. Streaming (stutters via the announce delivery) and the Direct path only make sense once each is validated on the device one at a time — Direct needs **Save & restart**, not just Save.

ruff + mypy clean; 237 tests green.

## 0.68.0 — voice barge-in (experimental): interrupt it by just talking

The capability that separates "2026 state of the art" from "2024 with better answers" (the SOTA audit's words) — shipped as an explicit opt-in.

**How it works.** Tick **Voice barge-in** under Voice PE → Setup. The mic gate now stays OPEN while the assistant speaks (the state machine supported this all along; it was force-disabled). The XMOS chip's echo cancellation keeps the assistant's own voice out of mic channel 0, so only *real* speech reaches the provider — whose server VAD detects it, cancels the reply (`Interrupted`), and PodVoice instantly silences the device (media STOP on the announce path; `voice_assistant.stop` on the direct path) and returns to LISTENING. Per the Gemini Live docs, `START_OF_ACTIVITY_INTERRUPTS` is the API's default behavior — the work was entirely client-side playback-flush, which 0.67 delivered.

**Barge-in mid-lookup is safe.** Gemini rescinds in-flight tool calls on interrupt (`tool_call_cancellation`); PodVoice now cancels the pending dispatches so a stale result is never submitted after you cut it off.

**If it misbehaves** (interrupting itself because echo leaks through — possible at high volume or in harsh rooms): untick the toggle and you're back on the proven half-duplex mode. The 0.66 barge-in debounce/cooldown and the "stop"-word path (0.67) are unaffected either way.

Recommended combo for the best feel: **Audio path: Direct** + **Voice barge-in** on the same room, tested one toggle at a time with Test speaker between.

ruff + mypy clean; 237 tests green (full-duplex barge-in end-to-end, tool-call cancellation drops pending dispatches).

## 0.67.0 — firmware release: direct audio highway, "stop" while it talks, kitchen timers

**Requires the 0.67 firmware** (already flashed to the device over USB — no action needed). The firmware is a pure-YAML overlay change (validated with `esphome config`, compiled and flashed 2026-07-02): no C++ was added.

**The direct audio highway (`speaker_path: direct`, opt-in).** The recon of upstream 26.6.0 proved the whole HTTP/FLAC detour is unnecessary: package maps merge key-by-key, so the overlay swaps the voice assistant's output from `media_player:` to the announcement resampler (`media_player: !remove` + `speaker:`), and the add-on drives the reply with four client events + raw PCM frames down the already-open encrypted API connection — paced to the device's 16 KB buffer, with a per-reply 24 kHz stream-info pin (the resampler otherwise assumes 16 kHz and would play at 2/3 speed). Result: **~0.1 s to first sound, instant precise stop (voice_assistant.stop), no file-type sniffing, and turn-done timing that's exact by construction** (paced sends end when playback ends). The hardware-proven announce path remains the default AND the automatic fallback — switch under Voice PE → Audio path, verify with Test speaker.

**"Stop" now works while it talks.** Upstream firmware already ships an internal "stop" wake model listening on the echo-cancelled mic channel; the overlay appends an automation that surfaces it (plus every wake) to PodVoice via the `podvoice_event` entity — which it turns out was NEVER fired by the old firmware (the 0.66 audit found the whole button/stop event path was dead code; even a re-wake mid-reply never reached PodVoice, because upstream's handler only stopped local audio). The add-on arms the stop model for exactly the duration of each reply. Saying **"stop"** while it speaks now interrupts locally on the device AND closes the PodVoice session.

**Kitchen timers — "sæt en timer på ti minutter" finally works.** The UX audit's #1 family gap. Three local tools (set/list/cancel, no HA dependency), and at expiry the Voice PE rings + says **"Din timer er færdig!"** (pre-rendered clip) through the reply path — works even when the room is idle. v1 is in-memory: an add-on restart clears running timers (logged at startup).

Also: the reply token stays out of announce logs on the direct path (no URL at all), and the media-state ground truth from 0.66 keeps guarding the announce path.

## 0.66.0 — "aldrig døv, aldrig dum": armoured core, first-word pre-roll, smooth streaming, honest errors

Driven by the post-0.65 triple audit (code C1/H1/H2/H3, UX C−, SOTA benchmark) + the streaming field test ("lyd kommer ud 🙂 … dog falder den lidt over ordene").

**Never permanently deaf (audit C1 — the single riskiest bug).** The mic-ingest loop had no error handling: ONE failed provider send (a wifi blip mid-LISTENING) killed the room's hearing forever, silently, while LEDs and wake kept looking alive. Now: the send failure is caught, ONE audible ERROR is posted (gate shuts, which stops the raising), and the ingest task itself has a death-watch that logs + restarts it if anything else ever kills it.

**Provider death is visible and honest (audit H3).** OpenAI's WS iterator ends silently on socket close — the room used to sit ducked-and-dead until the idle timeout. It now raises → ERROR → spoken Danish error + clean IDLE. Gemini's resume loop no longer retries a bad API key forever (auth errors and 6 consecutive failures abandon with an audible error).

**The first word of your command is never eaten again (UX audit #2).** The instant-cyan ring invited you to talk ~1 s before the provider WS was connected — those frames were discarded ("SLUK lyset" → "-set"). A ~1.5 s rolling **pre-roll buffer** now records while the gate is shut and replays the run-up the moment it opens — on wake AND on lounge re-open (where the VAD attack ate the onset). Cleared at session end (privacy).

**"Senegal" fixed for real (audit H1 + UX #4).** Two compounding bugs: the buffered reply collector gave up after 8 s while a tool may lawfully take 9 (the answer was collected into a closed HTTP response — you heard only "Lige et øjeblik…"), and the watchdog's 3 s TTFR window ticked while OUR OWN tool ran (0.65 moved the abort from 1.5 s → 3 s; a 3-9 s lookup still died). Now: collect ceiling 25 s, and the watchdog switches to an 11 s tool window at dispatch. Tools also dispatch **concurrently** — the event loop keeps consuming audio/interrupts during a slow lookup, and the parallel calls the system prompt requests actually run in parallel.

**Smooth streaming replies (the stutter fix).** Field test confirmed streaming FLAC plays — but "falder lidt over ordene" and stops mid-sentence around tool calls: classic underrun (the device drains its buffer whenever generation pauses). Now: a **~1 s jitter prebuffer** before the first byte, and **silence-filling** during generation gaps (a tool lookup becomes a calm pause, not a stutter). Still opt-in this release — flip it on, if it sounds right it becomes the default in 0.67.

**The device now tells us when it's done talking.** The media player's ANNOUNCING state is observed over the native API: the moment the speaker actually goes quiet, the follow-up window opens (the 0.65 byte-estimate stays as backstop). Timing truth instead of arithmetic.

**The physical mute switch is finally respected.** The Mute switch is observed: ring turns solid red, any live session closes, activity feed says so. Before, muting made wake silently do nothing with a dark ring — indistinguishable from "broken".

**Honest error messages.** A timeout now says *"Det tog for lang tid. Prøv lige igen."* (new clip) — only real connection failures blame the connection. (Blaming wifi for a slow model trains the family to distrust the wifi.)

**One bad settings value can no longer brick the add-on (audit H2).** POST /api/settings validates every key (clear 400 message to the panel), and the boot path degrades bad saved values to defaults per-field instead of crash-looping. Secrets (PodConnect token, Voice PE PSK) are **masked** on read — they never leave the box in cleartext — and a round-tripped mask never overwrites the stored secret. The reply token is stripped from announce logs and compared constant-time.

**Faster edges.** False wake / cough-in-the-lounge penalty cut from 20 s to 8 s (LISTEN_IDLE_S). Danish sign-offs "tak for i dag", "ellers tak", "farvel" now close politely. Reply-queue overflow is logged instead of silently dropping audio.

**Panel truth pass.** LED legend gains the missing dim-cyan follow-up entry + splits red into muted/problem; the how-to card no longer promises a "stop"-word that can't work while it speaks (that arrives with the 0.67 firmware); settings validation errors are shown; every user-initiated action surfaces its failure.

ruff + mypy clean; 230 tests green (new: pre-roll replay/bounds/privacy, ingest-survives-provider-death, media-state ground truth, hardware-mute close+red, tool-window watchdog, settings validation + secret-mask round-trip, config garbage-tolerance).

## 0.65.0 — the "det bare virker" release: kill the self-reply loop, real stop, audible errors, panel lockdown

Driven directly by the 0.64 field test (sound works! — and the log it produced found the worst remaining bug) plus the three-auditor service check.

**The self-reply loop (the "den bliver ved med at svare" bug).** The field log showed the exact sequence: `MODEL_TURN_COMPLETE` fires when the reply is *generated*, but the buffered FLAC only *starts playing* on the device at that moment — so the state machine opened LOUNGE_WINDOW, armed the lounge VAD, and the VAD heard **the assistant's own reply** still coming out of the speaker (`lounge_window -> listening on LOCAL_VOICE_DETECTED` 400 ms after serving the FLAC, every turn). It then answered itself, forever, until the button was pressed.
- **`MODEL_TURN_COMPLETE` is now held until the reply has actually finished playing** (reply size / 48 000 B/s + a 0.5 s tail; cancelled instantly by stop/barge-in/error). The green "replying" LED now also matches when the speaker is actually talking, and the follow-up window no longer burns while it speaks.

**"Stop" now actually stops the speaker.** Since the buffered reply, the device holds the whole FLAC once fetched — closing our stream did nothing and the speaker talked on through IDLE. Every stop path (the word, the button, barge-in, errors) now also sends a real `media_player` **STOP** at the announcement pipeline (verified against aioesphomeapi 45.3.1).

**Errors are audible now — in Danish.** The error tone went through `send_voice_assistant_audio`, which we ourselves documented as dead on this firmware — so every failure was pure silence (music snaps back, nothing said = "it ignored me"). Errors now play a short tone + a pre-rendered **"Der er problemer med forbindelsen lige nu."** through the *working* announce path. (Clips shipped as raw PCM assets; no TTS dependency, works precisely when the provider is what's down.)

**Politeness is no longer punished.** "Sluk lyset, tak" used to die mid-command — `tak` in any transcript delta closed the session. Closure now fires only when the *whole accumulated utterance* is a politeness phrase ("tak", "mange tak", "tak for hjælpen", "det var alt, tak"); any real command word defeats it. "stop"/"vent"/"stille" still fire anywhere, whole-word.

**"Hvordan gik Senegal-kampen" no longer dies mid-lookup.** The field log showed `watchdog stall` killing the turn 1.5 s into `home_call` — the mid-stream stall clock was ticking while *our own tool* ran. The watchdog now switches to the patient TTFR window *before* dispatching a tool, not only after.

**Instant light on wake.** ~1 s of dark ring between "Okay Nabu" and cyan (the LED waited for the provider WS connect) read as "did it hear me?". The ring is now pre-painted cyan the instant wake arrives.

**Panel locked down (security).** The sidebar panel on `:8098` was reachable — unauthenticated — by anything on the wifi (`host_network: true`), including `/api/settings` (tokens + PSK in cleartext), the mic controls, and restart. The panel/API now only answers Home Assistant Ingress + loopback; the reply audio the device fetches over LAN is instead protected by a per-boot token in the URL; `/health` stays open. An explicit `panel_lan_open` setting (default **off**) re-opens direct LAN access for those who want it.

**Streaming replies (experimental, default off).** `reply_streaming` pipes the reply through a live `flac` encoder and chunks it out **as the model generates** — removing the buffered path's silence between the green LED and the first word (the 0.64 field test's "betænkelig tid"). Off by default until hardware-verified: tick it in Settings → Reply delivery, press **Test speaker**, and untick if silent. The turn-done hold collapses to just the 0.5 s tail in this mode.

**Never silently deaf.** If the device doesn't fetch the announced reply within 2.5 s, PodVoice logs it, says so in the activity feed ("🔇 Enheden hentede ikke svaret — prøver igen") and re-announces once.

ruff + mypy clean; 219 tests green (new: closure-politeness rules, device STOP on closure, playback-hold before lounge, audible-error announce, Danish clip asset, wake LED pre-paint, ingress lock + reply token, streaming FLAC end-to-end).

## 0.64.0 — reply audio as FLAC (the real no-sound fix) + lounge-window floor + speaker self-test

The device-side ESPHome log finally pinned the no-sound cause. The Voice PE's on-device decoder connects, gets our WAV, then rejects it **before reading a single sample**:

```
micro_decoder.http_client: Connected: status=200 content-type='audio/wav'
E micro_decoder.audio_reader: Could not determine audio file type from URL or Content-Type
E micro_decoder.decoder_source: Reader failed to open URL
```

It's file-type detection, not the data-size sentinel. The device's `micro_decoder` (Espressif esp-audio-libs, not mainline ESPHome) does not accept our streaming WAV — but it decodes **FLAC** natively (it's what HA sends the Voice PE for TTS).

- **Reply audio now goes out as FLAC.** `/reply/<room>.flac` buffers the whole (front-loaded) reply, pipes the PCM through the `flac` CLI (added to the add-on image), and serves `audio/flac` with a real Content-Length. Both signals the decoder sniffs — the `.flac` URL and the `audio/flac` Content-Type — now say FLAC. Falls back to a finite WAV (logged loudly) only if the encoder is missing. **No firmware reflash needed — this is add-on-side only.**
- **Buffered, finite reply response.** Replaced the chunked data-size-0 streaming WAV with a fully-collected, Content-Length'd body — a deterministic file the decoder can size.
- **Lounge-window floor (`LOUNGE_WINDOW_FLOOR_S = 3`).** A stale saved `lounge_window_s: 0` in `/data/podvoice.json` was collapsing LOUNGE_WINDOW → IDLE in ~8 ms (observed in the device log), killing the follow-up window, snapping the music back instantly, and closing the WS every turn. Now floored like `heartbeat_ms` / `watchdog_ms`.
- **"Test speaker 🔊" panel button** (`test_speaker` control action). Drives the *real* announce path — reply_bus → FLAC → media_player announce — with a tone, so speaker-out can be verified in isolation without OpenAI, the mic, or the wake word. (The old "Test tone" used the dead `send_voice_assistant_audio` path.)
- **One-time stale-tuning reset (`settings_version` = 2).** Every saved tuning knob in `/data/podvoice.json` (duck/lounge/watchdog/heartbeat/VAD/turn-detection/noise) is reset to the current defaults ONCE on first start of 0.64 — ending the whole class of "an old saved value keeps overriding the retuned default" bugs (watchdog 800 ms, lounge 0 s, …). Identity settings (API keys, rooms, exposed, prompts, provider/models) are untouched. Values you save after the upgrade stick.
- **`get_time` tool — "hvad er klokken?" now always works.** A local clock tool (no HA call, available even without a Supervisor token) answering in HA's configured timezone with a ready-to-speak Danish summary ("Klokken er 16:52, onsdag den 2. juli 2026."). The model was told it can't look up the time because it genuinely had no clock.
- **`GEMINI_*` state-machine events renamed to `MODEL_*`** (`MODEL_RESPONDING`, `MODEL_TURN_COMPLETE`, `MODEL_INTERRUPTED`). They were provider-agnostic all along (OpenAI Realtime is what actually runs — see the `podvoice.openai` / `resp_…` log lines), but the old names made the log look like the wrong brain was answering.

ruff + mypy clean; 196 unit tests green (added FLAC-encode, finite-WAV, collect, lounge-floor, settings-migration and get_time tests). The full `/reply` FLAC path is smoke-tested end-to-end over HTTP.

## 0.41.0 — wake-gated full-duplex Voice PE (no !extend)

- **Full-duplex on the device without !extend** (which is unusable on ESPHome 2026.6.x). Wake (Okay Nabu) fires voice_assistant.start, which PodVoice receives as the wake signal (handle_start). PodVoice then aborts that stock turn (podvoice_va_abort -> voice_assistant.stop) so its turn-audio can't collide with podvoice_audio, and starts our continuous wake-gated stream. Result: barge-in-capable full-duplex on the hardware. Firmware config: esphome/podvoice-phase1b.yaml (api actions stream_start/stop + va_abort; podvoice_audio wake-gated). UNVALIDATED on hardware — first wake-flow test.

## 0.40.0

- **Ducking & tuning moved to the Voice PE tab.** Duck/lounge levels, lounge window, heartbeat, watchdog and VAD threshold now live under Voice PE (they only affect the per-room Voice PE flow, not the Talk console). Settings is now purely the assistant. IDs unchanged — config preserved.

## 0.39.0

- **Voice PE Gate 2 (Audio stream) now reads the LIVE room session** instead of opening a competing voice_assistant subscription. The device allows only one VA subscriber; the running session owns it, so the old standalone probe was rejected and falsely reported "No audio received" even while the device streamed gap-free. S1 health now comes from the session's actual frame reception (frames_in/bytes/age).

## 0.38.0 — Gemini native-audio: don't give up on a lookup without trying

Fixes a regression from 0.35.0 on the Gemini 2.5 Flash **Native Audio** model: asked "hvordan gik Canada-kampen i går?", it answered "Det kan jeg desværre ikke slå op her." **without calling `list_services` at all** — while the same prompt on OpenAI correctly ran `list_services` → `home_call`. Gemini's tool wiring is fine (it calls `list_home` for device status); the weaker native-audio model just took the 0.35.0 "no service available" escape hatch as a first response instead of doing the two-step web lookup.

- **The give-up line is now gated behind an actual `list_services` call.** The prompt requires looking up in `list_services` and calling a relevant service FIRST (a web/sports question → a search/conversation service), and forbids saying "Det kan jeg ikke slå op her" until it has actually checked and found nothing. No assuming up front that the service doesn't exist, no skipping the lookup. Memory-based answers for current facts remain forbidden.

Note: native-audio Gemini is weaker at multi-step agentic tool use, so this raises reliability but isn't a guarantee — a single-step web-search shortcut (partially reverting 0.27.0's "web search is just generic HA access") remains the bulletproof option if needed.

## 0.37.0 — wake-gated full-duplex Voice PE + LED feedback (5-expert design)

Re-architects the Voice PE firmware so the device streams audio ONLY between wake and grace-expiry (privacy + cost) while keeping TRUE full-duplex barge-in during the conversation. Minimal firmware; the brain stays in PodVoice.

- **Wake-gated mic.** The device boots with forwarding OFF. PodVoice opens it on wake (IDLE→LISTENING) and closes it on every return to IDLE (closure / grace timeout / error). It stays open continuously through the assistant's reply + grace, so you can interrupt by speaking (full-duplex via channel-0 XMOS AEC).
- **Dead-man safety stop.** The device force-stops the mic if PodVoice stops re-asserting for ~25s (crash / half-open socket), so the mic can never be left streaming. PodVoice keepalives every 10s while active.
- **LED ring feedback.** PodVoice drives the stock ring over the native API from a pure state→LED map: idle=off (privacy), listening=cyan, speaking=green, grace=dim cyan, muted=red, error=red blink. (The stock voice_assistant LED phases are dead under use_wake_word:false.)
- **Reconnect-safe.** On every (re)connect PodVoice re-asserts the correct stream + LED for the live state, so a reconnect never leaks audio nor leaves the ring stuck.
- Firmware deltas are tiny: boot-OFF default + the safety timer + two native-API services (podvoice_stream_start/stop). Still UNVALIDATED on hardware — new gates added (privacy gate, safety stop, LED states) to the runbook.

## 0.36.0 — OpenAI Realtime: fix double transcript + instrument the turn state machine

Targets two reported symptoms on the OpenAI/ChatGPT provider (not the prompt; Gemini's native-audio tool-discovery miss is tracked separately).

- **Double "you" transcript fixed.** `openai_realtime.py` emitted `InputTranscript` on **both** `conversation.item.input_audio_transcription.delta` and `.completed`; the console renders one bubble per event (no accumulation), so each utterance showed twice. We now emit only on `.completed` (the authoritative final transcript). Output transcript path unchanged.
- **Turn state machine instrumented (diagnostic).** To find the cross-wired answers ("Hvem scorede?" → "Summen er 137") and the stalls, every turn transition now logs at INFO: `response.created` (id + active/pending), `response.done` (id + **status** + whether it fired the deferred create or ended the turn), tool-calls (name/call_id/response), barge-in clears, and tool-result submit (defer vs. create-now). A first-audio check emits `turn: ANSWER CROSSING …` when a response speaks audio whose id doesn't match the current response — the smoking gun for answers landing on the wrong turn. Logging is once-per-turn (not per audio frame) and can be trimmed once the root cause is pinned.

## 0.35.0 — realtime voice prompt overhaul (10-expert research + adversarial red-team)

Rewrote the default Danish system prompt (`SYSTEM_PROMPT_DA`) from a ~1.5 KB note into a structured, sectioned realtime-voice prompt. Built by a 10-expert research pass (realtime/Gemini-Live, voice-UX, Danish localization, HA tooling, music, knowledge/QA grounding, safety, prompt structure, accessibility, latency) and hardened by a 5-reviewer adversarial red-team (35 issues fixed). Every result-contract claim was validated against `ha_tools.py` before shipping; the canonical fallback phrases in `constants.py` are preserved verbatim (tests green).

- **Anti-drift Danish, strengthened.** Positive "umiskendeligt rigsdansk" lock with a danico word-pair checklist (noget/meget/findes/igen/kun/hvad/hvordan/godt…) and a radioavis self-check on every word. Foreign-language tool `summary` strings are now translated before speaking instead of echoed verbatim — closing a real drift path. Proper names (song titles, brands, rooms, scenes) and names containing digits (Blink-182, U2) are exempt from translation and the numbers-as-words rule.
- **Realtime-native behavior.** Explicit barge-in handling (stop, listen, don't repeat, don't apologize), a turn that mixes an instant action + a slow lookup ("Slukket — vejret tjekker jeg"), and barge-in during a sensitive confirmation cancels the pending action.
- **Latency-shaped speech.** Instant local actions = do-then-confirm (no leading filler); slow lookups = short acknowledgement first, then silence until the result. Numbers, times, prices, years spoken as Danish words for correct TTS.
- **Tool-contract aligned to the real result shape.** The internal `summary:"Done."` action sentinel is never spoken (fixed Danish receipt used instead); `empty:true` success is reported as a fact, not a failure; `error_kind:"denied"` gets a distinct "not set up yet" line; a human-readable `error` (e.g. `intent_error` from a failed search/conversation agent) is relayed briefly in Danish, otherwise the generic fallback; never read ids/JSON/field-names aloud; relative volume routed through `list_services` rather than a guessed percentage.
- **Knowledge grounding.** Replaced temporal trigger-words with a content test — anything with a holder/record/price/latest-version/changing count is looked up even when phrased timelessly; no-service-available means "I can't check that here", never a hallucinated answer; calibrated uncertainty (round or hedge rather than a crisp-wrong number); spoken answers capped to one sentence / two facts.
- **Safety re-tiered by reversibility + blast radius.** Confirm-before only for hard-to-undo / security / money / privacy actions (unlock, garage, alarm-OFF, calls, messages, deletes, purchases, large/low heating changes); arm/lock/close and small heat nudges stay instant. Shared-speaker guard: unlock/alarm-off/call/purchase require a full unambiguous "yes" to the actual question; private content is summarized in one word and read aloud only on explicit yes.

## 0.34.0 — review follow-ups (3 owner-approved design calls)

- **Failed agents are reported as failures.** When a conversation/search agent errors (`response_type=='error'`) the call now returns `ok:false, error_kind:'intent_error'` (so Status no longer counts it as success) while keeping the agent's message so the assistant can relay it. Prompt updated to speak the `error` text when present.
- **Service catalog self-heals.** The `/services` catalog is now re-fetched after ~10 min (and immediately after a 404), so adding/removing an integration mid-session no longer leaves return_response auto-correct or list_services stale until restart.
- **Exposing an entity enables its domain's data services.** Account-level calls (no entity_id, e.g. listening history) are now allowed if you've exposed the bare domain OR any entity of it — no more confusing denials when you exposed the speakers by entity.

## 0.33.0 — hardening from a 20-agent adversarial review

Fixes for real edge cases found reviewing 0.30-0.32 (false alarms discarded):

- **P0 — turn no longer ends before the tool answer is spoken (OpenAI).** The function-call `response.done` was emitting `TurnComplete`, so the state machine ended the turn / shut the duck gate BEFORE the deferred reply spoke. We now fire the deferred `response.create` and suppress that premature `TurnComplete`; the spoken reply's own `response.done` is the real end-of-turn.
- **P0 — barge-in no longer resurrects the interrupted answer (OpenAI).** Interrupting a deferred tool turn now clears the pending follow-up, so it stops instead of speaking what you cut off.
- **P1 — falsy data no longer mislabeled empty.** A real `0`/`false`/`""` from a data service is kept as data; only genuinely-empty containers/None are flagged `empty`.
- **P1 — explicit return_response is never silently dropped.** A stale/incomplete `/services` catalog can no longer override an explicit `return_response=true` (was re-triggering the 0.30 data-loss bug).
- **P1 — OpenAI session state resets on (re)connect/disconnect**, so a dropped socket can't poison the next session (stuck-silent or spurious reply).
- **P1 — mic barge-in now stops browser playback** in the Talk console (the console forwards the interrupt and flushes scheduled audio instead of talking over you).
- **P2 — mixed-case domain guesses resolve** (domain/service lowercased so the gate, auto-correct and the call URL agree). **P2 — speech-summary promotion requires HA's `response` wrapper** (no promoting arbitrary data as the spoken answer).
## 0.32.0

- **OpenAI Realtime: the assistant now actually speaks the tool result.** Fixed a race where, after a tool call, PodVoice asked OpenAI for a reply (`response.create`) while the function-call response was still active — Realtime rejects that, so the model stayed silent ("searches but never returns", worst on chained calls like the music/history question). We now submit the tool output immediately but DEFER `response.create` until the active response finishes. Gemini was unaffected.

## 0.31.0

- **All Voice PE hardware settings live in the Voice PE tab now.** Moved PSK, Simulation mode and Rooms out of Settings into a "Setup" section on the Voice PE tab (with its own Save & restart), so everything about the device — setup + the 3 hardware gates — is in one place. Settings is now just the assistant (provider, prompt, ducking, home control, advanced tuning).

## 0.30.0 — tool-access architecture (5-expert consensus)

Root cause of "home_call ✓ but the assistant still says it can't": a tool-RESULT contract problem. Fixed generically in ha_tools.py, below the provider split, so Gemini and OpenAI behave identically.

- **One flat result contract.** Every home_call/tool result is now `{ok, summary?, data}` on success (`empty:true` when no data), `{ok:false, error_kind, status?, error, hint}` on failure. The model reads the spoken answer from `summary` and structure from `data` — one predictable place, no digging.
- **Generic speech-envelope normalizer.** A shape-driven (never service-named) helper promotes HA's intent/assist speech (`response.speech.plain.speech`) to `summary`; every other payload (track lists, search results) passes through unchanged under `data`. This is what makes conversation.process / web search actually get read aloud.
- **Authoritative discovery.** list_services now surfaces per-field `required` and a tri-state `response_mode` (none/optional/only); home_call auto-corrects the return_response flag from it (forces it for response-only services, drops it for none) — so a guessed flag or a hallucinated service can't 400.
- **Honest, classified errors + observability.** Failures carry error_kind/status/hint; one INFO log line per tool call (secrets redacted) and ok/empty/error counters on the Status tab.
- **Prompt: generic, not locked.** Removed per-service syntax; the model is told to discover via list_services and to only say it can't when a tool actually fails (ok:false).
- **Console UX.** Labels by active provider (Gemini/ChatGPT) instead of always "Gemini"; each tool call shows a collapsed raw-result body so a green check next to a refusal is diagnosable.

## 0.29.0

- **Listening-history questions now point at the right tool.** "What did I play / my top tracks" now go to PodConnect Control's data services (`podconnect.recently_played`, `top_tracks`, `liked`) via `home_call` with return_response — not `media_player.browse_media` (which isn't a history service and 400s). The cleanup did NOT change the return_response request path (verified in git); only error wording.

## 0.28.0

- **Generic web search reaches the model — and HA errors are now honest.** The assistant now correctly calls `conversation.process` via `home_call`. Two fixes: (1) `home_call` surfaces HA's actual error body (a 400 now says e.g. "required key not provided @ data['text']") instead of a bare status code, so the model can self-correct and we can debug; (2) the default prompt names the two fields (`text` = the question, `agent_id` = the search agent) so the call is well-formed first try.

## 0.27.0

- **Web search is no longer special — it's just Home control, like PodConnect.** Removed the bespoke `web_search` tool, the `Search agent` setting, the `Web search` toggle and all provider-native search (Gemini google_search / OpenAI web_search). Live/web questions now go through the SAME generic path as everything else: expose a conversation agent that has Google Search on (e.g. `conversation.google_ai_search`) in Home control, and the assistant calls `conversation.process` via `home_call` with return_response — exactly like `podconnect.top_tracks` or `media_player.play_media`. The default prompt now points at the search agent in natural language. One mental model, nothing to misconfigure.

## 0.26.0

- **Panel never caches stale UI.** The panel HTML is now served with `Cache-Control: no-store`, so new Settings fields (e.g. Search agent) appear right after an add-on update without a manual browser hard-reload.

## 0.25.0

- **Anti-drift Danish.** The default prompt now says "ALTID rigsdansk — ALDRIG norsk eller svensk", so the assistant stops drifting into Norwegian/Swedish when speech is ambiguous.

## 0.24.0

- **Reliable `web_search` tool (works on ANY provider, incl. OpenAI Realtime).** Set a **Search agent** in Settings (an HA conversation agent with Google Search on, e.g. `conversation.google_ai_search`) and the assistant gets a clean first-class `web_search(query)` tool that routes to it (via `conversation.process`, returns the answer). No more relying on the model to hand-compose a generic call — it just calls `web_search`. Keeps the system prompt natural (no tool-syntax needed). The native Web-search toggle stays for Gemini's google_search.

## 0.23.0

- **Web search now actually gets used when enabled.** With the Web search toggle on, the system prompt now tells the model it HAS a web tool (for live sport/news/weather) — so it stops replying "I have no live data" and calls the tool. Reliable on Gemini (native google_search); OpenAI Realtime hosted web search is not guaranteed by the API — use Gemini for dependable web search.

## 0.22.0 — Voice PE firmware Phase 1a (podvoice_audio)

- **`podvoice_audio` ESPHome component built** (the S1 continuous-audio shim) — multi-expert build (lead draft → 3 adversarial reviewers → assembled). A *passive* MicrophoneSource tap on the already-running mic → fixed PSRAM ring buffer (filled on the audio task) → drained from loop() as VoiceAssistantAudio over the native API connection PodVoice already holds. NOT start_continuous, NOT a voice_assistant.cpp fork. Lives at `esphome/components/podvoice_audio/`; wired in `esphome/podvoice.yaml`.
- **Consumer fix:** `voicepe.py._handle_audio(data, data2=None)` matches aioesphomeapi's real callback (2nd arg = optional 2nd channel, not an `end` flag). diag.run_s1 unchanged.
- ruff now excludes `esphome/` (firmware codegen, depends on the esphome package, not add-on source).
- ⚠️ UNVALIDATED on hardware — first flash is the S1 gate; expect a flash→report→fix cycle.

## 0.21.0 — Voice PE firmware Phase 0

- **Maintainable firmware overlay** (`esphome/podvoice.yaml`): replaces the copy-pasted sketch with a thin, pinned `packages:` include of the official firmware + tiny overrides (PSK, wake→event, voice_assistant ownership). Board/pin/audio-graph drift is inherited, not copied. The hard part (continuous-audio `podvoice_audio` component) is a documented Phase-1a placeholder, added only after the hardware gates pass.
- **Dummy-proof Voice PE control tab**: rebuilt as 3 ordered gates (Connection → Audio stream S1 → Speaker S2) with clear pass/fail, friendly edge-case messages (no room, simulation on, panel offline, no audio), and a **Copy result** button so a non-developer can run a gate and paste the outcome. Marked experimental (firmware still in build).

## 0.20.0

- **`list_services` now shows each field's valid values + description**, not just names — so the model calls services correctly. E.g. it sees `podconnect.play_from_library.source = liked | top_tracks | recent`, so "play something I like / play my recent" works in one `home_call` (no gu. The new PodConnect `play_from_library` action is reached fully generically.

## 0.19.0

- **`list_services` now reveals which services return data.** Each service shows `returns_response: true/false` (from HA's service registry). So the model can SEE that e.g. `podconnect.top_tracks` / `recently_played` / `media_player.search_media` give data back, and knows to call them via `home_call` with `return_response: true` — instead of giving up. Fixes "I can't see your listening history" even when the data service exists.

## 0.18.0

- **`home_call` can now read data-services + call account-level services.** Two additions so the
  assistant can reach the *data plane* (e.g. a future PodConnect `top_tracks`/listening-history
  service) generically:
  - `return_response: true` → calls the HA service with `?return_response` and returns its payload
    (e.g. `media_player.search_media`, `podconnect.top_tracks`).
  - `entity_id` is now optional: omit it for account-level services (then the **domain** must be
    exposed in Home control). Entity services still require an exposed entity.
  Stays fully generic — no PodConnect-specific code; the data service is added on the PodConnect side.

## 0.17.0

- **FIX: Home control list was empty because the add-on never received `SUPERVISOR_TOKEN`.**
  Root cause (multi-expert, high confidence): the entrypoint started Python WITHOUT s6-overlay's
  `with-contenv` wrapper, so the Supervisor token (written to /run/s6/container_environment/) was
  never exported into the process env → the HA core-API call sent an empty `Bearer ` header. That's
  why PodConnect & Gemini worked (own creds) but only HA failed.
  - `run.sh` now uses `#!/usr/bin/with-contenv bashio`.
  - `config.py` also reads the token directly from the s6 container_environment file as a fallback.
  Update the add-on (it rebuilds) + restart — NO uninstall needed. The entity list then fills.

## 0.16.0

- **Clear error when the add-on has no HA token.** The empty-token case used to crash with a cryptic `Illegal header value b'Bearer '`; Home control now says exactly what's wrong and how to fix it (reinstall the add-on so Supervisor grants homeassistant_api).
- **Settings page reorganised for clarity.** Logical sections: **Assistant** (provider + web search; note that model/voice live in Talk) → **Music ducking (PodConnect)** → **Home control** → **System prompt** → collapsed **Voice PE (hardware)** (PSK, rooms, simulation — not needed for the console/Assist) → collapsed **Advanced** (per-provider tuning + ducking). Every control now has a labelled home and a one-line purpose.

## 0.15.0

- **Stop button in Talk.** A ⏹ next to Send instantly silences the spoken reply (flushes the
  audio + ignores further chunks until your next turn) — for when the model rambles or you want
  to barge in by hand.
- **Web search (opt-in).** New Settings toggle exposes the provider's NATIVE web search — Gemini
  `google_search` grounding / OpenAI `web_search` — so the assistant can answer live questions
  (e.g. a match result). Off by default; experimental (may not combine with home control on
  every model). VERIFY tool names per provider.

## 0.14.1

- **Home control now shows WHY it's empty.** When no entities load, the picker surfaces the actual
  Home Assistant error (e.g. auth/connection) instead of a generic message — so an unreachable
  HA core API is diagnosable. `/api/ha/entities` returns an error string when home tools are off.

## 0.14.0

- **Settings split per provider — Gemini vs ChatGPT (OpenAI) — with the key tuning knobs to test.**
  - **Gemini (Live):** model, voice, VAD start/end sensitivity, prefix padding, silence ms.
  - **ChatGPT (OpenAI Realtime):** model, voice, turn detection (Semantic/Normal/Disabled),
    eagerness (semantic), threshold (normal), prefix padding, silence ms, noise reduction
    (near/far/off).
  Wired end-to-end: Gemini VAD → `realtime_input_config` (applied defensively, never breaks
  connect); OpenAI knobs → the `session.update` turn_detection + noise_reduction. Both the
  console and the room pipeline use them. Ducking/tuning kept in its own block.

## 0.13.0

- **Seamless session resume (no more mid-conversation drops/reloads).** `GeminiLiveSession.events()`
  now transparently reconnects on the server's `go_away` (Live session time cap) OR a dropped
  socket, using the stored resumption handle (make-before-break), with bounded backoff — the
  consumer's stream never ends. This is in the SHARED session layer, so it works in BOTH the
  in-panel Talk console AND the Voice PE room pipeline. The orchestrator no longer double-
  reconnects on go_away (events() owns it). The console WebSocket already pings (heartbeat=20s)
  so the Nabu Casa tunnel won't recycle an idle connection.

## 0.12.1

- **Home control picker redesigned.** It was being squeezed into the 2-column settings grid (broken layout). It's now its own full-width section: a heading with a live “N groups · M entities allowed” counter, **Allow whole groups** chips, an **Or pick individual entities** search + scrollable list grouped by room (two-line rows: name + entity_id, domain-covered rows greyed “via group”), and a collapsed manual field. Friendlier empty state.

## 0.12.0

- **Live selectors instead of typed/hardcoded ids.** Settings now reads the real data:
  - **Home control** is a live picker over your actual HA entities (grouped by Area) + domain
    chips derived from what you really have — tick a domain or individual entities. Search box;
    a collapsed manual field remains for ids HA hasn't loaded.
  - **Rooms → room** is a dropdown populated from PodConnect `GET /api/rooms` (real room ids/
    names) instead of typing `r0`. Falls back to a text field if PodConnect is unreachable.
- New read-only panel endpoints: `GET /api/ha/entities` (entities+areas+domains) and
  `GET /api/podconnect/rooms`. The saved `exposed` format is unchanged (domains + entity_ids).

## 0.11.1

- **Home control is now a multiselect.** Tick domain chips (light, media_player 🎵, scene, climate, cover, vacuum, …) to expose them, plus a text field for specific entity_ids. Saved value is unchanged (a list of domains/entity_ids).

## 0.11.0

- **PodVoice no longer embeds any PodConnect/music logic.** Removed the `music` tool and all the
  Control-specific machinery (search_media→play_media stitching, room→media_player mapping, the
  per-room media_player setting/UI). PodVoice is just Gemini voice + GENERIC Home Assistant
  access: `list_home`, `list_services`, `home_call`, plus the curated convenience tools.
- Music/speakers (PodConnect Control), a vacuum, a fan, … are now reached the SAME generic way
  (`list_services` + `home_call`) — like any HA device. Any nicer 'play X' belongs in PodConnect's
  own API, not here.
- PodVoice's only PodConnect contact remains the Attention duck (orchestrator/health), unchanged.

## 0.10.0

- **One clean music integration.** Replaced the three overlapping surfaces (generic `podconnect`
  HTTP passthrough, `play_music`, and curated `media_control`/`set_volume`) with a SINGLE
  `music` tool: action = play (query/uri) | pause | resume | stop | next | previous | volume,
  targeting the room's PodConnect Control media_player via standard HA services.
- **PodVoice no longer speaks PodConnect's own HTTP interface.** Its only PodConnect contact is
  the Attention duck (orchestrator/health) — the sanctioned contract. The `podconnect` raw
  passthrough tool is removed.

## 0.9.1

- **`play_music` now search-and-plays correctly.** PodConnect Control's `play_media` expects a
  Spotify URI, not free text — so a query is first resolved via `media_player.search_media`
  (plays the best-ranked result[0]). An exact `uri` skips the search. (0.9.0 sent raw text to
  play_media, which Control couldn't resolve.)

## 0.9.0

- **Fix: “play <song>” now actually plays that song, on the right speaker.** Play-by-name used to
  hit PodConnect `POST /api/play?query=`, but PodConnect (go-librespot) can only *resume* the
  last track — so it un-paused random old music on every HomePod (and returns 400 since
  Speakers 0.19.0). New **`play_music`** tool routes content selection through Home Assistant
  (`media_player.play_media`) on the room's PodConnect **Control** entity (Spotify Web API),
  targeting ONE speaker; accepts a free-text query or an exact `uri`.
- PodConnect is now used ONLY for local transport/volume/duck (stop, resume, volume, attention);
  its tool description forbids play-by-query.
- **Settings → Rooms** gains a per-room **media_player** field (the Control entity for that
  speaker). Configured room players are implicitly allowed.

## 0.8.1

- **Quieter log**: the add-on Log tab no longer drowns in `GET /api/status` polling lines
  (aiohttp access log set to WARNING) — meaningful events (settings saved, errors) stand out.
- **Cleaner model list**: translate/tts-only Live models (e.g. `*-live-translate-preview`) are no
  longer offered as chat voices.

## 0.8.0

- **Voice picker in Talk**: choose the TTS voice right next to provider/model, switch live by ear,
  and it's **saved** (per provider). Find your favourite Danish-sounding voice by ear.
- Provider/model/voice choices all persist to settings (the saved model stays selected on reload).

## 0.7.1

- **Service discovery**: new `list_services` tool lets the assistant see each exposed domain's
  services + parameters (e.g. a vacuum's room/segment cleaning, fan speed, mop/water mode) and
  run them via `home_call`. Unlocks advanced device control without hardcoding (e.g. Roborock).

## 0.7.0

- **Fix: the conversation now continues across turns.** The Gemini reader re-enters
  `session.receive()` after each turn, so it no longer goes silent after the first reply or a
  tool call.
- **Roborock & everything else:** new generic `home_call(domain, service, entity_id)` tool
  (allowlist-gated) covers vacuum/fan/lock/humidifier/… now and future — not hardcoded.

## 0.6.2

- Picking a provider/model in Talk now **live-syncs** the Settings → Advanced model field
  (no longer stale until reload).
- **Reset** button on the System prompt restores the built-in capability-aware default.

## 0.6.1

- Talk tab: model dropdown now lists **voice-capable models only** and is width-capped so a long
  name can't stretch the layout. Picking a provider/model now **persists** as the default
  (saved to settings).

## 0.6.0

- **Editable system prompt** (Settings) — a capability-aware default tells the assistant who
  it is and what it can do (home + music + tools), so it can answer “hvad kan du?” and never
  goes silent. Edit it freely (copy/paste) and Save & restart.

## 0.5.0

- **Tabs**: the panel is now Talk / Status / Settings / Voice PE — no more long scroll.
- **Voice selector**: pick the Gemini / OpenAI voice (Advanced).
- **Tool calls show inline** in the conversation (e.g. “🔧 podconnect ✓”) — no separate test field needed.
- Fixed dropdown width so long model names no longer stretch the layout.

## 0.4.0

- **Home control & music (like Assist).** The assistant can now control Home
  Assistant — lights, switches, scenes, climate, covers, media transport/volume, to-do —
  gated by an **allowlist** you set in Settings ("Home control"), and it works in the panel
  console too. Plus a **generic PodConnect** tool: full access to PodConnect's API (play/pause/
  volume/etc.) — current and future features, nothing hardcoded.

## 0.3.2

- **Cleaner, simpler panel.** Gemini replies now coalesce into one bubble per turn
  (no more fragment-per-line). The duplicate/contradictory "Rooms" boxes are gone —
  hardware-only sections (Rooms, room transcript) hide until you add a room. The console
  moved up; model fields moved into Advanced. Stale "set in the add-on Configuration"
  text removed.

## 0.3.1

- Service health dots are now meaningful without rooms: PodConnect is actively pinged
  (GET /api/attention) every 30 s, and the Gemini/OpenAI dot reflects whether the active
  provider's key is set. (Previously the dots only lit up as a side effect of a ducking call.)

## 0.3.0

- **Voice PE setup in the panel** — a "Voice PE setup" section with a guided checklist and
  three click-buttons (no terminal): **Check connection**, **Check audio stream** (the S1
  continuity test), and **Test speaker** (the S2 tone). The old CLI spikes still exist for
  power users.

## 0.2.0

- **Pluggable voice brain** — choose **Gemini Live** (default; best Danish, lowest cost)
  or **OpenAI Realtime** (`gpt-realtime`) from the panel.
- **Sidebar panel** restyled to match PodConnect (light/translucent, adapts to dark).
- **Talk to Gemini** console in the panel — type and hear spoken replies with a live
  transcript; mic auto-enables on a secure origin (HTTPS / Nabu Casa / localhost).
- **Provider + model selectors** in the console; voice-capable models flagged.
- **Simplified setup** — the Configuration tab now holds **only the API keys**
  (`gemini_api_key`, optional `openai_api_key`). Everything else (provider, models,
  PodConnect URL/token, Voice-PE PSK, rooms, tuning, simulation) is on the panel's
  **Settings** page with one-click **Save & restart**.
- **Simulation mode** — watch the full duck → speak → lounge → release flow with no
  hardware or keys.
- Live status, ducking meter, transcript, controls, metrics, and `/health` in the panel.

## 0.1.0

- Initial release: gatekeeper service, HA add-on packaging, custom Voice PE firmware
  sketch, and the S1/S2 hardware spikes.
