# PodVoice

PodVoice turns a custom-firmware Home Assistant Voice PE into a hands-free, spoken
assistant that talks back in Danish using Google's Gemini Live AI. When you start
talking, PodVoice politely turns your music down on the HomePod so you can be heard,
runs the conversation, and turns the music back up when you are done. It runs as its
own add-on so a hiccup in the AI or the network can never crash Home Assistant or
leave your music stuck quiet.

## Before you start (prerequisites)

You need three things working first:

1. **The PodConnect add-on**, with its Attention API reachable on port `:8099`.
   PodVoice asks PodConnect to turn the music down and back up; without it the
   conversation still works, but the music will not duck.
2. **A Voice PE flashed with the PodVoice firmware** (`esphome/voice-pe.yaml`).
   The stock firmware will not work — PodVoice needs the custom firmware so it can
   listen continuously. You will set an encryption key (Noise PSK) when you flash it;
   keep that key, you will paste it into PodVoice below.
3. **A Google Gemini API key with Live access** (from Google AI Studio, with billing
   enabled). This is what powers the spoken conversation.

## Installing

1. In Home Assistant go to **Settings → Add-ons → Add-on Store**.
2. Click the **⋮** menu (top right) → **Repositories**, paste the PodVoice repository
   URL, and click **Add**.
3. Find **PodVoice** in the store list and click **Install**. The first install takes
   a few minutes while the container is built.
4. Open the **Configuration** tab. It holds **only the API keys** (everything else is set
   in the panel — see below):
   - **gemini_api_key** — your Gemini API key (for the default Gemini brain)
   - **openai_api_key** — *optional*, only if you want the OpenAI Realtime provider
5. Click **Save**, then go to the **Info** tab and press **Start**.
6. Open **PodVoice** in the sidebar → expand **Settings** → fill in the rest (PodConnect URL +
   token, your Voice PE PSK, rooms, provider/model) → **Save & restart**.

## Settings (in the panel, not the Configuration tab)

Everything except the API keys lives on the panel's **Settings** page (saved inside the add-on, with
a **Save & restart** button). The HA **Configuration** tab is intentionally just the two keys.

| Setting | What it does |
|---|---|
| Provider | Which voice brain — **Gemini** (default, best Danish) or **OpenAI** Realtime. |
| Gemini model / OpenAI model | The default model for each provider. |
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
[PodVoice] OK · lytter · Gemini: forbundet · HomePod-styring: forbundet · sidste svar: 0.34s
```

A steady stream of these `OK` lines means everything is connected and working. If
something is wrong you will see an `ADVARSEL` (warning) line that says what is failing,
for example that the HomePod control is unavailable and the music will not duck.

## The sidebar panel

Once started, PodVoice adds a **PodVoice** item to the Home Assistant sidebar. Open it to see,
per room: the current state (idle / listening / speaking / follow-up), whether the music is
ducked and how far, the last response time, and live connection health for Gemini, the Voice PE,
and PodConnect. There's a live transcript and three buttons per room — **Listen** (start a
conversation as if you pressed the button), **Stop** (end it and restore music), and **Test tone**
(play a sound out the Voice PE speaker to check audio). No secrets are shown here; configuration
still lives in the **Configuration** tab.

### Talk to Gemini from the panel

The panel has a **Talk to Gemini** console — a software stand-in for the Voice PE. Type a message
and Gemini answers out loud (the reply is spoken in your browser) with a live transcript. With a real
Gemini key set it's the real assistant; with `simulate: true` (or no key) it echoes a demo reply.

A **provider dropdown** (Gemini / OpenAI) lets you switch the voice brain, and a **model dropdown**
lists that provider's models. Gemini Live is the default (best Danish, lowest cost); OpenAI Realtime
(`gpt-realtime`) is a stable alternative — to use it, set **`openai_api_key`** in the Configuration tab.
The model dropdown lists the models your key can use.
Real-time **voice needs a *Live* model** (e.g. `gemini-2.5-flash-native-audio-preview-12-2025` or
`gemini-3.1-flash-live-preview`). Ordinary models like `gemini-3.5-flash` have no bidirectional audio,
so they appear as **"text only (no voice)"** and can't be picked for the spoken console. The
`gemini_model` option in Configuration sets the default.

There's also a 🎤 mic button for hands-free voice **in** — but browsers only allow microphone access on
a secure page. If you open Home Assistant over plain `http://…` on your LAN, the mic is disabled
(you'll see a note) while typing + spoken replies keep working. Open HA over **HTTPS / Nabu Casa** (or
`localhost`) and the mic turns on automatically.

## Try it without hardware (simulation)

Set the **simulate** option to `true` and start the add-on. PodVoice will run a built-in demo —
no Gemini key, Voice PE, or PodConnect required — that cycles realistic conversations through the
panel so you can see exactly how it behaves before your hardware arrives. Turn it back to `false`
for real use.

## Troubleshooting

- **The add-on will not start / errors right away.** Check the Log tab. The most common
  cause is a missing or mistyped required field (Gemini key, PodConnect token, Voice PE
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
  ask again. If it happens constantly, check your internet connection and the Gemini
  API key's quota.
- **A warning about the music control keeps appearing.** PodConnect is down or the
  token is wrong. The music will automatically return to its normal volume on its own
  within a couple of seconds — it can never get stuck quiet.

If problems persist, set the add-on log level to debug (if available) and check the Log
tab for more detail. Secrets are always hidden in the logs.
