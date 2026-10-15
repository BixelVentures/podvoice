# PodVoice-systeminvarianter

> Produktbeslutning (13/10): brugeren har valgt **kun GPT-Live** til både Voice PE
> og Talk. Den allerede valgte GPT-Live-produktionsvej deler `ThinSession`, `VoicePELink`,
> `ToolRouter` og fysisk close/rearm. Aktuel installeret version og fysisk evidens står
> i `docs/STATUS.md`; et valg eller en kodeændring er ikke fysisk accept eller bevis for
> løst semantisk close.
> GPT-Live bruger samme ThinSession, VoicePELink, ToolRouter og fysiske close/rearm-
> ejer. Live-events skal navngives sandt; Realtime-tur-/audio-done-/ACK-events må ikke
> fabrikeres. Nedenstående mekaniske ejerskab og fysiske sikkerhedskrav bevares.
> Funktionsparitet, Stop, Talk og dræn skal stadig bevises på kandidatens egne bits.
> STATUS.md er den ene aktuelle lead-post for installerede bits og direkte bevis.
> Ingen følsom handling åbnes ved en opdigtet næste-brugertur, og strømlining arver
> ingen fysisk readiness fra den tidligere motor eller en UI-ændring.

> **Fortolkning af protokoldetaljer:** GPT-Live er produktionsprovideren. De konkrete
> OpenAI Realtime-wirekrav nedenfor (`response.create`, `input_audio_buffer.*`,
> item-commit/delete-ACK og tilhørende eventrækkefølge) gælder kun den beholdte
> `OpenAIRealtimeSession`-diagnostik og dens regressioner; de kan ikke tælle som
> GPT-Live-providerbevis. GPT-Live skal bevise samme ejerskab, generation, aktuelt input,
> værktøjsbatch, playback, teardown og rearm med sine faktisk udsendte events:
> `LiveSessionReady`, `LiveTransportReady`, `LiveAudioChunk`, `LiveBackendStarted`,
> `LiveBackendComplete`, `LiveToolBatch` og `LiveSessionClosed`. Der må ikke opfindes
> Realtime-ACKs. Alle mekaniske, fysiske, Talk- og sikkerhedsgates nedenfor gælder stadig.



Dette er repoets autoritative tværgående kontrakt. `AGENTS.md` og `CLAUDE.md` kræver,
at den læses før arkitektur-, lyd-, VAD-, Realtime-, firmware- eller livscyklusændringer.
En grøn deltest må aldrig tilsidesætte en invariant her.

## Én samtaleejer, flere afgrænsede ejere

| Ansvar | Eneste ejer |
|---|---|
| Fysisk wake-detektion og conversation-latch | Voice PE-firmware |
| Én wake → én kanal/session, mic-gate, playback, teardown og rearm | `ThinSession` |
| Sprogforståelse, turforståelse, semantisk afslutningsintention og værktøjsvalg | GPT-Live |
| Endelig autorisation af højrisiko-/sideeffektende handlinger | server-side execution policy; aldrig prompten alene |
| Live-data og handlinger for tid, hjem, musik, web, vejr og senere timere | Home Assistant; klassificeret MCP API-id `assist`, statisk `podconnect.*` HA-serviceadapter til private musikdata og den eksplicit opt-in, entity-afgrænsede enhedsadapter |
| Start/slut på fysisk svarlyd | firmware-events fra PodVoice-announcement-kæden |

Stock Home Assistant Assist må ikke starte eller eje en PodVoice-samtale. Et værktøj må
aldrig åbne, lukke eller genstarte tale-/wake-kanalen.

PodVoice må ikke have en konkurrerende lokal sandhed for tid, vejr eller countdown.
`GetDateTime` er eneste tids-/datoværktøj, `google_web_sogning` er eneste webværktøj,
og højst ét HA-weather-værktøj må være deklareret. Ukendte tool-navne vises som afventende klassifikation og sendes ikke til GPT-Live. En
konflikt skjuler kun det berørte domæne. Et åbent GPT-Live-tool-schemasnapshot er
immutable; ny HA-discovery gælder først den næste session.

