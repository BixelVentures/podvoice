"""Gemini Live session — the single long-lived WebSocket to the Live API (PLAN.md §5).

This module owns the Live protocol. Everything upstream consumes a typed async
event stream (the dataclasses below); tool calls are bridged out to ha_tools.py.

Two hard constraints shape this file:

1. It MUST import on Python 3.9+ even though we target 3.12 — hence
   ``from __future__ import annotations`` and no ``match`` statements.
2. The ``google-genai`` SDK is **lazy-imported inside ``connect()``**. The module
   itself (dataclasses + ``build_config``) imports with stdlib only, so the unit
   suite can import it without the SDK installed.

Every SDK attribute / kwarg / config field that could drift between SDK versions
is marked ``# VERIFY:`` — re-confirm against the pinned google-genai at impl time.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from . import constants as C
from .config import Config
from .voice import (
    AudioChunk,
    GoAway,
    Idle,
    InputTranscript,
    Interrupted,
    OutputTranscript,
    ToolCall,
    ToolCallCancellation,
    TurnComplete,
    VoiceEvent,
)

if TYPE_CHECKING:  # pragma: no cover - typing only, never imported at runtime
    from collections.abc import AsyncIterator

_LOG = logging.getLogger("podvoice.gemini")

# The typed events now live in voice.py (shared across providers). Re-exported
# here so existing ``from gatekeeper.gemini import AudioChunk, ...`` keep working.
GeminiEvent = VoiceEvent
__all__ = [
    "SYSTEM_PROMPT_DA",
    "AudioChunk",
    "GeminiEvent",
    "GeminiLiveSession",
    "GoAway",
    "Idle",
    "InputTranscript",
    "Interrupted",
    "OutputTranscript",
    "ToolCall",
    "ToolCallCancellation",
    "TurnComplete",
    "build_config",
]


# --- Danish system prompt (PLAN §5.10, verbatim) -------------------------------

SYSTEM_PROMPT_DA = """
Du er PodVoice — hjemmets stemmeassistent, ikke en samtalepartner. Du bor hos en dansk familie med voksne, børn og ældre. Dit job: udfør, svar kort, ti stille. Alt du siger læses højt og koster lytterens tid — hvert overflødigt ord er støj i deres stue.

STIL
- Rigsdansk, altid, som tale: ingen markdown, lister, emoji eller symboler.
- ÉN sætning er målet, to er max. Resultatet først: 'Atten grader udenfor.' Ingen indledninger, aldrig 'Er der ellers andet?'.
- Faste kvitteringer, som en lyd: 'Tændt.', 'Slukket.', 'Sat på pause.', 'Næste.', 'Skruet op.', 'Skruet ned.', 'Lagt på listen.' Én pr. svar, aldrig stablet, aldrig omformuleret.
- Gentag aldrig anmodningen: 'Sluk lyset' -> 'Slukket.' — ikke 'Okay, jeg slukker lyset nu.'
- Tal, tid og mål som danske ord: 'kvart over syv', 'enogtyve grader', 'halvtreds kroner', 'to tusind fireogtyve', 'treogtyve komma fem'. Aldrig ciffer for ciffer (undtagen koder), aldrig symboler højt.
- Max tre ting med 'og' — ellers antallet: 'Du har syv lamper — skal jeg nævne dem?'

SPROG
- KUN dansk, uanset hvad brugeren blander ind — aldrig engelsk, norsk eller svensk, og spejl aldrig deres sprog. Radioavis-testen: ville ordet ikke bruges i en dansk radioavis, så skift det ('ikke' aldrig 'inte', 'meget' aldrig 'mycket', 'kun', 'hvad', 'hvordan', 'godt' aldrig 'bra').
- Egennavne oversættes ALDRIG: sig 'Bohemian Rhapsody', 'Movie Night', 'iOS' som de hedder — resten af sætningen er dansk. Tal i navne udtales som navnet plejer (U2, Blink-182).
- 'Du' til alle. Varm, afslappet, aldrig stiv.

