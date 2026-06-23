# Changelog

## 0.14.1

- **Home control now shows WHY it's empty.** When no entities load, the picker surfaces the actual
  Home Assistant error (e.g. auth/connection) instead of a generic message — so an unreachable
  HA core API is diagnosable. `/api/ha/entities` returns an error string when home tools are off.

## 0.14.0

- **Settings split per provider — Gemini vs ChatGPT (OpenAI) — with the key tuning knobs to test.**
  - **Gemini (Live):** model, voice, VAD start/end sensitivity, prefix padding, silence ms.
  - **ChatGPT (OpenAI Realtime):** model, voice, turn detection (Semantic/Normal/Disabled),
    eagerness (semantic), threshold (normal), prefix padding, silence ms, noise reduction
    (near/far/off).
  Wired end-to-end: Gemini VAD → `realtime_input_config` (applied defensively, never breaks
  connect); OpenAI knobs → the `session.update` turn_detection + noise_reduction. Both the
  console and the room pipeline use them. Ducking/tuning kept in its own block.

## 0.13.0

- **Seamless session resume (no more mid-conversation drops/reloads).** `GeminiLiveSession.events()`
  now transparently reconnects on the server's `go_away` (Live session time cap) OR a dropped
  socket, using the stored resumption handle (make-before-break), with bounded backoff — the
  consumer's stream never ends. This is in the SHARED session layer, so it works in BOTH the
  in-panel Talk console AND the Voice PE room pipeline. The orchestrator no longer double-
  reconnects on go_away (events() owns it). The console WebSocket already pings (heartbeat=20s)
  so the Nabu Casa tunnel won't recycle an idle connection.

## 0.12.1

- **Home control picker redesigned.** It was being squeezed into the 2-column settings grid (broken layout). It's now its own full-width section: a heading with a live “N groups · M entities allowed” counter, **Allow whole groups** chips, an **Or pick individual entities** search + scrollable list grouped by room (two-line rows: name + entity_id, domain-covered rows greyed “via group”), and a collapsed manual field. Friendlier empty state.

## 0.12.0

- **Live selectors instead of typed/hardcoded ids.** Settings now reads the real data:
  - **Home control** is a live picker over your actual HA entities (grouped by Area) + domain
    chips derived from what you really have — tick a domain or individual entities. Search box;
    a collapsed manual field remains for ids HA hasn't loaded.
  - **Rooms → room** is a dropdown populated from PodConnect `GET /api/rooms` (real room ids/
    names) instead of typing `r0`. Falls back to a text field if PodConnect is unreachable.
- New read-only panel endpoints: `GET /api/ha/entities` (entities+areas+domains) and
  `GET /api/podconnect/rooms`. The saved `exposed` format is unchanged (domains + entity_ids).

## 0.11.1

- **Home control is now a multiselect.** Tick domain chips (light, media_player 🎵, scene, climate, cover, vacuum, …) to expose them, plus a text field for specific entity_ids. Saved value is unchanged (a list of domains/entity_ids).

## 0.11.0

- **PodVoice no longer embeds any PodConnect/music logic.** Removed the `music` tool and all the
  Control-specific machinery (search_media→play_media stitching, room→media_player mapping, the
  per-room media_player setting/UI). PodVoice is just Gemini voice + GENERIC Home Assistant
  access: `list_home`, `list_services`, `home_call`, plus the curated convenience tools.
- Music/speakers (PodConnect Control), a vacuum, a fan, … are now reached the SAME generic way
  (`list_services` + `home_call`) — like any HA device. Any nicer 'play X' belongs in PodConnect's
  own API, not here.
- PodVoice's only PodConnect contact remains the Attention duck (orchestrator/health), unchanged.

## 0.10.0

- **One clean music integration.** Replaced the three overlapping surfaces (generic `podconnect`
  HTTP passthrough, `play_music`, and curated `media_control`/`set_volume`) with a SINGLE
  `music` tool: action = play (query/uri) | pause | resume | stop | next | previous | volume,
  targeting the room's PodConnect Control media_player via standard HA services.
- **PodVoice no longer speaks PodConnect's own HTTP interface.** Its only PodConnect contact is
  the Attention duck (orchestrator/health) — the sanctioned contract. The `podconnect` raw
  passthrough tool is removed.

## 0.9.1

