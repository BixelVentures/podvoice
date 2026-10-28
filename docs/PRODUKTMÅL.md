# PodVoice-produktmål — pålidelig dansk GPT-Live-assistent

## Tværgående brugeraccept · standard v1

Den fælles [Pod-systemstandard](POD-SYSTEM-STANDARD.md) er et supplerende acceptkrav.
For berørte features prøves input → faktisk effekt → korrekt UI/lyd → recovery på
samme identificerede kandidat. Første musikflow er tal → afspil → vis → touch-pause
→ korreleret bekræftet pause på samme output. Unit/kontrakt, sammensat integration,
rigtig browser, rigtig service og fysisk hardware angives særskilt med faktiske
inertgrænser og udfald. Grønne deltests lukker ikke hele flowet. Eksisterende golden-,
lifecycle-, sikkerheds- og produktgates bevares; uændrede domæner genprøves ikke uden årsag.

> Produktbeslutning (13/10): brugeren har valgt **kun GPT-Live** til både Voice PE
> og Talk. GPT-Live er den valgte produktionsprovider med samme `ThinSession`,
> `VoicePELink`, `ToolRouter` og fysiske close/rearm-ejer. Aktuel installeret version og
> fysisk evidens står i `docs/STATUS.md`; produktbeslutningen er ikke fysisk accept
> eller bevis for løst semantisk close.
> GPT-Live bruger samme ThinSession, VoicePELink, ToolRouter og fysiske close/rearm-
> ejer. Live-events skal navngives sandt; Realtime-tur-/audio-done-/ACK-events må ikke
> fabrikeres. Nedenstående mekaniske ejerskab og fysiske sikkerhedskrav bevares.
> Funktionsparitet, Stop, Talk og dræn skal stadig bevises på kandidatens egne bits.
> STATUS.md er den ene aktuelle lead-post for installerede bits og direkte bevis.
> Ingen følsom handling åbnes ved en opdigtet næste-brugertur, og strømlining arver
> ingen fysisk readiness fra den tidligere motor eller en UI-ændring.

> **Fortolkning af protokoldetaljer:** de konkrete OpenAI Realtime-wirekrav nedenfor
> (`response.create`, `input_audio_buffer.*`, item-commit/delete-ACK og eventrækkefølge)
> gælder kun den beholdte `OpenAIRealtimeSession`-diagnostik og dens regressioner.
> De kan ikke tælle som GPT-Live-providerbevis. GPT-Live skal bevise samme ejerskab,
> generation, aktuelt input, værktøjsbatch, playback, teardown og rearm med de events,
> den faktisk udsender: `LiveSessionReady`, `LiveTransportReady`, `LiveAudioChunk`,
> `LiveBackendStarted`, `LiveBackendComplete`, `LiveToolBatch` og `LiveSessionClosed`.
> Der må ikke opfindes Realtime-ACKs. Samtlige mekaniske, fysiske, Talk- og
> sikkerhedsgates, tærskler og antal nedenfor gælder fortsat uændret.



> En funktion er først leveret, når både softwaregaten og den relevante fysiske gate
> er bestået. Grøn kode eller firmwarekompilering beviser ikke rummets akustik.

## Nordstjernen

Et familiemedlem siger “Okay Nabu” og fortsætter naturligt med spørgsmålet. Voice PE
åbner én PodVoice-kanal og PodVoice åbner én GPT-Live-session. Opfølgninger fortsætter
i samme session. GPT-Live fortolker semantisk brugerens hensigt — inklusive om
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
     → GPT-Live end_conversation eller fire sekunders timeout
     → CLOSING → én teardown → én rearm → IDLE → nyt wake
