# ARKITEKTUR — én PodVoice-samtale

> Kanonisk beslutning fra 2026-08-14. Hvis kode eller ældre dokumentation beskriver
> en parallel stock-HA Voice Assistant, frasebaseret hensigts-routing eller en direkte
> højttalervej, er den beskrivelse historisk og må ikke styre produktionen.

## Den eneste produktionsvej

```text
IDLE
  → Voice PE hører fysisk “Okay Nabu” og udsender ét wake-event
LISTENING
  → PodVoice åbner præcis én OpenAI Realtime-session og streamer brugertalen
  → Realtime speech_stopped
THINKING
  → Realtime svarer direkte eller bruger nødvendige værktøjer
  → firmware melder fysisk playback_started
AI_SPEAKING
  → firmware melder playback_finished; PodVoice venter kort ekkohale
LOUNGE_WINDOW
  → opfølgning fortsætter i samme session → THINKING → AI_SPEAKING → LOUNGE_WINDOW
  → Realtime signalerer end_conversation, eller fire sekunders stilhed udløber
CLOSING
  → højst ét kort farvel eller stille lukning
  → præcis én teardown → exact korreleret firmware-rearm
IDLE
```

`CLOSING` er den ene close-transaktion, ikke en konkurrerende eller sjette
runtime-`State`.

Home Assistant Assist deltager ikke i samtalen. ESPHomes `voice_assistant`-protokol
må kun fungere som lavniveau-abonnementet, der bærer mikrofonbytes over native API;
der startes aldrig et HA Assist-run eller en HA pipeline.

## Én motor, to I/O-adaptere

`ThinSession` er den eneste samtalemotor for både den fysiske Voice PE og Talk-fanen.
De deler:

- Realtime-session, model, prompt og værktøjer;
- tur-/response-ejerskab og follow-up-kontekst;
- Realtime-ejet hensigtsfortolkning samt transport-ejet udførelse, timeout og fejlteardown;
- de fem states `IDLE`, `LISTENING`, `THINKING`, `AI_SPEAKING` og `LOUNGE_WINDOW`.

Den fysiske half-duplex-ekkoport gælder kun Voice PE. Talk er den eksplicitte
full-duplex-browseradapter med browser-AEC; den deler ejerskab og lifecycle, men er ikke
fysisk bevis for puckens mic-gate.

Kun adapteren er forskellig:

| | Input | Output |
|---|---|---|
| Voice PE | 16 kHz PCM via `podvoice_audio` | FLAC-announcement på puckens højttaler |
| Talk | Browserens mikrofon | Browserens audioelement |

Talk er derfor en softwareprøve af motoren, men kan ikke bevise Voice PE-mikrofon,
wakeword, højttaler, LED eller akustik. De kræver fysisk test.

Alle brugerinputs ejes først af `ThinSession`. Talk må aldrig kalde Realtime direkte
eller vise et input som afleveret ved en rå WebSocket-forbindelse. En skrevet tur får et
kommando-id; `ThinSession` opretter session-/tur-id, afviser busy/closing/offline og
sender et klientgenereret item-id. Realtime skal kvittere det præcise item med
`conversation.item.added` (med kompatibilitet for den ældre
`conversation.item.created`), før `response.create` sendes og browseren må committe
brugerboblen. Talk-events sendes i én ordnet kø og bærer connection-, session-, turn-
og playback-id, så en sen event fra en gammel socket eller afspilning er virkningsløs.

Hvert publiceret svar får én playback-lease i `ThinSession`, bundet til den konkrete
samtale, tur, output-item og playback-generation. Providerens `response.done` afslutter
kun genereringen. Tilstanden forbliver optaget gennem ventet afspilningsstart, fysisk
playback og ekkohale; først den samme leases `playback_finished` åbner næste tur. Voice
PE serialiserer det ene inflight-svar gennem firmwarefasen, mens Talk også bærer det
eksplicitte playback-id. Et event fra et tidligere svar kan derfor ikke ændre den
aktuelle tur.

## Ejerskab

- Voice PE-firmware ejer wakeword, conversation-latch, fysisk mic-forward,
  playback-start/slut/fault og korreleret rearm-bevis.
- PodVoice/`ThinSession` ejer samtalens transport, state-ejet mic-gate, LED-kommando,
  værktøjsdispatch, timeout, teardown og rearm-anmodning.
- OpenAI Realtime ejer forståelse, svar og valg af eksponerede værktøjer.
- Home Assistant ejer alle live-data og handlinger. Det eksplicitte MCP API-id
  `assist` leverer `GetDateTime` for tid/dato, `google_web_sogning` for web, én
  weather-vej, musik/hjem/støvsuger og senere HA-backed timere.
- Den eksisterende statiske `podconnect.*` HA-serviceadapter leverer kun private
  musikdata, som Assist ikke eksponerer. Navnene er lokalt allowlistede, indgår i det
  fulde sessionschema-hash og importeres aldrig dynamisk; PodVoice har ingen direkte
  Spotify-provider.
