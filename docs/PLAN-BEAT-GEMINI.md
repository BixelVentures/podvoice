# Planen: Bedre end Gemini for Home (juli 2026)

Eksekverbar plan for næste sessions (skrevet 2026-07-02, efter 0.70). Basen er:
0.70 add-on + den beviste announce-only firmware (gen-flashet; `git show 107eec1:esphome/podvoice.yaml`).

## Målet, målbart (scorecard mod Gemini for Home)

| Kriterium | Gemini for Home | Vores mål |
|---|---|---|
| Svartid (wake→første lyd) | 1-3 s, udligger 7-10 s | p90 < 2 s, ingen udliggere |
| Kedelige ting virker HVER gang | Berygtet ustabil | Lys/timer/stop: 20/20 forsøg |
| Fortsat samtale uden wake-ord | Fjernet (!) | Virker (lounge-vinduet — har vi) |
| Afbryd ved at tale | Kun i Live-mode | Fase 3, kun oven på valideret base |
| Dansk | Svarer af og til på engelsk | Fejlfrit rigsdansk (har vi stort set) |

## JERNREGLER (brudt i denne session — koste wake, chipmunk-lyd, selv-svar-loop)

1. **INTET pushes til main eller flashes uden ejerens kvittering i stuen.** Én ændring ad
   gangen, bag default-OFF flag. "Tests grønne" ≠ færdig; "ejer bekræfter på enheden" = færdig.
2. **Flash-ritual, altid i denne rækkefølge:** `cd esphome && ./validate.sh podvoice.yaml`
   → `esphome compile podvoice.yaml` → `esphome upload podvoice.yaml --device /dev/cu.usbmodem2101`
   (upload uden frisk compile fejler med "No such file"). Kør fra HOVED-checkoutets esphome/
   (secrets + build-cache ligger dér).
3. **Test-venv:** Python 3.12 (add-on-imagets version) — projektets .venv er 3.9 og kan ikke
   køre suiten. `python3.12 -m venv && pip install -r podvoice/requirements-dev.txt`.
4. Hver fase SLUTTER med en ejer-test og starter først næste fase efter "grønt" fra ejeren.

## Fase 0 — lås baseline (ejeren tester på 0.70, ingen kode)

Wake · almindelig samtale · "stop" under svar (knap + ord i LISTENING) · "sluk lyset, tak" ·
"sæt en timer på ét minut" (ringer i marin-stemmen?) · træk netstikket til routeren midt i
en tur (tales fejlen i AI-stemmen?). Alt grønt → baseline låst; noter TTFR-følelsen.

## Fase 1 — latens + målbarhed (ren software, lav risiko)

1. **TTFR-instrumentering i panelet**: p50/p90 wake→første-lyd + pr.-tur-log. Uden måling
   ved vi ikke om vi slår Gemini.
2. **Streaming-hakkeriet root-causes FØRST, kodes bagefter**: aflæs enhedens micro_decoder-log
   under en streaming-tur (bufferer den hele filen eller afspiller den løbende?). Hvis den
   bufferer hele fetch'en er streaming-via-announce dødt — drop det og hent latensen i Fase 2
   i stedet. Ingen flere silence-fill-gæt.
3. Nice: wake-earcon (kort lyd ved wake) via announce — eneste "instant feedback" uden firmware.

## Fase 2 — direct path, gjort rigtigt denne gang (firmware, ét trin ad gangen)

0.67 fejlede med (a) wake død, (b) chipmunk-lyd. Isolér årsagerne:

- **2a**: Flash KUN `voice_assistant: { media_player: !remove, speaker: announcement_resampling_speaker }`
  (INGEN mww-automation, INGEN on_tts_start-lambda). Test: virker wake? Virker announce-svar
  stadig? → afgør om VA-ændringen eller mww-automationen brød wake.
- **2b (chipmunk)**: Antag INTET om AudioStreamInfo. Læs esphome 2026.6-kildens
  voice_assistant.cpp + resampler-speaker først. Fix-kandidater i rækkefølge:
  (1) klient-side resample 24k→16k (StreamResampler findes allerede; nul firmware-antagelser,
  koster diskant — acceptabelt til validering), (2) korrekt stream-info-mekanisme fundet i
  kilden. Test speaker efter HVERT trin.
- **2c**: Først når direct-lyd er REN: mww-automationen (wake_stop) alene, flash, test wake igen.
- Add-on: genaktiver `speaker_path`-valget først når 2a+2b er ejer-godkendt (config.py tvinger
  pt. "announce" — det er bevidst).

## Fase 3 — barge-in (KUN oven på ejer-godkendt Fase 2)

full_duplex-flaget + Interrupted-flush findes allerede (0.68). Mangler: hardware-validering af
at AEC'en holder i stuen (høj volumen!), og en sustain-debounce hvis den afbryder sig selv.

## Fase 4 — poler + strategi

- Gemini Live-hjernen (≈10× billigere, bedre dansk-prosodi på 3.1): kræver først THINKING-proxy
  + watchdog-arming uden UserSpeechStopped (se gemini.py — yielder den ikke i dag).
- Neural-TTS for flere faste linjer; "det forstod jeg ikke"-flowet; History-oprydning.

## Nøglefiler

Add-on: `podvoice/gatekeeper/` (orchestrator/state/reply/web/voicepe/speech/timers).
Firmware: `esphome/podvoice.yaml` (tynd overlay; upstream 26.6.0 pinnet). Beviste version = 107eec1.
Memory: `voicepe-rebuild-plan` har alle dyrt lærte facts (merge-regler, VA-event-flow, API-signaturer).
