# Changelog

## 0.40.0

- **Ducking & tuning moved to the Voice PE tab.** Duck/lounge levels, lounge window, heartbeat, watchdog and VAD threshold now live under Voice PE (they only affect the per-room Voice PE flow, not the Talk console). Settings is now purely the assistant. IDs unchanged — config preserved.

## 0.39.0

- **Voice PE Gate 2 (Audio stream) now reads the LIVE room session** instead of opening a competing voice_assistant subscription. The device allows only one VA subscriber; the running session owns it, so the old standalone probe was rejected and falsely reported "No audio received" even while the device streamed gap-free. S1 health now comes from the session's actual frame reception (frames_in/bytes/age).

## 0.38.0 — Gemini native-audio: don't give up on a lookup without trying

Fixes a regression from 0.35.0 on the Gemini 2.5 Flash **Native Audio** model: asked "hvordan gik Canada-kampen i går?", it answered "Det kan jeg desværre ikke slå op her." **without calling `list_services` at all** — while the same prompt on OpenAI correctly ran `list_services` → `home_call`. Gemini's tool wiring is fine (it calls `list_home` for device status); the weaker native-audio model just took the 0.35.0 "no service available" escape hatch as a first response instead of doing the two-step web lookup.

- **The give-up line is now gated behind an actual `list_services` call.** The prompt requires looking up in `list_services` and calling a relevant service FIRST (a web/sports question → a search/conversation service), and forbids saying "Det kan jeg ikke slå op her" until it has actually checked and found nothing. No assuming up front that the service doesn't exist, no skipping the lookup. Memory-based answers for current facts remain forbidden.

Note: native-audio Gemini is weaker at multi-step agentic tool use, so this raises reliability but isn't a guarantee — a single-step web-search shortcut (partially reverting 0.27.0's "web search is just generic HA access") remains the bulletproof option if needed.

## 0.37.0 — wake-gated full-duplex Voice PE + LED feedback (5-expert design)

Re-architects the Voice PE firmware so the device streams audio ONLY between wake and grace-expiry (privacy + cost) while keeping TRUE full-duplex barge-in during the conversation. Minimal firmware; the brain stays in PodVoice.

- **Wake-gated mic.** The device boots with forwarding OFF. PodVoice opens it on wake (IDLE→LISTENING) and closes it on every return to IDLE (closure / grace timeout / error). It stays open continuously through the assistant's reply + grace, so you can interrupt by speaking (full-duplex via channel-0 XMOS AEC).
- **Dead-man safety stop.** The device force-stops the mic if PodVoice stops re-asserting for ~25s (crash / half-open socket), so the mic can never be left streaming. PodVoice keepalives every 10s while active.
- **LED ring feedback.** PodVoice drives the stock ring over the native API from a pure state→LED map: idle=off (privacy), listening=cyan, speaking=green, grace=dim cyan, muted=red, error=red blink. (The stock voice_assistant LED phases are dead under use_wake_word:false.)
- **Reconnect-safe.** On every (re)connect PodVoice re-asserts the correct stream + LED for the live state, so a reconnect never leaks audio nor leaves the ring stuck.
- Firmware deltas are tiny: boot-OFF default + the safety timer + two native-API services (podvoice_stream_start/stop). Still UNVALIDATED on hardware — new gates added (privacy gate, safety stop, LED states) to the runbook.

## 0.36.0 — OpenAI Realtime: fix double transcript + instrument the turn state machine

