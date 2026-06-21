# PodVoice tools — Gemini Live smoke-test

`verify_gemini_live.py` is an operational tool (not part of the add-on, **not run
in CI**) that retires the `# VERIFY:` markers in
[`podvoice/gatekeeper/gemini.py`](../podvoice/gatekeeper/gemini.py) the moment you
have a real, Live-enabled Gemini API key. See **[PLAN.md](../PLAN.md) §5** for the
Live-session design it checks.

## What it does
The wrapper in `gemini.py` is written defensively — every SDK attribute / kwarg /
config field that could drift between `google-genai` versions is tagged
`# VERIFY:`. We can't exercise any of it without a real key (the unit suite
imports the module SDK-free and never opens a socket). This script does the live
exercise in two passes:

1. **Raw SDK pass** — drives `client.aio.live.connect()` directly, sends a Danish
   text turn (`send_client_content`) to elicit a spoken reply, then probes each
   response object for the fields our wrapper reads.
2. **Wrapper pass** — instantiates our own `GeminiLiveSession` + `build_config()`,
   opens a real session, sends a silent realtime-audio chunk, and iterates
   `events()` to prove the wrapper parses a real stream without raising.

It prints a CHECKLIST mapping every `# VERIFY:` concern to **OBSERVED** /
**NOT OBSERVED** / **ERROR**.

## Prerequisites
1. **Python 3.12** (the add-on targets 3.12; native-audio models need a recent SDK).
2. `pip install google-genai`
3. A **Live-enabled** `GEMINI_API_KEY` from
   [Google AI Studio](https://aistudio.google.com/apikey) — it must have access to
   the Live API / native-audio models.

```sh
python -m venv .venv && . .venv/bin/activate
pip install google-genai
export GEMINI_API_KEY="<your live-enabled key>"
```

## Run
```sh
# Basic: open a session, elicit a Danish greeting, probe every field.
GEMINI_API_KEY=... python tools/verify_gemini_live.py

# Also declare a get_time tool and prompt the model to call it, exercising
# tool_call parsing + send_tool_response.
GEMINI_API_KEY=... python tools/verify_gemini_live.py --make-tool-call

# Options:
#   --model    Live model id (default gemini-2.5-flash-native-audio-preview-12-2025)
#   --api-key  override env GEMINI_API_KEY
#   --seconds  receive window per pass (default 15)
```

With no key, it prints setup instructions and exits non-zero.

## Reading the checklist
- **OBSERVED** — the field was seen on the wire or the call succeeded. The wrapper's
  assumption holds for this SDK version.
- **NOT OBSERVED** — the path was never exercised this run. For `tool_call`,
  `interrupted`, `go_away`, and `session_resumption_update` this is usually benign:
  the scenario simply didn't occur (e.g. the server never sent a `go_away`, or you
  didn't pass `--make-tool-call`). It is **not** evidence the wrapper is wrong. Run
  with `--make-tool-call` and a longer `--seconds` to coax more of these.
- **ERROR** — the SDK raised on that call. The contract has likely drifted; fix the
  corresponding `# VERIFY:` line in `gemini.py`.

**Exit code:** `0` when the session opened and **both audio and a transcript** were
observed and the wrapper pass didn't error; non-zero otherwise. A `model id
accepted` line confirms the `--model` was valid.

## Scope
This script clears the **`gemini.py`** VERIFY markers only. The
`aioesphomeapi` / Voice PE markers (`voicepe.py`, `constants.ESPHOME_API_PORT`)
are cleared by the hardware spikes instead — see
[`../spikes/README.md`](../spikes/README.md) (S1 / S2).
