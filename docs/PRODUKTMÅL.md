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

## Bindende lifecycle-mål

```text
wake → LISTENING → THINKING → AI_SPEAKING → LOUNGE_WINDOW
     → opfølgning i samme session (gentag efter behov)
     → Realtime end_conversation eller fire sekunders timeout
     → CLOSING → én teardown → én rearm → IDLE → nyt wake
```

`CLOSING` er en transaktionsfase, ikke en ekstra runtime-`State`. De fem eksisterende
stateværdier er fortsat den eneste mic-gate.

Voice PE sender kun mic-lyd i `LISTENING` og `LOUNGE_WINDOW`. Realtime ejer sprog,
matematik, kontekst, værktøjsvalg og semantisk close. PodVoice må kun eje mic-gate,
dispatch, playback, timeout, teardown og rearm. Terminalresponsen er højst ét kort
farvel; ingen lyd eller fejlet lyd lukker stille. Ingen lokal keywordliste må afgøre
betydning.

## Release-gate 1 — arkitektur

- Renderet firmware: 1 wake-trigger, 0 stock `voice_assistant.start`.
- Ét lokalt wake-event åbner én mic-kanal og én Realtime-session.
- Den fysiske wake-grænse kasserer al pre-wake-lyd lokalt. Realtime må aldrig modtage
  selve wakefrasen; al lyd efter detektionen bevares under provider-opkoblingen.
- Dobbelt wake mens sessionen allerede er åben opretter ikke en ny session.
- Voice PE beholder VAD, men bruger `interrupt_response: false` og
  `create_response: false`. Kun et accepteret fysisk stop med matching committed
  provider-item må udløse præcis ét korreleret `response.create`.
- En crossed VAD-start under lukket mic-gate skal give nul response, nul tool-call og nul
  playback. Dens eksakte item skal være slettet og ACK'et før opfølgningsgaten åbner;
  ukendt cleanup lukker fail-closed.
- Realtime har ét provider-neutralt `end_conversation`-signal til en tydelig semantisk
  afslutningshensigt. Signalet må ikke selv lukke transporten eller gå gennem HA/MCP.
- Realtime bruger automatisk værktøjsvalg: et almindeligt spørgsmål besvares direkte i
  én respons, og kun en handling eller et opslag bruger et nødvendigt værktøj. Et
  obligatorisk fortsættelsesværktøj eller en tvungen ekstra svarrespons er forbudt.
- Der findes ingen frase-, keyword- eller ASR-aliasliste, som afgør samtalehensigten.
- “Klar”, “Kig FCK seneste kamp”, uklart input og almindelig høflighed kan ikke lukke,
  medmindre Realtime på den samme tur eksplicit beslutter, at brugeren afslutter.
- Talk og Voice PE bruger samme `ThinSession`; kun I/O-adapteren er forskellig.
- Ingen adapter må kalde provideren direkte eller vise en tur som accepteret. Hver Talk-
  tur skal have serverkvitteret command-, session-, turn- og provider-item-id, før den
  vises som afleveret; stale socket-/playback-events er virkningsløse.
- Classic/direct kan ikke aktiveres via gamle eller nye settings.
- Funktionskandidater må kun dispatches efter completed, response-id-bundet batchcommit;
  cancelled, incomplete, malformed, duplicate og stale provider-events skal give nul
  sideeffekter.
- Følsomme handlinger kræver en server-ejet, eksakt, næste-tur-bundet engangsgodkendelse.
  Promptbekræftelse alene er aldrig autorisation, og teardown/replay annullerer alt
  ventende.
- Sideeffekter kræver autoritativ provider-usage og reserveret kapacitet til den
  efterfølgende kvittering eller afslutning. Den eksplicit startede live-preflight er
  en gensidigt eksklusiv diagnostiktilstand: den må kun starte uden en aktiv fysisk/
  Talk-samtale, og nye produktionssessioner afvises hurtigt og rearmes rent, indtil
  preflightens bounded teardown har frigivet providerlåsen. UI må aldrig kalde Nabu
  fysisk klar imens. Sand parallel isolation kræver en separat providerprojekt-/
  rate-limit-pulje; den må ikke simuleres med ubeviseligt lokalt headroom.

### Maskinel adgangsgate før fysisk test

På præcis kandidatens bits skal følgende være grønt, før brugeren bedes tale igen:

- hele unit-/integrationstesten, typecheck, formattering og add-on-build;
- fælles `ThinSession`-regressioner for duplicate/busy/offline/closing, provider-tab,
  tool-ordering, semantisk close, én teardown og én rearm;