Targets two reported symptoms on the OpenAI/ChatGPT provider (not the prompt; Gemini's native-audio tool-discovery miss is tracked separately).

- **Double "you" transcript fixed.** `openai_realtime.py` emitted `InputTranscript` on **both** `conversation.item.input_audio_transcription.delta` and `.completed`; the console renders one bubble per event (no accumulation), so each utterance showed twice. We now emit only on `.completed` (the authoritative final transcript). Output transcript path unchanged.
- **Turn state machine instrumented (diagnostic).** To find the cross-wired answers ("Hvem scorede?" → "Summen er 137") and the stalls, every turn transition now logs at INFO: `response.created` (id + active/pending), `response.done` (id + **status** + whether it fired the deferred create or ended the turn), tool-calls (name/call_id/response), barge-in clears, and tool-result submit (defer vs. create-now). A first-audio check emits `turn: ANSWER CROSSING …` when a response speaks audio whose id doesn't match the current response — the smoking gun for answers landing on the wrong turn. Logging is once-per-turn (not per audio frame) and can be trimmed once the root cause is pinned.

## 0.35.0 — realtime voice prompt overhaul (10-expert research + adversarial red-team)

Rewrote the default Danish system prompt (`SYSTEM_PROMPT_DA`) from a ~1.5 KB note into a structured, sectioned realtime-voice prompt. Built by a 10-expert research pass (realtime/Gemini-Live, voice-UX, Danish localization, HA tooling, music, knowledge/QA grounding, safety, prompt structure, accessibility, latency) and hardened by a 5-reviewer adversarial red-team (35 issues fixed). Every result-contract claim was validated against `ha_tools.py` before shipping; the canonical fallback phrases in `constants.py` are preserved verbatim (tests green).

- **Anti-drift Danish, strengthened.** Positive "umiskendeligt rigsdansk" lock with a danico word-pair checklist (noget/meget/findes/igen/kun/hvad/hvordan/godt…) and a radioavis self-check on every word. Foreign-language tool `summary` strings are now translated before speaking instead of echoed verbatim — closing a real drift path. Proper names (song titles, brands, rooms, scenes) and names containing digits (Blink-182, U2) are exempt from translation and the numbers-as-words rule.
- **Realtime-native behavior.** Explicit barge-in handling (stop, listen, don't repeat, don't apologize), a turn that mixes an instant action + a slow lookup ("Slukket — vejret tjekker jeg"), and barge-in during a sensitive confirmation cancels the pending action.
- **Latency-shaped speech.** Instant local actions = do-then-confirm (no leading filler); slow lookups = short acknowledgement first, then silence until the result. Numbers, times, prices, years spoken as Danish words for correct TTS.
- **Tool-contract aligned to the real result shape.** The internal `summary:"Done."` action sentinel is never spoken (fixed Danish receipt used instead); `empty:true` success is reported as a fact, not a failure; `error_kind:"denied"` gets a distinct "not set up yet" line; a human-readable `error` (e.g. `intent_error` from a failed search/conversation agent) is relayed briefly in Danish, otherwise the generic fallback; never read ids/JSON/field-names aloud; relative volume routed through `list_services` rather than a guessed percentage.
- **Knowledge grounding.** Replaced temporal trigger-words with a content test — anything with a holder/record/price/latest-version/changing count is looked up even when phrased timelessly; no-service-available means "I can't check that here", never a hallucinated answer; calibrated uncertainty (round or hedge rather than a crisp-wrong number); spoken answers capped to one sentence / two facts.
- **Safety re-tiered by reversibility + blast radius.** Confirm-before only for hard-to-undo / security / money / privacy actions (unlock, garage, alarm-OFF, calls, messages, deletes, purchases, large/low heating changes); arm/lock/close and small heat nudges stay instant. Shared-speaker guard: unlock/alarm-off/call/purchase require a full unambiguous "yes" to the actual question; private content is summarized in one word and read aloud only on explicit yes.

## 0.34.0 — review follow-ups (3 owner-approved design calls)

- **Failed agents are reported as failures.** When a conversation/search agent errors (`response_type=='error'`) the call now returns `ok:false, error_kind:'intent_error'` (so Status no longer counts it as success) while keeping the agent's message so the assistant can relay it. Prompt updated to speak the `error` text when present.
- **Service catalog self-heals.** The `/services` catalog is now re-fetched after ~10 min (and immediately after a 404), so adding/removing an integration mid-session no longer leaves return_response auto-correct or list_services stale until restart.
- **Exposing an entity enables its domain's data services.** Account-level calls (no entity_id, e.g. listening history) are now allowed if you've exposed the bare domain OR any entity of it — no more confusing denials when you exposed the speakers by entity.

## 0.33.0 — hardening from a 20-agent adversarial review

Fixes for real edge cases found reviewing 0.30-0.32 (false alarms discarded):

- **P0 — turn no longer ends before the tool answer is spoken (OpenAI).** The function-call `response.done` was emitting `TurnComplete`, so the state machine ended the turn / shut the duck gate BEFORE the deferred reply spoke. We now fire the deferred `response.create` and suppress that premature `TurnComplete`; the spoken reply's own `response.done` is the real end-of-turn.
- **P0 — barge-in no longer resurrects the interrupted answer (OpenAI).** Interrupting a deferred tool turn now clears the pending follow-up, so it stops instead of speaking what you cut off.
- **P1 — falsy data no longer mislabeled empty.** A real `0`/`false`/`""` from a data service is kept as data; only genuinely-empty containers/None are flagged `empty`.
- **P1 — explicit return_response is never silently dropped.** A stale/incomplete `/services` catalog can no longer override an explicit `return_response=true` (was re-triggering the 0.30 data-loss bug).
- **P1 — OpenAI session state resets on (re)connect/disconnect**, so a dropped socket can't poison the next session (stuck-silent or spurious reply).
- **P1 — mic barge-in now stops browser playback** in the Talk console (the console forwards the interrupt and flushes scheduled audio instead of talking over you).
- **P2 — mixed-case domain guesses resolve** (domain/service lowercased so the gate, auto-correct and the call URL agree). **P2 — speech-summary promotion requires HA's `response` wrapper** (no promoting arbitrary data as the spoken answer).
## 0.32.0

- **OpenAI Realtime: the assistant now actually speaks the tool result.** Fixed a race where, after a tool call, PodVoice asked OpenAI for a reply (`response.create`) while the function-call response was still active — Realtime rejects that, so the model stayed silent ("searches but never returns", worst on chained calls like the music/history question). We now submit the tool output immediately but DEFER `response.create` until the active response finishes. Gemini was unaffected.

## 0.31.0

- **All Voice PE hardware settings live in the Voice PE tab now.** Moved PSK, Simulation mode and Rooms out of Settings into a "Setup" section on the Voice PE tab (with its own Save & restart), so everything about the device — setup + the 3 hardware gates — is in one place. Settings is now just the assistant (provider, prompt, ducking, home control, advanced tuning).

## 0.30.0 — tool-access architecture (5-expert consensus)

Root cause of "home_call ✓ but the assistant still says it can't": a tool-RESULT contract problem. Fixed generically in ha_tools.py, below the provider split, so Gemini and OpenAI behave identically.

- **One flat result contract.** Every home_call/tool result is now `{ok, summary?, data}` on success (`empty:true` when no data), `{ok:false, error_kind, status?, error, hint}` on failure. The model reads the spoken answer from `summary` and structure from `data` — one predictable place, no digging.
- **Generic speech-envelope normalizer.** A shape-driven (never service-named) helper promotes HA's intent/assist speech (`response.speech.plain.speech`) to `summary`; every other payload (track lists, search results) passes through unchanged under `data`. This is what makes conversation.process / web search actually get read aloud.
- **Authoritative discovery.** list_services now surfaces per-field `required` and a tri-state `response_mode` (none/optional/only); home_call auto-corrects the return_response flag from it (forces it for response-only services, drops it for none) — so a guessed flag or a hallucinated service can't 400.
- **Honest, classified errors + observability.** Failures carry error_kind/status/hint; one INFO log line per tool call (secrets redacted) and ok/empty/error counters on the Status tab.
- **Prompt: generic, not locked.** Removed per-service syntax; the model is told to discover via list_services and to only say it can't when a tool actually fails (ok:false).
- **Console UX.** Labels by active provider (Gemini/ChatGPT) instead of always "Gemini"; each tool call shows a collapsed raw-result body so a green check next to a refusal is diagnosable.

## 0.29.0

- **Listening-history questions now point at the right tool.** "What did I play / my top tracks" now go to PodConnect Control's data services (`podconnect.recently_played`, `top_tracks`, `liked`) via `home_call` with return_response — not `media_player.browse_media` (which isn't a history service and 400s). The cleanup did NOT change the return_response request path (verified in git); only error wording.

