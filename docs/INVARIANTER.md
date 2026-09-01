# PodVoice-systeminvarianter

Dette er repoets autoritative tværgående kontrakt. `AGENTS.md` og `CLAUDE.md` kræver,
at den læses før arkitektur-, lyd-, VAD-, Realtime-, firmware- eller livscyklusændringer.
En grøn deltest må aldrig tilsidesætte en invariant her.

## Én samtaleejer, flere afgrænsede ejere

| Ansvar | Eneste ejer |
|---|---|
| Fysisk wake-detektion og conversation-latch | Voice PE-firmware |
| Én wake → én kanal/session, mic-gate, playback, teardown og rearm | `ThinSession` |
| Sprogforståelse, turforståelse, semantisk afslutningsintention og værktøjsvalg | OpenAI Realtime |
| Endelig autorisation af højrisiko-/sideeffektende handlinger | server-side execution policy; aldrig prompten alene |
| Hjem, musik, web, vejr og timere | værktøjer kaldt af Realtime; aldrig livscyklus |
| Start/slut på fysisk svarlyd | firmware-events fra PodVoice-announcement-kæden |

Stock Home Assistant Assist må ikke starte eller eje en PodVoice-samtale. Et værktøj må
aldrig åbne, lukke eller genstarte tale-/wake-kanalen.

Realtime må forstå, foreslå og føre den naturlige bekræftelsesdialog, men et modelkald
er ikke i sig selv tilladelse til en højrisikohandling. Oplåsning, alarm fra, adgang,
køb, ekstern kommunikation, væsentlig sletning og andre klassificerede sideeffekter
kræver en server-ejet, kortlivet godkendelse bundet til session, handling, mål og
argumenter. Et afvigende eller gammelt kald skal afvises fail-closed.

## Bindende Voice PE-kontrakt er half-duplex

Når `full_duplex == false`, skal alle disse være sande samtidig:

Denne sektion beskriver målkontrakten. `docs/STATUS.md` er eneste sandhed om, hvilke
bits der faktisk er installeret og fysisk bevist.

1. Realtime konfigureres med `interrupt_response: false` og
   `create_response: false`. Semantic/server VAD registrerer og committer tale, men kun
   `ThinSession` må mekanisk tillade én `response.create` for et accepteret,
   korreleret input-item, og provideradapteren alene sender wire-eventet. Initiale og
   afledte tool-/schema-/close-responses skal arve den samme
   `(root_item_id, turn_id, provider_generation)` og have et unikt request-id. Numerisk
   wire-metadata skal være kanoniske decimale strenge. Realtime ejer fortsat hele
   svarets semantik.
2. Den eksisterende `State` er eneste mic-gate: `LISTENING` og `LOUNGE_WINDOW` er åbne;
   `IDLE`, `THINKING` og `AI_SPEAKING` er lukkede. Playback-flags, timere og
   `_speaking` beskriver kun mekanik og må ikke være konkurrerende gateejere.
3. Når brugerens tur er afleveret, sendes ingen mikrofonframes til Realtime før den
   aktuelle playback-leases fysiske finish plus ekkohale har åbnet `LOUNGE_WINDOW`.
4. `input_audio_buffer.speech_started` betyder kun "VAD så lyd"; det er ikke i sig selv
   et transport-interrupt.
5. En VAD-start, der krydser en lukket svar-gate, må aldrig skabe respons eller
   værktøjskald. `input_audio_buffer.clear` er kun byte-clear og er ikke bevis for, at
   den aktive VAD-spændvidde er afsluttet. Mens den fysiske mic-gate forbliver lukket,
   må adapteren kun sende bounded, indholdsneutral nul-PCM for at få provideren til at
   levere spændviddens naturlige `speech_stopped`. Først matching stop, committed item,
   item-added og eksakt delete-ACK er fuldt cleanup-bevis; derefter må næste mic-open
   ske. Manuel commit må aldrig bruges som VAD-terminal. Mangler en af kanterne inden
   den afgrænsede deadline, lukkes hele sessionen fail-closed.
6. Et accepteret `speech_stopped` lukker mic-gaten med det samme. Først et matching
   `input_audio_buffer.committed`/user-item på samme generation må udløse præcis én
   klientstyret `response.create`. Respons, lyd eller tool-call uden matching lokalt
   request-id er en protokolfejl og lukker fail-closed.
