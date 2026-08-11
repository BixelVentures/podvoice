"""Behavioral contracts carried by the default realtime voice prompt."""

from gatekeeper.prompt import SYSTEM_PROMPT_DA


def test_ambiguous_transcript_never_turns_an_unrelated_tool_result_into_an_answer():
    prompt = SYSTEM_PROMPT_DA.lower()
    assert "ét opklarende spørgsmål" in prompt
    assert "getlivecontext er kun hjemmets aktuelle tilstand" in prompt
    assert "et faktuelt, men irrelevant resultat er ikke et svar" in prompt
    assert "vejr må aldrig blive svar på sport" in prompt
