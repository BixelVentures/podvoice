# PodVoice

A standalone voice-AI gatekeeper for a **PodConnect** home, packaged as a **Home Assistant Add-on**.

A custom-firmware [HA Voice PE](https://www.home-assistant.io/voice-pe/) streams raw audio to
PodVoice, which runs a full-duplex [Gemini Live](https://ai.google.dev/gemini-api/docs/live-api)
conversation and **ducks the room's music** through PodConnect's Attention API while you talk — then
restores it when you're done. Dialogue comes out of the Voice PE speaker; music keeps playing
(quietly) on the HomePod underneath.

It is a **sibling** to PodConnect — separate process, separate failure domain, no shared code. They
meet at exactly one contract: PodConnect's `POST /api/attention` (duck) / `/api/attention/release`.
If PodVoice ever crashes, PodConnect's heartbeat TTL auto-restores the volume within ~2 seconds, so
**the music can never get stuck quiet.**

## Why an Add-on (not a plugin inside Home Assistant)
You install it from the HA Add-on Store and configure it in the HA UI — no extra server, no extra
hardware. But unlike a `custom_components` plugin, it runs in its **own container**, so a Gemini socket
hiccup or VAD confusion can't drag Home Assistant (or your music) down with it. Same deployment model
as PodConnect.

## Status
**Gatekeeper service implemented** (Phases 0/3/4/5 in code): state machine, Attention client +
heartbeat, 0-byte gate, lounge VAD, watchdog + barge-in, Gemini Live client, Voice PE link, HA tool
bridge, add-on packaging, and CI. **108 unit + integration tests pass; ruff + mypy clean.**

Still hardware/SDK-gated (Phases 1/2 spikes — see [PLAN.md](PLAN.md) §4, §13): the custom ESPHome
firmware's continuous-audio mechanism (**S1**) and the 24 kHz speaker-playback path (**S2**), plus
verifying the live `google-genai` / `aioesphomeapi` / Gemini-model specifics (every such point is
marked `# VERIFY:` in the code). See **[PLAN.md](PLAN.md)** for the full architecture and roadmap.

## Develop & test
```sh
python -m venv .venv && . .venv/bin/activate
pip install -r podvoice/requirements-dev.txt
ruff check . && ruff format --check . && mypy && pytest
```
The core (`state`, `audio`, `podconnect`, `heartbeat`, `gatekeeper`, `watchdog`, `config`) is
stdlib/httpx-only and fully unit-tested; the SDK-bound modules (`gemini`, `voicepe`) lazy-import their
SDKs and are exercised through fakes, so the whole suite runs without hardware or API keys.

## The conversation loop (at a glance)
```
IDLE ──wake word / button──▶ LISTENING ──Gemini replies──▶ AI_SPEAKING ──done──▶ LOUNGE_WINDOW
  ▲                          duck → 5%        hold 5%         (music → 35%, mic gate shut)
  └──────── release (music restored) ◀── "tak"/"stop"/timeout ──┘   │
                                                                     └── user speaks → back to LISTENING
```

## Components
- `esphome/voice-pe.yaml` — custom Voice PE firmware (continuous raw PCM, on-device wake word, button event).
- `gatekeeper/` — the Python asyncio service (state machine, Gemini Live client, Attention client +
  heartbeat, 800 ms watchdog, barge-in, HA tool bridge).
- `podvoice/` — the HA add-on packaging (`config.yaml`, `Dockerfile`, `run.sh`).
- `config.example.yaml` — Gemini API key, PodConnect base URL + token, Voice-PE → room map.

## Requires
- Home Assistant (Green or any supervised install) with the **PodConnect** add-on (Speakers ≥ 0.14.0)
  exposing the Attention API on `:8099`.
- An HA Voice PE flashed with the custom firmware in `esphome/`.
- A Google Gemini API key with Live API access.
