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

## Ejerskab

- Voice PE ejer wakeword, mikrofonport, LED og assistentens stemme.
- PodVoice ejer samtalens transport og lifecycle.
- OpenAI Realtime ejer forståelse, svar og valg af eksponerede værktøjer.
- HA MCP ejer adgang til eksponerede hjemmeenheder og HA-værktøjer.
- PodConnect Control/HA ejer Spotify-søgning og musikstyring.
- PodConnect Speakers ejer fysisk HomePod-afspilning og attention/ducking.
- Hjemmets søgeagent ejer aktuel webviden.

Ingen HA-, web-, musik- eller hjemmeværktøjer må åbne eller lukke Realtime-sessionen.
Realtime har kun et internt, provider-neutralt afslutningssignal; PodVoice ejer fortsat
selve lukningen og kan derfor garantere én teardown og én wake-rearm.

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

## Ikke længere produktionsarkitektur

- Classic-engine som alternativ samtalemotor.
- Stock HA Assist som wake- eller sessionsejer.
- Lokale slutfrase-, keyword- eller ASR-aliasregler som afslutningsautoritet.
- Direct PCM, som krævede en syntetisk stock-VA-håndtrykssekvens.
- Et kontrol-bip eller en ekstra announcement ved samtaleluk.

Koden kan midlertidigt indeholde isolerede historiske hjælpefunktioner og regressioner,
men add-on-builder, settings og runtime må ikke kunne aktivere disse veje. Modellens
reserverede, provider-neutrale `end_conversation`-signal ovenfor er derimod den gældende
semantiske produktionskontrakt; det går aldrig gennem HA/MCP og lukker ikke transporten
direkte.