- sammensat regression for accepteret tur → commit → matched response-request samt
  crossed start → bounded nul-PCM med fysisk mic lukket → natural matching
  `speech_stopped` → exact commit/item/delete-ACK → frisk opfølgning i samme session;
  manuel commit som VAD-terminal og ethvert auto-/ukorreleret response- eller tool-event
  skal fejle;
- rigtig Talk-WebSocket med hello/lease/input-ACK, ordnede events og korreleret playback;
- den bounded live-gate, som matcher kandidatens ændrede ejergrænse: en response-owner-
  ændring kræver den sideeffektfrie commit/delete/ACK-protokolprobe; ændret prompt,
  schema, værktøjer, model, reasoning eller audiosemantik kræver den fokuserede
  semantiske preflight uden HA/MCP/PodConnect-sideeffekter;
- trace-replay, der afviser manglende/dobbelte/omvendte wake-, provider-, playback-,
  close-, capture- og rearm-events samt faldende audio-generation, providerlyd under
  lukket mic-gate og opfølgning før fysisk playback-finish plus ekkohale;
- rå providerpermutationer for completed/cancelled/failed/incomplete, schema/ACK-fejl,
  multi-call atomik, approval replay/expiry og rate-limit før sideeffekt.

Live-preflight bruger et hårdt turn-, token-, pris- og timeoutloft. Et korrekt tekstsvar
uden korrekt beslutning, session eller lifecycle er en fejl. Maskingaten kan stoppe en
kandidat, men aldrig erstatte den efterfølgende fysiske Voice PE-gate.

For en kandidat, der ændrer native audiosemantik eller mic-/turn-kontrakten på en måde,
som kan påvirke semantik, er den fokuserede live-gate den sideeffektfrie sekvens
`math → math-opfølgning → time → weekday-opfølgning → semantic close`, fem gange på
samme sessionskontrakt. Kun tidsturen må bruge `get_time`; matematik og opfølgning skal
besvares direkte. En ren response-owner-/ACK-ændring kører først den smallere officielle
protokolprobe og genkører kun den semantiske 5×-gate ved ændret semantikscope eller ny
ren fysisk evidens for en semantikfejl. Samlet prisloft er $5, uden budgetprobe og uden
hjem-, musik- eller timerhandlinger. En bred SafeEval køres ikke igen, medmindre prompt,
schema, værktøjer eller Realtime-semantik faktisk er ændret.

### Lifecycle-confidence 97/100

97/100 er engineering confidence, ikke en garanti for alle rum og providerudfald:

| Område | Point | Obligatorisk bevis |
|---|---:|---|
| Én session og korrekt turkronologi | 20 | Alle maskinelle og fysiske kæder grønne |
| Half-duplex og audio-isolation | 20 | Ingen providerlyd under lukket gate; race-regression grøn |
| Realtime-semantik og værktøjsvalg | 15 | Fokuseret live-gate 5/5 |
| Playback, teardown og rearm | 20 | Præcis én af hver; næste wake virker |
| Stale/duplicate/out-of-order-sikkerhed | 10 | Alle relevante permutationer fail-closed |
| Artifact-, trace- og review-sandhed | 7 | Samme bits, komplet trace, P0/P1=0 |
| Fysisk ubrudt gate | 5 | Golden chain plus 10/10 fysisk |
| **Samlet** | **97** | **Alle kategorier er obligatoriske** |

De sidste tre point kræver den senere funktionsmatrix og syvdøgns soak. En kandidat må
ikke kaldes 97/100 alene på CI, Talk, live-eval eller én fysisk samtale.

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

Installér kandidatens exact add-on-artifact og kør 10 ubrudte samtaler på skrivebordet.
Flash kun Voice PE, hvis kandidatdiffet faktisk ændrer firmwarekontrakten; en ren
add-on-kandidat skal genbruge den allerede godkendte firmware:

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

## Udviklingsprioritet 1 — oplevet fysisk svartid

Hastighedsarbejdet starter først efter golden chain og 10/10 fysisk lifecycle på samme
kandidat. Den autoritative brugeroplevede måling er:

```text
speech_stopped → playback_started
```

Begge kanter skal komme fra den fysiske Voice PE-kædes observerede firmware-events;
modeltelemetry eller et beregnet lydestimat må ikke erstatte dem.

`response_audio_started` er kun modeltelemetry. Et kort lydsignal, generisk “et
øjeblik” eller en værktøjspreamble er ikke et meningsfuldt svar og må ikke stoppe
latency-uret.

