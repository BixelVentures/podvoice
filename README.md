# PodVoice

Start med [docs/STATUS.md](docs/STATUS.md): v1.13.11 er officielt den første fysisk
virkende half-duplex-baseline, mens 10/10-gaten og produktmålet stadig er åbne. Den
bindende samtalekontrakt findes i [docs/INVARIANTER.md](docs/INVARIANTER.md), og alle
menneskelige og agentiske ændringer følger læserækkefølgen i [AGENTS.md](AGENTS.md).

A standalone voice-AI gatekeeper for a **PodConnect** home, packaged as a **Home Assistant Add-on**.

A custom-firmware [HA Voice PE](https://www.home-assistant.io/voice-pe/) streams mic audio to
PodVoice, which runs a realtime [OpenAI Realtime](https://platform.openai.com/docs/guides/realtime)
conversation (`gpt-realtime-2.1` by default; mini is an explicit cost mode) and **ducks the room's music** through PodConnect's
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

HA-owned timers additionally use a small `custom_components/podvoice` bridge inside
Home Assistant. HA owns the countdown; the add-on still owns dialogue and device audio.
A provider connection failure does not move timer ownership into the add-on.

## Status (første virkende half-duplex-baseline)
**OpenAI-only, single pipeline.** The Gemini provider, the provider switch, and the hand-rolled HA
REST tool bridge are deleted. What ships now:
- one thin provider module (`openai_realtime.py`) — GPT-Live-1 readiness = a model string + event
  handlers there ([docs/realtime-config.md](docs/realtime-config.md));
- turn-detection **presets** (responsive / conservative / custom) tunable live in Settings — the
  default uses semantic completion for natural follow-ups, while the half-duplex echo shield
  prevents the puck from feeding its own reply back to Realtime
  ([docs/audio-path.md](docs/audio-path.md) maps the audio path and corrects two firmware premises);
- cost control: sessions open only on wake, idle/max-duration caps, per-response token metering and
  `sensor.podvoice_cost_today` / `_month` in HA;
- home control via a **local MCP client** to HA's MCP server (LAN), HA-owned timers on
  explicitly configured Voice PE/Talk endpoints, and the exposed Gemini search agent;
- a panel capability check that shows whether Realtime can actually see web/search and music tools,
  not just whether HA's MCP server is reachable;
- Realtime-ejet semantisk afslutningsintention; modellen foreslår afslutning på den
  aktuelle tur, mens PodVoice først lukker transporten efter det fysiske slutsvar.

The firmware has exactly one wake owner and never starts a stock Home Assistant Assist run.
The measurable product and release gates live in
**[docs/PRODUKTMÅL.md](docs/PRODUKTMÅL.md)**.

## Sidebar panel & simulation mode
PodVoice ships a **Home Assistant Ingress sidebar panel** (served on `:8098` — PodConnect owns `:8099`):
per-room state, service health (ChatGPT / Voice PE / PodConnect / Home control), live capability
pills (time / home / web-search / music / timers), the live ducking level, a live transcript, and
controls, plus a `/health` endpoint and live metrics. The **Talk tab** runs the REAL engine with
the browser as a device: the mic button is the wake word and every rule (tools, idle close, echo
shield, goodbye) is the same code path the puck runs.

**Try it with no hardware or keys:** enable simulation under the panel's advanced settings
(or run `python -m gatekeeper` with a simulated config). A built-in scenario driver (`sim.py`)
animates the full wake → duck → speak → lounge → release
flow per room so you can watch the panel work before the Voice PE / OpenAI key arrive.

## Develop & test

The fast local feedback loop and the unchanged release gate are described in
[`docs/UDVIKLINGSFLOW.md`](docs/UDVIKLINGSFLOW.md).

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
IDLE ──wake word / button──▶ ACTIVE (one Realtime session; follow-ups stay here)
  ▲                          music ducked; mic streams ONLY now)
  └── Realtime end-intent / timeout / error ──▶ socket closed, mic off, wake rearmed
```

## Components
- `esphome/podvoice.yaml` — the Voice PE firmware overlay plus an auditable vendored
  upstream base. Wake opens only PodVoice's mic channel; stock HA Assist is never started.
- `gatekeeper/` — the Python asyncio service (engines, OpenAI Realtime client, MCP tool router, Attention client + heartbeat, usage meter, panel).
- `podvoice/` — the HA add-on packaging (`config.yaml`, `Dockerfile`, `run.sh`).
- `config.example.yaml` — OpenAI API key, PodConnect base URL + token, Voice-PE → room map.

## Requires
- Home Assistant (Green or any supervised install) with the **PodConnect** add-on (Speakers ≥ 0.14.0)
  exposing the Attention API on `:8099`, and the **Model Context Protocol Server** integration enabled.
- An HA Voice PE flashed with the custom firmware in `esphome/`.
- An OpenAI API key.

## HA-owned timers

Copy this repository's `custom_components/podvoice` directory into Home Assistant's
`config/custom_components/podvoice`. Add the endpoints to `configuration.yaml`, then
restart Home Assistant. Use the exact room key from PodVoice Settings and the Voice PE's
verified MAC address from its device information; the example MAC below is a placeholder.
The browser endpoint uses `talk` for both endpoint and identity.

```yaml
podvoice:
  endpoints:
    - endpoint: kitchen
      name: Kitchen Voice PE
      kind: voice_pe
      identity: "02:00:00:00:00:01" # Replace with your verified device MAC.
    - endpoint: talk
      name: Talk
      kind: talk
      identity: talk
```

The bridge registers its own timer endpoints and uses HA's native intent timer manager.
It does not change the ESPHome device or start stock Assist. The add-on uses its existing
authenticated HA connection; no new credential or public endpoint is needed. Timer tools
appear only after the bridge, endpoint identity and connected adapter agree.

Ask to start, list or cancel a named timer. Each timer has its own ID, including timers
with the same name. An expiry waits for the current reply/conversation to finish, then
plays a brief alarm and returns to normal wake. Ask about or cancel the finished timer
on the next wake. An add-on restart leaves HA countdowns intact; **a Home Assistant Core
restart clears native timers**. Ambiguous starts are never retried automatically. An
interrupted alarm stays recorded until actual stop is confirmed; a different Talk tab
cannot claim that the original tab stopped. Normal integration unload is refused while timers or
unacknowledged expiry receipts remain, so the sole HA expiry handler is not discarded.

Endpoint configuration is imported once into the PodVoice HA integration entry. Editing
YAML alone does not replace that entry. To change endpoints, finish/cancel and acknowledge
its timers first, remove the integration entry, update YAML, then restart HA to import it
again. Core restart clears native timers. The native bridge has been checked against
Home Assistant Core 2026.8.2.