SAMTALEN
- Samtalen er åben til brugeren er færdig — de følger op uden wake-ord og må afbryde dig midt i et ord. Afbrudt: stop, lyt, svar på det nye. Ingen undskyldninger, ingen genstart af dit gamle svar.
- Er brugeren færdig — 'farvel', 'stop', 'tak for hjælpen', 'det var det' — så sig ét kort farvel og kald end_conversation. Træk aldrig samtalen i langdrag.
- Tale der tydeligvis ikke er til dig (to der taler sammen, tv, baggrund): bland dig IKKE. I tvivl: højst 'Skal jeg hjælpe?' — aldrig et svar på noget ingen bad dig om.
- Uklart eller støjfyldt input: gæt ALDRIG en handling — 'Det forstod jeg ikke helt. Sig det lige igen?'

TEMPO
- Øjeblikkelig handling (lys, kontakter, scener, gardiner, pause/afspil/næste, lydstyrke, små varmejusteringer): udfør STRAKS, kvitter kort bagefter i datid. Ingen kvittering før — det føles kun langsommere.
- Langsomt opslag (websøgning, nyheder, priser, vejr, hjemmets sensorer, historik, afspilning der skal hentes): sig først under fem ord ('Det tjekker jeg.'), kald tjenesten, ti stille til svaret er der.
- Blandet tur ('sluk lyset og hvad er vejret?'): det øjeblikkelige straks, opslagets kvittering dækker: 'Slukket — vejret tjekker jeg.'

VÆRKTØJER
- list_home viser enheder og rum; list_services viser tjenester og deres FELTER; home_call udfører. Timere: set_timer/cancel_timer/list_timers — send minutter og sekunder ADSKILT, præcis som brugeren sagde dem; regn aldrig selv om.
- Gæt ALDRIG tjeneste-, felt- eller enhedsnavne ('brightness' i stedet for 'brightness_pct' fejler lydløst). Slå op først; genbrug så resten af samtalen; slå kun op igen ved fejl eller nye navne.
- Saml: samme handling flere steder = ét kald; uafhængige handlinger = parallelle kald og samlet kvittering. ALDRIG parallelt for noget der kræver bekræftelse.
- Tvetydigt ('tænd lyset' uden rum)? Brug rummet du står i eller den aktive enhed. Ellers ét enten/eller-spørgsmål: 'Stuen eller køkkenet?' — og det spørgsmål er HELE dit svar.

RESULTATER
- 'summary'/'data' er din kilde, men DU formulerer svaret på dansk — oversæt alt fremmedsprog, bevar kun egennavne. Ved handlinger er 'summary' (fx 'Done.') intern — sig din faste danske kvittering.
- Læs aldrig id'er, JSON, URL'er eller fejltekster højt. 'Lyset i stuen er tændt' — aldrig 'light.stue er on'.
- Tomt-men-ok ('empty') er IKKE en fejl: 'Listen er tom.' Fald aldrig tilbage på egen viden fordi data mangler.
- Kun 'ok: falsk' er en fejl: ved 'denied' sig 'Den enhed er ikke tilføjet endnu'; ellers 'Det kan jeg desværre ikke.'
- Sig hvad dataene siger — ikke hvad du tror de betyder. Kun temperatur retur? Så kun temperaturen.

VIDEN
- Verden uden for hjemmet (nyheder, sportsresultater, priser, alt der kan have ændret sig): slå op via hjemmets SØGETJENESTE — find den med list_services (en tjeneste med returns_response:true, fx søgning) og kald den via home_call med return_response:true. Sig 'Det tjekker jeg.' først. Aktuelle tal fra hukommelsen er ALTID forbudt.
- Findes der ingen søgetjeneste, eller fejler opslaget: sig 'Det kan jeg ikke slå op her.' — digt ALDRIG et svar i stedet.
- Hjemmets egne data (sensorer, vejrudsigt, hvad der spiller) slås op direkte.
- Uforanderligt (matematik, geografi, fysik, afsluttet historie) -> svar direkte, én sætning, max to fakta.
- I tvivl om et tal, navn eller en dato: rund af og markér ('omkring tre hundrede') eller sig 'det er jeg ikke sikker på'. Find ALDRIG på noget. 'Hvorfor'-spørgsmål: kernen i én-to sætninger + 'vil du have den lange forklaring?'

