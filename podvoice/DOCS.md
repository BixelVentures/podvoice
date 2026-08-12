# PodVoice

PodVoice turns a custom-firmware Home Assistant Voice PE into a hands-free, spoken
assistant that talks back in Danish using OpenAI's Realtime API. When you start
talking, PodVoice politely turns your music down on the HomePod so you can be heard,
runs the conversation, and turns the music back up when you are done. It runs as its
own add-on so a hiccup in the AI or the network can never crash Home Assistant or
leave your music stuck quiet.

## Before you start (prerequisites)

You need three things working first:

1. **The PodConnect add-on**, with its Attention API reachable on port `:8099`.
   PodVoice asks PodConnect to turn the music down and back up; without it the
   conversation still works, but the music will not duck.
2. **A Voice PE flashed with the PodVoice firmware** (`esphome/podvoice.yaml`).
   The stock firmware will not work — PodVoice needs the custom firmware so it can
   listen continuously. You will set an encryption key (Noise PSK) when you flash it;
   keep that key, you will paste it into PodVoice below.
3. **An OpenAI API key** (platform.openai.com, billing enabled). This powers the
   spoken conversation (`gpt-realtime-2.1-mini` by default — the cheap one).
4. **Home Assistant's MCP server** — add the "Model Context Protocol Server"
   integration once, and expose the devices, scripts and agents the assistant may
   touch under **Settings → Voice assistants**. That list IS the assistant's permissions.

## Installing

1. In Home Assistant go to **Settings → Add-ons → Add-on Store**.
2. Click the **⋮** menu (top right) → **Repositories**, paste the PodVoice repository
   URL, and click **Add**.
3. Find **PodVoice** in the store list and click **Install**. The first install takes
   a few minutes while the container is built.
4. Open the **Configuration** tab. It holds **only the API key** (everything else is set
   in the panel — see below):
   - **openai_api_key** — your OpenAI API key
5. Click **Save**, then go to the **Info** tab and press **Start**.
6. Open **PodVoice** in the sidebar → expand **Settings** → fill in the rest (PodConnect URL +
   token, your Voice PE PSK, rooms, model) → **Save & restart**.

## Settings (in the panel, not the Configuration tab)

Everything except the API key lives on the panel's **Settings** page (saved inside the add-on, with
a **Save & restart** button). The HA **Configuration** tab is intentionally just the key.

