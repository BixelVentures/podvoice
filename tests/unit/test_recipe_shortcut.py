"""The versioned iPhone shortcut "Opskrifter til PodView" and what the server accepts from it."""

from __future__ import annotations

import json
import logging
import plistlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from multidict import CIMultiDict

from gatekeeper.podview import BRIDGE, _phone_recipes
from gatekeeper.recipe_submissions import (
    RECIPE_SHORTCUT_VERSION,
    RecipeSubmissions,
    shared_recipe_problem,
    shared_recipe_url,
    shortcut_version,
)

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = ROOT / "podvoice/shortcuts/opskrifter-til-podview.plist"
SIGNED = ROOT / "podvoice/gatekeeper/static/podview/assets/opskrifter-til-podview.shortcut"
URL = "https://example.com/opskrift/boller"
TOKEN = "s3cret-upload-code-" + "x" * 20
CURRENT = RECIPE_SHORTCUT_VERSION
NOTICE = " · Ny version af genvejen \u2013 hent den i PodView"


def _fields(param: dict) -> dict:
    items = param["Value"]["WFDictionaryFieldValueItems"]
    return {item["WFKey"]["Value"]["string"]: item for item in items}


def test_template_is_secret_free_and_matches_server_version():
    template = plistlib.loads(TEMPLATE.read_bytes())
    actions = template["WFWorkflowActions"]
    post = next(
        a["WFWorkflowActionParameters"]
        for a in actions
        if a["WFWorkflowActionIdentifier"] == "is.workflow.actions.downloadurl"
    )
    assert post["WFHTTPMethod"] == "POST" and post["WFHTTPBodyType"] == "JSON"
    headers, body = _fields(post["WFHTTPHeaders"]), _fields(post["WFJSONValues"])
    assert headers["X-PodView-Shortcut"]["WFValue"]["Value"]["string"] == str(
        RECIPE_SHORTCUT_VERSION
    )
    assert body["shortcut"]["WFValue"]["Value"]["string"] == str(RECIPE_SHORTCUT_VERSION)
    assert set(body) == {"url", "text", "shortcut"}
    # The upload code is a variable from the import question, never a literal.
    authorization = headers["Authorization"]["WFValue"]["Value"]
    assert authorization["string"] == "Bearer ￼"
    assert set(authorization["attachmentsByRange"]) == {"{7, 1}"}
    questions = template["WFWorkflowImportQuestions"]
    assert [q["Text"].split(":")[0] for q in questions] == ["PodView-adresse", "Uploadkode"]
    assert all(q["DefaultValue"] == "" for q in questions)
    assert {
        "WFURLContentItem",
        "WFSafariWebPageContentItem",
        "WFStringContentItem",
        "WFRichTextContentItem",
    } <= set(template["WFWorkflowInputContentItemClasses"])
    assert "ActionExtension" in template["WFWorkflowTypes"]
    # Every variable reference points at an action that exists.
    uuids = {a["WFWorkflowActionParameters"].get("UUID") for a in actions}
    raw = TEMPLATE.read_text()
    assert set(_output_uuids(template)) <= uuids
    # Changed in version 2: any pasted Home Assistant address is normalised to the recipe
    # endpoint on that host, so the path is in the template; no host and no code are.
    assert "Bearer " in raw and "nabu.casa" not in raw
    replaces = [
        a["WFWorkflowActionParameters"]
        for a in actions
        if a["WFWorkflowActionIdentifier"] == "is.workflow.actions.text.replace"
    ]
    assert [r["WFReplaceTextReplace"] for r in replaces] == [
        "https://",
        "$1/api/podvoice/recipe-submissions",
        "",
    ]
    assert (
        post["WFURL"]["Value"]["attachmentsByRange"]["{0, 1}"]["OutputUUID"]
        == (replaces[1]["UUID"])
    )
    code = authorization["attachmentsByRange"]["{7, 1}"]["OutputUUID"]
    assert code == replaces[2]["UUID"]
    assert (
        replaces[2]["WFInput"]["Value"]["attachmentsByRange"]["{0, 1}"]["OutputUUID"]
        == (actions[questions[1]["ActionIndex"]]["WFWorkflowActionParameters"]["UUID"])
    )
    # A reply without a message still tells the user what to do.
    shown = [
        a["WFWorkflowActionParameters"]["Text"]["Value"]["string"]
        for a in actions
        if a["WFWorkflowActionIdentifier"] == "is.workflow.actions.showresult"
    ]
    assert shown[-1].startswith("PodView svarede ikke")


def _output_uuids(value):
    if isinstance(value, dict):
        if "OutputUUID" in value:
            yield value["OutputUUID"]
        for item in value.values():
            yield from _output_uuids(item)
    elif isinstance(value, list):
        for item in value:
            yield from _output_uuids(item)


