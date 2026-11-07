# PodVoice

PodVoice is a Home Assistant add-on for voice conversations through a custom-firmware
[Home Assistant Voice PE](https://www.home-assistant.io/voice-pe/), and the home of
**PodView**, the wall-screen UI in
[`podvoice/gatekeeper/static/podview/`](podvoice/gatekeeper/static/podview/).
Music and speakers are provided by [PodConnect](https://github.com/BixelVentures/podconnect).

Developers and agents: start with [AGENTS.md](AGENTS.md). It is the whole workflow.

## Requirements and first setup

You need Home Assistant, an OpenAI API key, a Voice PE running the PodVoice firmware, and the
Home Assistant MCP integration for home tools. PodConnect is needed for its music and speaker
services. Voice PE setup and currently accepted versions are described by the release and
status documentation; do not infer physical acceptance from a successful add-on install.

Install PodVoice from the Home Assistant add-on repository and set the OpenAI key in the
Home Assistant add-on configuration. Use PodVoice Settings for connected services and rooms,
using the room identifiers you
will use for devices and optional HA-owned timer endpoints. The timer bridge installation is
separate and is documented below.

## Develop and check

See [AGENTS.md](AGENTS.md) for setup and test commands.

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
