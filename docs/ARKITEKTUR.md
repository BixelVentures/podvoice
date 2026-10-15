# ARKITEKTUR — én PodVoice-samtale

> Produktbeslutning (13/10): den valgte produktionsretning er **GPT-Live** for både
> Voice PE og Talk. Den aktive runtime har én `ThinSession`-ejer og ingen
> provider-vælger. `live_alpha` er fortsat et settings-/migrationsfelt i den aktuelle
> kodebase; det er kompatibilitetsdata, ikke en tilladelse til at skifte motor.
> Kandidatens præcise implementerings- og installationsstatus står i `docs/STATUS.md`.
> Retningen er ikke fysisk accept eller bevis for løst semantisk close. GPT-Live bruger
> samme `ThinSession`, `VoicePELink`, `ToolRouter` og fysiske close/rearm-ejer.
> Provider-events skal afspejle observerede events; Realtime-protokolkvitteringer må
> ikke fabrikeres. Funktionsparitet, Stop, Talk og dræn skal bevises på kandidatens
> egne bits. Ingen følsom handling åbnes ved en opdigtet næste-brugertur.



> Kanonisk beslutning fra 2026-08-14. Hvis kode eller ældre dokumentation beskriver
> en parallel stock-HA Voice Assistant, frasebaseret hensigts-routing eller en direkte
> højttalervej, er den beskrivelse historisk og må ikke styre produktionen.

## Den eneste produktionsvej