Mål mindst 20 enkle ture uden værktøj og 20 værktøjsture i samme rum og kandidat. For
hver tur skal tidslinjen kunne vise:

1. taleslut → færdig inputtransskription;
2. transskription → første modellyd eller værktøjsvalg;
3. værktøjsstart → værktøjsresultat, når relevant;
4. værktøjsresultat → endelig modellyd, når relevant;
5. endelig modellyd → fysisk playback-start.

Optimer kun det største dokumenterede delstræk ad gangen. Hver ændring skal sammenlignes
med den låste baseline og bestå golden chain plus 10/10 igen. Gain, VAD, prompt,
resampling, buffering og modelindstillinger må ikke ændres samlet, fordi resultatet så
ikke kan tilskrives eller rulles sikkert tilbage.

| Turtype | Bindende mål | Stretchmål |
|---|---:|---:|
| Enkel tur uden værktøj | p50 ≤ 1,2 s, p90 ≤ 1,8 s | p50 ≤ 1,0 s, p90 ≤ 1,5 s |
| Hurtigt lokalt værktøj | p50 ≤ 1,5 s, p90 ≤ 2,5 s | p50 så tæt på 1,0 s som muligt |
| Eksternt web/HA-opslag | PodVoice-overhead vises særskilt fra værktøjstid | lavest muligt uden falsk feedback |

Ingen latencyforbedring godkendes, hvis den reducerer ordgenkendelse eller giver ekstra
VAD-ture, afklippede opfølgninger, selvsvar, manglende playback-events, dobbelt teardown
eller død wake. Først når målene er fysisk målt, bliver baseline låst til næste feature.

## Udviklingsprioritet 2 — diskret modtaget-signal

Efter den låste latency-baseline må PodVoice få ét kort signal, når Realtime har
observeret `UserSpeechStopped`. Formålet er kun at bekræfte “din tur er modtaget” på
ture, der stadig kræver behandling; det må aldrig få en langsom kæde til at fremstå som
et hurtigt svar.

Firmware-spiken skal bevise en tredje selvstændig mixerindgang ved siden af announcement
og musik. Signalet skal være indbygget PCM på ca. 70–100 ms, lavere end tale og kunne
afbrydes straks. Det er **no-go**, hvis det kræver `external_media_player`, `play_sound`,
announcement-resampleren eller udsender reply playback-events.

Implementeringen sker i to adskilte trin:

1. Flash en sovende `request_ack_cue_v1`-capability med handlingerne
   `podvoice_request_ack` og `podvoice_request_ack_cancel`; funktionen er deaktiveret,
   mens golden chain og 10/10 beviser nul regression.
2. Lad `ThinSession` udstede signalet højst én gang per tur som fire-and-forget. Første
   assistant-audio, stop, fejl, timeout, disconnect eller teardown annullerer det.
   Stale sessioner ignoreres. Talk må være en no-op.

Observationsevents `request_ack_issued`, `request_ack_started`,
`request_ack_finished` og `request_ack_cancelled` er kun telemetry og må aldrig styre
sessionen. Panelet får én indstilling: “Lyd når Nabu har hørt dig”; ingen tone- eller
volumenknapper i første version.

Godkendelse kræver ny golden chain, 10/10 lifecycle, 20 enkle ture og 20 værktøjsture.
Tool-start må ikke forsinkes, fysisk meningsfuld TTFR må højst forværres 50 ms, signalet
må ikke nå OpenAI eller skabe en ekstra `speech_started`, og reply playback,
opfølgninger, musik duck/restore, semantisk “Farvel” og næste wake skal være uændrede.
Ved én regression slås funktionen fra uden ændring af den låste latency-baseline.

## Udviklingsprioritet 3 — automatisk HA/MCP-recovery

Et fejlet eller timeoutet `tools/list` må aldrig kræve manuel genindlæsning eller
add-on-genstart. PodVoice skal oprette MCP-sessionen på ny med hurtig backoff (ca. 1,
2, 5, 10 og 30 sekunder, derefter højst ét forsøg pr. minut), fortsætte samtalen, lokal
tid og lokale timere imens og atomisk genaktivere HA-afhængige evner, når HA svarer.
Et værktøj fortsætter kun under udfaldet, hvis det har en faktisk uafhængig, rask
adapter. I den nuværende topologi er `google_web_sogning`, HassMedia og PodConnects
data-services HA-/Supervisor-afhængige; de skal derfor vises ærligt som midlertidigt
utilgængelige og må aldrig køres fra et stale deklarationssnapshot.

