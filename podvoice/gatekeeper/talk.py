"""Talk tab = the REAL engine (0.90): the browser is a *device*, not a side-channel.

Talk exercises the same ``ThinSession`` logic as Voice PE, but remains browser evidence:
it cannot prove the puck's physical wake, microphone, loudspeaker or audible latency.

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
import uuid
from collections.abc import AsyncIterator
from typing import Any

from aiohttp import WSMsgType

log = logging.getLogger("podvoice.talk")

TALK_ROOM = "talk"
PROTOCOL_VERSION = 2
_QUEUE_MAXSIZE = 200  # ~4 s of 20 ms frames, same backpressure policy as the puck link
_COMMAND_JOIN_DIAGNOSTIC_S = 2.0  # Report stuck cleanup; never abandon its owned task.


class TalkConnection:
    """One ordered, versioned server->browser channel.

    aiohttp preserves WebSocket frame order, but the old TalkHub created an independent
    task for every message before frames reached aiohttp.  This single writer makes the
    engine's causal order the browser's order and attaches correlation metadata once.
    """

    def __init__(self, ws) -> None:
        self.ws = ws
        self.connection_id = uuid.uuid4().hex
        self._seq = 0
        self._session = None
        self._q: asyncio.Queue[tuple[str, object, asyncio.Future | None] | None] = asyncio.Queue()
        self._writer_task: asyncio.Task | None = None

    def attach(self, session) -> None:
        self._session = session

    def start(self) -> None:
        if self._writer_task is None:
            self._writer_task = asyncio.create_task(self._writer(), name="talk-ws-writer")

    def _envelope(self, payload: dict) -> dict:
        self._seq += 1
        session_id = getattr(self._session, "_history_session", "") or None
        turn_id = None
        if self._session is not None and hasattr(self._session, "_external_turn_id"):
            turn_id = self._session._external_turn_id()
        return {
            **payload,
            "v": PROTOCOL_VERSION,
            "seq": self._seq,
            "connection_id": self.connection_id,
            "session_id": payload.get("session_id", session_id),
            "turn_id": payload.get("turn_id", turn_id),
            "adapter": "talk",
            "evidence": "browser",
        }

    async def send_json(self, payload: dict) -> None:
        loop = asyncio.get_running_loop()
        done = loop.create_future()
        await self._q.put(("json", self._envelope(payload), done))
        await done

    def post_json(self, payload: dict) -> None:
        self._q.put_nowait(("json", self._envelope(payload), None))

    async def send_bytes(self, payload: bytes) -> None:
        loop = asyncio.get_running_loop()
        done = loop.create_future()
        await self._q.put(("bytes", payload, done))
        await done

    async def _writer(self) -> None:
        while True:
            item = await self._q.get()
            if item is None:
                return
            kind, payload, done = item
            try:
                if kind == "json":
                    await self.ws.send_json(payload)
                else:
                    await self.ws.send_bytes(payload)
                if done is not None and not done.done():
                    done.set_result(None)
            except Exception as exc:
                if done is not None and not done.done():
                    done.set_exception(exc)

    async def aclose(self) -> None:
        if self._writer_task is None:
            return
        await self._q.put(None)
        with contextlib.suppress(Exception):
            await self._writer_task
        self._writer_task = None

    def __aiter__(self):
        return self.ws.__aiter__()


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
        self.supports_playback_ids = True
        # Native Chrome audio verified with the exact non-seekable Live WAV route.
        # This is browser transport capability, never physical Voice PE evidence.
        self.supports_live_wav = True
        # Callbacks the engine wires (same names as VoicePELink).
        self.on_wake: Any = None
        self.on_media_state: Any = None
        self.on_playback_fault: Any = None
        self.on_event: Any = None
        self.on_mute: Any = None
        self.on_reconnect: Any = None
        # Mic-health counters (the panel's S1 read expects these names).
        self.frames_in = 0
        self.bytes_in = 0
        self.last_audio_ts = 0.0
        self._playback_serial = 0
        self._playback_id: str | None = None
        self._playback_phase = "idle"

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
    async def play_url(self, url: str, *, playback_id: str | None = None) -> None:
        """The browser fetches the SAME reply-bus stream the puck would announce."""
        if playback_id is None:
            self._playback_serial += 1
            playback_id = f"play-{self._playback_serial}"
        self._playback_id = playback_id
        self._playback_phase = "issued"
        await self._safe_json({"type": "play", "url": url, "playback_id": self._playback_id})

    async def stop_playback(self, *, playback_id: str | None = None) -> bool:
        """Stop exactly the reply owned by the caller, never a newer browser reply."""
        owned_id = playback_id or self._playback_id
        sent = await self._safe_json(
            {
                "type": "stop_playback",
                "playback_id": owned_id,
            }
        )
        if not sent:
            return False
        if self._playback_id == owned_id:
            self._playback_id = None
            self._playback_phase = "idle"
        return True

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

    def media_state(self, announcing: bool, playback_id: str | None = None) -> None:
        """The reply <audio> element started/finished — the engine's playback truth
        (drives the echo shield and 'reply finished playing' exactly like the puck)."""
        if not playback_id or playback_id != self._playback_id:
            log.info(
                "talk: ignored stale playback edge %s (current=%s)", playback_id, self._playback_id
            )
            return
        expected = "issued" if announcing else "started"
        if self._playback_phase != expected:
            log.info(
                "talk: ignored out-of-order playback edge %s (phase=%s id=%s)",
                "started" if announcing else "finished",
                self._playback_phase,
                playback_id,
            )
            return
        self._playback_phase = "started" if announcing else "finished"
        if self.on_media_state is not None:
            self.on_media_state(bool(announcing), playback_id)
        if not announcing:
            self._playback_id = None
            self._playback_phase = "idle"

    def playback_fault(self, playback_id: str | None, reason: str) -> None:
        if not playback_id or playback_id != self._playback_id:
            log.info("talk: ignored stale playback fault %s", playback_id)
            return
        if reason == "blocked":
            log.info("talk: browser autoplay blocked for %s; keeping reply pending", playback_id)
            return
        self._playback_phase = "fault"
        if self.on_playback_fault is not None:
            self.on_playback_fault(playback_id, reason=reason)
        self._playback_id = None

    async def _safe_json(self, payload: dict) -> bool:
        try:
            await self._send_json(payload)
        except Exception:  # callers decide whether this edge is safety-critical
            return False
        return True


class TalkHub:
    """StatusHub-shaped adapter: the engine's status calls become WS messages, so the
    tab shows the same state/activity/transcripts the panel shows for a real room."""

    def __init__(self, send_json, history=None) -> None:
        self._send = send_json  # async callable(dict)
        owner = getattr(send_json, "__self__", None)
        self._post_ordered = getattr(owner, "post_json", None)
        self._history = history
        self._pending: set[asyncio.Task] = set()

    def _post(self, payload: dict) -> None:
        if self._post_ordered is not None:
            self._post_ordered(payload)
            return
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

    def submitted_text(
        self,
        room: str,
        text: str,
        *,
        ts: float | None = None,
        session: str | None = None,
    ) -> None:
        """Persist accepted typed input; command_result owns its one visible bubble."""
        if self._history is not None and text:
            self._history.append(
                room,
                "in",
                text,
                ts=time.time() if ts is None else ts,
                session=session,
            )

    def set_latency(self, room: str, ms: float | None) -> None:
        if ms is not None:
            self._post({"type": "latency", "ms": round(ms)})

    def timeline(self, room: str, event: str, **details) -> None:
        self._post({"type": "timeline", "event": event, **details})

    # Panel-global concerns that don't apply to a browser session: quiet no-ops.
    def register_room(self, room: str) -> None:
        pass

    def set_connected(self, room: str, ok: bool) -> None:
        pass

    def set_service(
        self,
        name: str,
        status: str,
        *,
        reason: str | None = None,
        source: str | None = None,
    ) -> None:
        # StatusHub accepts runtime evidence metadata. Talk has no global service
        # dashboard of its own, but it must implement the same call contract so a
        # provider status update can never abort the shared ThinSession lifecycle.
        pass

    def set_level(self, room: str, level: int) -> None:
        pass

    def incr(self, metric: str, n: int = 1) -> None:
        pass


async def run_talk(ws, session, link: BrowserLink) -> None:
    """Bridge one Talk WebSocket to its (already-built) ThinSession until close.

    The engine owns everything; this loop only moves browser events in. On socket
    close the session is torn down exactly like a room shutdown (music released)."""
    await session.start()
    await ws.send_json(
        {
            "type": "hello",
            "engine": "thin",
            "protocol": PROTOCOL_VERSION,
            "rate": 24000,
            "conversation": "idle",
        }
    )
    commands: asyncio.Queue[tuple[int, dict, bool] | None] = asyncio.Queue()
    command_epoch = 0
    running: asyncio.Task | None = None
    stopping = False
    stop_task: asyncio.Task | None = None
    stop_commands: list[str] = []
    stop_receipts: dict[str, dict] = {}

    async def receipt(correlation_id: str, **result) -> None:
        with contextlib.suppress(Exception):
            await ws.send_json({"type": "command_result", **result, "command_id": correlation_id})

    async def execute(data: dict) -> dict:
        if data["type"] == "wake":
            await session.wake()
            active = bool(getattr(session, "_active", False))
            return {
                "status": "accepted" if active else "rejected",
                "code": "accepted" if active else "unavailable",
            }
        return await session.submit_text(str(data.get("text") or ""), data["command_id"])

    async def command_worker() -> None:
        nonlocal running
        while True:
            queued = await commands.get()
            if queued is None:
                return
            epoch, data, rejected_during_stop = queued
            command_id = data["command_id"]
            if epoch != command_epoch or rejected_during_stop or stopping:
                await receipt(command_id, status="rejected", code="stopped")
                continue
            task = asyncio.create_task(execute(data), name="talk-command")
            running = task
            try:
                result = await task
            except asyncio.CancelledError:
                owner = asyncio.current_task()
                if owner is not None and owner.cancelling():
                    raise
                result = {"status": "rejected", "code": "stopped"}
            except Exception as exc:
                log.warning(
                    "talk command %s failed without killing the socket: %s", data["type"], exc
                )
                result = {
                    "status": "rejected",
                    "code": "internal_error",
                    "message": "Kommandoen fejlede; prøv igen.",
                }
            finally:
                if running is task:
                    running = None
            # A cancellation-resistant command cannot publish success after Stop.
            if epoch != command_epoch:
                result = {"status": "rejected", "code": "stopped"}
            await receipt(command_id, **result)

    async def perform_stop(interrupted: asyncio.Task | None) -> None:
        nonlocal stopping
        succeeded = False
        try:
            # Thin owns its cancellation-safe close transaction. Do not wait for
            # the interrupted command before invoking that owner.
            await session.stop(reason="panel")
            if interrupted is not None:
                await asyncio.gather(interrupted, return_exceptions=True)
            succeeded = True
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("talk Stop failed without killing the socket: %s", exc)
        finally:
            # Failed close remains fenced; it cannot authorize a fresh wake.
            for command_id in stop_commands:
                result = {
                    "status": "accepted" if succeeded else "rejected",
                    "code": "accepted" if succeeded else "internal_error",
                }
                stop_receipts[command_id] = result
                if len(stop_receipts) > 128:
                    del stop_receipts[next(iter(stop_receipts))]
                with contextlib.suppress(Exception):
                    await receipt(command_id, **result)
            stop_commands.clear()
            if succeeded:
                stopping = False

    worker = asyncio.create_task(command_worker(), name="talk-command-worker")
    try:
        async for msg in ws:
            if msg.type == WSMsgType.BINARY:
                link.feed(msg.data)
            elif msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except (json.JSONDecodeError, ValueError):
                    continue
                if not isinstance(data, dict):
                    continue
                kind = data.get("type")
                if kind in ("wake", "stop", "text"):
                    data["command_id"] = str(data.get("command_id") or uuid.uuid4().hex)
                if kind == "stop":
                    if data["command_id"] in stop_receipts:
                        await receipt(data["command_id"], **stop_receipts[data["command_id"]])
                        continue
                    if data["command_id"] not in stop_commands:
                        stop_commands.append(data["command_id"])
                    if stop_task is None or stop_task.done():
                        command_epoch += 1  # Fence queued work before yielding to any await.
                        stopping = True
                        interrupted = running
                        if interrupted is not None:
                            interrupted.cancel()
                        stop_task = asyncio.create_task(perform_stop(interrupted), name="talk-stop")
                elif kind in ("wake", "text"):
                    commands.put_nowait((command_epoch, data, stopping))
                elif kind == "media":
                    playback_id = str(data.get("playback_id")) if data.get("playback_id") else None
                    state = str(data.get("state") or "")
                    if state in ("fault", "blocked"):
                        link.playback_fault(playback_id, state)
                    else:
                        link.media_state(bool(data.get("announcing")), playback_id)
                elif kind == "ping":
                    await ws.send_json({"type": "pong", "ping_id": data.get("ping_id")})
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
            elif msg.type == WSMsgType.ERROR:
                break
    finally:
        command_epoch += 1
        stopping = True
        commands.put_nowait(None)
        worker.cancel()
        # Invoke the existing Thin close owner before joining a cancelled command:
        # its SDK cleanup may be what releases a cancellation-resistant send.
        closing = asyncio.create_task(session.aclose(), name="talk-session-close")
        try:
            await asyncio.shield(closing)
        except asyncio.CancelledError:
            await asyncio.shield(closing)
            raise
        finally:
            if stop_task is not None and not stop_task.done():
                stop_task.cancel()
            owned = [worker, *([stop_task] if stop_task is not None else [])]
            _, pending = await asyncio.wait(owned, timeout=_COMMAND_JOIN_DIAGNOSTIC_S)
            if pending:
                log.error(
                    "talk command cleanup still pending after provider close; retaining ownership"
                )
            await asyncio.gather(*owned, return_exceptions=True)
