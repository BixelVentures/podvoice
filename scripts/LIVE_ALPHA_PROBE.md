# Official GPT-Live SDK probe

This is the first isolated implementation step of the Alpha plan. It is not the
Voice PE integration or a production setting. It uses OpenAI's SDK and Responses
delegation with a fixed, harmless `get_probe_status` function. It has no HA client,
home actions, microphone capture, speaker driver or automatic reconnect.

The active decision and actual gate status remain in `docs/STATUS.md`.

Use a separate Python 3.12 environment outside synced storage:

```sh
python3.12 -m venv /private/tmp/podvoice-live-sdk-venv
/private/tmp/podvoice-live-sdk-venv/bin/python -m pip install -r scripts/requirements-live-alpha.txt
```

Provide `OPENAI_API_KEY` through the existing authorized environment or secret
configuration. Do not put keys in commands, this repository, reports or chat. No key
is bundled. Run one bounded trial at a time; the normal production/eval exclusivity
contract still applies to a shared provider budget. A separate validated provider
pool is required for simultaneous trials and production.

Feed raw mono PCM16 little-endian at 24 kHz through a pipe, and consume the output
through another pipe. A known synthetic Danish fixture is sufficient for the first
protocol trial; private room recordings are unnecessary. For example:

```sh
set -o pipefail
cat /absolute/path/input.pcm | /private/tmp/podvoice-live-sdk-venv/bin/python scripts/live_alpha_probe.py --seconds 30 | ffmpeg -f s16le -ar 24000 -ac 1 -i pipe:0 /absolute/path/live-output.wav
```

Both stdin and stdout must be pipes. Input is paced in 20 ms frames. EOF adds counted
synthetic silence until the duration limit or SIGINT/SIGTERM, allowing a response to
arrive after the input file ends. EOF is not treated as a semantic turn boundary.
The output file records received audio; it does not prove room playback.
Check the fixture before opening the API session: expected format, nonzero length,
duration, signal energy and intelligible known speech. Some local speech generators
can exit successfully while producing an empty file in a restricted environment.
`source_input_bytes` counts actual pipe reads separately from synthetic padding;
zero source bytes produces `no_source_audio` and exit1 even when the session closes.
Nonzero source bytes still do not prove speech or correct understanding. Keep pipeline
failure propagation enabled, or inspect the probe's own process exit code.

The probe uses `gpt-live-1`, voice `marin` and the official example's inexpensive
`gpt-5.6-luna` backend. These are probe choices, not a claim of quality parity with
the existing assistant or a decision about the final Alpha backend.

Metadata is written to stderr, separate from PCM. `finalized` means the transport
received `session.closed`, not that the model understood Danish, called a tool,
handled interruption, completed a farewell or played sound physically. Inspect the
separate counters and usage, and listen to the output against the known input.
Output submitted to a pipe and a tool result submitted to the provider are not
acknowledgments of audible playback or accepted tool results.

Stop/deadline cancels local audio tasks and discards future audio. It waits for the
official final session event within a deadline, then reports incomplete finalization
as an error. It does not drain an external player's buffers or implement puck Stop.

Tests use documented event envelopes and installed SDK types. They do not require a
key or contact OpenAI:

```sh
/private/tmp/podvoice-live-sdk-venv/bin/python -m pip install -r podvoice/requirements.txt -r podvoice/requirements-dev.txt
/private/tmp/podvoice-live-sdk-venv/bin/python -m pytest tests/unit/test_live_alpha_probe.py
```

Sources: [official WebSocket example](https://developers.openai.com/api/docs/guides/voice-websockets?api=live)
and [managed delegation](https://developers.openai.com/api/docs/guides/live-delegation).