Panelet skal vise “forbinder igen”, seneste konkrete fejl og automatisk skifte til
verificeret uden at afbryde en aktiv Realtime-samtale. Tests skal dække opstartsfejl,
tabt forbindelse midt i idle og midt i en samtale, gentagne fejl, frisk tool-discovery
efter recovery og nul dobbelte MCP-sessioner.

## Udviklingsprioritet 4 / release-gate 4 — fysisk funktionsmatrix

| Område | Fysisk krav |
|---|---|
| Dansk | 50 ytringer, mindst 95 % korrekt intention, 0 engelske svar |
| Svartid | enkle ture: første meningsfulde fysiske lyd p50 ≤1,2 s, p90 ≤1,8 s |
| Web/sport | 20 aktuelle spørgsmål, reelt opslag og kilder, 0 opdigtede aktuelle tal |
| Vejr | bruger hjemmets placering og korrekt live-værktøj |
| Hjem | 30 reversible HA-kommandoer, korrekt mål 30/30 |
| Musik | 30 kommandoer via HA/PodConnect, korrekt rum og gendannet ducking |
| Opfølgning | 20 kontekstafhængige opfølgninger uden nyt wake, mindst 19 korrekte |
| Ekko | 50 svar, 0 selvsvar/selvafbrydelser |
| Fejl | OpenAI, MCP, PodConnect og Voice PE-fejl vises og afsluttes rent |

## Udviklingsprioritet 5 — samlet UI-gennemgang

UI-gennemgangen starter først, når funktionsmatrixens reelle muligheder og fejltilstande
er kendt. Den må forbedre præsentation og interaktion, men må ikke introducere en ny
samtalemotor, skjult fallback eller ændre den godkendte lifecycle.

Godkendelse kræver:

- Første viewport svarer tydeligt på “kan Nabu bruges?”, “hvad fejler?” og “hvad skal
  jeg gøre?” uden at blande forbindelse, konfiguration og fysisk verification sammen.
- Realtime, Voice PE/wake-readiness, HA/MCP, PodConnect og hver kapabilitet viser sand
  tilstand, konkret årsag, kilde og seneste verification. Fundet må ikke ligne bevist.
- Hjem, Tal, Test, Historik og Indstillinger har én klar primær opgave hver. Test- og
  latencyvisning bruger de fysiske events og må aldrig kalde modellyd “hørbar”.
- Talk håndterer HTTPS, HA-app/iframe-begrænsning, mic-tilladelse, manglende enhed,
  offline socket og autoplay med konkrete danske handlinger. Alle MediaStream-spor
  frigives ved stop, idle, disconnect og sideskift.
- Indstillinger viser gemt versus effektiv værdi, restartkrav, valideringsfejl og
  usaved changes. Delvise rum eller modstridende modelvalg må ikke tabes lydløst.
- Alt brugerrettet UI er konsekvent dansk. Alle kontrolmål er mindst 44×44 px, tastatur-
  fokus er synligt, dynamiske statusser annonceres uden gentagelsesstorm, og kontrast
  består WCAG AA.
- Ingen vandret scroll eller afklip ved 320, 390 og 430 px mobilbredde, ved 200 % zoom,
  med åbent mobiltastatur eller safe-area. Desktop kontrolleres ved 768 og 1440 px.
- Browsertests dækker ready/degraded/offline, stale status, settings save/fejl,
  Talk-mic success/deny/cleanup og de vigtigste mobile layouts. Manuel HA-app/Safari-
  smoke og VoiceOver-gennemgang har nul kritiske eller alvorlige fejl.

UI-gaten er bestået, når alle ovenstående krav er dokumenteret; en subjektiv score eller
et flot screenshot kan ikke alene godkende den.

## Release-gate 5 — stabilitet og benchmark

Kør syv døgn uden manuel genstart, fastlåst session eller tabt musiktilstand. Sammenlign
derefter samme danske manuskript, rum og handlinger med Gemini for Home og Alexa+.
PodVoice må kun kaldes bedre på de målepunkter, hvor de fysiske tal faktisk er bedre.

## Parkeret

Taleafbrydelse midt i assistentens svar er ikke en del af den første half-duplex-release.
Den kræver en separat fysisk gate for wake/stop-model eller dokumenteret full-duplex;
den må ikke genindføres ved at åbne mikrofonen ukontrolleret under højttalerafspilning.
