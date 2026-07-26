# OpenAI Realtime — GA surface & turn-detection tunables (Task 0.2 — verified 2026-07)

Verified against developers.openai.com (search retrieval) + the live generated
OpenAI SDK/OpenAPI spec (which already carries gpt-realtime-2.1). The Realtime
**Beta was removed 2026-05-12**; everything below is the GA surface.

## Beta-remnant audit of our provider (openai_realtime.py)

Result: **clean** — the module was written against GA and re-verified now.

- No `OpenAI-Beta` header; URL `wss://api.openai.com/v1/realtime?model=...` ✅
- `session.update` uses `session.type: "realtime"` + nested `audio.input/output` ✅
- Event names in use are the GA names (beta → GA renames were
  `response.audio.*` → `response.output_audio.*`, `response.audio_transcript.*` →
  `response.output_audio_transcript.*`): `response.output_audio.delta`,
  `response.output_audio_transcript.delta`,
  `conversation.item.input_audio_transcription.completed`,
  `response.function_call_arguments.done`, `input_audio_buffer.speech_started` /
  `speech_stopped` / `committed` / `timeout_triggered`, `response.created`,
  `response.done`, `conversation.item.truncate`, `input_audio_buffer.append`,
  `conversation.item.create`, `response.create` ✅ (all confirmed in the GA spec)
- Two stale beliefs FIXED in this overhaul:
  1. `idle_timeout_ms` **exists** (added ~2025-09; server_vad only) — old comments
     claimed it didn't. The server now closes idle conversations for us.
  2. Input transcription: `gpt-4o-mini-transcribe` is in the GA enum (better Danish
     than whisper-1) — we use it. Full enum: `whisper-1`, `gpt-4o-mini-transcribe(-2025-12-15)`,
     `gpt-4o-transcribe`, `gpt-4o-transcribe-diarize`, `gpt-realtime-whisper`.

## Models (Task 1.1)

| id | role | notes |
|---|---|---|
| `gpt-realtime-2.1-mini` | **default** | distilled reasoning model, released 2026-07-06; priced like the old gpt-realtime-mini |
| `gpt-realtime-2.1` | opt-in | same date; better alphanumerics, silence/noise handling, **more reliable interruption behavior** — relevant to Phase 1 |
| `gpt-realtime-2` | legacy | previous default; kept selectable for A/B |

Both 2.1 models: 128k context, 32k max output, ≥25% p95 latency cut via caching.
Dated snapshot ids were NOT verifiable — use the aliases.

## Turn detection (the Task 1.3 tunables)

`session.audio.input.turn_detection`:

- **`server_vad`** (energy-based): `threshold` (0–1, default 0.5),
  `prefix_padding_ms` (300), `silence_duration_ms` (500), `create_response`,
  `interrupt_response`, `idle_timeout_ms` (nullable; timer runs after the last
  reply finishes playing → emits `input_audio_buffer.timeout_triggered`).
- **`semantic_vad`** (model decides when you're done): `eagerness`:
  `low` (waits up to ~8 s) | `medium` (~4 s) | `high` (~2 s) | `auto` (=medium),
  `create_response`, `interrupt_response`. **No idle_timeout_ms here** — our
  client-side idle fallback covers this mode.
- `null` = manual (push-to-talk style). No new detection types shipped in 2026;
  gpt-realtime-2.1's interruption improvements are model behavior, not new fields.

PodVoice presets (Settings → "Interruption style", applied live per session):

| preset | wire config | rationale |
|---|---|---|
| `conservative` (default) | `server_vad` threshold **0.7**, prefix 300 ms, silence **700 ms**, `idle_timeout_ms` = `idle_timeout_s`×1000 | residual echo past the XMOS AEC is far quieter than close speech — a high energy bar stops it firing `speech_started` during replies (the self-interruption bug) |
| `responsive` | `semantic_vad`, eagerness `auto` | easiest to talk over; for quiet rooms / after 1.4 proves echo is a non-issue |
| `custom` | raw knobs `openai_turn/threshold/prefix_ms/silence_ms/eagerness` | the 1.4 matrix sweeps |

Other verified session facts: PCM is **24 kHz only** (in and out; alternatives are
G.711 `audio/pcmu/pcma`); voices incl. `marin`/`cedar` (recommended) + `alloy`,
`ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`; `audio.output.speed`
0.25–1.5; `noise_reduction`: `near_field`/`far_field`/null; sessions and sockets
hard-cap at **60 min** (we close at `max_session_min`, default 15).

## Usage & pricing (drives usage.py)

`response.done` → `response.usage`:
`{input_tokens, output_tokens, total_tokens, input_token_details: {text_tokens,
audio_tokens, image_tokens, cached_tokens, cached_tokens_details: {...}},
output_token_details: {text_tokens, audio_tokens}}`.
Audio ≈ 1 token/100 ms in, 1 token/50 ms out.

Per 1M tokens (checked 2026-07 — **secondary-source consensus, not read off the
pricing page**; treat sensor values as estimates and re-check
https://platform.openai.com/pricing when they matter):

| | text in / cached / out | audio in / cached / out |
|---|---|---|
| gpt-realtime-2.1 | $4.00 / $0.40 / $24.00 | $32.00 / $0.40 / $64.00 |
| gpt-realtime-2.1-mini | $0.60 / ~$0.06 / $2.40 | $10.00 / $0.30 / $20.00 |

Rule of thumb: one wake-gated family day (~30 min total audio in+out) on mini ≈
**$0.3–0.5/day**; the big model is ~3× audio-in / ~3× audio-out that.

## MCP (confirms the Task 3.1 topology)

The Realtime API supports **server-side** MCP (`tools: [{type: "mcp", server_url:
...}]`) — but `server_url` must be an HTTPS endpoint reachable from OpenAI (their
new "Secure MCP Tunnel" is the alternative). Exposing the house to the internet is
the wrong tradeoff → PodVoice runs a **local MCP client** against HA's LAN MCP
server and surfaces the tools as ordinary function calls. Nothing about the home
is internet-reachable.

## GPT-Live-1 seam

The provider module (openai_realtime.py) owns model id, session config, socket
lifecycle and event decoding. Design assumption for GPT-Live-1: streaming
audio-in/audio-out with turn-taking + tool events — same shape. Target migration:
model string + new event handlers in that one file. No other assumptions are
built in (no API/docs exist as of 2026-07).