## 0.28.0

- **Generic web search reaches the model — and HA errors are now honest.** The assistant now correctly calls `conversation.process` via `home_call`. Two fixes: (1) `home_call` surfaces HA's actual error body (a 400 now says e.g. "required key not provided @ data['text']") instead of a bare status code, so the model can self-correct and we can debug; (2) the default prompt names the two fields (`text` = the question, `agent_id` = the search agent) so the call is well-formed first try.

## 0.27.0

- **Web search is no longer special — it's just Home control, like PodConnect.** Removed the bespoke `web_search` tool, the `Search agent` setting, the `Web search` toggle and all provider-native search (Gemini google_search / OpenAI web_search). Live/web questions now go through the SAME generic path as everything else: expose a conversation agent that has Google Search on (e.g. `conversation.google_ai_search`) in Home control, and the assistant calls `conversation.process` via `home_call` with return_response — exactly like `podconnect.top_tracks` or `media_player.play_media`. The default prompt now points at the search agent in natural language. One mental model, nothing to misconfigure.

## 0.26.0

- **Panel never caches stale UI.** The panel HTML is now served with `Cache-Control: no-store`, so new Settings fields (e.g. Search agent) appear right after an add-on update without a manual browser hard-reload.

## 0.25.0

- **Anti-drift Danish.** The default prompt now says "ALTID rigsdansk — ALDRIG norsk eller svensk", so the assistant stops drifting into Norwegian/Swedish when speech is ambiguous.

