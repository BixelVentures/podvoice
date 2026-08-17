# PodVoice-produktmål — pålidelig dansk Realtime-assistent

> En funktion er først leveret, når både softwaregaten og den relevante fysiske gate
> er bestået. Grøn kode eller firmwarekompilering beviser ikke rummets akustik.

## Nordstjernen

Et familiemedlem siger “Okay Nabu” og fortsætter naturligt med spørgsmålet. Voice PE
åbner én PodVoice-kanal og PodVoice åbner én Realtime-session. Opfølgninger fortsætter
i samme session. GPT Realtime fortolker semantisk brugerens hensigt — inklusive om
samtalen er slut — og vælger værktøjer ud fra prompt og kontekst. PodVoice udfører kun
den deterministiske lifecycle: fysisk svarslut, én socket-/mikrofonlukning, musik-release
og wake-rearm. Timeout og tekniske fejl kan stadig lukke uden en modelbeslutning.

Systemet skal give korte korrekte danske svar, bruge HA/MCP, PodConnect, musik, vejr,
web og timere korrekt og fejle hørligt. Det må aldrig lukke på almindelig tale, svare
på sin egen højttaler eller blive dødt efter få samtaler.

## Release-gate 1 — arkitektur

- Renderet firmware: 1 wake-trigger, 0 stock `voice_assistant.start`.
- Ét lokalt wake-event åbner én mic-kanal og én Realtime-session.
- Den fysiske wake-grænse kasserer al pre-wake-lyd lokalt. Realtime må aldrig modtage
  selve wakefrasen; al lyd efter detektionen bevares under provider-opkoblingen.
- Dobbelt wake mens sessionen allerede er åben opretter ikke en ny session.
- Realtime har ét provider-neutralt `end_conversation`-signal til en tydelig semantisk
  afslutningshensigt. Signalet må ikke selv lukke transporten eller gå gennem HA/MCP.
- Der findes ingen frase-, keyword- eller ASR-aliasliste, som afgør samtalehensigten.
- “Klar”, “Kig FCK seneste kamp”, uklart input og almindelig høflighed kan ikke lukke,
  medmindre Realtime på den samme tur eksplicit beslutter, at brugeren afslutter.
- Talk og Voice PE bruger samme `ThinSession`; kun I/O-adapteren er forskellig.
- Classic/direct kan ikke aktiveres via gamle eller nye settings.

## Release-gate 2 — automatisk lifecycle

Kør mindst 10 cyklusser:

1. wake;
2. præcis én provider-connect;
3. mic-forward aktiv;
4. opfølgning i samme session;
5. Realtime udsender semantisk afslutningsintention på varierede naturlige formuleringer,
   eller transportens timeout/fejl udløses;
6. provider lukket, mic-forward slukket, ducking frigivet og state idle;
7. næste wake accepteres.

Krav: 10/10, ingen ekstra sessioner, ingen stock RUN_END og ingen kontrol-announcement.

## Release-gate 3 — fysisk Voice PE

Flash kandidaten og kør 10 ubrudte samtaler på skrivebordet:

- Sig wake og spørgsmål i samme naturlige åndedrag; ingen kunstig pause.
- Lydbevisets første input skal være spørgsmålet, ikke “Okay Nabu”, et fragment af
  wakefrasen eller pre-wake-rumlyd.
- Hvert wake giver én tydelig visuel lyttefeedback og ét svar.
- Stil mindst én opfølgning uden nyt wake i hver samtale.
- Luk fem samtaler med forskellige naturlige hensigter, fx “farvel”, “tak, det var alt”,
  “vi snakkes” og en kontekstuel afslutning; lad timeout lukke fem.
- Medtag uklare/korrumperede korte ytringer og almindeligt “tak” midt i en opgave; de
  skal blive i samme session eller udløse et opklarende spørgsmål, aldrig frase-routing.
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

## Næste runde

- **Automatisk HA/MCP-recovery:** Et fejlet eller timeoutet `tools/list` må aldrig kræve
  manuel genindlæsning eller add-on-genstart. PodVoice skal oprette MCP-sessionen på ny
  med hurtig backoff (ca. 1, 2, 5, 10 og 30 sekunder, derefter højst ét forsøg pr. minut),
  fortsætte tid/web/musik/samtale imens og atomisk genaktivere hjem og vejr, når HA svarer.
  Panelet skal vise “forbinder igen”, seneste konkrete fejl og automatisk skifte til
  verificeret uden at afbryde en aktiv Realtime-samtale.
