# PodVoice & PodView

A voice assistant and a wall screen for Home Assistant.

- **PodVoice** is a Home Assistant add-on that turns a
  [Home Assistant Voice PE](https://www.home-assistant.io/voice-pe/) (with custom firmware) into a
  full-duplex conversational assistant powered by OpenAI's realtime models. It controls your home
  through Home Assistant and shows answers on screen.
- **PodView** is the wall-screen app served by the add-on: music, radio, robot vacuum, lights,
  recipes, timers, weather, car and the assistant's answers, in one touch interface.

Music and speakers come from [PodConnect](https://github.com/BixelVentures/podconnect).

## Features

| Area | What you can do |
|---|---|
| Music | Browse moods and suggestions, play, pause, skip, seek, change volume, see the queue, move music between speakers |
| Radio | Pick a station and play it on any speaker |
| Robot vacuum | See status and battery, clean selected rooms, pause, resume, send to base, change cleaning options |
| Lights | Turn rooms and lamps on/off and dim them |
| Recipes | Browse your recipes, check off ingredients, follow the steps |
| Timers | Start, adjust and stop timers, also by voice |
| Weather, car | Current weather and forecast; car battery and range |
| Assistant | Talk to the Voice PE or in the browser; answers appear as cards on the screen |

## Requirements

Home Assistant, an OpenAI API key, a Voice PE with the firmware in [`esphome/`](esphome/),
and Home Assistant's Model Context Protocol Server integration. PodConnect for music.

## Install

1. Settings → Add-on Store → ⋮ → Repositories → add `https://github.com/BixelVentures/podvoice`.
2. Install **PodVoice**, set your OpenAI key in the add-on configuration and start it.
3. Open **PodVoice** in the sidebar and connect your services and rooms.
4. Optional: install the **PodVoice** integration through HACS for Home Assistant–owned timers
   and wall-screen pairing.

More in [podvoice/DOCS.md](podvoice/DOCS.md).

## Development

See [AGENTS.md](AGENTS.md): describe the user outcome, write a failing test, fix it in the
layer where it happens, keep it green. Acceptance per feature: [docs/BRUGERHISTORIER.md](docs/BRUGERHISTORIER.md).

```sh
npm ci && npm run dev -- --host 127.0.0.1 --port 4173   # PodView preview with sample data
```