```text
IDLE
  → Voice PE hører fysisk “Okay Nabu” og udsender ét wake-event
LISTENING
  → PodVoice åbner præcis én GPT-Live-session gennem `OpenAILiveSession`
  → GPT-Live registrerer afslutningen på brugerens taletur
THINKING
  → GPT-Live svarer direkte eller vælger nødvendige værktøjer
  → firmware melder fysisk playback_started
AI_SPEAKING
  → firmware melder playback_finished; PodVoice venter kort ekkohale
LOUNGE_WINDOW
  → opfølgning fortsætter i samme session → THINKING → AI_SPEAKING → LOUNGE_WINDOW
  → GPT-Live signalerer `end_conversation`, eller den gældende idle-grænse udløber
CLOSING
  → højst én kort sand kvittering, ét kort farvel eller stille lukning
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
Begge builders opretter en `OpenAILiveSession` som samtalens `brain` og `live_brain`;
runtime-valget er fast. Den lille fælles builder samler konstruktion og den delte
konfiguration, mens hver adapter stadig leverer sin egen I/O, playback og room-context.
Det samler eksempelvis standardværdien for sessionlængde ét sted i stedet for i begge
builders. Ændringen er en konstruktionsforenkling: den ændrer ikke eventrækkefølge,
state eller ejerskab.

De deler:

- GPT-Live-session, model, prompt og værktøjer;
- tur-/response-ejerskab og follow-up-kontekst;
- GPT-Live-ejet hensigtsfortolkning samt transport-ejet udførelse, timeout og fejlteardown;
- de fem states `IDLE`, `LISTENING`, `THINKING`, `AI_SPEAKING` og `LOUNGE_WINDOW`.

V2.x-retningen er full duplex på både Voice PE og Talk. Native Live-input fortsætter
under eget svar; det er en bevidst produktionsvej, ikke en half-duplex-overtrædelse.
Talk bruger browserens I/O/AEC og deler ejerskab/lifecycle, men beviser ikke puckens
akustik eller faktiske afbrydelse. Den fysiske accept står separat i STATUS.

Kun adapteren er forskellig:

| | Input | Output |
|---|---|---|
| Voice PE | 16 kHz PCM via `podvoice_audio` | Live WAV-announcement på puckens højttaler |
| Talk | Browserens mikrofon | Browserens audioelement |

Talk er derfor en softwareprøve af motoren, men kan ikke bevise Voice PE-mikrofon,
wakeword, højttaler, LED eller akustik. De kræver fysisk test.

### Runtime-, adapter- og kildegrænser

| Del | Beslutning | Kaldested / bevisgrænse |
|---|---|---|
| Voice PE og Talk | Behold samme GPT-Live-brain som både `brain` og `live_brain` og én `ThinSession`-ejer. Saml fælles sessionkonstruktion og værdier for duck, idle, maks. session og prompt i én mapping; adapterne leverer fortsat hver sin link, playback og room-context. | De to call sites (`_build_session` og `_make_talk`) kalder `__main__._make_thin_session`. Før ændringen gentages de delte bindings i to konstruktører; efter ændringen kræver en ændret sessionstandard kun én mapping. Det ændrer ikke events eller state. |
| Providergrænse | Behold `OpenAILiveSession` som den eneste produktionsprovider for begge adaptere. | `__main__._make_live_brain` bygger sessionen; `ThinSession` ejer lifecycle og oversætter providerhændelser. `live_alpha` er kompatibilitets-/migrationsdata, ikke runtime-vælger. |
| Fælles stemmekontrakt | Behold typede `VoiceEvent`s: audio, input/output-transcript, tool-call og tool-round, response-start/completion, schema correction, silent completion, interruption, user-speech-start/stop, quarantine-resolved, idle og usage. | `voice.py` er kontraktfladen; `openai_live.py` har sine egne `Live*` wire-events, som `ThinSession` fortolker. Eventnavne og ACK-semantik må ikke lånes fra en anden protokol. |
| OpenAI Realtime | Behold alene som eval-/diagnostikdriver og historisk regressionsadapter; fjern det som runtime-valg eller produktionsbrain. | `eval_harness.LiveEvalService` bruger den afgrænsede Realtime-protokol til eval. `__main__` importerer dens model-/ratekonstanter i eval-/Talk-konfigurationen; det er ikke en selectable session-builder. Bevar de protokolregressioner, der stadig beskytter denne diagnostik. |
| Lyd- og evaldiagnostik | Behold aktivt `audio_trace`, `audio_analysis` og `eval_harness`. | `__main__` kobler trace og analyse til add-onen og indlæser eval-service betinget af betroet konfiguration/API-nøgle. `Dockerfile` import-smoke checker `__main__`, `thin`, `openai_live`, `talk` og disse tre diagnostikmoduler. Diagnostikstatus erstatter ikke fysisk bevis. |
| Historisk runtimekilde | Behold regressioner/kildehistorik, men udeluk fra add-onens image: `orchestrator.py`, `state.py`, `gatekeeper.py`, `watchdog.py`, den direkte `console.py`, gamle lokale `timers.py` og `live_input_policy.py`. | Ingen af dem er produktions-entrypoint. `make_console=None`; Talk er den Thin-adapter, ikke den direkte Realtime-console. `ha_timers.py` og Home Assistant timer-adapteren er en særskilt HA-ejet funktion og følger ikke med den gamle lokale timerkode ud. |

Denne grænse gør kildebevarelse og installerbar kode forskellige ting: gamle regressioner
kan fortsat forklare tidligere fejl uden at gøre legacy-moduler til image-afhængigheder.
Ændringen er kun afsluttet, når build-importen og kandidatens scope faktisk matcher
denne tabel; `docs/STATUS.md` registrerer resultat og fysisk gate-status.

Alle brugerinputs ejes først af `ThinSession`. Talk må aldrig kalde GPT-Live direkte
eller vise et input som afleveret ved en rå WebSocket-forbindelse. En skrevet tur får et
kommando-id; `ThinSession` opretter session-/tur-id, afviser busy/closing/offline og
sender et klientgenereret item-id. Serveren kvitterer Talk-kommando/session/turn som
submitted; GPT-Live typed input returnerer `provider_ack=unavailable`, hvilket ikke er
providerbevis for en komplet brugertur. Talk-events sendes i én ordnet kø og bærer connection-, session-, turn-
og playback-id, så en sen event fra en gammel socket eller afspilning er virkningsløs.

Den fysiske outputstrøm har én korreleret playback-lease i `ThinSession`, bundet til
session, stream/outputgeneration og firmware-events; Talk bærer også playback-id.
Backend-complete er genereringstilstand, ikke fysisk stilhed. Playback-start/slut
styrer output- og afsluttende drain; de åbner ikke først brugerinput. Nyt aktuelt
Live-input kan komme under eget svar og ugyldiggøre gammel tool-/close-autoritet.
Stale playback-events må ikke ændre en nyere outputgeneration eller næste session.
Output skal afsluttes eller afbrydes sandt før teardown/rearm; det påstår ikke, at
hørbar afbrydelse allerede er bevist på installeret hardware.

## Ejerskab

- Voice PE-firmware ejer wakeword, conversation-latch, fysisk mic-forward,
  playback-start/slut/fault og korreleret rearm-bevis.
- PodVoice/`ThinSession` ejer samtalens transport, session-/generationsafgrænset mic-input, LED-kommando,
  værktøjsdispatch, timeout, teardown og rearm-anmodning.
- GPT-Live ejer forståelse, svar og valg af eksponerede værktøjer.
- Home Assistant ejer alle live-data og handlinger. Det eksplicitte MCP API-id
  `assist` leverer `GetDateTime` for tid/dato, `google_web_sogning` for web, én
  weather-vej, musik/hjem/støvsuger og senere HA-backed timere.
- Den eksisterende statiske `podconnect.*` HA-serviceadapter leverer kun private
  musikdata, som Assist ikke eksponerer. Navnene er lokalt allowlistede, indgår i det
  fulde sessionschema-hash og importeres aldrig dynamisk; PodVoice har ingen direkte
  Spotify-provider.
- PodConnect Control/HA ejer Spotify-søgning og musikstyring.
- Den valgfrie enhedsadapter tilføjer præcis `ha_get_device_capabilities` og
  `ha_execute_device_action` gennem samme ToolRouter/policy. Default off giver ingen
  ekstra declarations eller HA-opslag. Kun eksplicit tilladte Roborock-entiteter,
  friske registeridentiteter, aktuelle lovlige indstillinger og det aktive kort kan
  danne en kortlivet engangscapability. Roborock valgt-kort læses, men kan ikke ændres.
  GPT-Live vælger og rækkefølger handlinger; adapteren har ingen taleparser, HA-script
  eller ny samtalemotor. HA's cachede metadata og service-ACK er ikke fysisk bevis.
- PodConnect Speakers ejer fysisk HomePod-afspilning og attention/ducking.
- Hjemmets søgeagent ejer aktuel webviden.

`ToolRouter` validerer først hele HA-siden og publicerer derefter atomisk kun statisk
klassificerede navne. Nye navne bliver stående som `pending_tools`; de bliver aldrig
modelværktøjer på baggrund af navn eller beskrivelse alene. `HassGetWeather` foretrækkes
over `weather_forecast`, hvis begge findes. Et sessionsschema kopieres ved sessionstart
og ændres ikke under opfølgninger; en genfundet HA-side gælder først næste session.
PodVoice har ingen lokal `get_time` og ingen model-synlig in-memory timer.

Ingen HA-, web-, musik- eller hjemmeværktøjer må åbne eller lukke GPT-Live-sessionen.
GPT-Live svarer direkte, når intet værktøj er nødvendigt, og bruger kun et
reelt domæneværktøj til en handling eller et opslag. De eneste interne,
provider-neutrale lifecycle-signaler er `wait_for_user` for ikke-henvendt tale eller et rent modtaget-signal uden ny
anmodning/afslutningshensigt, og
`end_conversation` for en klar semantisk afslutning. PodVoice fortolker aldrig brugerens
ord og ejer kun transportlukningen, så én teardown og én wake-rearm kan garanteres.
Et rent tak til et allerede givet svar kan derfor mødes med stilhed uden lukning.
Eksisterende korreleret silent-tool-ACK åbner followup; næste spørgsmål eller normal
fysisk idle bestemmer fortsættelsen. Høflighed i handlinger, spørgsmål, godkendelser
og uklar henvendt tale er ikke denne undtagelse. Ingen lokal fraseregel eller ny tilstand.

Der findes intet obligatorisk fortsættelsessignal og ingen tvungen to-respons-vej for et
direkte svar. Den konstruktion blev afvist efter den fysiske 1.13.22-trace, hvor et
korrekt observeret “Hvad er tolv gange syv?” først blev sendt gennem et kunstigt
fortsættelseskald og derefter blev besvaret som “7 gange 7 er 49”. Automatiske
værktøjsvalg bevarer GPT-Lives naturlige svarvej og samme åbne kontekst.

## Lukning

Lukning har to adskilte ejere:

- **GPT-Live ejer betydningen.** Når brugerens aktuelle tur tydeligt betyder, at
  samtalen er slut, udsender modellen det interne `end_conversation`-signal. Det kan
  også følge efter en fuldt bekræftet, selvstændig handling uden udestående dialog;
  modellen skal først have set handlingsresultatet. En kort sand opgavekvittering
  kan være terminalresponsen. Det gælder
  naturlige formuleringer på tværs af ordvalg og sprog; PodVoice matcher ingen fraser,
  keywords eller dokumenterede ASR-fejl.
- **PodVoice ejer mekanikken.** Signalet bindes til den konkrete tur. Hvis GPT-Live har
  leveret svarlyd, afspilles den, og dens fysiske playback-finish
  afventes; hvis der ikke er svarlyd, eller den fejler, lukkes stille. Begge veje ender i
  præcis én atomisk teardown af GPT-Live-sessionen, mikrofon, ducking og wake-lås.
- Uklart input skal få GPT-Live til at spørge kort igen. Et løst “tak”, ord inde i en
  opgave, deltransskriptioner og et signal fra en gammel tur må aldrig lukke.
- Et eksplicit hardware-stop, timeout og tekniske fejl er transport-sikkerhed og kan
  lukke deterministisk uden semantisk modelbeslutning.

## V2.x: GPT-Live full duplex

Der er én produktionsvej: aktiv native mic → VoicePELink → ThinSession →
OpenAILiveSession samtidig med Live-output → /reply/live/{stream_id}.wav → Voice PE-playback.
`_pump_mic` lader `live_alpha` fremføre aktuelle micframes under svar; eksisterende
native integrationstest kræver netop provider-append mens device spiller.

Det gamle `full_duplex`-flag er ikke sandheden om GPT-Live-input. Native builderens
`False` bevarer legacy-konfiguration, mens Live har sin egen kontinuerlige inputsti.
Flaget må hverken bruges som fysisk duplexbevis eller blot sættes True uden review
af alle dets øvrige callback-/afbrydelsesgrene.

| State/fase | V2.x Live-input | Mekanisk grænse |
|---|---|---|
| `IDLE` | ingen forwarding | privacy/inaktiv session |
| `LISTENING` | åben | aktiv session og generation |
| `THINKING` | fortsat åben | nyt input invaliderer gammel tool-/close-autoritet |
| `AI_SPEAKING` | fortsat åben | GPT-Live ejer betydning; PodVoice ejer fysisk output |
| `LOUNGE_WINDOW` | åben | opfølgning i samme session |
| closing/confirmation-rotation | afgrænset af eksisterende ejer | ingen stale input efter teardown/rotation |

Åben mic er ikke alene bevis for hørbar afbrydelse. Live-transcripts er fragmenter,
ikke lokale Stop-kommandoer eller et opdigtet speech-start/interrupt-ACK. Aktuel input-,
provider-, stream- og playback-generation skal følges gennem eventuel afbrydelse,
relevant nyt svar, close og næste wake. Den fysiske funktion kræver korreleret
device-/provider-/højttalerbevis uden selvsvar; #112/#103 ejer denne accept.

Kildegennemgangen finder kontinuerlig input, men ingen eksplicit kobling fra et
almindeligt Live-inputfragment til VoicePELink.stop_playback. Provideren kan ændre
sit løbende output; dets hørbare resultat er ikke målt her. Der påstås derfor hverken
en ny runtimefejl eller bevist fysisk barge-in. #164's tidligere krav om at lukke mic
under svar skyldtes forældet v1.x-dokumentation og er trukket tilbage.

Legacy half-duplex/VAD/commit/ACK-regressioner beholdes til den gamle adapter nedenfor;
de må ikke styre GPT-Live-produktionen eller lukke en tilsigtet aktiv Live-mikrofon.

### Historisk OpenAI Realtime-wirekontrakt (kun diagnostik/regression)

De følgende eventnavne og ACK-regler gælder kun, når `OpenAIRealtimeSession` bruges af
den afgrænsede eval-/regressionskode. De må ikke fortolkes som GPT-Live-wirekrav.

Sessionen bruger `interrupt_response: false` og `create_response: false`. Et accepteret
fysisk `speech_stopped` lukker mic-gaten; når samme generations user-item er committed,
tillader `ThinSession` præcis én respons. Provideradapteren sender det korrelerede
`response.create` med unikt request-id og samme
`(root_item_id, turn_id, provider_generation)`; alle afledte tool-/schema-/close-
responses arver samme lease. Turn og generation serialiseres som kanoniske decimale
strenge i providerens metadata. Denne klientevent er kun en mekanisk tilladelse til
inference. I denne historiske adapter ejer Realtime stadig forståelse, værktøjsvalg, svar og `end_conversation`.

En provider-VAD-start, der ankommer efter mic-gaten er lukket, er en crossed span og må
ikke blive næste tur. Den holdes i karantæne, må skabe nul response/tool/playback og skal
afsluttes med bounded, adapter-ejet nul-PCM, mens den fysiske mic-gate forbliver lukket.
OpenAI Realtime-adapteren skal derefter levere den naturlige, matching `speech_stopped`; først matching
commit, item-added og eksakt delete-ACK udgør hele cleanup-beviset og må åbne
`LOUNGE_WINDOW`. Manuel commit og `input_audio_buffer.clear` er aldrig VAD-terminaler.
Hvis stop-/commit-/delete-kontrakten ikke afsluttes bounded og eksakt, lukkes sessionen
fail-closed og Voice PE rearmes; ingen gammel VAD-spændvidde genbruges.

Den lokale stop-kandidat bruger microWakeWord-modellen `Stop` under eget playback.
Token+URL optages atomisk; detektion stopper announcement og sender et korreleret event.
ThinSession lukker stille via samme close-owner. Firmware kræver producer-quiescence,
stoppet resampler, frigivet mixer-reference og output-consumed-frame fence før ACK.
`stopped_word` åbner aldrig opfølgning; næste wake kræver fuld teardown og rearm.
Den særskilte stop-gate i produktmål er endnu ikke fysisk bestået.

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

Den pakkede `LiveEvalService` bruger OpenAI Realtime-evaldriveren med faste lokale
værktøjsresultater uden HA/MCP/PodConnect-klienter. Den måler denne drivers semantik og
protokol uden sideeffekter; den er ikke et GPT-Live-semantikresultat. Trace-oraclet
bedømmer mekanisk eventrækkefølge,
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

Et GPT-Live-funktionskald er først et forslag. Provideradapteren udsender en
`LiveToolBatch` først efter den tilhørende backend-delegation er meldt `completed` og
værktøjskald er valideret. `ThinSession` kontrollerer fortsat batchens generation,
aktuelle input og serverpolicy, før den stager resultaterne og sender ét
`function_call_output` pr. eksakt call-id via `send_tool_results`; adapteren fortsætter
derefter backend-samtalen. Denne GPT-Live-vej venter ikke på en særskilt
Realtime-item-ACK. Cancelled, incomplete, failed, malformed, duplicate eller stale
kald kan derfor ikke nå HA, PodConnect eller lifecycle.

GPT-Live ejer stadig betydningen og den naturlige dialog. Serverens execution policy
ejer derimod tilladelsen. Et følsomt forslag gemmes som en kortlivet challenge med
kanoniske argumenter og mål; kun en completed approval-beslutning på den umiddelbart
næste tur i samme session kan udføre præcis den gemte handling én gang. HA-mutationer
autoriseres mod frisk state og dispatches til det samme eksakte entity-id. Det er ikke
lokal intent-routing: serveren fortolker ingen brugerfraser, men håndhæver grænsen på
den modelvalgte, strukturerede handling.

Provider-sessioner deler et budget per nøgleidentitet og model. Produktion og
live-eval er gensidigt eksklusive under den nøglebrede diagnostiklås; eval bruger en
separat response-reservation, men simulerer ikke fysisk headroom. En completed
tool-batch frigives ikke, hvis den samme generation mangler autoritativ usage eller
reserveret kapacitet til at levere resultatet/farvel. Dermed kan en hjemmehandling ikke
blive udført og derefter efterlade brugeren uden den causale tilbagemelding.
