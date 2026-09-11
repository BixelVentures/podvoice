"""Live prompt split preserves product policy without inventing Realtime turns."""

from gatekeeper.live_prompt import _sections, live_instructions
from gatekeeper.prompt import PROMPT_VERSION, SYSTEM_PROMPT_DA


def test_canonical_prompt_changes_require_live_policy_review():
    assert PROMPT_VERSION == 14
    assert set(_sections()) == {
        "IDENTITET OG MÅL",
        "PRIORITET",
        "DANSK TALE",
        "LYD OG FORSTÅELSE",
        "SAMTALE OG OPFØLGNINGER",
        "SVAR ELLER VÆRKTØJ",
        "KILDER OG ROUTING",
        "RESULTATER OG FEJL",
        "HANDLINGER OG SIKKERHED",
        "SEMANTISK AFSLUTNING",
    }
    live_instructions(SYSTEM_PROMPT_DA)


def test_voice_owns_listening_style_and_delegation_backend_owns_product_rules():
    primary, backend = live_instructions(SYSTEM_PROMPT_DA)
    assert _sections()["DANSK TALE"].strip() in primary
    for section in ("PRIORITET", "KILDER OG ROUTING", "RESULTATER OG FEJL"):
        assert _sections()[section].strip() in backend
    assert "# LYD OG FORSTÅELSE" not in backend
    assert "# DANSK TALE" not in backend
    assert "kald wait_for_user" not in primary + backend
    assert "Det forstod jeg ikke helt. Sig det lige igen?" not in primary + backend
    assert "umiddelbart næste brugertur" not in backend
    assert "i samme respons" not in backend
    assert "Sig først den korte, sande kvittering efter afslutningskaldet" not in backend
    assert "kald aldrig opgaven og end_conversation i samme batch" in backend
    assert "accepted_by_ha=true" in backend
    assert "physical_result_verified=false" in backend
    for label in (
        "Backchannel policy:",
        "Interruption policy:",
        "Delegation policy:",
        "Backend tools:",
        "Delegate to the backend when:",
        "Do not delegate to the backend when:",
    ):
        assert label in primary
    assert "Afbrudt tale\nannullerer ikke backendens arbejde" in primary
    assert "wait_for_user er ikke din lyd- eller turgate" in backend


def test_primary_defers_current_capability_check_without_cached_inventory():
    primary, _ = live_instructions(SYSTEM_PROMPT_DA)
    assert "Backend kontrollerer de aktuelt deklarerede værktøjer" in primary
    assert "Tilgængeligheden kan ændre sig" in primary
    assert "lov hverken en funktion eller succes, før backend" in primary
    assert "Kun disse deklarerede værktøjsnavne" not in primary
    assert "GetDateTime" not in primary


def test_custom_prompt_retained_with_explicit_security_and_live_ownership():
    custom = 'Skriv "hej".\nMin brugerdefinerede regel.'
    primary, backend = live_instructions(custom)
    assert custom in backend
    assert custom not in primary
    assert backend.index(custom) < backend.index("# BINDENDE LIVE-EJERSKAB")
    assert "Mundtlig handlingsgodkendelse er utilgængelig i Alpha" in backend
    assert "Udfør ikke en bekræftelseskrævende handling eller approve_action" in backend
    security = _sections()["HANDLINGER OG SIKKERHED"].strip().splitlines()
    for line in [*security[:2], security[4], *security[6:]]:
        assert line in backend
    assert "uden at indsamle et\nvirkningsløst ja" in primary


def test_contextual_intro_is_optional_and_cannot_claim_tool_success():
    primary, backend = live_instructions(SYSTEM_PROMPT_DA)
    assert "også mens backend arbejder" in primary
    assert "Den er aldrig påkrævet" in primary
    assert "konstante lytterreaktioner" in primary
    assert "Foregrib aldrig et værktøjsresultat" in primary
    assert "En indledning er heller ikke selve svaret" in primary
    assert "Live må give en kort, relevant indledning, mens du arbejder" in backend
    assert "forsink ikke værktøjskaldet for tale" in backend
    assert "ingen generisk ventereplik før eller under" not in primary + backend
    assert _sections()["RESULTATER OG FEJL"].strip() in backend
