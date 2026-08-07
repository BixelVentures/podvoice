"""Panel-managed settings, persisted to the add-on's own /data (not options.json).

Everything except the OpenAI API key lives here and is edited in the sidebar
panel's Settings page — keeping the HA add-on Configuration tab down to a single
field (the key). The key stays an add-on option because HA's masked secret field
is the right place for it.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import pathlib

from . import constants as C
from .prompt import SYSTEM_PROMPT_DA

_LOG = logging.getLogger("podvoice.settings")

SETTINGS_PATH = pathlib.Path("/data/podvoice.json")


def _resolve(path: pathlib.Path | None) -> pathlib.Path:
    """Resolve the settings file: explicit arg > PODVOICE_SETTINGS env > default.

    Reading the module global at call time keeps it monkeypatch-friendly in tests.
    """
    if path is not None:
        return path
    env = os.environ.get("PODVOICE_SETTINGS")
    return pathlib.Path(env) if env else SETTINGS_PATH


# Bumping this triggers the one-time stale-tuning reset in load_settings(): any saved
# file with an older (or missing) version gets its TUNING_KEYS dropped, so values saved
# under old defaults (watchdog 800ms, lounge 0s, near_field noise…) can't keep overriding
# retuned defaults forever. Identity settings (keys, rooms, prompts) are kept.
# v3: the OpenAI-only overhaul — drops saved gemini_*/provider knobs (now unknown keys)
# and resets openai_model so the gpt-realtime-2.1-mini default actually lands.
SETTINGS_VERSION = 4

# sha256 of RETIRED default system prompts. A saved prompt matching one of these is
# just a persisted copy of an old default (the panel saves every field on Save) —
# drop it on load so the CURRENT default applies. A genuinely customized prompt
# never matches and is always kept.
LEGACY_PROMPT_HASHES = frozenset(
    {
        # pre-MCP default (referenced list_home/list_services/home_call) — retired 0.91
        "38e4311b176b5f3696516e36c5d3c38ee4b23294f84753860c01e7a03991619b",
        "0f96cf58ee764eb07fb0d98618ce592e17fea22d92bc1b44fff8d3b79f964ae4",
        "93e0a784292b139f0af3e2ab514295c229f32ca08a0360f6719a84a7a8e656c5",
        "fbdfefcea1f6da605e9db71121a3b3eb129f88f490263831ac74fb05ad0bf238",
        "110b997af4109665dca58344c421d43096c220d4a4bd2e817794d988a5ad2051",
        "15190f65641d422d3ce1406c4aefafc7943d8e24ffbfd281183b4fad50324559",
        "362dd769128e25955d51c99388f97746fbade4ed848063c7c736870d98792253",
        "3c00a2f3527c4da041dfac3186589adb36efaee1cc03a40f9cc0d0b607c871c0",
        "48fb7e5e8aa9bf09d0af0dd835ae845034a54137d06e605bb096ef61e8b92d8c",
        "502f06d06e168bcca2fdb24267cc1b92bcf11e05822afdf5701dd22e68361559",
        "6a011af37bff0706624c9fb2172b60e32c2b840c3b7a619238acce2a89f12c7c",
        "a666b92c790f220210c648e82f248e9167c8ff54e1f4f60ff3a8263312c76371",
        "ab05b51319d2e3ee41b87170017b944c25e79bc983cc419e3c51dd1137cea3cb",
        "b477a58004a5404e5ec43808d2848628db8bae492e0657e89ab425171a3a5291",
        "bf688e5ce5fc74b9828b4d92473a3b832f823501b502b220ad78c08cd165123c",
        "c4225cd129121611a8a02b29c7fca3289d55bcc5edc612eb3a3a448b41b12f7a",
        "ce4450bcdddc7dabb0adb74fad2231f2f071e993f61957d3a1a1cdca71ad2fff",
        "dec42bbffe405fa6ce80758409300764843d6a8c7ad00b6c3d637ea90437e540",
        "f9ca666875134a52804ee2275f81ca17c8bfcd96278c973c83f574096274841d",
    }
)

# The tunable knobs that the version bump resets. Everything NOT here survives a reset.
TUNING_KEYS: frozenset[str] = frozenset(
    {
        "duck_level",
        "lounge_level",
        "lounge_window_s",
        "heartbeat_ms",
        "watchdog_ms",
        "vad_threshold",
        "openai_model",
        "turn_preset",
        # v4: full_duplex is GATED (ARKITEKTUR matrix-C). A `true` saved back in the
        # 0.68 experiments survived every migration and silently disabled the echo
        # shield on 0.92+ (self-interrupting puck, broken audio, 2026-08-06). Any
        # saved value is dropped on upgrade — it can only be turned on deliberately,
        # after the gate. Same for a stale semantic_vad turn from that era.
        "full_duplex",
        "openai_turn",
        "openai_threshold",
        "openai_prefix_ms",
        "openai_silence_ms",
        "openai_eagerness",
        "openai_noise",
        "mic_channel",
        "mic_gain",
        "idle_timeout_s",
        "max_session_min",
    }
)

# Panel-editable fields and their defaults. The OpenAI API key is intentionally
# NOT here (it's the one add-on option).
DEFAULTS: dict = {
    "settings_version": SETTINGS_VERSION,
    "simulate": False,
    "full_duplex": False,  # half-duplex (continued conversation) is the shipped mode; True is
    # the experimental open-mic duplex opt-in (Phase 1.4 test matrix gates promotion)
    "system_prompt": SYSTEM_PROMPT_DA,  # who the assistant is + what it can do (editable)
    "openai_model": "gpt-realtime-2.1-mini",
    "openai_voice": "marin",
    "force_mini": False,  # cost guard: clamp EVERY session (rooms + Talk) to the mini model
    # Turn detection: a preset, or "custom" driven by the raw knobs below.
    # conservative = server_vad tuned hard-to-interrupt (residual echo past the XMOS AEC
    # must not read as barge-in); responsive = semantic_vad, easiest to interrupt.
    "turn_preset": "conservative",  # conservative|responsive|custom
    "openai_turn": "semantic_vad",  # custom: server_vad|semantic_vad|none
    "openai_threshold": 0.5,  # custom, server_vad only
    "openai_prefix_ms": 300,  # custom, server_vad only
    "openai_silence_ms": 500,  # custom, server_vad only
    "openai_eagerness": "auto",  # custom, semantic_vad: auto|low|medium|high
    "openai_noise": "far_field",  # near_field|far_field|off
    # Microphone tuning, re-asserted on EVERY device connect. The firmware's own
    # defaults are only a starting point: a live tweak that lives in RAM is lost the
    # moment the puck reboots, and nobody notices until transcription quietly gets
    # worse again. These are the source of truth.
    "mic_channel": 1,  # 1 = raw (what modern STT wants), 0 = the processed channel
    "mic_gain": 16,  # replaces the AGC the raw channel lacks (1..64)
    "idle_timeout_s": 8,  # close the conversation after this much user silence (owner-tunable 3+)
    "max_session_min": 15,  # hard ceiling on one conversation (cost control)
    "engine": "classic",  # "classic" (the proven state-machine engine) | "thin" (Track B:
    # the model owns the conversation — turn-taking, barge-in, idle — via server VAD)
    "reply_streaming": False,  # stream the reply FLAC as it's generated (kills the pre-reply
    # silence) — experimental until verified on the device; buffered is the safe default
    "speaker_path": "announce",  # "announce" (HTTP/FLAC via media_player, hardware-proven) |
    # "direct" (raw PCM over the native API into the VA speaker — needs the 0.67 firmware)
    "panel_lan_open": False,  # False = panel/API only via HA Ingress (the sidebar). True
    # re-opens direct LAN access to :8098 (unauthenticated — you're on your own)
    "podconnect_base_url": "http://homeassistant.local:8099",
    "podconnect_token": "",
    "voicepe_noise_psk": "",
    # HA MCP server (home control). Empty url = the Supervisor proxy default
    # (http://supervisor/core/api/mcp with the add-on's own token). Which entities
    # the assistant may touch is governed by HA: Settings -> Voice assistants.
    "ha_mcp_url": "",
    "ha_mcp_token": "",
    "rooms": [],  # list of {"voicepe_host": str, "room": str}
    "duck_level": C.DUCK_LEVEL,
    "lounge_level": C.LOUNGE_LEVEL,
    "lounge_window_s": C.LOUNGE_WINDOW_S,
    "heartbeat_ms": C.HEARTBEAT_MS,
    "watchdog_ms": C.WATCHDOG_MS,
    "vad_threshold": C.VAD_THRESHOLD,
}


def load_settings(path: pathlib.Path | None = None) -> dict:
    """Return defaults overlaid with any saved panel settings.

    Saved files from an older SETTINGS_VERSION get their TUNING_KEYS dropped (one-time
    stale-tuning reset) and are re-stamped, so old bad knob values can't silently override
    retuned defaults across upgrades. Identity settings always survive.
    """
    src = _resolve(path)
    data = dict(DEFAULTS)
    try:
        if src.exists():
            saved = json.loads(src.read_text())
            if int(saved.get("settings_version") or 1) < SETTINGS_VERSION:
                stale = sorted(k for k in saved if k in TUNING_KEYS)
                if stale:
                    _LOG.info(
                        "settings v%s -> v%s: resetting stale tuning to defaults: %s",
                        saved.get("settings_version") or 1,
                        SETTINGS_VERSION,
                        ", ".join(stale),
                    )
                saved = {k: v for k, v in saved.items() if k not in TUNING_KEYS}
                saved["settings_version"] = SETTINGS_VERSION
                with contextlib.suppress(Exception):  # migration write-back is best-effort
                    src.write_text(json.dumps(saved, indent=2))
            sp = saved.get("system_prompt")
            # A saved prompt that still teaches the RETIRED REST tools (list_home /
            # list_services / home_call) is stale by construction: those tools were
            # deleted with the MCP switch, so the model is being told to call things
            # that do not exist (the 0.88 class — prompt promises, toolset can't).
            # Hash-matching only catches untouched defaults; this catches edited ones.
            if isinstance(sp, str) and any(
                dead in sp for dead in ("list_home", "list_services", "home_call")
            ):
                _LOG.warning(
                    "saved system_prompt names RETIRED tools (list_home/list_services/"
                    "home_call) — dropping it and using the current default"
                )
                saved.pop("system_prompt", None)
                sp = None
            if isinstance(sp, str):
                import hashlib

                if hashlib.sha256(sp.strip().encode()).hexdigest() in LEGACY_PROMPT_HASHES:
                    saved.pop("system_prompt", None)  # stale copy of an old default
            data.update({k: v for k, v in saved.items() if k in DEFAULTS})
    except Exception as e:  # corrupt file must not stop the add-on
        _LOG.warning("could not read %s: %s — using defaults", src, e)
    return data


# Secret-valued settings: masked on read (panel GET), and a masked value coming BACK
# on save is ignored so a round-tripped form can't overwrite the real secret.
SECRET_SETTINGS = frozenset({"podconnect_token", "voicepe_noise_psk", "ha_mcp_token"})
SECRET_MASK = "********"


def masked(settings: dict) -> dict:
    """Copy with secret values replaced by the mask (empty stays empty)."""
    out = dict(settings)
    for k in SECRET_SETTINGS:
        if out.get(k):
            out[k] = SECRET_MASK
    return out


def _coerce(key: str, value, template) -> object:
    """Coerce ``value`` to the DEFAULTS type for ``key``; raise ValueError if it can't.

    Persisting an unvalidated value used to crash-loop the whole add-on at next boot
    (int("loud") in config loading) — one bad panel POST bricked the assistant."""
    if isinstance(template, bool):
        if isinstance(value, bool):
            return value
        raise ValueError(f"{key}: expected true/false")
    if isinstance(template, int) and not isinstance(template, bool):
        try:
            return int(value)
        except (TypeError, ValueError):
            raise ValueError(f"{key}: expected a number") from None
    if isinstance(template, float):
        try:
            return float(value)
        except (TypeError, ValueError):
            raise ValueError(f"{key}: expected a number") from None
    if isinstance(template, str):
        if isinstance(value, str):
            return value
        raise ValueError(f"{key}: expected text")
    if isinstance(template, list):
        if not isinstance(value, list):
            raise ValueError(f"{key}: expected a list")
        if key == "rooms":
            for r in value:
                if not (isinstance(r, dict) and r.get("voicepe_host") and r.get("room")):
                    raise ValueError("rooms: each row needs a Voice PE host and a room")
        return value
    return value


def save_settings(values: dict, path: pathlib.Path | None = None) -> dict:
    """Validate + merge ``values`` (only known keys) into the saved settings and persist.

    Raises ValueError (with a human-readable message for the panel) instead of ever
    persisting a value the boot path can't parse. Masked secrets are skipped."""
    src = _resolve(path)
    data = load_settings(src)
    for k, v in values.items():
        if k not in DEFAULTS:
            continue
        if k in SECRET_SETTINGS and v == SECRET_MASK:
            continue  # round-tripped mask — keep the stored secret
        data[k] = _coerce(k, v, DEFAULTS[k])
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_text(json.dumps(data, indent=2))
    _LOG.info("settings saved to %s", src)
    return data