```

`CLOSING` er en transaktionsfase, ikke en ekstra runtime-`State`. De fem eksisterende
stateværdier viser lifecycle; de er ikke en half-duplex-mic-gate i GPT-Live.

V2.x kræver full duplex: aktiv Voice PE-input skal også nå GPT-Live under svar.
Brugeren skal kunne tale ind over svaret og fortsætte i samme session. Fysisk
afbrydelse og fravær af selvsvar skal bevises på pucken, ikke udledes af flags. GPT-Live ejer sprog,
matematik, kontekst, værktøjsvalg og semantisk close. PodVoice må kun eje mic-gate,
dispatch, playback, timeout, teardown og rearm. Terminalresponsen er højst én kort
sand opgavekvittering eller ét kort farvel; ingen lyd eller fejlet lyd lukker stille. Ingen lokal keywordliste må afgøre
betydning.

## Release-gate 1 — arkitektur

De følgende produktionskrav gælder GPT-Live: aktuel session-/connection-generation og
epoch, input-index bundet til den completed backend-delegation før tool-batch dispatch,
aktuel playback-lease og fysisk playback-events. `LiveAudioChunk` har ikke Realtime
response-/item-id; kræv derfor ikke et opdigtet wire-ACK. Kontinuerlig Live-input
under svar er tilsigtet og kodet/testet, ikke #164's påståede P1-fejl. Hørbar korrekt
afbrydelse, intet selvsvar og sikker fortsættelse er stadig fysisk accept i #112/#103;
der må ikke afledes en akustisk garanti fra den åbne input-pump.

De eksplicitte `response.create`, `input_audio_buffer.*`, committed-item og delete-ACK-
krav nedenfor er fortsat en separat regression for den beholdte OpenAI Realtime-
diagnostikadapter. De tæller ikke som GPT-Live-produktionsbevis.

- Renderet firmware: 1 wake-trigger, 0 stock `voice_assistant.start`.
- Ét lokalt wake-event åbner én mic-kanal og én GPT-Live-session.
- Den fysiske wake-grænse kasserer al pre-wake-lyd lokalt. GPT-Live må aldrig modtage selve wakefrasen; al lyd efter detektionen bevares under
  provider-opkoblingen.
- Dobbelt wake mens sessionen allerede er åben opretter ikke en ny session.
- GPT-Live-boundary: kun aktiv session-/epoch-/generationsejet input må nå den aktuelle
  backend; tool-dispatch kræver completed delegation/response, matching aktuelt input-index,
  uændret inputrevision og godkendt `LiveToolBatch`. Stale, cancelled, incomplete, duplicate
  eller ukorrelerede hændelser giver nul sideeffekt.
- Live-input forbliver åbent i den aktive samtale under THINKING og AI_SPEAKING;
  inaktiv session, privacy, closing og eksisterende bounded confirmation-hold afgrænser
  forwarding. Ny inputrevision invaliderer gammel tool-/close-autoritet. Stale input
  eller output må ikke krydse afbrydelse, generation eller teardown/rearm.
- Full-duplex-regression skal dække input under eget svar og den faktiske output-/
  interruptkontrakt. Fysisk input, korrekt afbrydelse, nyt svar i samme session og
  ingen selvsvar skal accepteres på samme artifact. En transcript-fragmenthændelse
  må ikke omdøbes til et provider-interrupt-ACK.
- GPT-Live har ét provider-neutralt `end_conversation`-signal til en tydelig semantisk
  afslutningshensigt. Signalet må ikke selv lukke transporten eller gå gennem HA/MCP.
- GPT-Live bruger automatisk værktøjsvalg: et almindeligt spørgsmål besvares direkte i
  én respons, og kun en handling eller et opslag bruger et nødvendigt værktøj. Et
  obligatorisk fortsættelsesværktøj eller en tvungen ekstra svarrespons er forbudt.
- Der findes ingen frase-, keyword- eller ASR-aliasliste, som afgør samtalehensigten.
- “Klar”, “Kig FCK seneste kamp”, uklart input og almindelig høflighed kan ikke lukke,
  medmindre GPT-Live på den samme tur eksplicit beslutter, at brugeren afslutter.
- Talk og Voice PE bruger samme `ThinSession`; kun I/O-adapteren er forskellig.
- Ingen adapter må kalde provideren direkte eller vise en tur som accepteret. Hver Talk-
  tur skal have serverkvitteret command-, session- og turn-id før den vises som submitted;
  GPT-Live har ikke et user-input provider-item-ACK. Stale socket-/playback-events er virkningsløse.
- Classic/direct kan ikke aktiveres via gamle eller nye settings.
- Funktionskandidater må kun dispatches fra en completed, response-/delegation- og
  current-input-bundet `LiveToolBatch`;
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

### Realtime-protokolprobe — kun diagnostik/regression

Den beholdte `OpenAIRealtimeSession` har fortsat sin særskilte wire-regression:
`interrupt_response: false`/`create_response: false`; ét korreleret `response.create` efter
accepteret stop og matching committed item; samt crossed-VAD cleanup med nul-PCM,
matching stop, commit/item/delete-ACK og fail-closed ved manglende ACK. Disse er konkrete
Realtime-adapterkrav, ikke GPT-Live-produktionskrav eller bevis. GPT-Live-produktions-
accepten ovenfor bruger aktuelle session-/epoch-/generation, input-index, completed
backend/delegation, `LiveToolBatch`, audio-generation og playback-lease; den fysiske
full-duplex- og akustikaccept kræver stadig device-/firmwarebevis.

### Maskinel adgangsgate før fysisk test

På præcis kandidatens bits skal følgende være grønt, før brugeren bedes tale igen:

- hele unit-/integrationstesten, typecheck, formattering og add-on-build;
- fælles `ThinSession`-regressioner for duplicate/busy/offline/closing, provider-tab,
  tool-ordering, semantisk close, én teardown og én rearm;
- sammensat GPT-Live-regression for aktuelt input-index → completed delegation/response →
  `LiveToolBatch` → guarded dispatch samt stale generation/input og duplicate/replay,
  sammen med playback-lease, kontinuerlig input, afbrydelse og opfølgning i samme session;
  ingen provider-ACK må fabrikeres. Den særskilte Realtime-protokolprobe bevarer de
  historiske crossed-start → nul-PCM → stop/commit/item/delete-ACK-regressioner;
- rigtig Talk-WebSocket med hello/lease/input-ACK, ordnede events og korreleret playback;
- den bounded live-gate, som matcher kandidatens ændrede ejergrænse: en response-owner-
  ændring kræver den relevante ejerskabsregression. Realtime-adapterændringer kræver
  dens sideeffektfrie commit/delete/ACK-protokolprobe; GPT-Live-ændringer kræver
  regression for aktiv epoch/generation, aktuelt input-index og completed delegation-/
  response-bundet `LiveToolBatch`. Ændret prompt, schema, værktøjer, model, reasoning
  eller audiosemantik kræver fokuseret semantisk preflight uden sideeffekter;
- trace-replay, der afviser manglende/dobbelte/omvendte wake-, provider-, playback-,
  close-, capture- og rearm-events samt faldende audio-generation, forwarding efter
  teardown, stale output efter afbrydelse og close på forældet inputrevision;
- rå providerpermutationer for completed/cancelled/failed/incomplete, schema/ACK-fejl,
  multi-call atomik, approval replay/expiry og rate-limit før sideeffekt.

Live-preflight bruger et hårdt turn-, token-, pris- og timeoutloft. Et korrekt tekstsvar
uden korrekt beslutning, session eller lifecycle er en fejl. Maskingaten kan stoppe en
kandidat, men aldrig erstatte den efterfølgende fysiske Voice PE-gate.

For en kandidat, der ændrer native audiosemantik eller mic-/turn-kontrakten på en måde,
som kan påvirke semantik, er den fokuserede live-gate den sideeffektfrie sekvens
`math → math-opfølgning → time → weekday-opfølgning → semantic close`, fem gange på
samme sessionskontrakt. Kun tidsturene må bruge HA `GetDateTime`; matematik og opfølgning skal
besvares direkte. En ren response-owner-/ACK-ændring kører først den smallere officielle
protokolprobe og genkører kun den semantiske 5×-gate ved ændret semantikscope eller ny
ren fysisk evidens for en semantikfejl. Samlet prisloft er $5, uden budgetprobe og uden
hjem-, musik- eller timerhandlinger. Ved ændret GPT-Live-prompt/schema/værktøj/semantik
bruges en fokuseret prøve af den faktiske GPT-Live-vej. Den beholdte Realtime-SafeEval
kan kun bevise sin egen diagnostik eller en eksplicit sideeffektfri sammenligning;
den er aldrig GPT-Live-releasebevis. Se EVALUERING.md.

### Lifecycle-confidence 97/100

97/100 er engineering confidence, ikke en garanti for alle rum og providerudfald:

| Område | Point | Obligatorisk bevis |
|---|---:|---|
| Én session og korrekt turkronologi | 20 | Alle maskinelle og fysiske kæder grønne |
| Full duplex og audio-isolation | 20 | Input under svar, korrekt afbrydelse/fortsættelse, intet selvsvar og grøn race-regression |
| GPT-Live-semantik og værktøjsvalg | 15 | Fokuseret live-gate 5/5 |
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
5. GPT-Live udsender semantisk afslutningsintention på varierede naturlige formuleringer,
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

## Hey Chat — fysisk featuregate (endnu ikke bevist)

Samme versionsbundne add-on/firmware-par skal først bestå frisk golden chain og
10/10 ubrudte lifecycle-cyklusser. Derefter 40 wakes med naturlig dansk udtale:
10 ved hver kombination af 1/3 meter og stille rum/baggrundstale. Mindst 38/40
samlet og mindst 9/10 i hver kombination. Spørgsmålet i samme åndedrag må ikke
klippes. Kræv nul selvaktiveringer under 50 assistantsvar og nul falske wakes
i to timers dokumenteret baggrundslyd. Gem afstand, lydforhold, version og trace.
Model-readback eller en grøn softwaretest er ikke akustisk bevis.

## Udviklingsprioritet 1 — oplevet fysisk svartid

Hastighedsarbejdet starter først efter golden chain og 10/10 fysisk lifecycle på samme
kandidat. Den autoritative brugeroplevede måling er:

```text
fysisk taleslut → første meningsfulde svarlyd fra Voice PE
```

Begge tidspunkter måles i den korrelerede rum-/deviceoptagelse med dokumenteret
proveniens og fælles tidsgrundlag. `speech_stopped` kan bruges som målelabel, men
er ikke et firmware-/provider-event, som GPT-Live-adapteren udsender. Firmware-
playback-events korrelerer outputtransporten; de beviser ikke alene første tale i
en vedvarende stream. Modeltelemetry eller et beregnet lydestimat erstatter ikke
den faktisk hørbare grænse.

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

Efter den låste latency-baseline må PodVoice få ét kort signal ved en faktisk
observeret, korreleret Live-turslut-/admission-grænse. Den nuværende Live-adapter
udsender ikke `UserSpeechStopped`; indtil en egnet grænse er dokumenteret, forbliver
signalet gated og må ikke udløses af opdigtede VAD-events. Formålet er kun at bekræfte “din tur er modtaget” på
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
add-on-genstart. PodVoice skal oprette MCP-forbindelsen på ny med hurtig backoff (ca. 1,
2, 5, 10 og 30 sekunder, derefter højst ét forsøg pr. minut), lade direkte GPT-Live-
dialog og matematik fortsætte og atomisk genaktivere HA-afhængige evner i den næste
session, når HA svarer. Tid, vejr, web, musik, hjem og timere må ikke falde tilbage til
en konkurrerende lokal sandhed.
Et værktøj fortsætter kun under udfaldet, hvis det har en faktisk uafhængig, rask
adapter. I den nuværende topologi er `google_web_sogning`, HassMedia og PodConnects
data-services HA-/Supervisor-afhængige; de skal derfor vises ærligt som midlertidigt
utilgængelige og må aldrig køres fra et stale deklarationssnapshot.

Panelet skal vise “forbinder igen”, seneste konkrete fejl og automatisk skifte til
verificeret uden at afbryde en aktiv GPT-Live-samtale. Tests skal dække opstartsfejl,
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
- GPT-Live, Voice PE/wake-readiness, HA/MCP, PodConnect og hver kapabilitet viser sand
  tilstand, konkret årsag, kilde og seneste verification. Fundet må ikke ligne bevist.
- Hjem, Tal, Diagnose, Historik og Indstillinger har én klar primær opgave hver.
  Passiv diagnose- og latensvisning bruger de fysiske events og må aldrig kalde
  modellyd “hørbar”. Panelet indeholder ingen guidede samtaletests.
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

## Særskilt gate — lokalt stop under svar

Bruger har valgt: “stop” afbryder svaret, lukker stille og kræver nyt wake word.
Kandidaten må udvikles isoleret; installation og merge afventer brugerens besked.
Den må ikke sammenblandes med latency, feedbacksignal, VAD, gain eller full-duplex.
Før fysisk featuregodkendelse kræves maskinel gate og fysisk godkendt grundkæde.

- 40 forsøg med brugerens naturlige danske “stop”: 1/3 meter × 50/80 % volumen,
  10 per kombination. Mindst 39/40 detektioner og mindst 9/10 i hver kombination.
- p95 fra slutningen af brugerens ord til sidste hørbare assistant-lyd ≤ 500 ms.
  Misses opgøres separat; firmware-STOP eller source IDLE må ikke erstatte lydmålingen.
- 50 svar uden bruger-stop, heraf 10 med ordet “stop” i svaret: 0 selvafbrydelser.
- 0 gammel lyd efter stop eller ny wake. 10/10 ubrudte stop → teardown → ny wake → svar.
- Ny almindelig golden chain og 10/10 fysisk lifecycle på samme add-on/firmware-par.
- Fysisk rotary, musik restore, timer-stop, disconnect under svar og efterfølgende
  recovery bevares. Under stop må der ikke startes nye hjemmehandlinger; allerede
  udførte handlinger kan ikke fortrydes af transport-stoppet.
- Audio fra rum/device/provider samt tidslinje gemmes med token/playback/session-id.
  Ukendt lyd, selvafbrydelse, delt-output-fejl eller død wake giver NO-GO.

## Afgrænsning mod naturlig samtaleafbrydelse

Naturlig taleafbrydelse og fortsættelse er allerede v2.x-produktretningen og skal
fysisk accepteres som sådan; en bestået lokal Stop-prøve beviser ikke den funktion.
Kontinuerlig mikrofoninput under Voice PE-afspilning er tilsigtet, men beviser ikke
alene korrekt fysisk afbrydelse eller fravær af selvsvar.