- PodConnect Control/HA ejer Spotify-søgning og musikstyring.
- PodConnect Speakers ejer fysisk HomePod-afspilning og attention/ducking.
- Hjemmets søgeagent ejer aktuel webviden.

`ToolRouter` validerer først hele HA-siden og publicerer derefter atomisk kun statisk
klassificerede navne. Nye navne bliver stående som `pending_tools`; de bliver aldrig
modelværktøjer på baggrund af navn eller beskrivelse alene. `HassGetWeather` foretrækkes
over `weather_forecast`, hvis begge findes. Et sessionsschema kopieres ved sessionstart
og ændres ikke under opfølgninger; en genfundet HA-side gælder først næste session.
PodVoice har ingen lokal `get_time` og ingen model-synlig in-memory timer.

Ingen HA-, web-, musik- eller hjemmeværktøjer må åbne eller lukke Realtime-sessionen.
Realtime svarer direkte i én respons, når intet værktøj er nødvendigt, og bruger kun et
reelt domæneværktøj til en handling eller et opslag. De eneste interne,
provider-neutrale lifecycle-signaler er `wait_for_user` for ikke-henvendt tale og
`end_conversation` for en klar semantisk afslutning. PodVoice fortolker aldrig brugerens
ord og ejer kun transportlukningen, så én teardown og én wake-rearm kan garanteres.

Der findes intet obligatorisk fortsættelsessignal og ingen tvungen to-respons-vej for et
direkte svar. Den konstruktion blev afvist efter den fysiske 1.13.22-trace, hvor et
korrekt observeret “Hvad er tolv gange syv?” først blev sendt gennem et kunstigt
fortsættelseskald og derefter blev besvaret som “7 gange 7 er 49”. Automatiske
værktøjsvalg bevarer Realtime-modellens naturlige én-respons-vej og samme åbne kontekst.

## Lukning

Lukning har to adskilte ejere:

- **GPT Realtime ejer betydningen.** Når brugerens aktuelle tur tydeligt betyder, at
  samtalen er slut, udsender modellen det interne `end_conversation`-signal. Det gælder
  naturlige formuleringer på tværs af ordvalg og sprog; PodVoice matcher ingen fraser,
  keywords eller dokumenterede ASR-fejl.
- **PodVoice ejer mekanikken.** Signalet bindes til den konkrete tur. Hvis Realtime har
  leveret kort, korreleret svarlyd, afspilles den, og dens fysiske playback-finish
  afventes; hvis der ikke er svarlyd, eller den fejler, lukkes stille. Begge veje ender i
  præcis én atomisk teardown af Realtime, mikrofon, ducking og wake-lås.
- Uklart input skal få Realtime til at spørge kort igen. Et løst “tak”, ord inde i en
  opgave, deltransskriptioner og et signal fra en gammel tur må aldrig lukke.
- Et eksplicit hardware-stop, timeout og tekniske fejl er transport-sikkerhed og kan
  lukke deterministisk uden semantisk modelbeslutning.

## Half-duplex først

`State` er den eneste gate for Voice PE-lyd til Realtime:

| State | Mic til Realtime | LED |
|---|---|---|
| `IDLE` | lukket | slukket efter bevist teardown |
| `LISTENING` | åben | klar cyan |
| `THINKING` | lukket | amber |
| `AI_SPEAKING` | lukket | grøn fra fysisk playback-start |
| `LOUNGE_WINDOW` | åben | dæmpet cyan |

Den native callback fanger sin audio-generation synkront. `VoicePELink` må kun øge
generationen og dræne køen ved gyldigt `speech_stopped`, efter current playback-finish
plus ekkohale og ved korreleret rearm-ACK. En delayed callback fra tur A kan derfor ikke
blive opfølgning B. Der skæres aldrig ved wake, så same-breath-prefix bevares.

Tidslinjen binder hele kæden som `session_id → provider_generation → turn_id →
audio_generation → response/tool → playback_id → close_id → rearm_token`, så et
tilfældigt korrekt svar aldrig kan skjule forkert input eller forkert ejer.

Half-duplex betyder ikke én kommando pr. wake: Realtime-socketten holdes åben og
konteksten bevares gennem opfølgninger. Fuld duplex og tale-stop midt i svar er en
separat senere gate.

Dette er den bindende målkontrakt; `docs/STATUS.md` afgør, om de installerede bits har
bevist den. Voice PE beholder providerens VAD, men ikke providerens automatiske
response-ejerskab.
Sessionen bruger `interrupt_response: false` og `create_response: false`. Et accepteret
fysisk `speech_stopped` lukker mic-gaten; når samme generations user-item er committed,
tillader `ThinSession` præcis én respons. Provideradapteren sender det korrelerede
`response.create` med unikt request-id og samme
`(root_item_id, turn_id, provider_generation)`; alle afledte tool-/schema-/close-
responses arver samme lease. Turn og generation serialiseres som kanoniske decimale
strenge i providerens metadata. Denne klientevent er kun en mekanisk tilladelse til
inference. Realtime ejer stadig forståelse, værktøjsvalg, svar og `end_conversation`.