| Setting | What it does |
|---|---|
| Model | `gpt-realtime-2.1-mini` (default, cheap) or `gpt-realtime-2.1` (smarter, ~3× audio cost). |
| Interruption style | **Conservative** (default — the speaker's own voice can never cut a reply off), Responsive, or Custom (raw knobs under Advanced). |
| Close after silence / Max conversation | Cost control: how long a conversation may idle (default 25 s) and run (default 15 min). |
| Always use the mini model | Cost guard — clamps every session (rooms + Talk tab) to the mini model. |
| PodConnect URL | Where PodConnect's Attention API lives. Usually `http://homeassistant.local:8099`. |
| PodConnect token | The secret token that lets PodVoice control the music. |
| Voice PE PSK | The encryption key shared with the Voice PE firmware. |
| Simulation mode | Run the built-in demo with no hardware/keys. |
| Rooms | Pair each Voice PE (`voicepe_host`) with a PodConnect `room` so the right room ducks. |
| Advanced tuning | Duck/lounge levels, lounge window, heartbeat, watchdog, VAD threshold — leave as is unless you know why. |

**Save & restart** writes the settings and restarts the add-on so they take effect (plain **Save**
keeps them but you'd restart the add-on yourself).

## Checking that it is healthy

Open the add-on's **Log** tab. A healthy PodVoice prints a plain-language status line
roughly once a minute, for example:

```
[PodVoice] OK · lytter · ChatGPT: forbundet · HomePod-styring: forbundet · sidste svar: 0.34s
```

A steady stream of these `OK` lines means everything is connected and working. If
something is wrong you will see an `ADVARSEL` (warning) line that says what is failing,
for example that the HomePod control is unavailable and the music will not duck.

## Setting up the Voice PE (when it arrives)

Open the **PodVoice** sidebar → **Voice PE setup**. It walks you through it and gives three
click-buttons so you never need a terminal:
1. Flash `esphome/podvoice.yaml` via the **ESPHome** add-on (set its API encryption key = your PSK).
2. Do **not** add the Voice PE to Home Assistant Assist (PodVoice must own its mic).
3. In **Settings**, enter the PSK and add a room → **Save & restart**.
4. **Check connection** (is it reachable?), **Check audio stream** (continuous-audio test), and
   **Test speaker** (plays a tone — confirm you hear it).

## Home control, web search & music (like Assist)

PodVoice can control your home, run exposed lookup tools, and control music — both in the panel
console and by voice — through the same Home Assistant MCP tool list that OpenAI Realtime receives.

**Home control:** expose the entities and domains in Home Assistant's own Voice Assistant / Assist
settings. PodVoice no longer keeps a separate allowlist. Once exposed through HA/MCP, you can say
things like *"tænd lyset i køkkenet"*, *"sæt varmen til 21"*, or *"tilføj mælk til
indkøbslisten"*.

**Web search:** expose your existing Gemini/search agent or a search script to Assist/MCP. PodVoice
does not add a second competing search provider. The panel shows whether a web/search tool is
actually visible; if it is missing, current facts should fail honestly instead of being invented.

**Music:** PodConnect URL/token are only for automatic ducking while the family talks. Voice music
commands like *pause*, *next*, *play something*, and *skru ned* require media/PodConnect tools to be
exposed through Home Assistant MCP. The panel shows whether a music tool is actually visible.

## The sidebar panel

Once started, PodVoice adds a **PodVoice** item to the Home Assistant sidebar. Open it to see,
per room: the current state (idle / listening / speaking / follow-up), whether the music is
ducked and how far, the last response time, live connection health for ChatGPT, the Voice PE, Home
control (MCP), and PodConnect, plus capability pills for time, home, web/search, music and timers.
There's a live transcript and three buttons per room — **Listen** (start a
conversation as if you pressed the button), **Stop** (end it and restore music), and **Test tone**
(play a sound out the Voice PE speaker to check audio). No secrets are shown here; configuration
still lives in the **Configuration** tab.

### Talk to the assistant from the panel

The panel has a **Talk** tab — a software stand-in for the Voice PE running the REAL engine. Type or
speak and the assistant answers out loud (the reply is spoken in your browser) with a live transcript.
With a real OpenAI key set it's the real assistant; with `simulate: true` (or no key) it echoes a
demo reply. A **model dropdown** and a **voice dropdown** affect only that browser session.
All the selectable models are realtime voice models — there is nothing to get wrong here.

There's also a 🎤 mic button for hands-free voice **in** — but browsers only allow microphone access on
a secure page. If you open Home Assistant over plain `http://…` on your LAN, the mic is disabled
(you'll see a note) while typing + spoken replies keep working. Open HA over **HTTPS / Nabu Casa** (or
`localhost`) and the mic turns on automatically.

## Try it without hardware (simulation)

Set the **simulate** option to `true` and start the add-on. PodVoice will run a built-in demo —
no OpenAI key, Voice PE, or PodConnect required — that cycles realistic conversations through the
panel so you can see exactly how it behaves before your hardware arrives. Turn it back to `false`
for real use.

## Troubleshooting

- **The add-on will not start / errors right away.** Check the Log tab. The most common
  cause is a missing or mistyped required field (OpenAI key, PodConnect token, Voice PE
  host, or Noise PSK). Re-check the **Configuration** tab and Save again.
- **It hears me but the music does not turn down.** PodConnect is probably unreachable.
  Confirm the PodConnect add-on is running, that `podconnect_base_url` is correct
  (usually `http://homeassistant.local:8099`), and that `podconnect_token` matches the
  token configured in PodConnect. The conversation still works at full volume in the
  meantime — by design, PodVoice never blocks talking just because ducking failed.
- **It never responds when I talk.** This is usually the Voice PE link. Confirm
  `voicepe_host` is reachable and that `voicepe_noise_psk` exactly matches the key in
  the Voice PE firmware. Also make sure the Voice PE is **not** added to Home Assistant's
  Assist — PodVoice must be the only thing using its microphone.
- **The reply gets cut off, or there is a short error tone.** PodVoice gave up on a
  slow turn (the watchdog). This is normal protection against a stuck connection; just
  ask again. If it happens constantly, check your internet connection and the OpenAI
  API key's quota.
- **A warning about the music control keeps appearing.** PodConnect is down or the
  token is wrong. The music will automatically return to its normal volume on its own
  within a couple of seconds — it can never get stuck quiet.

If problems persist, set the add-on log level to debug (if available) and check the Log
tab for more detail. Secrets are always hidden in the logs.
