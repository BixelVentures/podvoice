"""The diagnostic probe must not silently broaden audio or provider usage."""

import json
import wave

import httpx
import pytest
from scripts import live_addressedness_eval as ev


def wav(path, seconds=1):
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(16_000)
        out.writeframes(b"\0\0" * (16_000 * seconds))


def test_fixture_requires_both_labels_and_bounded_audio(tmp_path):
    audio = tmp_path / "sample.wav"
    wav(audio)
    manifest = tmp_path / "cases.json"
    rows = [
        {"id": name, "label": label, "wav": str(audio), "start_ms": 0, "end_ms": 800}
        for name, label in (("user", "relevant"), ("tv", "background"))
    ]
    manifest.write_text(json.dumps({"cases": rows}))
    assert len(ev._cases(manifest)) == 2
    rows[1]["end_ms"] = 8001
    manifest.write_text(json.dumps({"cases": rows}))
    with pytest.raises(ValueError, match="invalid interval"):
        ev._cases(manifest)
    rows[1]["end_ms"] = 800
    rows[1]["label"] = "relevant"
    manifest.write_text(json.dumps({"cases": rows}))
    with pytest.raises(ValueError, match="both relevant and background"):
        ev._cases(manifest)


def test_provider_request_never_sends_labels_or_audio_output(tmp_path):
    audio = tmp_path / "sample.wav"
    wav(audio)
    clip, _ = ev._clip(audio, 0, 800)
    captured = []

    def respond(request):
        body = json.loads(request.content)
        captured.append(body)
        return httpx.Response(
            200,
            json={"choices": [{"finish_reason": "stop", "message": {"content": "BACKGROUND"}}]},
        )

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        assert ev._classify(client, "secret-test-key", clip) == ("background", 200)
    body = captured[0]
    assert body["model"] == ev.MODEL
    assert body["store"] is False
    assert body["max_completion_tokens"] == 24
    assert "audio" not in body
    assert "label" not in json.dumps(body)
    assert body["messages"][1]["content"][1]["type"] == "input_audio"


def test_truncated_provider_choice_never_counts_as_verdict(tmp_path):
    audio = tmp_path / "sample.wav"
    wav(audio)
    clip, _ = ev._clip(audio, 0, 800)

    def respond(_request):
        return httpx.Response(
            200,
            json={"choices": [{"finish_reason": "length", "message": {"content": "BACKGROUND"}}]},
        )

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        assert ev._classify(client, "secret-test-key", clip) == ("invalid_response", 200)


def test_final_case_protocol_error_is_not_a_model_mismatch():
    assert (
        ev._result_status(
            [
                {"verdict": "relevant", "match": True},
                {"verdict": "invalid_response", "match": False},
            ],
            2,
        )
        == "stopped_on_error"
    )
    assert (
        ev._result_status(
            [
                {"verdict": "relevant", "match": True},
                {"verdict": "unknown", "match": False},
            ],
            2,
        )
        == "completed_mismatch"
    )
