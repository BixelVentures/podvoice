"""Cryptographic-field scope cases, separate from the frozen legacy Git inventory."""

import pytest
from scripts.candidate_scope import classify_candidate, production_fingerprint

# Exact four key-field additions and actual Talk playback guard line from the observed
# production-only n=0 settings/Talk diff; no test text or unrelated source context.
_CRYPTO_KEY_AND_TALK_LINES = (
    '+        if "voicepe_noise_psk" in row and not isinstance(row["voicepe_noise_psk"], str):\n'
    '+    row.dataset.invalidKey = sourceRow && "voicepe_noise_psk" in sourceRow && typeof sourceRow.voicepe_noise_psk !== "string" ? "true" : "false";\n'
    '+    if (sourceRow && typeof sourceRow.voicepe_noise_psk === "string") row.roomKey = sourceRow.voicepe_noise_psk;\n'
    '+        if (typeof row.roomKey === "string") saved.voicepe_noise_psk = row.roomKey;\n'
    '+      else if (ev.type === "play") { if (livePeer || halted || !talkVisible()) return; halted = false; playReply(ev.url, ev.playback_id); }\n'
)


@pytest.mark.parametrize("large", [False, True])
@pytest.mark.parametrize("side", ["+", "-"])
def test_crypto_transport_key_and_actual_talk_guard_are_only_physical_output(large, side):
    diff = _CRYPTO_KEY_AND_TALK_LINES.replace("+", side)
    if large:
        diff += (side + "neutral_assignment = plain_value;\n") * 700
    report = classify_candidate(
        [
            "podvoice/gatekeeper/settings.py",
            "podvoice/gatekeeper/static/index.html",
            "tests/unit/test_candidate_scope.py",
        ],
        diff,
    )
    assert report.passed
    assert report.domains == ("physical_output",)


@pytest.mark.parametrize("large", [False, True])
@pytest.mark.parametrize(
    "audio_code",
    [
        "openai_noise = filter_value;",
        "mic_gain = requested_gain;",
        "mic_gate = gate_value;",
        "mic_channel = selected_channel;",
        "mic_frame = input_frame;",
        "VAD = requested_detector;",
        "noise = changed_filter;",
        "speech_stopped = input_edge;",
    ],
)
def test_crypto_key_never_hides_real_audio_input_in_the_same_changed_line(large, audio_code):
    diff = '+ row["voicepe_noise_psk"] = key; play_pcm(packet); ' + audio_code + "\n"
    if large:
        diff += "+ neutral_assignment = plain_value;\n" * 700
    report = classify_candidate(
        ["podvoice/gatekeeper/static/index.html", "tests/unit/test_candidate_scope.py"], diff
    )
    assert not report.passed
    assert report.domains == ("audio_input", "physical_output")


@pytest.mark.parametrize(
    "identifier",
    [
        "_voicepe_noise_psk",
        "voicepe_noise_psk_extra",
        "other_voicepe_noise_psk",
        "voicepe_noise_psk2",
        "xvoicepe_noise_psk",
        "VOICEPE_NOISE_PSK",
        "Voicepe_noise_psk",
        "évoicepe_noise_psk",
        "voicepe_noise_pské",
    ],
)
def test_crypto_key_exemption_is_exact_case_sensitive_identifier_only(identifier):
    report = classify_candidate(
        ["podvoice/gatekeeper/static/index.html", "tests/unit/test_candidate_scope.py"],
        '+ row["' + identifier + '"] = key; play_pcm(packet);\n',
    )
    assert not report.passed
    assert report.domains == ("audio_input", "physical_output")


def test_crypto_key_normalization_does_not_change_raw_effective_fingerprints(tmp_path, monkeypatch):
    name = "podvoice/gatekeeper/settings.py"
    path = tmp_path / name
    path.parent.mkdir(parents=True)
    path.write_text('voicepe_noise_psk = "first transport key"\n')

    def inventory(root, *args):
        assert root == tmp_path
        assert args == ("ls-files", "-z")
        return name + "\0"

    monkeypatch.setattr("scripts.candidate_scope._git", inventory)
    first = production_fingerprint(tmp_path, "base-tip", "merge-base", [name])
    path.write_text('voicepe_noise_psk = "changed transport key"\n')
    changed = production_fingerprint(tmp_path, "base-tip", "merge-base", [name])
    assert changed != first
    path.write_text('voicepe_psk = "changed transport key"\n')
    neutral = production_fingerprint(tmp_path, "base-tip", "merge-base", [name])
    assert neutral != changed


@pytest.mark.parametrize("raw_size", [9999, 10000, 10001])
@pytest.mark.parametrize("real_input", [False, True])
def test_crypto_key_normalization_preserves_raw_large_diff_owner(raw_size, real_input):
    prefix = 'row["voicepe_noise_psk"] = key; ' * 24
    if real_input:
        prefix += "mic_gain = unchanged_input_gain; "
    old = prefix + 'const padding=""; ZZZ();'
    new = prefix + 'const padding=""; playback_started();'
    padding = raw_size - len(old) - len(new)
    assert padding > 0
    # Shared unique string characters avoid turning the real fine matcher into a
    # repeated-character timing test. Both lines are valid inert JS fragments.
    common = "".join(chr(0xE000 + i) for i in range(padding // 2))
    old = old.replace('padding=""', 'padding="' + common + '"') + " " * (padding % 2)
    new = new.replace('padding=""', 'padding="' + common + '"')
    assert len(old) + len(new) == raw_size
    report = classify_candidate(
        ["podvoice/gatekeeper/static/index.html", "tests/unit/test_candidate_scope.py"],
        "-" + old + "\n+" + new + "\n",
    )
    if raw_size > 10000 and real_input:
        assert not report.passed
        assert report.domains == ("audio_input", "physical_output")
    else:
        # The existing fine path discards equal input context; the raw large
        # path must conservatively retain it only above its original bound.
        assert report.passed
        assert report.domains == ("physical_output",)
