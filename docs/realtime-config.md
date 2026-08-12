# OpenAI Realtime — GA surface & turn-detection tunables (verified 2026-08-12)

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
- Stale beliefs fixed:
  1. `idle_timeout_ms` **exists** (added ~2025-09; server_vad only) — old comments
     claimed it didn't. PodVoice deliberately does not send it because it triggers a
     model re-prompt rather than closing the conversation; client idle is the closer.
  2. Input transcription is asynchronous guidance and is **not** what the Realtime
     model itself heard. OpenAI Docs now says to start with `gpt-live-transcribe`.
     PodVoice uses it with `languages:["da"]` and Danish domain context; the live
     model requires plural `languages`, not singular `language`.

## Models (Task 1.1)

| id | role | notes |
|---|---|---|
| `gpt-realtime-2.1` | **quality default** | official model card: highest reasoning; improved alphanumerics, silence/noise handling and interruption behavior |
| `gpt-realtime-2.1-mini` | explicit cost mode | official model card: distilled, faster and lower-cost; `force_mini` clamps all sessions |
| `gpt-realtime-2` | legacy | previous default; kept selectable for rollback only |

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
| `conservative` (default) | `server_vad` threshold **0.45**, prefix **800 ms**, silence **700 ms**, no `idle_timeout_ms` | catches soft/short Danish without clipping first syllables, while the half-duplex echo shield prevents the assistant from interrupting itself |
| `responsive` | `semantic_vad`, eagerness `auto` | easiest to talk over; for quiet rooms / after 1.4 proves echo is a non-issue |
| `custom` | raw knobs `openai_turn/threshold/prefix_ms/silence_ms/eagerness` | the 1.4 matrix sweeps |

Other verified session facts: PodVoice uses PCM at **24 kHz** in and out;
`noise_reduction.near_field` is for close-talking headset-style microphones and
`far_field` for laptop/conference microphones. Noise filtering runs before both VAD
and the model. Therefore source processing is explicit:

- Voice PE ch1: XMOS AEC+IC+NS, no AGC, gain 4 → OpenAI noise reduction `null`/off.
- Talk/Mac: browser echo cancellation on, browser NS/AGC requested off → OpenAI
  `far_field`. Actual browser settings and rates are logged because simple media
  constraints are best-effort.

Alternatives to PCM are G.711 `audio/pcmu/pcma`; voices include `marin`/`cedar`
(recommended) plus `alloy`,
`ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`; `audio.output.speed`
0.25–1.5; `noise_reduction`: `near_field`/`far_field`/null; sessions and sockets
hard-cap at **60 min** (we close at `max_session_min`, default 15).

## Usage & pricing (drives usage.py)

`response.done` → `response.usage`:
`{input_tokens, output_tokens, total_tokens, input_token_details: {text_tokens,
audio_tokens, image_tokens, cached_tokens, cached_tokens_details: {...}},
output_token_details: {text_tokens, audio_tokens}}`.
Audio ≈ 1 token/100 ms in, 1 token/50 ms out.

Per 1M tokens (official model cards, checked 2026-08-12; the HA sensors remain
estimates because the final invoice depends on actual token accounting):

| | text in / cached / out | audio in / cached / out |
|---|---|---|
| gpt-realtime-2.1 | $4.00 / $0.40 / $24.00 | $32.00 / $0.40 / $64.00 |
| gpt-realtime-2.1-mini | $0.60 / ~$0.06 / $2.40 | $10.00 / $0.30 / $20.00 |

The full model is 3.2× mini on audio input and output token price. `force_mini`
therefore remains an explicit owner-controlled cost guard.

Primary sources: [Realtime sessions](https://developers.openai.com/api/docs/api-reference/realtime-sessions),
[Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription),
[GPT-Realtime-2.1](https://developers.openai.com/api/docs/models/gpt-realtime-2.1),
[GPT-Realtime-2.1 mini](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini),
[GPT Live Transcribe](https://developers.openai.com/api/docs/models/gpt-live-transcribe).

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
