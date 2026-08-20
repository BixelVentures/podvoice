# ARKITEKTUR — én PodVoice-samtale

> Kanonisk beslutning fra 2026-08-14. Hvis kode eller ældre dokumentation beskriver
> en parallel stock-HA Voice Assistant, frasebaseret hensigts-routing eller en direkte
> højttalervej, er den beskrivelse historisk og må ikke styre produktionen.

## Den eneste produktionsvej

```text
Voice PE hører “Okay Nabu”
  → firmware åbner podvoice_audio og udsender ét wake-event
  → PodVoice åbner præcis én OpenAI Realtime-session
  → al tale, værktøjer, svar og opfølgninger bliver i samme session
  → Realtime fortolker en tydelig afslutningshensigt og signalerer den til PodVoice
  → fysisk svarslut, timeout eller fejl lukker session og mikrofon præcis én gang
  → Voice PE er straks tilbage i wakeword
```

Home Assistant Assist deltager ikke i samtalen. ESPHomes `voice_assistant`-protokol
må kun fungere som lavniveau-abonnementet, der bærer mikrofonbytes over native API;
der startes aldrig et HA Assist-run eller en HA pipeline.

## Én motor, to I/O-adaptere

`ThinSession` er den eneste samtalemotor for både den fysiske Voice PE og Talk-fanen.
De deler:

- Realtime-session, model, prompt og værktøjer;
- turn detection, half-duplex-ekkoport og follow-up-kontekst;
- Realtime-ejet hensigtsfortolkning samt transport-ejet udførelse, timeout og fejlteardown;
- tilstandene lytter, tænker, taler og idle.

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

## Ejerskab

- Voice PE ejer wakeword, mikrofonport, LED og assistentens stemme.
- PodVoice ejer samtalens transport og lifecycle.
- OpenAI Realtime ejer forståelse, svar og valg af eksponerede værktøjer.
- HA MCP ejer adgang til eksponerede hjemmeenheder og HA-værktøjer.
- PodConnect Control/HA ejer Spotify-søgning og musikstyring.
- PodConnect Speakers ejer fysisk HomePod-afspilning og attention/ducking.
- Hjemmets søgeagent ejer aktuel webviden.

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
- **PodVoice ejer mekanikken.** Signalet bindes til den konkrete tur, det korte
  afslutningssvar afspilles, og først fysisk playback-finish må udløse én atomisk
  teardown af Realtime, mikrofon, ducking og wake-lås.
- Uklart input skal få Realtime til at spørge kort igen. Et løst “tak”, ord inde i en
  opgave, deltransskriptioner og et signal fra en gammel tur må aldrig lukke.
- Et eksplicit hardware-stop, timeout og tekniske fejl er transport-sikkerhed og kan
  lukke deterministisk uden semantisk modelbeslutning.

## Half-duplex først

Mens pucken afspiller et svar, sendes dens mikrofon ikke videre til OpenAI. Det er den
pålidelige første version: ingen selvsvar og ingen falske afbrydelser fra højttaleren.
Opfølgningen fortsætter i samme session, så half-duplex betyder ikke én kommando pr.
wake. Fuld duplex og tale-stop midt i svar er en separat senere gate.

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
- mikrofonstart ved den lokale wakekant, uden wake-chime eller 300 ms forsinkelse.

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