## 0.24.0

- **Reliable `web_search` tool (works on ANY provider, incl. OpenAI Realtime).** Set a **Search agent** in Settings (an HA conversation agent with Google Search on, e.g. `conversation.google_ai_search`) and the assistant gets a clean first-class `web_search(query)` tool that routes to it (via `conversation.process`, returns the answer). No more relying on the model to hand-compose a generic call — it just calls `web_search`. Keeps the system prompt natural (no tool-syntax needed). The native Web-search toggle stays for Gemini's google_search.

## 0.23.0

- **Web search now actually gets used when enabled.** With the Web search toggle on, the system prompt now tells the model it HAS a web tool (for live sport/news/weather) — so it stops replying "I have no live data" and calls the tool. Reliable on Gemini (native google_search); OpenAI Realtime hosted web search is not guaranteed by the API — use Gemini for dependable web search.

## 0.22.0 — Voice PE firmware Phase 1a (podvoice_audio)

- **`podvoice_audio` ESPHome component built** (the S1 continuous-audio shim) — multi-expert build (lead draft → 3 adversarial reviewers → assembled). A *passive* MicrophoneSource tap on the already-running mic → fixed PSRAM ring buffer (filled on the audio task) → drained from loop() as VoiceAssistantAudio over the native API connection PodVoice already holds. NOT start_continuous, NOT a voice_assistant.cpp fork. Lives at `esphome/components/podvoice_audio/`; wired in `esphome/podvoice.yaml`.
- **Consumer fix:** `voicepe.py._handle_audio(data, data2=None)` matches aioesphomeapi's real callback (2nd arg = optional 2nd channel, not an `end` flag). diag.run_s1 unchanged.
- ruff now excludes `esphome/` (firmware codegen, depends on the esphome package, not add-on source).
- ⚠️ UNVALIDATED on hardware — first flash is the S1 gate; expect a flash→report→fix cycle.

