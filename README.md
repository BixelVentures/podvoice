# PodVoice

A standalone voice-AI gatekeeper for a **PodConnect** home, packaged as a **Home Assistant Add-on**.

A custom-firmware [HA Voice PE](https://www.home-assistant.io/voice-pe/) streams mic audio to
PodVoice, which runs a realtime [OpenAI Realtime](https://platform.openai.com/docs/guides/realtime)
conversation (`gpt-realtime-2.1-mini` by default) and **ducks the room's music** through PodConnect's
Attention API while you talk — then restores it when you're done. Dialogue comes out of the Voice PE
speaker; music keeps playing (quietly) on the HomePod underneath. Home control goes through **Home
Assistant's own MCP server on the LAN** — nothing about the house is internet-reachable, and HA's
expose settings are the single permission list.

Current public facts are handled by the home's existing Gemini search agent exposed through Home
Assistant, alongside the other home tools. PodVoice does not install a second competing search
provider.

It is a **sibling** to PodConnect — separate process, separate failure domain, no shared code. They
meet at exactly one contract: PodConnect's `POST /api/attention` (duck) / `/api/attention/release`.
If PodVoice ever crashes, PodConnect's heartbeat TTL auto-restores the volume within ~2 seconds, so
**the music can never get stuck quiet.**

## Why an Add-on (not a plugin inside Home Assistant)
You install it from the HA Add-on Store and configure it in the HA UI — no extra server, no extra
hardware. But unlike a `custom_components` plugin, it runs in its **own container**, so a provider
socket hiccup or VAD confusion can't drag Home Assistant (or your music) down with it. Same
deployment model as PodConnect.

## Status (1.12.10 reliability candidate)
**OpenAI-only, single pipeline.** The Gemini provider, the provider switch, and the hand-rolled HA
REST tool bridge are deleted. What ships now:
- one thin provider module (`openai_realtime.py`) — GPT-Live-1 readiness = a model string + event
  handlers there ([docs/realtime-config.md](docs/realtime-config.md));
- turn-detection **presets** (conservative / responsive / custom) tunable live in Settings — the
  self-interruption fix rides the XMOS AEC + a hard-to-trip `server_vad`
  ([docs/audio-path.md](docs/audio-path.md) maps the audio path and corrects two firmware premises);
- cost control: sessions open only on wake, idle/max-duration caps, per-response token metering and
  `sensor.podvoice_cost_today` / `_month` in HA;
- home control via a **local MCP client** to HA's MCP server (LAN), plus local tools (clock, kitchen
  timers that ring on the device) and the exposed Gemini search agent;
- a panel capability check that shows whether Realtime can actually see web/search and music tools,
  not just whether HA's MCP server is reachable;
- end-phrase fallback (Danish + English) on top of the model-owned `end_conversation` closure.

The direct speaker fix is compiled but deliberately not called delivered until a complete physical
conversation passes. The measurable product and release gates live in
**[docs/PRODUKTMÅL.md](docs/PRODUKTMÅL.md)**.

## Sidebar panel & simulation mode
PodVoice ships a **Home Assistant Ingress sidebar panel** (served on `:8098` — PodConnect owns `:8099`):
per-room state, service health (ChatGPT / Voice PE / PodConnect / Home control), live capability
pills (time / home / web-search / music / timers), the live ducking level, a live transcript, and
controls, plus a `/health` endpoint and live metrics. The **Talk tab** runs the REAL engine with
the browser as a device: the mic button is the wake word and every rule (tools, idle close, echo
shield, goodbye) is the same code path the puck runs.

**Try it with no hardware or keys:** set the add-on option `simulate: true` (or run `python -m gatekeeper`
with it). A built-in scenario driver (`sim.py`) animates the full wake → duck → speak → lounge → release
flow per room so you can watch the panel work before the Voice PE / OpenAI key arrive.

## Develop & test
```sh
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r podvoice/requirements.txt -r podvoice/requirements-dev.txt
ruff check . && ruff format --check . && mypy podvoice/gatekeeper && python -m pytest
```
The core is stdlib/httpx/aiohttp-only and fully unit-tested; the SDK-bound module (`voicepe`)
lazy-imports `aioesphomeapi` and is exercised through fakes, so the whole suite runs without
hardware or API keys.

## The conversation loop (at a glance)
```
IDLE ──wake word / button──▶ ACTIVE (one open conversation: listening and speaking
  ▲                          interleave freely; music ducked; mic streams ONLY now)
  └── "stop"/"det var det"/end_conversation/idle timeout ──▶ music restored, mic off
```

## Components
- `esphome/podvoice.yaml` — the Voice PE firmware overlay (thin `packages:` include of the official firmware + PodVoice's few overrides, incl. the `podvoice_audio` mic transport).
- `gatekeeper/` — the Python asyncio service (engines, OpenAI Realtime client, MCP tool router, Attention client + heartbeat, usage meter, panel).
- `podvoice/` — the HA add-on packaging (`config.yaml`, `Dockerfile`, `run.sh`).
- `config.example.yaml` — OpenAI API key, PodConnect base URL + token, Voice-PE → room map.

## Requires
- Home Assistant (Green or any supervised install) with the **PodConnect** add-on (Speakers ≥ 0.14.0)
  exposing the Attention API on `:8099`, and the **Model Context Protocol Server** integration enabled.
- An HA Voice PE flashed with the custom firmware in `esphome/`.
- An OpenAI API key.
