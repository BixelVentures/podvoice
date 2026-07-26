# Wake word plan (Phase 2 — decision + runbook, verified 2026-07)

**Constraint (confirmed):** openWakeWord does NOT run on the ESP32-S3 — that is why
micro_wake_word exists. The stock `okay_nabu` micro model is the current detector
and the source of the false/missed triggers.

**Decision: Option 1 first — a custom-trained microWakeWord model, on-device.**
No continuous streaming off the device, no new hardware, and the wake path
PodVoice already uses (mww → `voice_assistant.start` → `handle_start`) is
unchanged — only the model file swaps.

## Option 1 runbook — custom microWakeWord (do this first)

The project moved: **https://github.com/OHF-Voice/micro-wake-word** (the old
kahrendt/microWakeWord URL redirects; actively maintained as of 2026-07).

1. **Pick the phrase.** Keep 3–5 syllables and unlike household words. Danish
   caveat: there is **no official Danish/accent guidance** — positives are
   synthesized with piper-sample-generator, so phrase quality is bounded by the
   Piper voices available. Two realistic routes:
   - an English phrase said with Danish accents (augment: generate positives with
     BOTH English and Danish Piper voices speaking the phrase), or
   - a Danish phrase using Danish Piper voices only — works, but fewer voices =
     less augmentation diversity; expect more experimentation.
2. **Train.** `notebooks/basic_training_notebook.ipynb` in the repo (GPU strongly
   recommended; Colab works). The README's own warning applies: the first model
   will probably not be usable — plan for a few iterations over
   `probability_cutoff` and sample counts. Negatives come pre-computed
   (HuggingFace dataset `kahrendt/microwakeword`).
3. **Output:** a quantized streaming `.tflite` + a v2 JSON manifest
   (`{"type":"micro","wake_word":...,"model":"<file>.tflite","micro":{...}}`).
   Host both files anywhere reachable at flash time (a GitHub release on this
   repo is fine — the model contains no secrets).
4. **Load it on the Voice PE** — overlay override in `esphome/podvoice.yaml`
   (`micro_wake_word:` is a single-instance component; overriding `models:` in
   the package merge replaces the stock list; a commented block is in the file):

   ```yaml
   micro_wake_word:
     models:
       - model: https://github.com/BixelVentures/podvoice/releases/download/wake-v1/podvoice_wake.json
         id: podvoice_wake
       - model: stop
         id: stop
   ```

5. **Tune on device.** The "Wake word sensitivity" select (stock firmware entity)
   trades false accepts vs. misses; test at the three positions before touching
   training again.

**[HUMAN] acceptance (unchanged from the task):** one week of family use with
~zero false triggers and reliable activation at conversational volume across the
room. Log every false trigger (panel History timestamps them — a wake with no
following speech = a false trigger).

## Option 2 fallback — server-side openWakeWord

Better detection quality; the cost is always-streaming audio to HA and giving up
the on-device wake gate. **Extra cost specific to PodVoice:** our wake signal
comes from the on-device mww starting a stock VA run. Wake-in-HA means enabling
the HA Assist pipeline's wake stage for the device (firmware supports streaming
wake audio to HA) and letting PodVoice observe the wake — a real integration
change, not a config flip:
- flash: remove/disable `micro_wake_word`, enable "wake word in Home Assistant";
- HA: openWakeWord add-on (Wyoming) + Assist pipeline with wake word on it;
- PodVoice: the `handle_start` wake signal should still fire when the pipeline
  starts (verify on hardware) — if not, subscribe to the pipeline-start event.
Audio never leaves the house (LAN only). Only go here if Option 1 misfires after
a real training effort.

## Option 3 escape hatch — Pi satellite

OHF `linux-voice-assistant` (verified: speaks the ESPHome native API on port
6053, runs openWakeWord **or** microWakeWord on-device, Pi Zero 2 W is a
recommended platform — note the mic HAT matters; the FutureProofHomes Satellite1
HAT has its own XMOS AEC). PodVoice's `VoicePELink` should attach to it mostly
unchanged (same protocol), but the podvoice_audio component and media_player
announce path are Voice-PE-specific — expect adaptation. **Do not buy hardware
unless Options 1 and 2 both fail.**