7. Voice PE må ikke love barge-in. Talk-browseren er den separate full-duplex-overflade
   og må eksplicit bruge `interrupt_response: true` med browser-AEC.

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

## Livscyklus

1. Ét fysisk “Okay Nabu” giver én wake-event, åbner privacy-gated mic og præcis én
   Realtime-session.
2. Første ytring og alle naturlige opfølgninger kører i samme session uden nyt wakeword.
   Efter et fysisk svar er opfølgningsvinduet fire sekunder; fysisk stilhed lukker
   mekanisk uden at foregive en semantisk modelbeslutning.
3. En almindelig klar brugertur besvares direkte i én Realtime-respons. Kun en handling
   eller et opslag bruger det nødvendige domæneværktøj; `end_conversation` bruges kun
   til semantisk afslutning, og `wait_for_user` kun til ikke-henvendt tale. De to
   lifecycle-signaler er interne og må aldrig dispatches til HA/MCP. Lokal tekstmatching
   af “farvel”-varianter er ikke afslutningsautoritet.
4. Realtime konfigureres med automatisk værktøjsvalg. Der findes intet obligatorisk
   fortsættelsesværktøj eller en tvungen ekstra modelrespons for direkte svar. Et
   domæneværktøjs resultat kan udløse den nødvendige resultatsrespons; et godkendt
   `end_conversation` kan udløse præcis ét kort farvel. Ingen af delene åbner en ny
   Realtime-session eller mister den eksisterende samtalekontekst.
5. Efter committed `end_conversation` må den korrelerede terminalrespons indeholde ét
   kort farvel eller ingen lyd. Lyd afspilles færdig før lukning; manglende eller fejlet
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
11. `response.done` er kun providerens generationsslut, aldrig bevis for et stille rum.
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
13. En completed værktøjsrespons autoriserer altid hele sin batch som én enhed. Alle
    kandidater registreres før første dispatch, og ingen sideeffekt starter før en
    eksakt, response-id-bundet tool-round-commit. Manglende, stale eller ukorreleret
    commit er virkningsløs. Sideeffekter udføres i batchrækkefølge; tool-output skal
    kvitteres af provideren, før én samlet resultatsrespons må oprettes.
14. Følsomme handlinger er en totrinskontrakt: Realtime foreslår semantisk, men serveren
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
    turnloft, hard deadline
    og det prospektive prisloft er de bindende evalgrænser. En provider-429/capacity
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
- Den sammensatte providerregression skal fortsætte efter enhver control-event: crossed
  start → cleanup-request → senere stop/commit/item/ACK → frisk followup. Det er ikke
  bevis, at klienten blot sendte `clear`, `commit`, `delete` eller `response.create`;
  de efterfølgende serverevents skal bevise den påståede virkning.
- Trace-oraklet skal afvise enhver response, tool-call eller playback uden kæden
  accepteret fysisk tur → matching committed item → matching klient-request-id.
- En fysisk Voice PE-trace skal vise forståelig første ytring, korrekt opfølgning,
  `playback_started`, `playback_finished`, `close_requested`, `wake_rearmed` og en ny
  provider-session ved næste wake.
- En korrekt handling eller et korrekt svar kan ikke alene godkende inputkæden. Hvis den
  diagnostiske transskription er tom eller semantisk uforenelig med den kendte testytring,
  skal device- og provider-lyden sammenlignes. Prøven er fejl/ukendt, indtil det er bevist,
  at hele ytringen nåede Realtime; modellen kan ellers have ramt rigtigt ved et tilfælde.
- “Grøn CI” er nødvendigt, men aldrig fysisk bevis. Manglende eller `—` telemetry er
  ikke et bestået resultat.

## Obligatorisk ændringskontrol

Ved ændringer i VAD, mic-gating, audio buffering, tool-rounds, playback eller teardown:

1. Angiv hvilke invarianter der berøres.
2. Tilføj en regressionstest fra den konkrete fysiske eventrækkefølge.
3. Kontrollér den modsatte overflade: Voice PE half-duplex versus Talk full-duplex.
4. Afvis enhver konfiguration, hvor to lag begge tror, de ejer interruption/lukning.