MUSIK
- Pause/afspil/næste/lydstyrke på en aktiv højttaler: straks, max ét ord. Ingen højttaler nævnt = DENNE højttaler; spørg aldrig hvilken.
- Relativ lydstyrke: flyt få trin via den rigtige tjeneste (slå felter op først); find aldrig selv på en procent. Kun konkrete tal sættes absolut.
- 'Spil noget': kort kvittering ('Sætter noget på…'), genoptag det sidste eller vælg bredt, bekræft kort når det spiller. 'Hvad spiller der?': aflæs og svar straks. Historik ('hvad hørte vi i går?') er et opslag.
- Multi-room: 'i hele huset' = gruppér, 'flyt til køkkenet' = flyt, 'også i stuen' = tilføj — via list_services.

SIKKERHED (vejer tungest af alt)
- Reversibelt (lys, musik, gardiner, scener, støvsuger, få navngivne punkter på en liste): udfør straks, tilbyd fortrydelse bagefter. Små varmejusteringer (max tre grader, inden for sytten til fireogtyve) er reversible.
- Bekræft ALTID FØR: låse OP, garage/port, alarm FRA, opkald og beskeder, køb, slette data eller rydde en hel liste, varme uden for intervallet. (Låse, alarm TIL og lukke gardiner kræver ingen bekræftelse.)
- Bekræftelsen nævner handling og enhed: 'Vil du låse hoveddøren op?' — aldrig 'Er du sikker?'. Beskeder: gentag modtager og kerne før afsendelse; uklar modtager -> spørg hvem først.
- Udfør KUN på et helt, utvetydigt 'ja' der svarer direkte på spørgsmålet, i umiddelbar forlængelse af det. Løsrevet, tøvende, fra en anden stemme, eller afbrudt af noget andet = NEJ: gør intet og sig 'Så gør jeg ikke noget.' Afbrydes en ventende bekræftelse, bortfalder handlingen helt.
- Private ting (beskeder, kalender, placering, historik): læs ALDRIG højt på første kommando — andre kan høre med. Ét ikke-følsomt ord + 'Skal jeg læse den højt?'

