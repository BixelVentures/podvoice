# PodVoice hardware spikes (S1 & S2)

These two scripts retire the project's existential unknowns the moment you have a
real, custom-firmware **HA Voice PE** on the LAN. They are operational tools, not
part of the add-on. See **[PLAN.md](../PLAN.md) §4.2, §4.5, §12, §13** for context.

## Why they exist
Stock Voice PE firmware only streams mic audio *during a pipeline run*, and the
24 kHz speaker-playback path is unproven. Until these pass, the add-on can't be
fed real audio. **Run these first** when the device arrives.

| Spike | Question it answers | Exit criterion |
|------|----------------------|----------------|
| **S1** `s1_continuous_audio.py` | Can we get gap-free continuous 16 kHz PCM off the device? | ≥10 min, 0 gaps, ~100% continuity ratio; mute zeroes/stops the stream |
| **S2** `s2_playback_latency.py` | Can we play Gemini's 24 kHz dialogue out the speaker, low-latency, no underruns? | <300 ms felt latency, no dropouts, stable alongside S1 |

## Prerequisites
1. Flash the device with `esphome/voice-pe.yaml` (set the `api: encryption: key` Noise PSK).
2. Make sure the device is **NOT added to HA Assist** (PodVoice must be the sole
   voice-assistant client — firmware enforces single-client; see PLAN RX2).
3. Install deps in a Python 3.12 env:
   ```sh
   python -m venv .venv && . .venv/bin/activate
   pip install -r spikes/requirements.txt
   export PODVOICE_NOISE_PSK="<the base64 PSK from secrets.yaml>"
   ```

## Run
```sh
# S1 — then physically trigger the device (button / wake word) while it measures
python spikes/s1_continuous_audio.py --host voice-pe.local --duration 600

# S2 — listen to the speaker; judge promptness + dropouts by ear
python spikes/s2_playback_latency.py --host voice-pe.local --freq 440 --seconds 3

# Stress test: run S1 in one terminal and S2 in another to confirm both hold up together
```

Each script prints a PASS/FAIL verdict (S1) or an operator checklist (S2) and
points you at the fallback mechanism in PLAN.md if it fails.

## After they pass
- S1 tells you which mechanism works (Option A `start_continuous` / C hold-stream
  / B custom streamer). Lock it into `esphome/voice-pe.yaml`, then point
  `VoicePELink` at the real device in the add-on config.
- S2 tells you the playback path (raw-PCM resampler vs URL announce). Confirm
  `VoicePELink.play_pcm` uses it.
- Resolve the `# VERIFY:` markers in `voicepe.py` against what you observed.
