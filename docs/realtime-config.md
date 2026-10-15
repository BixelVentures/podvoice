# Historical OpenAI Realtime protocol reference

This is a dated v1.x reference for the retained diagnostic/regression adapter
`podvoice/gatekeeper/openai_realtime.py`. It is **not** a v2.x production provider,
settings guide, model recommendation, release gate or GPT-Live acceptance test.
The current source of authority is [`STATUS.md`](STATUS.md),
[`INVARIANTER.md`](INVARIANTER.md), [`PRODUKTMÅL.md`](PRODUKTMÅL.md) and
[`ARKITEKTUR.md`](ARKITEKTUR.md). The user has explicitly selected GPT-Live-only,
full-duplex v2.x. Any half-duplex mic gate or Realtime VAD advice below applies
only when interpreting old traces and tests.

## Scope of the old protocol

The retained adapter uses the Realtime GA WebSocket endpoint with
`session.type: "realtime"`, `session.update`, `input_audio_buffer.append`,
`response.create` and `response.done`. Historical output events include
`response.output_audio.delta`; historical input-VAD events include
`input_audio_buffer.speech_started`, `speech_stopped` and `committed`.
These event names must not be projected onto `ThinSession`'s GPT-Live input,
output stream or physical Voice PE capture edges.

The v1.x configuration supported `server_vad`, `semantic_vad` and manual turn
detection, with old Settings presets such as `responsive` and `conservative`.
Its `noise_reduction`, gain, idle and half-duplex assumptions were choices for
that historical path. They do not define the current native full-duplex
interruption contract. Inspect the actual Live provider and Voice PE adapter
before proposing a current change.

The historical adapter also processed `response.done.usage`,
`rate_limits.updated`, tool-call events and session teardown. Retained
evaluation and replay code can exercise these behaviors as **Realtime-specific
diagnostics**; `docs/EVALUERING.md` explains their limits. A green Realtime
fixture or live diagnostic cannot validate GPT-Live semantics, hardware
playback, barge-in or the current physical gate.

The old design used a local HA/MCP client and exposed its tools as function
calls; no historical inference about a publicly reachable home endpoint is
needed for current deployment decisions. Do not use old model aliases,
prices, token estimates or SDK/API observations from August 2026 as current
vendor facts or runtime settings. Check the actual provider documentation and
running code when those facts matter.

References for the retained adapter:
[Realtime sessions](https://developers.openai.com/api/docs/api-reference/realtime-sessions)
and [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription).
