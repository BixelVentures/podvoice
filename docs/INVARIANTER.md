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
| Hjem, musik, web, vejr og timere | værktøjer kaldt af Realtime; aldrig livscyklus |
| Start/slut på fysisk svarlyd | firmware-events fra PodVoice-announcement-kæden |

Stock Home Assistant Assist må ikke starte eller eje en PodVoice-samtale. Et værktøj må
aldrig åbne, lukke eller genstarte tale-/wake-kanalen.

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
3. Realtime foreslår semantisk afslutning med det reserverede `end_conversation`-tool.
   Lokal tekstmatching af “farvel”-varianter er ikke afslutningsautoritet.
4. Semantisk afslutning, fysisk stop, timeout og fejl samles i én atomisk close-owner.
   Provider, mic, playback, ducking og attention frigives præcis én gang.
5. Rearm sker først efter fuld teardown. Firmwarekvitteringen må kun åbne næste latch,
   når ubrudt detektorkontinuitet **og frisk fysisk mikrofonfremdrift** er bevist efter
   rearm. `micro_wake_word.is_running()` alene er forbudt som readiness-bevis, fordi
   ESPHome også returnerer sand i `STARTING` og `STOPPING`. En virkelig efterfølgende
   wake er fortsat det stærkeste kontinuitetsbevis.
6. Provider-eventrækkefølge er ikke nødvendigvis den fysiske samtalerækkefølge. En
   færdig inputtransskription kan komme efter svaret; historik skal derfor tidsstemples
   ved brugerens `speech_stopped`-grænse og må aldrig vise svar før årsag.

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
- “Grøn CI” er nødvendigt, men aldrig fysisk bevis. Manglende eller `—` telemetry er
  ikke et bestået resultat.

## Obligatorisk ændringskontrol

Ved ændringer i VAD, mic-gating, audio buffering, tool-rounds, playback eller teardown:

1. Angiv hvilke invarianter der berøres.
2. Tilføj en regressionstest fra den konkrete fysiske eventrækkefølge.
3. Kontrollér den modsatte overflade: Voice PE half-duplex versus Talk full-duplex.
4. Afvis enhver konfiguration, hvor to lag begge tror, de ejer interruption/lukning.
