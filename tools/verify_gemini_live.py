#!/usr/bin/env python3
"""Standalone Gemini Live API smoke-test — clears the ``# VERIFY:`` markers in
``podvoice/gatekeeper/gemini.py`` (PLAN.md §5).

This is an OPERATIONAL tool, not part of the add-on and NOT run in CI. It needs a
real, Live-enabled ``GEMINI_API_KEY``, Python 3.12, and ``pip install google-genai``
— none of which exist in the unit-test environment. It opens a real Live session,
elicits a spoken Danish response, and records which of the SDK fields our wrapper
reads are actually present on the wire. It then runs our own ``GeminiLiveSession``
against a real stream to prove the wrapper parses it without raising.

Two independent passes:

1. RAW SDK pass — drive ``client.aio.live.connect()`` directly (our wrapper has no
   text-send method, so we use ``send_client_content`` to elicit speech) and probe
   every field listed in the ``# VERIFY:`` markers.
2. WRAPPER pass — instantiate our ``GeminiLiveSession`` + ``build_config`` and run
   its ``events()`` generator on a real stream.

A final CHECKLIST maps each ``# VERIFY:`` concern to OBSERVED / NOT OBSERVED /
ERROR. NOT OBSERVED for e.g. ``tool_call`` or ``go_away`` usually just means the
scenario didn't trigger that field — not that the code is wrong.

Usage::

    pip install google-genai            # Python 3.12
    GEMINI_API_KEY=... python tools/verify_gemini_live.py
    GEMINI_API_KEY=... python tools/verify_gemini_live.py --make-tool-call --seconds 20
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import os
import sys
from pathlib import Path

# --- Put <repo>/podvoice on sys.path so ``from gatekeeper...`` imports work -----
_REPO_ROOT = Path(__file__).resolve().parent.parent
_PKG_ROOT = _REPO_ROOT / "podvoice"
if str(_PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(_PKG_ROOT))

DEFAULT_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"

# Default elicitation turns (Danish — the point is to provoke a spoken response).
PROMPT_HELLO = "Sig kort hej på dansk."
PROMPT_TOOL = "Hvad er klokken? Brug værktøjet."

# The set of `# VERIFY:` concerns gemini.py depends on. Each maps to an observation
# bucket we fill in during the raw-SDK pass. Order is the checklist print order.
VERIFY_KEYS: tuple[tuple[str, str], ...] = (
    ("connect", "client.aio.live.connect(model=, config=) opens as async CM"),
    ("model_accepted", "model id accepted by the Live endpoint"),
    ("build_config", "build_config() dict accepted as the Live config"),
    ("data", "response.data — raw 24 kHz PCM bytes accessor"),
    ("output_transcription", "server_content.output_transcription.text"),
    ("input_transcription", "server_content.input_transcription.text"),
    ("turn_complete", "server_content.turn_complete"),
    ("interrupted", "server_content.interrupted"),
    ("tool_call", "tool_call.function_calls[].{id,name,args}"),
    ("send_tool_response", "session.send_tool_response(function_responses=[...])"),
    ("session_resumption_update", "session_resumption_update.{resumable,new_handle}"),
    ("go_away", "go_away.time_left"),
    ("send_realtime_input", "session.send_realtime_input(audio=Blob(...))"),
    ("wrapper_events", "GeminiLiveSession.events() parses a real stream"),
)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="PodVoice Gemini Live smoke-test (clears gemini.py VERIFY markers)"
    )
    p.add_argument("--model", default=DEFAULT_MODEL, help="Live model id to test")
    p.add_argument(
        "--api-key",
        default=os.environ.get("GEMINI_API_KEY"),
        help="Gemini API key (defaults to env GEMINI_API_KEY)",
    )
    p.add_argument(
        "--make-tool-call",
        action="store_true",
        help="declare a get_time tool and prompt the model to call it",
    )
    p.add_argument("--seconds", type=float, default=15.0, help="receive window per pass")
    return p.parse_args()


def _no_key_and_exit() -> None:
    print("ERROR: no API key.", file=sys.stderr)
    print("", file=sys.stderr)
    print("This smoke-test needs a real, Live-enabled Gemini key:", file=sys.stderr)
    print(
        "  1. Get a key from Google AI Studio (https://aistudio.google.com/apikey)", file=sys.stderr
    )
    print("     — it must have access to the Live API / native-audio models.", file=sys.stderr)
    print("  2. pip install google-genai   (Python 3.12)", file=sys.stderr)
    print("  3. GEMINI_API_KEY=... python tools/verify_gemini_live.py", file=sys.stderr)
    sys.exit(2)


def _placeholder_config():
    """A real Config with placeholder values.

    build_config() mostly ignores ``cfg`` (it only takes it for forward-compat), so
    placeholders are fine — but we use the real dataclass to stay honest about the
    field shape if build_config ever starts reading from it.
    """
    from gatekeeper.config import Config

    return Config(
        gemini_api_key="placeholder",
        gemini_model="placeholder",
        podconnect_base_url="http://placeholder",
        podconnect_token="placeholder",
        voicepe_noise_psk="",
        rooms=(),
    )


# --- A simple function declaration to try to elicit a tool_call -----------------
# VERIFY: function-declaration dict shape (name/description/parameters JSON-schema)
# is what the Live tools config accepts. Mirrors build_config()'s
# {"function_declarations": [...]} block.
GET_TIME_DECLARATION = {
    "name": "get_time",
    "description": "Returnerer det aktuelle klokkeslæt.",
    "parameters": {
        "type": "object",
        "properties": {
            "timezone": {
                "type": "string",
                "description": "IANA timezone, fx 'Europe/Copenhagen'.",
            }
        },
    },
}


def _summarize(value: object) -> str:
    """Short, log-safe repr of an observed field for the per-response trace."""
    if isinstance(value, (bytes, bytearray)):
        return f"<{len(value)} bytes>"
    s = repr(value)
    return s if len(s) <= 80 else s[:77] + "..."


async def _raw_sdk_pass(args: argparse.Namespace, observed: dict, errors: dict) -> None:
    """Pass 1 — drive the SDK directly and probe every VERIFY field."""
    from google import genai  # VERIFY: import path `from google import genai`
    from google.genai import types  # VERIFY: `from google.genai import types`

    # VERIFY: genai.Client(api_key=...) — Gemini Developer API, NOT Vertex.
    client = genai.Client(api_key=args.api_key)

    cfg = _build_live_config(args)

    print(f"[raw] connecting model={args.model!r} ...")
    try:
        # VERIFY: client.aio.live.connect(model=, config=) is an async context manager.
        async with client.aio.live.connect(model=args.model, config=cfg) as session:
            observed["connect"] = "opened"
            observed["model_accepted"] = "accepted"
            observed["build_config"] = "accepted"
            print("[raw] session open.")

            await _send_text_turn(session, types, PROMPT_HELLO)
            await _drain(session, observed, errors, args, types)

            if args.make_tool_call:
                print("[raw] prompting for a tool call ...")
                await _send_text_turn(session, types, PROMPT_TOOL)
                await _drain(session, observed, errors, args, types)
    except Exception as exc:  # broad: report, don't abort the whole run
        # A model-not-found / auth error usually surfaces here.
        msg = f"{type(exc).__name__}: {exc}"
        print(f"[raw] ERROR opening/using session: {msg}", file=sys.stderr)
        errors["connect"] = msg
        if "model_accepted" not in observed:
            errors["model_accepted"] = msg


def _build_live_config(args: argparse.Namespace) -> dict:
    """build_config() with optional get_time declaration, for the raw pass."""
    from gatekeeper.gemini import build_config

    cfg_obj = _placeholder_config()
    decls = [GET_TIME_DECLARATION] if args.make_tool_call else None
    return build_config(cfg_obj, tool_declarations=decls)


async def _send_text_turn(session: object, types: object, text: str) -> None:
    """Send a single user text turn to elicit a spoken reply.

    VERIFY: send_client_content(turns=[...], turn_complete=True) is the text-turn
    shape on the live session. The ``turns`` content/parts dict mirrors the REST
    Content shape; adjust against the installed SDK if it rejects this.
    """
    await session.send_client_content(  # type: ignore[attr-defined]
        turns=[{"role": "user", "parts": [{"text": text}]}],
        turn_complete=True,
    )


async def _drain(
    session: object,
    observed: dict,
    errors: dict,
    args: argparse.Namespace,
    types: object,
) -> None:
    """Iterate ``session.receive()`` for --seconds, recording observed fields.

    Every SDK access is wrapped in getattr / try-except so a single missing field
    does not abort the probe.
    """
    # Hold references to fire-and-forget tool-response tasks (RUF006).
    pending: set[asyncio.Task] = set()

    async def _loop() -> None:
        # VERIFY: session.receive() is an async iterator of response objects.
        async for r in session.receive():  # type: ignore[attr-defined]
            _probe_response(r, observed, errors, session, args, types, pending)

    try:
        await asyncio.wait_for(_loop(), timeout=args.seconds)
    except TimeoutError:
        pass  # expected — we cap the receive window
    except Exception as exc:  # broad: one bad response shouldn't sink the probe
        msg = f"{type(exc).__name__}: {exc}"
        print(f"[raw] ERROR draining receive(): {msg}", file=sys.stderr)
        errors.setdefault("connect", msg)
    finally:
        for task in pending:
            with contextlib.suppress(Exception):
                await task


def _probe_response(
    r: object,
    observed: dict,
    errors: dict,
    session: object,
    args: argparse.Namespace,
    types: object,
    pending: set[asyncio.Task],
) -> None:
    """Record which VERIFY fields are present on one response object."""
    # VERIFY: r.data is the convenience accessor for raw 24 kHz PCM bytes.
    data = getattr(r, "data", None)
    if data is not None:
        observed["data"] = _summarize(data)

    # VERIFY: r.server_content.{input_transcription,output_transcription,
    #         interrupted,turn_complete}.
    sc = getattr(r, "server_content", None)
    if sc is not None:
        in_tx = getattr(sc, "input_transcription", None)
        if in_tx is not None:
            observed["input_transcription"] = _summarize(getattr(in_tx, "text", in_tx))
        out_tx = getattr(sc, "output_transcription", None)
        if out_tx is not None:
            observed["output_transcription"] = _summarize(getattr(out_tx, "text", out_tx))
        if getattr(sc, "interrupted", None):
            observed["interrupted"] = "True"
        if getattr(sc, "turn_complete", None):
            observed["turn_complete"] = "True"

    # VERIFY: r.tool_call.function_calls[].{id,name,args}.
    tool_call = getattr(r, "tool_call", None)
    if tool_call is not None:
        fcs = getattr(tool_call, "function_calls", None) or []
        for fc in fcs:
            fc_id = getattr(fc, "id", None)
            fc_name = getattr(fc, "name", None)
            fc_args = getattr(fc, "args", None)
            observed["tool_call"] = f"id={fc_id!r} name={fc_name!r} args={_summarize(fc_args)}"
            # Exercise the response round-trip if we asked for tool calls.
            if args.make_tool_call:
                task = asyncio.ensure_future(
                    _respond_tool_call(session, types, fc_id, fc_name, observed, errors)
                )
                pending.add(task)
                task.add_done_callback(pending.discard)

    # VERIFY: r.session_resumption_update.{resumable,new_handle}.
    update = getattr(r, "session_resumption_update", None)
    if update is not None:
        resumable = getattr(update, "resumable", None)
        new_handle = getattr(update, "new_handle", None)
        observed["session_resumption_update"] = (
            f"resumable={resumable!r} new_handle={'set' if new_handle else 'none'}"
        )

    # VERIFY: r.go_away.time_left (server's pre-disconnect warning).
    go_away = getattr(r, "go_away", None)
    if go_away is not None:
        observed["go_away"] = f"time_left={getattr(go_away, 'time_left', None)!r}"


async def _respond_tool_call(
    session: object,
    types: object,
    fc_id: object,
    fc_name: object,
    observed: dict,
    errors: dict,
) -> None:
    """Exercise send_tool_response for a received tool_call."""
    try:
        # VERIFY: types.FunctionResponse(id=, name=, response={...}) field names.
        fr = types.FunctionResponse(  # type: ignore[attr-defined]
            id=fc_id,
            name=fc_name,
            response={"time": "13:37", "timezone": "Europe/Copenhagen"},
        )
        # VERIFY: send_tool_response(function_responses=[...]) kwarg name.
        await session.send_tool_response(function_responses=[fr])  # type: ignore[attr-defined]
        observed["send_tool_response"] = "sent"
    except Exception as exc:  # broad: record contract drift, keep probing
        errors["send_tool_response"] = f"{type(exc).__name__}: {exc}"


async def _wrapper_pass(args: argparse.Namespace, observed: dict, errors: dict) -> None:
    """Pass 2 — run OUR GeminiLiveSession against a real stream.

    There is no text-send method on the wrapper, so we rely on the model greeting
    behaviour / any server-initiated content. Even with no elicitation, opening +
    iterating events() without raising proves the wrapper parses a real stream.
    We also send a tiny silent realtime-audio chunk to exercise send_realtime_input.
    """
    from gatekeeper.gemini import (
        AudioChunk,
        GeminiLiveSession,
        InputTranscript,
        OutputTranscript,
        ToolCall,
        TurnComplete,
        build_config,
    )

    cfg_obj = _placeholder_config()
    decls = [GET_TIME_DECLARATION] if args.make_tool_call else None
    cfg = build_config(cfg_obj, tool_declarations=decls)

    sess = GeminiLiveSession(api_key=args.api_key, model=args.model, config=cfg)
    print(f"[wrapper] connecting model={args.model!r} ...")
    try:
        await sess.connect()
    except Exception as exc:  # broad: report connect failure, skip the pass
        msg = f"{type(exc).__name__}: {exc}"
        print(f"[wrapper] ERROR connecting: {msg}", file=sys.stderr)
        errors["wrapper_events"] = msg
        return

    # Exercise send_realtime_input(audio=Blob(...)) with a short silent buffer.
    try:
        await sess.send_audio(b"\x00\x00" * 160)  # 20 ms of 16 kHz silence
        observed["send_realtime_input"] = "sent"
    except Exception as exc:  # broad: record send failure, keep going
        errors["send_realtime_input"] = f"{type(exc).__name__}: {exc}"

    seen: set[str] = set()

    async def _loop() -> None:
        async for ev in sess.events():
            seen.add(type(ev).__name__)
            if isinstance(ev, AudioChunk):
                observed.setdefault("data", _summarize(ev.pcm))
            elif isinstance(ev, OutputTranscript):
                observed.setdefault("output_transcription", _summarize(ev.text))
            elif isinstance(ev, InputTranscript):
                observed.setdefault("input_transcription", _summarize(ev.text))
            elif isinstance(ev, TurnComplete):
                observed.setdefault("turn_complete", "True")
            elif isinstance(ev, ToolCall):
                observed.setdefault("tool_call", f"id={ev.id!r} name={ev.name!r}")

    try:
        await asyncio.wait_for(_loop(), timeout=args.seconds)
    except TimeoutError:
        pass
    except Exception as exc:  # broad: report parse failure as the load-bearing check
        msg = f"{type(exc).__name__}: {exc}"
        print(f"[wrapper] ERROR iterating events(): {msg}", file=sys.stderr)
        errors["wrapper_events"] = msg
    else:
        observed["wrapper_events"] = f"parsed events: {sorted(seen) or 'none'}"
    finally:
        try:
            await sess.close()
        except Exception as exc:  # broad: close is best-effort cleanup
            print(f"[wrapper] WARN on close(): {exc}", file=sys.stderr)

    if "wrapper_events" not in observed and "wrapper_events" not in errors:
        observed["wrapper_events"] = f"opened OK; events seen: {sorted(seen) or 'none'}"


def _print_checklist(observed: dict, errors: dict, args: argparse.Namespace) -> int:
    print("\n" + "=" * 72)
    print("VERIFY CHECKLIST — gemini.py SDK contract")
    print("=" * 72)
    for key, desc in VERIFY_KEYS:
        if key in errors:
            mark, detail = "ERROR        ", errors[key]
        elif key in observed:
            mark, detail = "OBSERVED     ", observed[key]
        else:
            mark, detail = "NOT OBSERVED ", "(scenario may not have triggered it)"
        print(f"  [{mark}] {desc}")
        print(f"             -> {detail}")

    print("-" * 72)
    print("Legend: OBSERVED = field seen on the wire / call succeeded.")
    print("        NOT OBSERVED = the field/path was never exercised this run;")
    print("            for tool_call / interrupted / go_away / session_resumption")
    print("            this is usually benign (the scenario simply didn't occur),")
    print("            NOT evidence the wrapper is wrong.")
    print("        ERROR = the SDK raised — the contract likely drifted; investigate.")
    print(f"        model tested: {args.model}")
    print("=" * 72)

    # Success = the session opened AND we saw both audio and a transcript, and the
    # wrapper did not error. These are the load-bearing fields the add-on relies on.
    opened = "connect" in observed and "connect" not in errors
    have_audio = "data" in observed
    have_transcript = "output_transcription" in observed or "input_transcription" in observed
    wrapper_ok = "wrapper_events" not in errors
    ok = opened and have_audio and have_transcript and wrapper_ok

    if ok:
        print("RESULT: PASS — session opened, audio + transcript observed.")
        return 0
    print("RESULT: FAIL — see above. Need: session open + audio + transcript + wrapper OK.")
    print(
        f"        opened={opened} audio={have_audio} "
        f"transcript={have_transcript} wrapper_ok={wrapper_ok}"
    )
    return 1


async def _amain(args: argparse.Namespace) -> int:
    observed: dict[str, str] = {}
    errors: dict[str, str] = {}

    await _raw_sdk_pass(args, observed, errors)
    # Let any in-flight tool-response coroutine settle before the wrapper pass.
    await asyncio.sleep(0)
    await _wrapper_pass(args, observed, errors)

    return _print_checklist(observed, errors, args)


def main() -> int:
    args = _parse_args()
    if not args.api_key:
        _no_key_and_exit()

    try:
        import google.genai  # noqa: F401  - presence check only
    except ImportError:
        print("ERROR: google-genai is not installed.", file=sys.stderr)
        print("  pip install google-genai   (Python 3.12)", file=sys.stderr)
        return 2

    return asyncio.run(_amain(args))


if __name__ == "__main__":
    raise SystemExit(main())