RETTELSER
- 'Nej, det var køkkenet': fortryd det reversible, udfør det rettede, meld kun det rettede: 'Køkkenet — slukket.'
- Skævt udtalt navn: match til nærmeste rigtige enhed og brug enhedens korrekte navn.
- 'Hvad kan du?': én sætning — lys, varme, scener, gardiner, musik, timere, indkøbslister, og opslag som vejr og historik.
"""


# --- Config builder (PLAN §5.9) ------------------------------------------------


def build_config(
    cfg: Config, tool_declarations: list[dict] | None = None, voice: str | None = None
) -> dict:
    """Assemble the Live ``config`` dict (PLAN §5.9).

    Plain dict (not ``types.LiveConnectConfig``) so this function — and therefore
    the whole module — imports without google-genai. The SDK accepts a dict here.

    ``cfg`` is accepted for forward-compatibility (e.g. surfacing voice / model
    knobs as options later); the field values below are the canonical §5.9 spec.
    """
    config: dict = {
        # VERIFY: response_modalities is the field name; ["AUDIO"] for voice out.
        "response_modalities": ["AUDIO"],
        # VERIFY: system_instruction accepts a plain string on the Live config.
        "system_instruction": getattr(cfg, "system_prompt", "") or SYSTEM_PROMPT_DA,
        # VERIFY: speech_config -> voice_config -> prebuilt_voice_config -> voice_name
        # VERIFY: "Kore" is a Danish-suitable prebuilt voice (PLAN §5.9 flags this).
        "speech_config": {
            "voice_config": {
                "prebuilt_voice_config": {
                    "voice_name": voice or getattr(cfg, "gemini_voice", "") or "Kore"
                }
            }
        },
        # VERIFY: empty dicts enable transcription; the input transcript drives barge-in.
        "input_audio_transcription": {},
        "output_audio_transcription": {},
        # VERIFY: sliding_window key under context_window_compression (PLAN §5.8).
        "context_window_compression": {"sliding_window": {}},
        # VERIFY: session_resumption {} opts in; handle is injected per-connect below.
        "session_resumption": {},
        # Automatic activity detection (VAD) — tunable in Settings. connect() upgrades
        # this to typed objects defensively (so a wrong enum name can't break connect).
        "realtime_input_config": {
            "automatic_activity_detection": {
                "start_of_speech_sensitivity": getattr(cfg, "gemini_vad_start", "high") or "high",
                "end_of_speech_sensitivity": getattr(cfg, "gemini_vad_end", "high") or "high",
                "prefix_padding_ms": int(getattr(cfg, "gemini_prefix_ms", 300)),
                "silence_duration_ms": int(getattr(cfg, "gemini_silence_ms", 500)),
            }
        },
        # NOTE: max_output_tokens is intentionally UNSET. On native-audio models it
        #       counts AUDIO tokens, so any small cap TRUNCATES speech mid-sentence.
        #       Brevity is enforced via the system prompt instead.
        #       VERIFY: temperature / max_output_tokens are even accepted in Live.
        # NOTE: language_code is intentionally NOT set — native-audio auto-selects
        #       the spoken language; Danish is driven by SYSTEM_PROMPT_DA.
    }
    tools: list[dict] = []
    if tool_declarations:
        # VERIFY: tools is a list of {"function_declarations": [...]} blocks (PLAN §5.6).
        tools.append({"function_declarations": list(tool_declarations)})
    if tools:
        config["tools"] = tools
    return config


# --- Live session (satisfies interfaces.GeminiLike) ----------------------------


@dataclass
class GeminiLiveSession:
    """One long-lived Live WebSocket. Satisfies ``interfaces.GeminiLike``.

    Reconnect strategy lives in the orchestrator, not here. The recommended
    bounded exponential backoff for the orchestrator's reconnect loop is::

        delay = min(BASE * 2 ** attempt, CAP)   # e.g. BASE=0.5s, CAP=30s
        await asyncio.sleep(delay + random.uniform(0, JITTER))

    On ``go_away`` (PLAN §5.8) the orchestrator opens a NEW session with the
    stored resume handle and switches over (make-before-break); a hard socket
    drop falls back to ``reconnect()`` (close + connect) below. Auth errors
    (401/403) are non-retryable — fail fast, never tight-loop (PLAN §5.12).
    """

    api_key: str
    model: str
    config: dict
    # Internal SDK handles (typed loosely so the module imports without the SDK).
    _client: object | None = field(default=None, init=False, repr=False)
    _session: object | None = field(default=None, init=False, repr=False)
    _cm: object | None = field(default=None, init=False, repr=False)
    _resume_handle: str | None = field(default=None, init=False, repr=False)

    async def connect(self) -> None:
        """Open the Live WebSocket. Lazy-imports the SDK so the module loads without it."""
        # LAZY IMPORT — do NOT hoist to module top (keeps the module SDK-free).
        from google import genai  # CONFIRMED 2026-06-22: `from google import genai`
        from google.genai import types

        if self._client is None:
            # CONFIRMED: genai.Client(api_key=...) — Gemini Developer API, NOT Vertex.
            self._client = genai.Client(api_key=self.api_key)

        # Start from the plain dict (build_config) and upgrade the two keys the SDK
        # prefers as typed objects; inject the resume handle for make-before-break.
        cfg = {
            k: v
            for k, v in self.config.items()
            if k
            not in ("session_resumption", "context_window_compression", "realtime_input_config")
        }
        cfg["session_resumption"] = types.SessionResumptionConfig(handle=self._resume_handle)
        cfg["context_window_compression"] = types.ContextWindowCompressionConfig(
            sliding_window=types.SlidingWindow()
        )

        # VAD (automatic activity detection) — typed, but never let it break connect.
        ric = self.config.get("realtime_input_config")
        if ric:
            try:  # VERIFY: enum + field names against current google-genai types.
                aad = ric["automatic_activity_detection"]
                start = types.StartSensitivity.START_SENSITIVITY_LOW
                if (aad.get("start_of_speech_sensitivity") or "high") == "high":
                    start = types.StartSensitivity.START_SENSITIVITY_HIGH
                end = types.EndSensitivity.END_SENSITIVITY_LOW
                if (aad.get("end_of_speech_sensitivity") or "high") == "high":
                    end = types.EndSensitivity.END_SENSITIVITY_HIGH
                cfg["realtime_input_config"] = types.RealtimeInputConfig(
                    automatic_activity_detection=types.AutomaticActivityDetection(
                        start_of_speech_sensitivity=start,
                        end_of_speech_sensitivity=end,
                        prefix_padding_ms=int(aad.get("prefix_padding_ms", 300)),
                        silence_duration_ms=int(aad.get("silence_duration_ms", 500)),
                    )
                )
            except Exception as e:  # VAD is a tuning nicety, never load-bearing
                _LOG.warning("Gemini VAD config not applied (%s) — using server defaults", e)

        # CONFIRMED: client.aio.live.connect(model=, config=) is an async context manager.
        self._cm = self._client.aio.live.connect(model=self.model, config=cfg)  # type: ignore[attr-defined]
        # VERIFY: entering the CM yields the live session object.
        self._session = await self._cm.__aenter__()  # type: ignore[attr-defined]

    async def send_audio(self, pcm16k: bytes) -> None:
        """Stream a small raw 16 kHz PCM chunk up (PLAN §5.2)."""
        if self._session is None:
            return
        from google.genai import types  # VERIFY: `from google.genai import types`

        # VERIFY: send_realtime_input(audio=types.Blob(data=, mime_type=)).
        # VERIFY: mime_type "audio/pcm;rate=16000".
        await self._session.send_realtime_input(  # type: ignore[attr-defined]
            audio=types.Blob(
                data=pcm16k,
                mime_type=f"audio/pcm;rate={C.GEMINI_INPUT_RATE}",
            )
        )

    async def send_text(self, text: str) -> None:
        """Send a typed user turn (used by the in-panel console, PLAN.md UI)."""
        if self._session is None:
            return
        # VERIFY: send_client_content(turns=[...], turn_complete=True) shape.
        await self._session.send_client_content(  # type: ignore[attr-defined]
            turns=[{"role": "user", "parts": [{"text": text}]}], turn_complete=True
        )

    async def audio_stream_end(self) -> None:
        """Flush the server's cached audio after a >1 s gate pause (PLAN §5.4)."""
        if self._session is None:
            return
        # VERIFY: send_realtime_input(audio_stream_end=True) is the flush shape.
        await self._session.send_realtime_input(audio_stream_end=True)  # type: ignore[attr-defined]

    async def send_tool_results(self, results: list, *, create: bool = True) -> None:
        """Return FunctionResponses for dispatched tool calls (PLAN §5.6).

        Accepts either pre-built SDK FunctionResponse objects or plain dicts with
        ``id`` / ``name`` / ``response`` keys (so callers stay SDK-free).
        ``create`` exists for signature parity with the OpenAI provider; Gemini Live
        decides for itself whether a FunctionResponse warrants more speech.
        """
        del create
        if self._session is None:
            return
        from google.genai import types  # VERIFY: FunctionResponse import path

        frs = []
        for r in results:
            if isinstance(r, dict):
                frs.append(
                    types.FunctionResponse(
                        id=r.get("id"), name=r.get("name"), response=r.get("response")
                    )
                )
            else:
                frs.append(r)
        # VERIFY: send_tool_response(function_responses=[...]) kwarg name.
        await self._session.send_tool_response(function_responses=frs)  # type: ignore[attr-defined]

    async def events(self) -> AsyncIterator[GeminiEvent]:
        """Async generator of typed events for the WHOLE session — with SEAMLESS resume.

        Two layers of resilience so BOTH the in-panel console and the Voice PE room
        pipeline keep talking without the consumer noticing:
        - ``session.receive()`` yields one turn then returns; we re-enter it so the
          conversation continues across turns (no silence after the first reply).
        - On a server ``go_away`` (session time cap) OR a dropped socket, we transparently
          ``reconnect()`` using the stored resumption handle (make-before-break) and keep
          yielding — the consumer's ``async for`` never ends. Bounded backoff on failure.
        ``close()`` (deliberate teardown) sets ``_session`` to None and stops the loop.
        """
        backoff = 0.5
        failures = 0
        while self._session is not None:
            session = self._session
            resume = False
            try:
                # VERIFY: session.receive() yields a turn's responses then completes.
                async for r in session.receive():  # type: ignore[attr-defined]
                    # VERIFY: r.data is the convenience accessor for raw 24 kHz PCM bytes.
                    data = getattr(r, "data", None)
                    if data is not None:
                        yield AudioChunk(data)

                    # VERIFY: r.tool_call.function_calls[].{id,name,args}.
                    tool_call = getattr(r, "tool_call", None)
                    if tool_call is not None:
                        for fc in tool_call.function_calls:
                            yield ToolCall(fc.id, fc.name, fc.args)

                    # Barge-in mid-tool: the server rescinds in-flight calls — cancel
                    # the pending dispatches so a stale result is never submitted after
                    # the interrupt (Live API: BidiGenerateContentToolCallCancellation).
                    tcc = getattr(r, "tool_call_cancellation", None)
                    if tcc is not None and getattr(tcc, "ids", None):
                        yield ToolCallCancellation(list(tcc.ids))

                    # VERIFY: r.server_content.{input_transcription,output_transcription,
                    #         interrupted,turn_complete}.
                    sc = getattr(r, "server_content", None)
                    if sc is not None:
                        in_tx = getattr(sc, "input_transcription", None)
                        if in_tx is not None:
                            yield InputTranscript(in_tx.text)  # VERIFY: .text attribute
                        out_tx = getattr(sc, "output_transcription", None)
                        if out_tx is not None:
                            yield OutputTranscript(out_tx.text)  # VERIFY: .text attribute
                        if getattr(sc, "interrupted", None):
                            yield Interrupted()
                        if getattr(sc, "turn_complete", None):
                            yield TurnComplete()

                    # VERIFY: r.session_resumption_update.{resumable,new_handle}.
                    update = getattr(r, "session_resumption_update", None)
                    if update is not None and getattr(update, "resumable", False):
                        new_handle = getattr(update, "new_handle", None)
                        if new_handle:
                            self._resume_handle = new_handle

                    # VERIFY: r.go_away.time_left (server's pre-disconnect warning).
                    go_away = getattr(r, "go_away", None)
                    if go_away is not None:
                        yield GoAway(getattr(go_away, "time_left", None))
                        resume = True  # session is closing — resume below, seamlessly
                        break
            except asyncio.CancelledError:
                raise
            except Exception as e:  # dropped socket / server hiccup -> resume
                _LOG.warning("gemini stream dropped (%s) — resuming", e)
                resume = True

            if self._session is None:
                break  # deliberate close()
            if resume:
                try:
                    await self.reconnect()  # preserves _resume_handle (make-before-break)
                    backoff = 0.5
                    failures = 0
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    # A bad/expired API key is not a transient hiccup: retrying forever
                    # just hides "your key is wrong" from the owner (0.66 audit H3).
                    # Raise -> the orchestrator posts ERROR -> audible clip + clean IDLE.
                    msg = str(e)
                    fatal = any(
                        tok in msg
                        for tok in ("401", "403", "UNAUTHENTICATED", "PERMISSION_DENIED", "API key")
                    )
                    failures = failures + 1
                    if fatal or failures >= 6:
                        _LOG.error("gemini resume abandoned (%s) after %d attempts", e, failures)
                        raise
                    _LOG.warning("gemini resume failed (%s) — retry in %.1fs", e, backoff)
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 8.0)
            # else: clean turn-batch end -> loop re-enters receive() on the same session

    async def reconnect(self) -> None:
        """Close + reconnect, preserving the resumption handle (make-before-break).

        ``events()`` calls this automatically on go_away / socket drop, so both the
        console and the room pipeline resume seamlessly without the consumer noticing.
        """
        await self.close()
        await self.connect()

    async def close(self) -> None:
        """Tear down the WebSocket; preserves the resume handle for reconnect."""
        cm = self._cm
        self._cm = None
        self._session = None
        if cm is not None:
            # VERIFY: exiting the CM closes the session cleanly.
            await cm.__aexit__(None, None, None)  # type: ignore[attr-defined]
