# PodVoice agentkontrakt

Denne fil er indgangen for alle mennesker og agenter. Den forhindrer, at historiske
spor, grønne deltests eller plausible lydhypoteser bliver til en ny produktionsretning.

## Læs i denne rækkefølge

1. `docs/STATUS.md` — hvad der fysisk er bevist lige nu.
2. `docs/INVARIANTER.md` — den bindende tværgående systemkontrakt.
3. `docs/PRODUKTMÅL.md` — gates og målbare acceptkrav.
4. `docs/ARKITEKTUR.md` — forklaring af den ene produktionsvej.

`PLAN.md`, `docs/PLAN-BEAT-GEMINI.md`, `docs/PLAN-DUPLEX.md` og
`docs/HANDOVER-v2.md` er historiske research-/handoverfiler. De må bruges som baggrund,
men aldrig som autoritet over de fire filer ovenfor.

## Den eneste produktionsretning

- Voice PE-firmware ejer fysisk wake, mic-latch, playback-events og rearm-bevis.
- `VoicePELink` er den eneste native-API-adapter.
- `ThinSession` er den eneste runtime-samtalemotor for Voice PE og Talk.
- OpenAI Realtime ejer sprog, turforståelse, værktøjsvalg og semantisk afslutning.
- Voice PE er half-duplex og bruger FLAC-announcement. Talk er en separat browser-I/O-
  overflade og må ikke bruges som fysisk bevis for pucken.
- PodVoice ejer kun mekanikken: mic-gate, værktøjsdispatch, fysisk playback, én teardown
  og én rearm. Lokale fraser eller ASR-aliaser må ikke eje samtalens betydning.

Classic (`orchestrator.py`, `state.py`, `gatekeeper.py`, `watchdog.py`) og direct PCM er
karantæneret legacy/regressionskode. De må ikke importeres af add-on-builderen, aktiveres
af settings eller udvikles som parallel produktionsvej. En ændring dér skal enten fjerne
legacy eller bevare en historisk regression; den må ikke introducere ny produktlogik.

## Ord med præcis betydning

- **Første virkende version:** mindst én frisk fysisk golden chain har bevist wake →
  første svar → opfølgning → modelsemantisk lukning → fysisk farvel → teardown/rearm →
  ny wake. Den milepæl er opnået af v1.13.11 og registreret i `docs/STATUS.md`.
- **Lifecycle release-godkendt:** samme kandidat har bestået 10/10 automatiske og 10/10
  ubrudte fysiske cyklusser. Ikke det samme som “første virkende version”.
- **Produktmålet nået:** funktions-, latens-, stabilitets- og benchmark-gates i
  `docs/PRODUKTMÅL.md` er bestået. Må aldrig udledes af én vellykket samtale.

## Obligatorisk ændringskontrol

Før ændringer i arkitektur, Realtime, VAD, lyd, firmware eller lifecycle:

1. Navngiv de berørte invarianter.
2. Bevar én samlet half-duplex-kæde; optimer ikke én komponent på bekostning af den
   fysiske eventrækkefølge.
3. Omsæt hver fysisk fejl til en regression med den observerede eventrækkefølge.
4. Test både den fælles `ThinSession`-kontrakt og den relevante I/O-adapter.
5. Kald aldrig en kandidat testklar eller færdig alene på komponenttests, Talk eller CI.
6. Opdatér `docs/STATUS.md` ved ny fysisk evidens. Overskriv aldrig en bevist baseline
   med en ny kandidat, før den nye kandidat selv har bestået den relevante fysiske gate.
7. Godkend aldrig en golden chain alene fordi svaret tilfældigvis var korrekt. Den kendte
   testytring og det observerede input skal være semantisk konsistente. Et tomt eller
   tydeligt afvigende input kræver gennemlytning af både device- og provider-sporet og
   tæller som fejl/ukendt, indtil lydkæden er forklaret. Et heldigt tool-kald er ikke
   bevis for stabil hørelse.

Gain, VAD, bip, prompt og timeouts må kun ændres på baggrund af en trace eller en på
forhånd defineret måling. Tænke-lyd, duplex og barge-in er selvstændige gatede features;
de må ikke kobles ind i den virkende half-duplex-kæde som en uobserveret bivirkning.

## Bindende udviklingsprioritet

Når den aktive kandidat har bestået golden chain og 10/10 fysisk lifecycle, er næste
arbejde i denne rækkefølge:

1. **Udviklingsprioritet 1 — oplevet fysisk svartid.** Mål
   `speech_stopped → playback_started`, del kæden op og
   optimer den største dokumenterede flaskehals én ad gangen. Første lyd skal være
   meningsfuld tale; et earcon eller en generisk værktøjspreamble tæller ikke som svar.
   Målet er p50 ≤ 1,2 s for enkle ture og et stretchmål så tæt på 1,0 s som muligt uden
   at bryde forståelse, værktøjer, playback-sandhed eller lifecycle.
2. **Udviklingsprioritet 2 — diskret modtaget-signal.** Først efter latency-gaten må et
   ca. 80 ms firmwarelokalt signal ved `UserSpeechStopped` udvikles som en isoleret
   mixer-sidekanal. Det må ikke bruge announcement-vejen, forsinke Realtime eller eje
   nogen samtaletilstand.
3. **Udviklingsprioritet 3 — automatisk HA/MCP-recovery.** Hjem og vejr skal selv komme
   tilbage efter tabt HA/MCP-forbindelse uden manuel reload, add-on-genstart eller tab
   af en aktiv Realtime-samtale.
4. **Udviklingsprioritet 4 — fysisk funktionsmatrix.** Dansk, hjem, vejr, web, musik,
   timere og opfølgninger skal bestå de målbare antal i `docs/PRODUKTMÅL.md`.
5. **Udviklingsprioritet 5 — samlet UI-gennemgang.** Panelet skal vise sand readiness,
   fejl og næste handling, fungere på mobil/HA-app/desktop og bestå de definerede
   accessibility-, Talk-, settings- og browsergates.

Ingen agent må bruge feedbacksignalet til at maskere langsomhed eller udvikle prioritet
1 og 2 i samme kandidat. En UI-ændring må ikke ændre samtalens lifecycle som en skjult
bivirkning. De fulde gates står i `docs/PRODUKTMÅL.md`, og den aktuelle rækkefølge står
i `docs/STATUS.md`.