GPT-Live må forstå, foreslå og føre den naturlige bekræftelsesdialog, men et modelkald
er ikke i sig selv tilladelse til en højrisikohandling. Oplåsning, alarm fra, adgang,
køb, ekstern kommunikation, væsentlig sletning og andre klassificerede sideeffekter
kræver en server-ejet, kortlivet godkendelse bundet til session, handling, mål og
argumenter. Et afvigende eller gammelt kald skal afvises fail-closed.

## Bindende Voice PE-kontrakt er half-duplex

Når `full_duplex == false`, skal alle disse være sande samtidig:

Denne sektion beskriver målkontrakten. `docs/STATUS.md` er eneste sandhed om, hvilke
bits der faktisk er installeret og fysisk bevist.

1. GPT-Live er produktionsprovideren. `ThinSession` afviser events fra en inaktiv session,
   lukning eller forkert `_connection_generation`. `LiveSessionReady` og
   `LiveTransportReady` er kun provider-/transporttilstand; de beviser ikke fysisk wake,
   mic-gate eller playback.
2. Den eksisterende `State` skal fortsat være eneste software-mic-gate:
   `LISTENING` og `LOUNGE_WINDOW` er åbne; `IDLE`, `THINKING` og `AI_SPEAKING` er
   lukkede. Playback-flags, timere og `_speaking` må ikke blive konkurrerende gateejere.
   Fra den accepterede brugertur lukkes gaten; først den aktuelle playback-leases
   fysiske finish plus ekkohale må åbne `LOUNGE_WINDOW`. Ingen
   software-state, model-event eller provider-ACK erstatter device-/firmwarebevis for,
   at mikrofonframes ikke krydser den lukkede fysiske gate. Den aktuelle GPT-Live-kode
   pumper native inputaudio under aktiv session og har ikke en capture-hold omkring
   almindelig playback; det er derfor ikke dokumenteret, at den opfylder dette lukkede
   mic-mål. #164 sporer dette separat; ingen fysisk/acoustic proof er udledt her.
3. En brugerinput-fragmenthændelse er ikke en komplet eller ACK'et tur. GPT-Live's
   `LiveTranscript.input_index` og `LiveBackendStarted.input_index` er input-sekvensbevis;
   ved tool-dispatch kræver `ThinSession` fortsat, at batchens generation og det aktuelle
   input-index matcher den backendrespons, som oprettede batchen.
4. `LiveBackendComplete` skal være `completed`, før `LiveToolBatch` accepteres.
   `ThinSession` skal fortsat afvise inaktiv/stale epoch, gammel provider-generation,
   ny inputrevision, fremmed response/delegation, replay og kald, der fejler serverpolicy.
   En provider batch eller et korrekt svar alene er ikke autorisation.
5. GPT-Live's `LiveAudioChunk` har provider-generation og sample-rate, ikke en
   Realtime response-/item-ACK. Kun PCM fra aktiv session/generation/stream må komme til
   live audio-streamen; fysisk playback-start/slut skal matche den aktuelle playback-lease
   og firmware-event. Playback-finish plus ekkohale og korreleret rearm forbliver de
   fysiske grænser for næste wake.
6. En GPT-Live input- eller tool-resultatsti må ikke opfinde `conversation.item.added`,
   `response.create`, commit- eller delete-ACKs. Typed Talk-input har den faktiske
   submitted/provider-ack-unavailable kontrakt; backend- og værktøjseffekter skal stadig
   bindes til current input, response, delegation og generation.
7. Voice PE må ikke love barge-in. Talk-browseren er den separate full-duplex-overflade
   og må eksplicit bruge browser-AEC; den er ikke bevis for puckens fysiske mic-gate.

### Historisk OpenAI Realtime-protokolprobe (kun diagnostik/regression)

Følgende eksakte wirekrav gælder fortsat, når den beholdte `OpenAIRealtimeSession`
diagnostic-/regressionsadapter afprøves. De gælder ikke GPT-Live og kan ikke erstatte
punkterne ovenfor eller tælle som GPT-Live-bevis:

- Realtime bruger `interrupt_response: false`, `create_response: false` og ét
  `response.create` bundet til accepteret `speech_stopped`, matching committed-item og
  `(root_item_id, turn_id, provider_generation)` med unikt request-id.
