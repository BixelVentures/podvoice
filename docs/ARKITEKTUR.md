# ARKITEKTUR — én PodVoice-samtale

> Kanonisk beslutning fra 2026-08-14. Hvis kode eller ældre dokumentation beskriver
> en parallel stock-HA Voice Assistant, en modelstyret lukke-tool eller en direkte
> højttalervej, er den beskrivelse historisk og må ikke styre produktionen.

## Den eneste produktionsvej

```text
Voice PE hører “Okay Nabu”
  → firmware åbner podvoice_audio og udsender ét wake-event
  → PodVoice åbner præcis én OpenAI Realtime-session
  → al tale, værktøjer, svar og opfølgninger bliver i samme session
  → “farvel”, “stop”, timeout eller fejl lukker session og mikrofon
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
- transport-ejet lukning, timeout, fejlteardown og historik;
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

Ingen af disse værktøjer må åbne eller lukke Realtime-sessionen.

## Lukning

Lukning er transportlogik, ikke et modelværktøj. `end_conversation` er fjernet, fordi
Realtime i feltet kaldte det på “Klar” og “Kig FCK seneste kamp” og dermed svarede
“Farvel” eller tavshed på almindelige spørgsmål.

- Et eksakt helt “stop”, “stille” eller “vent” lukker straks.
- Et eksakt helt “farvel” eller en godkendt høflig slutfrase lader det korte farvel
  spille færdigt og lukker derefter.
- En dokumenteret ASR-forveksling må kun blive en slutfrase, når den står alene og
  Realtime uafhængigt svarer med et rent farvel. Aliaset alene må aldrig lukke.
- Ord inde i et spørgsmål, deltransskriptioner og modelgæt lukker aldrig.
- Timeout og fejl lukker deterministisk og frigiver mikrofon, Realtime og ducking.

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
- Modellens `end_conversation`-tool.
- Direct PCM, som krævede en syntetisk stock-VA-håndtrykssekvens.
- Et kontrol-bip eller en ekstra announcement ved samtaleluk.

Koden kan midlertidigt indeholde isolerede historiske hjælpefunktioner, men settings og
runtime må ikke kunne aktivere disse veje.
