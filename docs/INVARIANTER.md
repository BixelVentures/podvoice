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

## Shippet Voice PE er half-duplex

Når `full_duplex == false`, skal alle disse være sande samtidig:

1. Realtime konfigureres med `interrupt_response: false`.
2. Når modelsvaret er begyndt, sendes ingen mikrofonframes til Realtime før fysisk
   playback-finish plus ekkohale.
3. `input_audio_buffer.speech_started` betyder kun "VAD så lyd"; det er ikke i sig selv
   et transport-interrupt.
4. En VAD-start, der krydser svar-gaten, nulstilles med `input_audio_buffer.clear`.
   Ellers modtager serveren aldrig den efterfølgende stilhed og kan hænge permanent i
   `speech_started`.
5. Voice PE må ikke love barge-in. Talk-browseren er den separate full-duplex-overflade
   og må eksplicit bruge `interrupt_response: true` med browser-AEC.

Den forbudte kombination er: **lokal half-duplex mic-gate + server-side automatisk
response-interrupt**. Den gav feltfejlen 2026-08-18: tale registreret 139 ms før fysisk
playback, 330 ms svar, ingen færdig opfølgning og en session fastlåst i LYTTER.

## Livscyklus

1. Ét fysisk “Okay Nabu” giver én wake-event, åbner privacy-gated mic og præcis én
   Realtime-session.
2. Første ytring og alle naturlige opfølgninger kører i samme session uden nyt wakeword.
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
5. Hvis Realtime har foreslået semantisk afslutning, men den efterfølgende lydrespons
   eksplicit fejler, må transporten afspille et cachet farvel. Fallbacken må aldrig
   udløses af brugertransskription alene og må først lukke efter fysisk playback-finish.
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
   serverkvittering.
10. WebSocket-forbindelse, provider-readiness, samtalestatus og inputaccept er fire
    forskellige sandheder. UI må ikke udlede "klar" af en åben socket. Hver session,
    tur, providerrespons, værktøjskald og playback skal kunne korreleres; events fra en
    gammel forbindelse eller gammel playback må ikke ændre den aktuelle tilstand.
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

## Beviskrav før “testklar” eller “færdig”

- Test den sammensatte kontrakt, ikke kun komponenter: provider-konfiguration,
  `ThinSession`, Voice PE-events og eventrækkefølge skal mødes i samme test.
- Release-gaten skal gennemføre mindst ti gange:
  `wake → én session → første svar → opfølgning i samme session → semantisk lukning →
  fysisk playback-finish → én teardown → én rearm`.
- Race/permutationer skal dække speech-start lige før playback, tool-resultat mellem
  responses, playback-start/slut i forskellig rækkefølge, samtidig stop/timeout/fejl og
  re-wake efter lukning.
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