- `input_audio_buffer.speech_started`, `.clear`, `.committed` og `speech_stopped` følger
  den eksakte VAD-crossing-, nul-PCM-, item-added- og delete-ACK-cleanuprækkefølge;
  manuel commit er ikke VAD-terminal, og enhver manglende ACK lukker fail-closed.
- Realtime response-/tool-/schema-/close-responses arver samme turn/generation lease;
  numeriske wire-metadata er kanoniske decimale strenge.

Tre og kun tre fysiske audio-generation-grænser er autoritative:

1. første gyldige `speech_stopped` på en åben Voice PE-tur;
2. den aktuelle playback-leases `playback_finished` plus ekkohale, atomisk før
   `LOUNGE_WINDOW` åbnes;
3. exact korreleret `token:recovered`-ACK efter fuld teardown.

Grænsen øger generationen synkront og dræner køen. En callback, der allerede har
fanget den gamle generation, er derefter inert. Der må aldrig skæres ved wake eller
idempotent stream-keepalive; det ville klippe den bevidst bevarede same-breath-lyd.

De forbudte kombinationer er: **lokal half-duplex mic-gate + server-side automatisk
response-interrupt** og **lokalt kasseret tur + server-side automatisk response**. Den
første gav feltfejlen 2026-08-18; den anden gav trace `20260901T101334-410`, hvor en
kasseret start overlevede playback og opslugte den næste opfølgning.

Den isolerede `correlated_local_stop_v1`-kandidat tilføjer en lokal stemmestyret
transport-stopknap under eget svar. Kun microWakeWord-modellen `Stop` må udløse den;
ikke ASR-tekst, VAD eller providerfraser. Stop låser playback før lokal afbrydelse,
lukker stille gennem samme close-owner og kræver korreleret pipeline-drain før rearm.
Stopaktivering er playback-/timer-ejet; mikrofonlyd til OpenAI forbliver gated.
Kandidaten er ikke fysisk godkendt, før den særskilte stop-gate er bestået.

## Livscyklus

1. Ét fysisk “Okay Nabu” giver én wake-event, åbner privacy-gated mic og præcis én
   GPT-Live-session. ThinSession afviser events fra forkert session-/connection-generation.
2. Første ytring og alle naturlige opfølgninger kører i samme session uden nyt wakeword.
   Efter et fysisk svar er opfølgningsvinduet fire sekunder; fysisk stilhed lukker
   mekanisk uden at foregive en semantisk modelbeslutning.
3. En almindelig klar brugertur besvares direkte af GPT-Live. Kun en handling
   eller et opslag bruger det nødvendige domæneværktøj; `end_conversation` bruges kun
   til semantisk afslutning, og `wait_for_user` kun til ikke-henvendt tale eller et rent modtaget-signal
   for et allerede givet svar uden ny anmodning eller afslutningshensigt. GPT-Live afgør betydningen; et rent tak giver stille venten med åben samtale. Spørgsmål,
   høflige handlinger, tilbud/godkendelser og nødvendig opklaring behandles stadig. De to
   lifecycle-signaler er interne og må aldrig dispatches til HA/MCP. Lokal tekstmatching
   af “farvel”-varianter er ikke afslutningsautoritet.
4. GPT-Live konfigureres med automatisk værktøjsvalg. Der findes intet obligatorisk
   fortsættelsesværktøj eller en tvungen ekstra modelrespons for direkte svar. Et
   domæneværktøjs resultat kan udløse den nødvendige resultatsrespons; et godkendt
   `end_conversation` kan udløse én kort terminal kvittering eller ét farvel. Ingen af delene åbner en ny
   GPT-Live-session eller mister den eksisterende samtalekontekst.
5. Efter committed `end_conversation` må den korrelerede terminalrespons indeholde én
   kort sand opgavekvittering, ét kort farvel eller ingen lyd. Lyd afspilles færdig før
   lukning; manglende eller fejlet
   terminallyd lukker stille. Transporten må ikke opfinde betydning eller afspille et
   lokalt cachet farvel.
