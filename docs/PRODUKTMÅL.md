# PodVoice-produktmål — pålidelig dansk Realtime-assistent

> En funktion er først leveret, når både softwaregaten og den relevante fysiske gate
> er bestået. Grøn kode eller firmwarekompilering beviser ikke rummets akustik.

## Nordstjernen

Et familiemedlem siger “Okay Nabu” og fortsætter naturligt med spørgsmålet. Voice PE
åbner én PodVoice-kanal og PodVoice åbner én Realtime-session. Opfølgninger fortsætter
i samme session. “Farvel” eller timeout lukker både socket og mikrofon, hvorefter næste
wake virker straks.

Systemet skal give korte korrekte danske svar, bruge HA/MCP, PodConnect, musik, vejr,
web og timere korrekt og fejle hørligt. Det må aldrig lukke på almindelig tale, svare
på sin egen højttaler eller blive dødt efter få samtaler.

## Release-gate 1 — arkitektur

- Renderet firmware: 1 wake-trigger, 0 stock `voice_assistant.start`.
- Ét lokalt wake-event åbner én mic-kanal og én Realtime-session.
- Dobbelt wake mens sessionen allerede er åben opretter ikke en ny session.
- `end_conversation` findes ikke i modellens værktøjer.
- “Klar” og “Kig FCK seneste kamp” kan ikke lukke transporten.
- Talk og Voice PE bruger samme `ThinSession`; kun I/O-adapteren er forskellig.
- Classic/direct kan ikke aktiveres via gamle eller nye settings.

## Release-gate 2 — automatisk lifecycle

Kør mindst 10 cyklusser:

1. wake;
2. præcis én provider-connect;
3. mic-forward aktiv;
4. opfølgning i samme session;
5. eksakt farvel/stop eller timeout;
6. provider lukket, mic-forward slukket, ducking frigivet og state idle;
7. næste wake accepteres.

Krav: 10/10, ingen ekstra sessioner, ingen stock RUN_END og ingen kontrol-announcement.

## Release-gate 3 — fysisk Voice PE

Flash kandidaten og kør 10 ubrudte samtaler på skrivebordet:

- Sig wake og spørgsmål i samme naturlige åndedrag; ingen kunstig pause.
- Hvert wake giver én tydelig visuel lyttefeedback og ét svar.
- Stil mindst én opfølgning uden nyt wake i hver samtale.
- Luk med “farvel” i fem og lad timeout lukke fem.
- Bekræft at næste wake virker hver gang.
- Gem lydspor og tidslinje for fejl; bedøm ikke kun transskripttekst.

Godkendelse kræver 10/10 lifecycle. Taleindhold kan derefter tunes separat; en død wake
eller falsk lukning er en arkitekturfejl og stopper testen.

## Release-gate 4 — funktionsmatrix

| Område | Fysisk krav |
|---|---|
| Dansk | 50 ytringer, mindst 95 % korrekt intention, 0 engelske svar |
| Svartid | første meningsfulde lyd p50 ≤1,5 s, p90 ≤2,5 s |
| Web/sport | 20 aktuelle spørgsmål, reelt opslag og kilder, 0 opdigtede aktuelle tal |
| Vejr | bruger hjemmets placering og korrekt live-værktøj |
| Hjem | 30 reversible HA-kommandoer, korrekt mål 30/30 |
| Musik | 30 kommandoer via HA/PodConnect, korrekt rum og gendannet ducking |
| Opfølgning | 20 kontekstafhængige opfølgninger uden nyt wake, mindst 19 korrekte |
| Ekko | 50 svar, 0 selvsvar/selvafbrydelser |
| Fejl | OpenAI, MCP, PodConnect og Voice PE-fejl vises og afsluttes rent |

## Release-gate 5 — stabilitet og benchmark

Kør syv døgn uden manuel genstart, fastlåst session eller tabt musiktilstand. Sammenlign
derefter samme danske manuskript, rum og handlinger med Gemini for Home og Alexa+.
PodVoice må kun kaldes bedre på de målepunkter, hvor de fysiske tal faktisk er bedre.

## Parkeret

Taleafbrydelse midt i assistentens svar er ikke en del af den første half-duplex-release.
Den kræver en separat fysisk gate for wake/stop-model eller dokumenteret full-duplex;
den må ikke genindføres ved at åbne mikrofonen ukontrolleret under højttalerafspilning.