## 0.21.0 — Voice PE firmware Phase 0

- **Maintainable firmware overlay** (`esphome/podvoice.yaml`): replaces the copy-pasted sketch with a thin, pinned `packages:` include of the official firmware + tiny overrides (PSK, wake→event, voice_assistant ownership). Board/pin/audio-graph drift is inherited, not copied. The hard part (continuous-audio `podvoice_audio` component) is a documented Phase-1a placeholder, added only after the hardware gates pass.
- **Dummy-proof Voice PE control tab**: rebuilt as 3 ordered gates (Connection → Audio stream S1 → Speaker S2) with clear pass/fail, friendly edge-case messages (no room, simulation on, panel offline, no audio), and a **Copy result** button so a non-developer can run a gate and paste the outcome. Marked experimental (firmware still in build).

## 0.20.0

- **`list_services` now shows each field's valid values + description**, not just names — so the model calls services correctly. E.g. it sees `podconnect.play_from_library.source = liked | top_tracks | recent`, so "play something I like / play my recent" works in one `home_call` (no gu. The new PodConnect `play_from_library` action is reached fully generically.

## 0.19.0

- **`list_services` now reveals which services return data.** Each service shows `returns_response: true/false` (from HA's service registry). So the model can SEE that e.g. `podconnect.top_tracks` / `recently_played` / `media_player.search_media` give data back, and knows to call them via `home_call` with `return_response: true` — instead of giving up. Fixes "I can't see your listening history" even when the data service exists.

## 0.18.0

- **`home_call` can now read data-services + call account-level services.** Two additions so the
  assistant can reach the *data plane* (e.g. a future PodConnect `top_tracks`/listening-history
  service) generically:
  - `return_response: true` → calls the HA service with `?return_response` and returns its payload
    (e.g. `media_player.search_media`, `podconnect.top_tracks`).
  - `entity_id` is now optional: omit it for account-level services (then the **domain** must be
    exposed in Home control). Entity services still require an exposed entity.
  Stays fully generic — no PodConnect-specific code; the data service is added on the PodConnect side.

## 0.17.0

- **FIX: Home control list was empty because the add-on never received `SUPERVISOR_TOKEN`.**
  Root cause (multi-expert, high confidence): the entrypoint started Python WITHOUT s6-overlay's
  `with-contenv` wrapper, so the Supervisor token (written to /run/s6/container_environment/) was
  never exported into the process env → the HA core-API call sent an empty `Bearer ` header. That's
  why PodConnect & Gemini worked (own creds) but only HA failed.
  - `run.sh` now uses `#!/usr/bin/with-contenv bashio`.
  - `config.py` also reads the token directly from the s6 container_environment file as a fallback.
  Update the add-on (it rebuilds) + restart — NO uninstall needed. The entity list then fills.

## 0.16.0

- **Clear error when the add-on has no HA token.** The empty-token case used to crash with a cryptic `Illegal header value b'Bearer '`; Home control now says exactly what's wrong and how to fix it (reinstall the add-on so Supervisor grants homeassistant_api).
- **Settings page reorganised for clarity.** Logical sections: **Assistant** (provider + web search; note that model/voice live in Talk) → **Music ducking (PodConnect)** → **Home control** → **System prompt** → collapsed **Voice PE (hardware)** (PSK, rooms, simulation — not needed for the console/Assist) → collapsed **Advanced** (per-provider tuning + ducking). Every control now has a labelled home and a one-line purpose.

## 0.15.0

- **Stop button in Talk.** A ⏹ next to Send instantly silences the spoken reply (flushes the
  audio + ignores further chunks until your next turn) — for when the model rambles or you want
  to barge in by hand.
- **Web search (opt-in).** New Settings toggle exposes the provider's NATIVE web search — Gemini
  `google_search` grounding / OpenAI `web_search` — so the assistant can answer live questions
  (e.g. a match result). Off by default; experimental (may not combine with home control on
  every model). VERIFY tool names per provider.

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