En provider-VAD-start, der ankommer efter mic-gaten er lukket, er en crossed span og må
ikke blive næste tur. Den holdes i karantæne, må skabe nul response/tool/playback og skal
afsluttes med bounded, adapter-ejet nul-PCM, mens den fysiske mic-gate forbliver lukket.
Provideren skal derefter levere den naturlige, matching `speech_stopped`; først matching
commit, item-added og eksakt delete-ACK udgør hele cleanup-beviset og må åbne
`LOUNGE_WINDOW`. Manuel commit og `input_audio_buffer.clear` er aldrig VAD-terminaler.
Hvis stop-/commit-/delete-kontrakten ikke afsluttes bounded og eksakt, lukkes sessionen
fail-closed og Voice PE rearmes; ingen gammel VAD-spændvidde genbruges.

## Firmwarekontrakten

Den officielle Voice PE-base er vendored med commit og SHA i
`esphome/voice-pe-podvoice-base.yaml`, fordi ESPHome sammenfletter triggerlister.
Et almindeligt overlay kunne derfor ikke fjerne upstreams anonyme stock-Assist-trigger
og skabte to wakeveje.

Godkendt firmware skal statisk og i renderet konfiguration have:

- præcis én `on_wake_word_detected`;
- nul `voice_assistant.start`;
- præcis ét `wake_okay_nabu`-event;
- `podvoice_channel_v1` og `same_breath_v1`;
- mikrofonstart ved den lokale wakekant, uden wake-chime eller 300 ms forsinkelse;
- korreleret reset/rearm med frisk mic-fremdrift før `recovered`;
- korrelerede `podvoice_playback_started`, `podvoice_playback_finished` og fault-events;
- publiceret `led_ring`, som add-onen kan styre uden at gøre LED til lifecycle-bevis.

En add-on-only ændring må genbruge denne ABI og kræver ingen flash. Ændres ESPHome,
build-marker, services, capability-listen eller light-entity-kontrakten, er kandidaten
ikke længere add-on-only og skal bygge, flashes og bestå firmwaregaten på ny.

## Maskinelle bevislag

Den sikre Realtime-eval bruger samme produktionsprompt og model, men kun faste lokale
værktøjsresultater uden HA/MCP/PodConnect-klienter. Den måler semantiske beslutninger,
opfølgning og protokol uden sideeffekter. Trace-oraclet bedømmer mekanisk eventrækkefølge,
playback-par, lukning og rearm; acoustic HIL må kun afspille begrænsede, samtykkede
PCM-fixtures gennem en ekstern højttaler og observere produktions-events.

Ingen af disse lag kan erklære puckens wake, mikrofon, LED, DAC eller rumakustik bevist.
De reducerer den manuelle testflade; fysisk golden chain og 10/10 forbliver sidste gate.

## Ikke længere produktionsarkitektur

- Classic-engine som alternativ samtalemotor.
- Stock HA Assist som wake- eller sessionsejer.
- Lokale slutfrase-, keyword- eller ASR-aliasregler som afslutningsautoritet.
- Direct PCM, som krævede en syntetisk stock-VA-håndtrykssekvens.
- Et kontrol-bip eller en ekstra announcement ved samtaleluk.

Koden kan midlertidigt indeholde isolerede historiske hjælpefunktioner og regressioner,
men add-on-builder, settings og runtime må ikke kunne aktivere disse veje. Modellens
reserverede `wait_for_user`- og `end_conversation`-signaler ovenfor er den gældende
semantiske produktionskontrakt; de går aldrig gennem HA/MCP, og kun den efterfølgende
transportmekanik kan fysisk lukke samtalen.

## Værktøjscommit og serverautorisation

Et Realtime-funktionskald er først et forslag. PodVoice stager alle kald under den
konkrete providerrespons og frigiver ingen af dem, før samme `response.done` er
`completed`, hele batchen er valideret, og den eksakte tool-round-commit er modtaget.
Cancelled, incomplete, failed, malformed, duplicate eller stale kald kan derfor ikke
nå HA, PodConnect eller lifecycle. Tool-output item-kvitteres, før der oprettes én
samlet resultatsrespons.

Realtime ejer stadig betydningen og den naturlige dialog. Serverens execution policy
ejer derimod tilladelsen. Et følsomt forslag gemmes som en kortlivet challenge med
kanoniske argumenter og mål; kun en completed approval-beslutning på den umiddelbart
næste tur i samme session kan udføre præcis den gemte handling én gang. HA-mutationer
autoriseres mod frisk state og dispatches til det samme eksakte entity-id. Det er ikke
lokal intent-routing: serveren fortolker ingen brugerfraser, men håndhæver grænsen på
den modelvalgte, strukturerede handling.

Alle Realtime-sessioner deler et budget per nøgleidentitet og model. Produktion og
live-eval er gensidigt eksklusive under den nøglebrede diagnostiklås; eval bruger en
separat response-reservation, men simulerer ikke fysisk headroom. En completed
tool-batch frigives ikke, hvis den samme generation mangler autoritativ usage eller
reserveret kapacitet til at levere resultatet/farvel. Dermed kan en hjemmehandling ikke
blive udført og derefter efterlade brugeren uden den causale tilbagemelding.
