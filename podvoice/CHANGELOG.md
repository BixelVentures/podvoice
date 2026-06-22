# Changelog

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