- **`play_music` now search-and-plays correctly.** PodConnect Control's `play_media` expects a
  Spotify URI, not free text — so a query is first resolved via `media_player.search_media`
  (plays the best-ranked result[0]). An exact `uri` skips the search. (0.9.0 sent raw text to
  play_media, which Control couldn't resolve.)

## 0.9.0

- **Fix: “play <song>” now actually plays that song, on the right speaker.** Play-by-name used to
  hit PodConnect `POST /api/play?query=`, but PodConnect (go-librespot) can only *resume* the
  last track — so it un-paused random old music on every HomePod (and returns 400 since
  Speakers 0.19.0). New **`play_music`** tool routes content selection through Home Assistant
  (`media_player.play_media`) on the room's PodConnect **Control** entity (Spotify Web API),
  targeting ONE speaker; accepts a free-text query or an exact `uri`.
- PodConnect is now used ONLY for local transport/volume/duck (stop, resume, volume, attention);
  its tool description forbids play-by-query.
- **Settings → Rooms** gains a per-room **media_player** field (the Control entity for that
  speaker). Configured room players are implicitly allowed.

## 0.8.1

- **Quieter log**: the add-on Log tab no longer drowns in `GET /api/status` polling lines
  (aiohttp access log set to WARNING) — meaningful events (settings saved, errors) stand out.
- **Cleaner model list**: translate/tts-only Live models (e.g. `*-live-translate-preview`) are no
  longer offered as chat voices.

## 0.8.0

- **Voice picker in Talk**: choose the TTS voice right next to provider/model, switch live to
  A/B them, and it's **saved** (per provider). Find your favourite Danish-sounding voice by ear.
- Provider/model/voice choices all persist to settings (the saved model stays selected on reload).

## 0.7.1

- **Service discovery**: new `list_services` tool lets the assistant see each exposed domain's
  services + parameters (e.g. a vacuum's room/segment cleaning, fan speed, mop/water mode) and
  run them via `home_call`. Unlocks advanced device control without hardcoding (e.g. Roborock).

## 0.7.0

- **Fix: the conversation now continues across turns.** The Gemini reader re-enters
  `session.receive()` after each turn, so it no longer goes silent after the first reply or a
  tool call.
- **Roborock & everything else:** new generic `home_call(domain, service, entity_id)` tool
  (allowlist-gated) covers vacuum/fan/lock/humidifier/… now and future — not hardcoded.

## 0.6.2

- Picking a provider/model in Talk now **live-syncs** the Settings → Advanced model field
  (no longer stale until reload).
- **Reset** button on the System prompt restores the built-in capability-aware default.

## 0.6.1

- Talk tab: model dropdown now lists **voice-capable models only** and is width-capped so a long
  name can't stretch the layout. Picking a provider/model now **persists** as the default
  (saved to settings).

## 0.6.0

- **Editable system prompt** (Settings) — a capability-aware default tells the assistant who
  it is and what it can do (home + music + tools), so it can answer “hvad kan du?” and never
  goes silent. Edit it freely (copy/paste) and Save & restart.

## 0.5.0

- **Tabs**: the panel is now Talk / Status / Settings / Voice PE — no more long scroll.
- **Voice selector**: pick the Gemini / OpenAI voice (Advanced).
- **Tool calls show inline** in the conversation (e.g. “🔧 podconnect ✓”) — no separate test field needed.
- Fixed dropdown width so long model names no longer stretch the layout.

## 0.4.0

- **Home control & music (like Assist).** The assistant can now control Home
  Assistant — lights, switches, scenes, climate, covers, media transport/volume, to-do —
  gated by an **allowlist** you set in Settings ("Home control"), and it works in the panel
  console too. Plus a **generic PodConnect** tool: full access to PodConnect's API (play/pause/
  volume/etc.) — current and future features, nothing hardcoded.

## 0.3.2

- **Cleaner, simpler panel.** Gemini replies now coalesce into one bubble per turn
  (no more fragment-per-line). The duplicate/contradictory "Rooms" boxes are gone —
  hardware-only sections (Rooms, room transcript) hide until you add a room. The console
  moved up; model fields moved into Advanced. Stale "set in the add-on Configuration"
  text removed.

## 0.3.1

- Service health dots are now meaningful without rooms: PodConnect is actively pinged
  (GET /api/attention) every 30 s, and the Gemini/OpenAI dot reflects whether the active
  provider's key is set. (Previously the dots only lit up as a side effect of a ducking call.)

## 0.3.0

- **Voice PE setup in the panel** — a "Voice PE setup" section with a guided checklist and
  three click-buttons (no terminal): **Check connection**, **Check audio stream** (the S1
  continuity test), and **Test speaker** (the S2 tone). The old CLI spikes still exist for
  power users.

## 0.2.0

- **Pluggable voice brain** — choose **Gemini Live** (default; best Danish, lowest cost)
  or **OpenAI Realtime** (`gpt-realtime`) from the panel.
- **Sidebar panel** restyled to match PodConnect (light/translucent, adapts to dark).
- **Talk to Gemini** console in the panel — type and hear spoken replies with a live
  transcript; mic auto-enables on a secure origin (HTTPS / Nabu Casa / localhost).
- **Provider + model selectors** in the console; voice-capable models flagged.
- **Simplified setup** — the Configuration tab now holds **only the API keys**
  (`gemini_api_key`, optional `openai_api_key`). Everything else (provider, models,
  PodConnect URL/token, Voice-PE PSK, rooms, tuning, simulation) is on the panel's
  **Settings** page with one-click **Save & restart**.
- **Simulation mode** — watch the full duck → speak → lounge → release flow with no
  hardware or keys.
- Live status, ducking meter, transcript, controls, metrics, and `/health` in the panel.

## 0.1.0

- Initial release: gatekeeper service, HA add-on packaging, custom Voice PE firmware
  sketch, and the S1/S2 hardware spikes.