def test_committed_shortcut_is_signed():
    assert SIGNED.read_bytes()[:4] == b"AEA1"


@pytest.mark.parametrize(
    "body,expected",
    [
        ({"urls": [URL, "https://second.example/x"]}, URL),
        ({"urls": ["Boller", URL]}, URL),
        ({"webpage": {"url": URL, "title": "Boller"}}, URL),
        ({"page": {"URL": URL}}, URL),
        ({"page": URL}, URL),
        ({"urls": [{"url": URL}]}, URL),
        ({"url": "", "text": f"Boller {URL}", "shortcut": 1}, URL),
        ({"url": {"href": URL}}, URL),
        ({"urls": []}, None),
        ({"webpage": {"title": "Boller"}}, None),
    ],
)
def test_share_shapes_yield_the_link(body, expected):
    assert shared_recipe_url(body) == expected


def test_no_link_messages_are_concrete():
    assert shared_recipe_problem({"title": "Boller"}, outdated=True) == (
        "Delingen indeholdt kun sidens titel. Opdatér genvejen i PodView."
    )
    assert shared_recipe_problem({"url": "", "text": "Boller", "shortcut": 1}, outdated=False) == (
        "Delingen indeholdt kun tekst uden et link. Brug Kopiér link i appen, og del linket igen."
    )
    assert shared_recipe_problem({"url": "", "text": "", "shortcut": 1}, outdated=False) == (
        "Der kom intet med fra delingen. Del opskriftens link igen."
    )


@pytest.mark.parametrize(
    "header,body,expected",
    [
        ("1", {}, 1),
        (None, {"shortcut": 2}, 2),
        (None, {"shortcut": "3"}, 3),
        ("x", {"shortcut": True}, None),
        (None, {}, None),
    ],
)
def test_shortcut_version(header, body, expected):
    assert shortcut_version(header, body) == expected


def _request(bridge, body, version=None):
    class Content:
        async def iter_chunked(self, _):
            yield json.dumps(body).encode()

    headers = CIMultiDict(Authorization="Bearer " + TOKEN)
    if version is not None:
        headers["X-PodView-Shortcut"] = version
    return SimpleNamespace(
        app={BRIDGE: bridge},
        remote="127.0.0.1",
        headers=headers,
        method="POST",
        content_type="application/json",
        content=Content(),
    )


def _html():
    recipe = {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": "Boller",
        "recipeIngredient": ["500 g mel"],
        "recipeInstructions": ["Bag dem."],
    }
    return f'<script type="application/ld+json">{json.dumps(recipe)}</script>'


@pytest.mark.asyncio
async def test_old_shortcut_is_told_and_recorded_without_logging_the_code(tmp_path, caplog):
    bridge = SimpleNamespace(
        recipe_submissions=RecipeSubmissions(tmp_path / "catalog.json"),
        recipe_upload_token=TOKEN,
        recipe_shortcut_outdated=None,
    )
    caplog.set_level(logging.DEBUG)
    fetch = AsyncMock(return_value=(_html(), URL))
    with patch("gatekeeper.recipe_import.fetch_html", new=fetch):
        current = await _phone_recipes(
            _request(bridge, {"url": URL, "shortcut": CURRENT}, str(CURRENT))
        )
        assert json.loads(current.text)["message"] == "Gemt: Boller"
        assert bridge.recipe_shortcut_outdated is None

        legacy = await _phone_recipes(_request(bridge, {"url": URL}))
    assert json.loads(legacy.text)["message"] == "Findes allerede: Boller" + NOTICE
    assert bridge.recipe_shortcut_outdated["version"] is None
    assert isinstance(bridge.recipe_shortcut_outdated["seenAt"], int)

    title_only = await _phone_recipes(_request(bridge, {"title": "Boller"}, "0"))
    assert title_only.status == 400
    assert json.loads(title_only.text)["message"] == (
        "Delingen indeholdt kun sidens titel. Opdatér genvejen i PodView."
    )
    assert bridge.recipe_shortcut_outdated["version"] == 0

    empty = await _phone_recipes(_request(bridge, {}))
    assert json.loads(empty.text)["message"] == (
        "Der kom intet med fra delingen. Del opskriftens link igen." + NOTICE
    )
    with patch("gatekeeper.recipe_import.fetch_html", new=fetch):
        await _phone_recipes(_request(bridge, {"url": URL, "shortcut": CURRENT}, str(CURRENT)))
    assert bridge.recipe_shortcut_outdated is None, "an updated iPhone clears the notice"
    assert TOKEN not in caplog.text and "Boller" not in caplog.text
    assert "recipe_shortcut version=none outdated=True" in caplog.text
