# PodVoice

PodVoice is a Home Assistant add-on for voice conversations through a custom-firmware
[Home Assistant Voice PE](https://www.home-assistant.io/voice-pe/). Start with the
[current status](docs/STATUS.md) for the installed version, known limits and open acceptance
gates. Product behavior and measurable goals are in [docs/PRODUKTMÅL.md](docs/PRODUKTMÅL.md).
The [documentation index](docs/README.md) distinguishes current guides, diagnostics,
proposals and historical material; agents start at [AGENTS.md](AGENTS.md).

## How it works

**GPT-Live is the only production conversation engine.** `ThinSession` owns the conversation
for both Voice PE and Talk. Voice PE firmware owns physical wake, microphone forwarding,
playback events and rearm. V2.x targets full-duplex GPT-Live on Voice PE and Talk: the
active conversation keeps listening while it speaks. Native Live already submits input
during playback; audible interruption and acoustic isolation require physical evidence
on the same candidate. Talk is a separate browser I/O adapter. Talk can exercise the shared software engine, but it does not prove the puck's
microphone, speaker, wake, or physical lifecycle.

Home data and actions belong to Home Assistant. PodVoice uses only the connected MCP tools
and other statically admitted adapters available to the current session. PodConnect owns its
music services and physical HomePod playback. Web search depends on the existing Home
Assistant search integration. The live capability and service status in the panel indicate
what the current installation exposes; a configured integration alone is not proof that an
action works end to end.

## Home Assistant panel

Open PodVoice from the Home Assistant sidebar. The panel has Home, Talk, History and Settings
views. Use it to inspect the current connection/readiness state, talk through the browser, and
manage the add-on's available settings. The panel does not provide a simulation mode or a
conversation test wizard. Product and physical acceptance remain separate; see
[docs/STATUS.md](docs/STATUS.md).

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

Follow [docs/UDVIKLINGSFLOW.md](docs/UDVIKLINGSFLOW.md). Create the shared Python 3.12
virtual environment once, outside the synchronized checkout, then reuse it:

```sh
python3.12 -m venv ~/Developer/venvs/podvoice
~/Developer/venvs/podvoice/bin/pip install -r podvoice/requirements.txt -r podvoice/requirements-dev.txt
```

For focused feedback, run one command from the persistent unsynchronized clone, substituting
the affected test module or node:

```sh
PODVOICE_PYTHON=~/Developer/venvs/podvoice/bin/python scripts/dev fast --test tests/path/test_file.py
```

The focused check is development feedback, not release or physical acceptance. The frozen
candidate's official CI and the hardware gates listed in STATUS remain required.

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
