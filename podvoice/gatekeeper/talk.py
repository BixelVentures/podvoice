"""Talk tab = the REAL engine (0.90): the browser is a *device*, not a side-channel.

The old console was a raw browser<->model bridge that bypassed every rule the puck
lives by (no wake gate, no idle close, no echo shield, different transport closure) — so the
tab could never PROVE the product. Now the mic button fires the same ``wake()`` as
"Okay Nabu", and the browser plays the same reply-bus FLAC stream the puck fetches:
tools, goodbye, idle fallback, conversation cap, echo shield — all identical by
construction, because it IS the same ThinSession.

Wire protocol (WebSocket):
  browser -> server:  {"type":"wake"}                  mic button == "Okay Nabu"
                      {"type":"media","announcing":b}  reply <audio> started/ended
                      {"type":"text","text":...}       typed input (mid-conversation)
                      binary                            16 kHz PCM mic frames
  server -> browser:  {"type":"mic","on":b}            forward-gate state (privacy truth)
                      {"type":"play","url":...}        fetch+play this reply stream
                      {"type":"stop_playback"}         barge/stop: silence NOW
                      {"type":"led","on":b,"rgb":[..],"brightness":f}  the "ring"
                      {"type":"state","state":...,"turn_cue":b} IDLE/LISTENING/AI_SPEAKING
                      {"type":"activity","text":...}   the same activity feed lines
                      {"type":"transcript","dir":..,"text":..}
                      binary                            24 kHz PCM (error clips)
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

from aiohttp import WSMsgType

log = logging.getLogger("podvoice.talk")

TALK_ROOM = "talk"
_QUEUE_MAXSIZE = 200  # ~4 s of 20 ms frames, same backpressure policy as the puck link


class BrowserLink:
    """The browser as a Voice PE: same contract surface ThinSession drives.

    Satisfies the (hasattr-guarded) ``VoicePELinkLike`` subset thin.py uses, so the
    Talk tab exercises the very same engine code paths as the hardware puck.
    """

    def __init__(self, send_json, send_bytes, *, room: str = TALK_ROOM) -> None:
        self.host = "browser"
        self.room = room
        self._send_json = send_json  # async callable(dict)
        self._send_bytes = send_bytes  # async callable(bytes)
        self._audio_q: asyncio.Queue[bytes] = asyncio.Queue(maxsize=_QUEUE_MAXSIZE)
        self._streaming = False  # forward-gate: mirrors podvoice_stream_start/stop
        # Same lifecycle generation as the physical adapter. Only the audio I/O differs.
        self.supports_podvoice_channel = True
        self.supports_same_breath = True
        self.supports_direct = False
        # Callbacks the engine wires (same names as VoicePELink).
        self.on_wake: Any = None
        self.on_media_state: Any = None
        self.on_event: Any = None
        self.on_mute: Any = None
        self.on_reconnect: Any = None
        # Mic-health counters (the panel's S1 read expects these names).
        self.frames_in = 0
        self.bytes_in = 0
        self.last_audio_ts = 0.0

    # ---------------------------------------------------------------- lifecycle
    async def start(self) -> None:  # the socket IS the connection
        return None

    async def aclose(self) -> None:
        return None

    # ---------------------------------------------------------------- mic path
    def feed(self, data: bytes) -> None:
        """One binary WS frame of 16 kHz PCM from the browser mic."""
        if not self._streaming:
            return  # gate CLOSED — same privacy truth as the puck's mic-forward
        self.frames_in += 1
        self.bytes_in += len(data)
        self.last_audio_ts = asyncio.get_event_loop().time()
        try:
            self._audio_q.put_nowait(data)
        except asyncio.QueueFull:
            pass  # drop rather than block the socket reader

    def pcm_frames(self) -> AsyncIterator[bytes]:
        async def _gen() -> AsyncIterator[bytes]:
            while True:
                yield await self._audio_q.get()

        return _gen()

    def drain_mic(self) -> int:
        n = 0
        while not self._audio_q.empty():
            with contextlib.suppress(asyncio.QueueEmpty):
                self._audio_q.get_nowait()
                n += 1
        return n

    async def start_streaming(self) -> bool:
        if self._streaming:
            return True  # keepalive re-assert — nothing to tell the browser
        self._streaming = True
        await self._safe_json({"type": "mic", "on": True})
        return True

    async def stop_streaming(self) -> bool:
        if not self._streaming:
            return True
        self._streaming = False
        await self._safe_json({"type": "mic", "on": False})
        return True

    # ---------------------------------------------------------------- speaker path
    async def play_url(self, url: str) -> None:
        """The browser fetches the SAME reply-bus stream the puck would announce."""
        await self._safe_json({"type": "play", "url": url})

    async def stop_playback(self) -> None:
        await self._safe_json({"type": "stop_playback"})

    async def play_pcm(self, chunk: bytes) -> None:
        """Raw 24 kHz PCM (error clips via Playback) — the old binary channel."""
        with contextlib.suppress(Exception):
            await self._send_bytes(chunk)

    async def set_light(self, on: bool, rgb: tuple[float, float, float], brightness: float) -> None:
        await self._safe_json({"type": "led", "on": on, "rgb": list(rgb), "brightness": brightness})

    # ---------------------------------------------------------------- browser events
    def fire_wake(self) -> None:
        """Mic button pressed == the wake word was heard."""
        if self.on_wake is not None:
            self.on_wake()

    def media_state(self, announcing: bool) -> None:
        """The reply <audio> element started/finished — the engine's playback truth
        (drives the echo shield and 'reply finished playing' exactly like the puck)."""
        if self.on_media_state is not None:
            self.on_media_state(bool(announcing))

    async def _safe_json(self, payload: dict) -> None:
        with contextlib.suppress(Exception):  # a closed socket must never break the engine
            await self._send_json(payload)


class TalkHub:
    """StatusHub-shaped adapter: the engine's status calls become WS messages, so the
    tab shows the same state/activity/transcripts the panel shows for a real room."""

    def __init__(self, send_json, history=None) -> None:
        self._send = send_json  # async callable(dict)
        self._history = history
        self._pending: set[asyncio.Task] = set()

    def _post(self, payload: dict) -> None:
        task = asyncio.ensure_future(self._send_quiet(payload))
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    async def _send_quiet(self, payload: dict) -> None:
        with contextlib.suppress(Exception):
            await self._send(payload)

    # --- the StatusHub surface thin.py touches ---------------------------------
    def set_state(self, room: str, state: str, *, turn_cue: bool = False) -> None:
        self._post({"type": "state", "state": state, "turn_cue": bool(turn_cue)})

    def activity(self, room: str, text: str) -> None:
        self._post({"type": "activity", "text": text})

    def tool_call(
        self, room: str, name: str, result: dict | None = None, args: dict | None = None
    ) -> None:
        result = result or {}
        # The browser reads `ev.result`. The old flat shape made EVERY call render ✕
        # and hid the real MCP error even when the call succeeded.
        self._post(
            {
                "type": "tool",
                "room": room,
                "name": name,
                "args": args or {},
                "result": result,
            }
        )

    def transcript_delta(self, room: str, direction: str, text: str) -> None:
        # Realtime input transcription is asynchronous: the completed USER text can
        # arrive after the model has already started its spoken acknowledgement. Raw
        # deltas therefore rendered as "Det tjekker" -> USER -> "jeg." in Talk even
        # though the audible conversation was correct. ThinSession already coalesces
        # whole utterances; only show those authoritative display turns here.
        pass

    def transcript(
        self,
        room: str,
        direction: str,
        text: str,
        *,
        ts: float | None = None,
        session: str | None = None,
    ) -> None:
        if text:
            observed_at = time.time() if ts is None else ts
            # Keep the established browser wire shape; the timestamp is persistence
            # metadata used by the History tab, not another Talk rendering protocol.
            self._post({"type": "transcript", "dir": direction, "text": text})
        if self._history is not None and text:
            self._history.append(room, direction, text, ts=observed_at, session=session)

    def set_latency(self, room: str, ms: float | None) -> None:
        if ms is not None:
            self._post({"type": "latency", "ms": round(ms)})

    # Panel-global concerns that don't apply to a browser session: quiet no-ops.
    def register_room(self, room: str) -> None:
        pass

    def set_connected(self, room: str, ok: bool) -> None:
        pass

    def set_service(self, name: str, status: str) -> None:
        pass

    def set_level(self, room: str, level: int) -> None:
        pass

    def incr(self, metric: str, n: int = 1) -> None:
        pass


async def run_talk(ws, session, link: BrowserLink) -> None:
    """Bridge one Talk WebSocket to its (already-built) ThinSession until close.

    The engine owns everything; this loop only moves browser events in. On socket
    close the session is torn down exactly like a room shutdown (music released)."""
    await ws.send_json({"type": "hello", "engine": "thin", "rate": 24000})
    await session.start()
    try:
        async for msg in ws:
            if msg.type == WSMsgType.BINARY:
                link.feed(msg.data)
            elif msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except (json.JSONDecodeError, ValueError):
                    continue
                kind = data.get("type")
                if kind == "wake":
                    link.fire_wake()
                elif kind == "media":
                    link.media_state(bool(data.get("announcing")))
                elif kind == "mic_config":
                    log.info(
                        "talk: browser mic context_rate=%s track_rate=%s "
                        "echo_cancel=%s noise_suppression=%s auto_gain=%s",
                        data.get("context_rate"),
                        data.get("track_rate"),
                        data.get("echo_cancellation"),
                        data.get("noise_suppression"),
                        data.get("auto_gain_control"),
                    )
                elif kind == "stop":
                    with contextlib.suppress(Exception):
                        await session.stop(reason="panel")
                elif kind == "text" and data.get("text"):
                    # Typed input rides the SAME conversation (wake first if idle).
                    if not getattr(session, "_active", False):
                        # Wait for the actual provider-ready boundary. The previous
                        # guessed sleep lost the first text when connect took >300 ms.
                        await session.wake()
                    with contextlib.suppress(Exception):
                        await session.brain.send_text(str(data["text"]))
            elif msg.type == WSMsgType.ERROR:
                break
    finally:
        with contextlib.suppress(Exception):
            await session.aclose()