6. Semantisk afslutning, fysisk stop, timeout og fejl samles i én atomisk close-owner.
   Provider, mic, playback, ducking og attention frigives præcis én gang.
7. Rearm sker først efter fuld teardown. Firmwarekvitteringen må kun åbne næste latch,
   når ubrudt detektorkontinuitet **og frisk fysisk mikrofonfremdrift** er bevist efter
   rearm. `micro_wake_word.is_running()` alene er forbudt som readiness-bevis, fordi
   ESPHome også returnerer sand i `STARTING` og `STOPPING`. En virkelig efterfølgende
   wake er fortsat det stærkeste kontinuitetsbevis.
8. Provider-eventrækkefølge er ikke nødvendigvis den fysiske samtalerækkefølge. En
   færdig inputtransskription kan komme efter svaret; historik skal derfor tidsstemples
   ved brugerens `speech_stopped`-grænse og må aldrig vise svar før årsag.
9. Alle brugerinput skal ejes af `ThinSession`, før de sendes til provider. Tale opretter
   turen ved den autoritative taleslutgrænse; skrevet Talk-input skal gå gennem en
   tilsvarende offentlig turindgang. En adapter må aldrig kalde providerens `send_text`
   direkte, undertrykke sendefejl eller vise input som accepteret uden en korreleret
   serverkvittering. På Voice PE må et committed provider-item ikke skabe en respons,
   før Thin har accepteret den samme fysiske talespændvidde og sendt det ene korrelerede
   response-request.
10. WebSocket-forbindelse, provider-readiness, samtalestatus og inputaccept er fire
    forskellige sandheder. UI må ikke udlede "klar" af en åben socket. Hver session,
    tur, providerrespons, værktøjskald og playback skal kunne korreleres; events fra en
    gammel forbindelse eller gammel playback må ikke ændre den aktuelle tilstand.
    Den sammenhængende trace-nøgle er `session_id → provider_generation → turn_id →
    audio_generation → response_id/tool-call-id → playback_id → close_id → rearm_token`.
11. `LiveBackendComplete` er kun backendens terminalstatus, aldrig bevis for et stille rum;
    `LiveAudioChunk` binder heller ikke hver lydchunk til et response-/item-id.
    Et publiceret svar ejer én tur-bundet playback-lease fra request gennem fysisk start,
    fysisk finish og ekkohale. Først den samme leases finish må åbne opfølgningen eller
    lukke efter modelsemantisk farvel. Manglende start fejler lukket; stale, dublerede,
    omvendte eller fremmede playback-events er virkningsløse.
12. Et provider-værktøjskald er kun en kandidat, indtil den samme korrelerede
    providerrespons afsluttes med den officielle status `completed`. Kandidater fra
    `cancelled`, `incomplete`, `failed` eller ukendt status må udføre nul sideeffekter
    og må ikke eje semantisk close. Argumenter skal parse og validere fail-closed før
    dispatch; en senere cleanup kan aldrig legitimere en handling, der blev startet for
    tidligt.
13. En completed GPT-Live-backend-delegation autoriserer ikke alene en sideeffekt. Alle
    kandidater valideres som én `LiveToolBatch`; før dispatch skal ThinSession bekræfte
    aktiv epoch/generation, samme backend-response/delegation, aktuelt input-index,
    uændret inputrevision og serverpolicy. Manglende, stale eller ukorreleret batch er
    virkningsløs. Sideeffekter udføres i batchrækkefølge; `send_tool_results` sender ét
    `function_call_output` pr. eksakt call-id og fortsætter GPT-Live-backendforløbet uden
    en særskilt Realtime-item-ACK. Realtime-protokollens commit/ACK-regression forbliver
    alene en diagnostisk adapterkontrakt.
14. Følsomme handlinger er en totrinskontrakt: GPT-Live foreslår semantisk, men serveren
    holder den eksakte normaliserede handling. Kun en completed, intern approval på den
    umiddelbart næste brugertur i samme session kan frigive den én gang. Ethvert andet
    input, ændret mål/argument, udløb, teardown eller replay annullerer tilladelsen.
