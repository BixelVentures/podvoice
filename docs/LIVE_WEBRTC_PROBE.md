# Isolated Live WebRTC transport proof

This developer script is not imported by PodVoice and changes no runtime transport.
It has not been run against OpenAI or a browser yet. Root coordinates that explicit
API test separately. Unit tests use an in-process fake SDK and create no sockets.

The source is the official Live flow in the cached guides and SDK 3.13:

- [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live)
- [Server-side controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live)
- [Session lifecycle](https://developers.openai.com/api/docs/guides/live-conversations)

## Preparation and launch

Use Python 3.12 with `scripts/requirements-live-alpha.txt` plus the repository's pinned
`aiohttp` dependency. The already prepared environment is
`/private/tmp/podvoice-live-sdk-venv`. Run from the isolated clone, not Documents.

A fixture is raw signed PCM16 little-endian, mono, 24 kHz, at most ten seconds, with
an independently verified SHA-256. Use only the previously authorized synthetic
Danish fixture. The script verifies alignment, size and SHA before binding. It wraps
these exact PCM bytes in a finite WAV for browser `decodeAudioData`; it does not
record the microphone or send a recording file to another service.

The server needs `OPENAI_API_KEY` supplied in memory by the authorized credential
handoff. Never put the value in a command argument, saved script, report or browser.
The script removes the environment entry after reading it and retains the value
only in its server/SDK objects. It prints no credential. No ephemeral browser key
is needed in this official server-created Live flow.

Example launch after the authorized handoff has populated that environment variable:

```sh
/private/tmp/podvoice-live-sdk-venv/bin/python scripts/live_webrtc_probe.py \
  --fixture /absolute/path/to/verified-synthetic-danish.pcm \
  --fixture-sha256 VERIFIED_SHA256 \
  --report /private/tmp/podvoice-live-webrtc-report.json
```

These paths/hash are placeholders, not a suggested unverified fixture. Preparing the
server makes no API request. It binds `127.0.0.1:18799` only and prints its nonce URL.
Only the browser button **Start one bounded API session** consumes the one-use create
permission and calls OpenAI. Keep the nonce URL local. All POSTs require the exact
loopback Host, Origin and nonce; the browser receives no key. A second session create
is rejected even if the first startup failed. There are no provider retries.

Do not start a second run after an ambiguous creation failure without reviewing the
first outcome: a lost creation response cannot prove that no remote session exists.

## What the probe does

1. Browser creates an AudioContext destination track driven by looping zero PCM.
   Nothing connects to the local speaker destination. The remote audio element is
   always muted. There is no `getUserMedia` or microphone-permission request.
2. Browser creates `oai-events`, gathers ICE and posts its offer. Server creates one
   `gpt-live-1`/`marin` session with the fixed `gpt-5.6-luna` backend and only the
   immutable `get_probe_status` stub. Backend output is capped at 256 tokens.
3. Server attaches official same-session sideband **before returning the SDP answer**
   and sends `session.update(session={}, event_id=...)`. It records an attachment
   snapshot only when `session.updated` matches both event ID and created session ID.
   It does not fabricate or require replay of `session.started` on the sideband.
4. Browser waits for its real data-channel `session.started` and asks the server to
   proceed. Server waits for the correlated sideband snapshot, then sends the one
   fixed typed request: “Hvad er prøvens status? Svar kort på dansk.” The receipt is
   submitted, not a separate input-acceptance ACK. Input is still silent at this point.
5. Eight seconds later, browser plays the hash-verified fixture into the outgoing
   destination track and returns to silence. This gives an observable typed-only
   interval before fixture input, followed by the synthetic Danish audio interval.
6. Server reuses `live_alpha_probe.Probe.backend` for completed-batch validation and
   fixed stub results. At most two stub calls and four backend starts are allowed.
   Browser permissions allow zero provider client events and only session start,
   close and error server events. It cannot drive tools, instructions or close.
7. Server requests close after 30 seconds from its successful create response, or
   earlier on explicit Stop/failure. Startup is bounded by 15 seconds, finalization
   by 15 seconds, cleanup by three seconds. Browser has its own bounded stop/cleanup.
   API creation loss or sideband attachment failure can leave remote finalization
   unknown; local deadlines never assert remote cleanup without evidence.

The server remains alive at most three minutes if no session is started. Reports
contain fixed event labels, session identity, numeric usage and restricted browser
media telemetry, not API keys, SDP, ICE addresses, arbitrary transcripts or tool text.

## Interpret the evidence

- `sideband_attached` before `answer_returned` proves server attachment ordering.
- `attachment_snapshot_confirmed` proves the correlated session identity, not replay
  of earlier events. Sideband `session.started` is recorded independently if observed.
- Browser `started=true` comes from its primary data channel. This is browser evidence;
  it is not trusted tool authorization or a substitute for the server snapshot.
- Increasing `bytesReceived`, packets, samples, `jitterBufferEmittedCount`, audio
  currentTime and `outputPlaying=true` show media progress. Compare against
  `fixtureStarted=false` to check whether typed-only plus silent input produced output.
  MediaStream currentTime/playing alone can describe a running silent track; RTP
  sample counts are also not semantic proof. Muted output proves no audible content.
- Compare server `typed_probe_submitted`, backend terminals and numeric usage.
  There is no claim that this telemetry measures meaningful response latency.
- `session.closed` and numeric `usage.seconds` establish final usage, while missing
  backend terminal usage remains visible in the reused probe report.
- Browser cleanup is deliberately recorded separately. This probe does **not** infer
  DAC drain, complete farewell playback, Danish understanding or physical readiness
  from `session.closed`, track shutdown, or browser statistics.

If the empty update is rejected or its ACK never arrives, the boundary is a failed
attachment-snapshot proof. Do not replace it with a fabricated readiness event. Stop
and review the actual protocol before attempting a different handshake.

## Offline checks

```sh
/private/tmp/podvoice-live-sdk-venv/bin/python -m pytest \
  tests/unit/test_live_webrtc_probe.py tests/unit/test_live_alpha_probe.py
```

These checks cover configuration/frontend permissions, one-create ownership,
attachment-before-answer, snapshot identity without started replay, stale readiness,
Stop before creation and during delayed fixture/ICE completion, Stop/deadline during
each typed SDK send, timeout close/final usage, fixture verification and the shared
completed-response stub validator. They do not prove browser or provider behavior.
