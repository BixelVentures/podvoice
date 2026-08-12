# PodVoice audio ingestion path (Task 0.1 — verified 2026-07-26)

**TL;DR: PodVoice does NOT use the HA Assist/STT pipeline.** Mic audio reaches the
add-on through our own ESPHome external component (`podvoice_audio`), so the Voice PE
26.6.0 "unprocessed audio" feature (which is delivered *through HA's STT interface*)
does **not** apply to us as shipped — but the same channel it exposes **is directly
reachable from our transport** with a one-line firmware overlay change (see §4).

## 1. How mic audio actually flows today

```
XMOS XU316 (AEC → IC → NS → AGC) ──I2S──▶ ESP32-S3 i2s_mics (16 kHz / 32-bit / stereo)
    ch0 = full chain (incl. AGC)             │
    ch1 = same chain WITHOUT AGC             ▼
                      podvoice_audio (passive MicrophoneSource tap, channels: [0, 1],
                      default_channel 1, gain 4, 16-bit truncate, 400 ms PSRAM ring)
                                             │  VoiceAssistantAudio messages over the
                                             ▼  ESPHome native API (port 6053)
                      gatekeeper/voicepe.py `_handle_audio` → asyncio queue
                                             │  16 kHz PCM frames
                                             ▼
                      engine (thin/classic) → StreamResampler 16→24 kHz → OpenAI Realtime WS
```

- Wake-gated: `podvoice_stream_start/stop` (API actions) open/close the forward;
  a 25 s dead-man timer force-stops it if the add-on dies. Audio streams to the
  cloud only between wake and conversation end.
- The stock `voice_assistant` component still exists on the device (it delivers the
  wake signal via `handle_start`), but its own mic streaming to HA is not used.
- Reply audio goes out via the `external_media_player` announce path (HTTP FLAC),
  i.e. through the same mixer → speaker chain the XMOS taps as its echo reference —
  **so the hardware AEC stays correct for everything we play.**

## 2. Which XMOS stages apply to our stream

Verified against `voice_kit` in home-assistant-voice-pe @ 26.6.0
(`channel_0_stage: AGC`, `channel_1_stage: NS` are the defaults; the Voice PE YAML
does not override them; unchanged across 25.12.4 → 26.6.0):

| I2S channel | XMOS processing | Who consumes it | PodVoice reachable? |
|---|---|---|---|
| **0** | AEC + Interference Canceller + Noise Suppression + **AGC** (full chain) | HA STT (classic), PodVoice fallback/diagnostic | yes — runtime-selectable |
| **1** | AEC + IC + NS, **no AGC** (quieter — mww compensates with `gain_factor: 4`) | micro_wake_word; HA STT *optionally* since 26.6.0; **PodVoice default** | yes — runtime-selectable, default `channel=1`, `gain=4` |
| (raw) | none — pre-AEC | nobody by default | only by overriding `voice_kit: channel_X_stage: NONE` (reflash) |

**Correction to the task premise:** the field notes calling channel 0 "not
echo-cancelled" (0.83/0.85 changelog) are wrong per upstream source — **both**
channels are AEC-processed; what the 26.6.0 release notes call "unprocessed" is
only *AGC-less*, not raw. The echo the 0.83 test heard was **residual** echo past
the AEC (AGC re-amplifies it, and our announce path adds none of its own risk).
That residual is exactly what server-side turn detection misread as barge-in —
which is why Phase 1 tunes turn detection (conservative preset: `server_vad`
threshold 0.45 with 800 ms prefix padding) instead of fighting the AEC. The 0.87 finding "channel 1 is mute
for STT" is also explained: we tapped ch1 with `gain_factor: 1`; without AGC it
needs gain ≈ 4 (micro_wake_word uses exactly that).

## 3. The 26.6.0 "unprocessed audio" feature — what it actually is

- The real PR is **esphome/home-assistant-voice-pe#591** ("Add second mic to voice
  assistant with audio not passed through AGC", merged 2026-05-21, in firmware
  26.6.0). The task file's reference, **PR #555, is a one-line typo fix** — nothing
  to adopt there.
- Mechanism: `voice_assistant:` now takes up to two microphone sources; the device
  sets `FEATURE_MULTI_CHANNEL_AUDIO` and streams ch0 as `data` and ch1 as `data2`
  in the same `VoiceAssistantAudio` message. **HA ≥ 2026.6** picks `data2` only
  when the active STT engine declares it prefers no AGC/no NS. No select, no
  switch, no new entity.
- Because PodVoice bypasses HA's STT pipeline, none of that selection logic runs
  for us. Our `_handle_audio(data, data2)` already receives `data2=None` (our
  component forwards a single channel).

## 4. How PodVoice reaches each Phase-1.4 matrix row

| Matrix row | Change needed | Effort |
|---|---|---|
| Documented PodVoice baseline: AGC-less XMOS channel 1 + default/tuned turn detection | current firmware exposes both channels; add-on re-applies `mic_channel=1`, `mic_gain=4`, `openai_noise=off` on every connect | none after 1.12.18 |
| XMOS-processed fallback: channel 0 (AEC+NS+AGC) | Settings/API service sets `mic_channel=0`; useful only as a diagnostic if the room disproves the baseline | no flash |
| Truly raw (pre-AEC) — diagnostic only | additionally `voice_kit: channel_1_stage: NONE` in the overlay → reflash | 10 min + flash |
| Processed + software AEC in the add-on | do NOT build preemptively (task rule) | — |

Remember: **an AGC-less channel is quieter** — if OpenAI stops detecting speech on ch1,
fix the documented gain first. Do not silently return to high gain or double-processing:
the add-on log must show `mic tuning applied (channel=1 gain=4)` and
`openai_noise=off` before a physical ASR result counts.

## 5. Consequences for the rest of the overhaul

- The XMOS AEC is an asset and applies to both PodVoice input channels. The shipped
  ASR baseline is channel 1 (AEC/IC/NS without AGC) + gain 4. OpenAI noise reduction
  is off on this already-filtered source, avoiding a second noise-suppression pass.
- Talk is deliberately different: browser AEC stays on, browser NS/AGC are requested
  off, and OpenAI `far_field` is the single noise pass. It targets 24 kHz directly;
  actual browser track/context settings are logged.
- The echo shield in the thin engine (mic gated while the device announces) remains
  the shipped default; `full_duplex: true` disables it and leans on AEC + the
  conservative preset — promoted only if the 1.4 matrix passes.
- Sources: home-assistant-voice-pe 26.6.0 release + `home-assistant-voice.yaml` @
  26.6.0; `voice_kit` component source; esphome `voice_assistant`/`api.proto` @ dev;
  home-assistant core `esphome/assist_satellite.py` @ dev; PR #591 / #555.
