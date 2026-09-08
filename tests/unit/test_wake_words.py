import asyncio
import json

import pytest

from gatekeeper.config import from_options
from gatekeeper.settings import load_settings, save_settings
from gatekeeper.voicepe import VoicePELink
from gatekeeper.wake_words import WAKE_WORDS


@pytest.mark.parametrize("word", WAKE_WORDS)
def test_wake_word_save_reload_upgrade(tmp_path, word):
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"settings_version": 1, "wake_word": word}))
    assert load_settings(path)["wake_word"] == word
    save_settings({"wake_word": word}, path)
    assert from_options(load_settings(path)).wake_word == word
    save_settings({"duck_level": 5}, path)
    assert load_settings(path)["wake_word"] == word


@pytest.mark.parametrize("value", ["invalid", "", None, [], {}, 1])
def test_bad_wake_word_never_overwrites_saved_value(tmp_path, value):
    path = tmp_path / "settings.json"
    save_settings({"wake_word": "hey_jarvis"}, path)
    before = path.read_bytes()
    with pytest.raises(ValueError, match="wake_word"):
        save_settings({"wake_word": value}, path)
    assert path.read_bytes() == before
    assert from_options({"wake_word": value}).wake_word == "okay_nabu"


class TextSensorState:
    key = 42

    def __init__(self, state):
        self.state = state


@pytest.mark.parametrize("word", WAKE_WORDS)
async def test_ack_not_send_is_confirmation_and_disconnect_clears_it(word):
    link = VoicePELink("puck.local", "", room="room")
    link.wake_word = word
    link._wake_word_ack_key = 42
    commands = []

    async def send(name, args):
        commands.append(args)
        return True

    link._call_service = send
    task = asyncio.create_task(link.apply_wake_word())
    await asyncio.sleep(0)
    token = commands[-1]["token"]
    assert link.confirmed_wake_word is None
    link._on_state(TextSensorState(f"old:{word}"))
    link._on_state(TextSensorState(f"{token}:invalid"))
    assert link.confirmed_wake_word is None
    link._on_state(TextSensorState(f"{token}:{word}"))
    await task
    assert link.confirmed_wake_word == word
    await link._on_disconnect()
    assert link.confirmed_wake_word is None
    next_task = asyncio.create_task(link.apply_wake_word())
    await asyncio.sleep(0)
    link._on_state(TextSensorState(f"{token}:{word}"))
    assert link.confirmed_wake_word is None
    next_token = commands[-1]["token"]
    assert next_token != token
    link._on_state(TextSensorState(f"{next_token}:{word}"))
    await next_task
    assert link.confirmed_wake_word == word


async def test_old_firmware_cannot_confirm():
    link = VoicePELink("puck.local", "", room="room")
    link.wake_word = "hey_chat"
    with pytest.raises(RuntimeError, match="Opdatér"):
        await link.apply_wake_word()
    assert link.confirmed_wake_word is None


@pytest.mark.parametrize("disconnect", [False, True])
async def test_missing_ack_or_disconnect_fails_admission(monkeypatch, disconnect):
    from gatekeeper import voicepe

    monkeypatch.setattr(voicepe, "_WAKE_WORD_ACK_TIMEOUT_S", 0.01)
    link = VoicePELink("puck.local", "", room="room")
    link.wake_word = "hey_chat"
    link._wake_word_ack_key = 42

    async def send(name, args):
        return True

    link._call_service = send
    task = asyncio.create_task(link.apply_wake_word())
    await asyncio.sleep(0)
    old_token = link._wake_word_token
    if disconnect:
        await link._on_disconnect()
    with pytest.raises((RuntimeError, TimeoutError)):
        await task
    link._on_state(TextSensorState(f"{old_token}:hey_chat"))
    assert link.confirmed_wake_word is None
    assert link._wake_word_waiter is None


def test_pinned_model_and_four_normal_models_keep_single_owner():
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    provenance = json.loads((root / "esphome/hey-chat-model.json").read_text())
    base = (root / "esphome/voice-pe-podvoice-base.yaml").read_text()
    overlay = (root / "esphome/podvoice.yaml").read_text()
    models = base.split("micro_wake_word:\n", 1)[1].split("  vad:", 1)[0]
    assert models.count("    - model:") == 5
    assert provenance["commit"] in models
    for word in WAKE_WORDS:
        assert f"id: {word}" in models
    assert "id: stop" in models
    service = overlay.split("action: podvoice_set_wake_word", 1)[1].split("\n# PodVoice", 1)[0]
    assert "id(stop)" not in service
    for word in WAKE_WORDS:
        assert f"id({word}).is_enabled()" in service