15. Providerbudgettet er en causal sikkerhedsgrænse, ikke kun telemetry. Før en
    sideeffektende tool-batch frigives, skal den samme socket-generation have
    autoritativ, ikke-negativ usage og reserveret kapacitet til tool-resultat eller
    farvel. Ellers udføres nul sideeffekter. På en delt provider-/rate-limit-pulje er
    den eksplicit startede live-preflight en bounded, gensidigt eksklusiv
    diagnostiktilstand: aktiv produktion blokerer eval før socket, og en aktiv eval
    afviser nye Voice PE-/Talk-sessioner straks som `diagnostic_busy`, hvorefter den
    normale fejl-teardown og rearm gennemføres én gang. UI må ikke vise fysisk klar,
    og diagnostiklåsen skal frigives ved enhver terminal sti. Parallel eval og
    produktion kræver en separat providerpulje; lokalt simuleret headroom er ikke bevis.
    Første sideeffektfrie semantiske response er providerpreflight; der må ikke oprettes
    en separat throwaway Response, probelease eller probesession. `rate_limits.updated`
    er kun valgfri pacingtelemetri: fravær eller malformed data vælger et nyt
    konservativt lokalt vindue og må aldrig genbruge gammel providerautoritet. Typet
    usage på alle semantiske responsekanter, atomisk kontinuerlig TPM-pacing lige før
    hver klientstyret `response.create` (også tool-resultat/follow-up), tre-kanters
    turnloft, hard deadline og det prospektive prisloft gælder den sideeffektfrie
    Realtime-evaldriver; det er ikke GPT-Live-runtimekrav. En provider-429/capacity
    stopper hele diagnostikken særskilt og terminalt uden automatisk retry, næste
    scenarie eller sideeffekt.

## Beviskrav før “testklar” eller “færdig”

- Test den sammensatte kontrakt, ikke kun komponenter: provider-konfiguration,
  `ThinSession`, Voice PE-events og eventrækkefølge skal mødes i samme test.
- Release-gaten skal gennemføre mindst ti gange:
  `wake → én session → første svar → opfølgning i samme session → semantisk lukning →
  fysisk playback-finish → én teardown → én rearm`.
- Race/permutationer skal dække speech-start lige før playback, tool-resultat mellem
  responses, playback-start/slut i forskellig rækkefølge, samtidig stop/timeout/fejl og
  re-wake efter lukning.
- GPT-Live-regressioner skal afvise stale generation/input og tool-dispatch uden kæden
  aktuelt input-index → completed delegation/response → admitted `LiveToolBatch` →
  guarded dispatch; audio skal være fra aktiv session/generation og fysisk playback-lease.
  Realtime crossed-start → cleanup → stop/commit/item/delete-ACK forbliver en særskilt
  protokolprobe, hvor klientens kontrol-event alene aldrig tæller som serverbevis.
- Trace-oraklet skal afvise enhver response, tool-call eller playback uden den faktiske
  provider-/input-/generationsevidens for den testede adapter; det må ikke kræve en
  opdigtet GPT-Live committed-item eller ACK.
- En fysisk Voice PE-trace skal vise forståelig første ytring, korrekt opfølgning,
  `playback_started`, `playback_finished`, `close_requested`, `wake_rearmed` og en ny
  provider-session ved næste wake.
- En korrekt handling eller et korrekt svar kan ikke alene godkende inputkæden. Hvis den
  diagnostiske transskription er tom eller semantisk uforenelig med den kendte testytring,
  skal device- og provider-lyden sammenlignes. Prøven er fejl/ukendt, indtil det er bevist,
  at hele ytringen nåede den testede provider; modellen kan ellers have ramt rigtigt ved et tilfælde.
- “Grøn CI” er nødvendigt, men aldrig fysisk bevis. Manglende eller `—` telemetry er
  ikke et bestået resultat.

## Obligatorisk ændringskontrol

Ved ændringer i VAD, mic-gating, audio buffering, tool-rounds, playback eller teardown:

1. Angiv hvilke invarianter der berøres.
2. Tilføj en regressionstest fra den konkrete fysiske eventrækkefølge.
3. Kontrollér den modsatte overflade: Voice PE half-duplex versus Talk full-duplex.
4. Afvis enhver konfiguration, hvor to lag begge tror, de ejer interruption/lukning.
