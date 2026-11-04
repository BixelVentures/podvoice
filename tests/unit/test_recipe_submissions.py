import json
from concurrent.futures import ThreadPoolExecutor

import pytest

from gatekeeper.recipe_submissions import RecipeRejectedError, RecipeStorageError, RecipeSubmissions


def _reviewed(url):
    return {
        "source": {"url": url, "files": ["private-copy"]},
        "title": "Rugbrød",
        "publisher": "Bager",
        "categories": ["Brød og bagværk"],
        "groups": [{"title": "Dej", "lines": ["500 g mel"]}],
        "steps": ["Bland dejen"],
    }


def test_rejected_recipe_stays_private_and_is_returned_on_retry(tmp_path):
    path = tmp_path / "catalog.json"
    catalog = RecipeSubmissions(path)
    submitted = catalog.submit("https://example.test/recipe/?utm_campaign=abc&servings=4#steps")
    assert submitted["status"] == "received"
    same_recipe = "https://example.test/recipe?servings=4"
    rejected = catalog.reject(same_recipe, "not_recipe")
    assert rejected["status"] == "rejected"

    stored = json.loads(path.read_bytes())
    assert len(stored["recipes"]) == 8
    rejection = stored["submissions"][submitted["id"]]["rejection"]
    assert rejection["reason"] == "not_recipe"
    assert rejection["at"] >= stored["submissions"][submitted["id"]]["receivedAt"]

    reopened = RecipeSubmissions(path)
    assert reopened.receipt(submitted["id"]) == rejected
    assert reopened.submit(same_recipe) == rejected
    assert reopened.reject(same_recipe, "unreadable") == rejected
    assert reopened.list_submissions()[0]["rejection"] == rejection
    with pytest.raises(RecipeRejectedError):
        reopened.publish(_reviewed(same_recipe))
    assert submitted["id"] not in json.loads(path.read_bytes())["recipes"]


def test_reviewed_recipe_can_be_published_and_phone_receipt_is_updated(tmp_path):
    path = tmp_path / "catalog.json"
    catalog = RecipeSubmissions(path)
    recipe = _reviewed("https://example.test/recipe")
    pending = catalog.submit(recipe["source"]["url"])
    with pytest.raises(ValueError):
        catalog.publish({**recipe, "groups": []})
    saved = catalog.publish(recipe)
    assert saved == {"id": pending["id"], "status": "saved", "message": "Gemt"}
    assert catalog.receipt(pending["id"]) == saved
    assert catalog.submit(recipe["source"]["url"]) == saved
    assert catalog.list_submissions() == []
    assert json.loads(path.read_bytes())["recipes"][pending["id"]]["source"]["files"] == []


def test_concurrent_submissions_are_not_lost_and_invalid_store_is_preserved(tmp_path):
    path = tmp_path / "catalog.json"
    catalog = RecipeSubmissions(path)
    urls = [f"https://example.test/recipe-{index}" for index in range(12)]
    with ThreadPoolExecutor() as pool:
        list(pool.map(catalog.submit, urls + urls))
    assert len(catalog.list_submissions()) == len(urls)

    path.write_text('{"recipes": []}')
    with pytest.raises(RecipeStorageError):
        catalog.submit("https://example.test/new")
    assert path.read_text() == '{"recipes": []}'
