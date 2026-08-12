"""Behavioral contracts carried by the default realtime voice prompt."""

from gatekeeper.prompt import SYSTEM_PROMPT_DA


def test_ambiguous_transcript_never_turns_an_unrelated_tool_result_into_an_answer():
    prompt = SYSTEM_PROMPT_DA.lower()
    assert "ét opklarende spørgsmål" in prompt
    assert "getlivecontext er kun hjemmets aktuelle tilstand" in prompt
    assert "et faktuelt, men irrelevant resultat er ikke et svar" in prompt
    assert "vejr må aldrig blive svar på sport" in prompt
    assert "give spil i aften" in prompt
    assert "agf spille i aften" in prompt
    assert "et vejrresultat pr. definition irrelevant" in prompt


def test_home_weather_and_music_are_ha_first():
    prompt = SYSTEM_PROMPT_DA.lower()
    assert "home assistant er autoriteten for hjemmet" in prompt
    assert "brug ha/mcp-værktøjerne først" in prompt
    assert "vejr hvor familien er = ha/weather først" in prompt
    assert "web kun som fallback" in prompt
    assert "brug ikke web til spotify-bibliotek" in prompt
    assert "hjemmets aktuelle afspilning" in prompt
    assert "web er derimod ok til ekstern viden om en sang" in prompt
