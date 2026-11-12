"""Durable shared recipe catalog and upload receipts."""

import hashlib
import json
import logging
import os
import re
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

_LOG = logging.getLogger("podvoice.recipes")


def recipe_reference(recipe_id: str) -> str:
    """Opaque, stable diagnostic correlation; never a command or receipt authority."""
    return hashlib.sha256(("podview-recipe-journal:" + recipe_id).encode()).hexdigest()[:24]


def recipe_catalog_reference(recipes: list[dict]) -> str:
    """Order-independent fingerprint of the actual catalog's validated source identities."""
    refs = sorted(
        recipe_reference(_recipe_id(_source_url(row["source"]["url"]))) for row in recipes
    )
    return hashlib.sha256("\n".join(refs).encode()).hexdigest()[:24]


def recipe_event(
    stage: str,
    outcome: str,
    *,
    recipe_id: str | None = None,
    catalog: str = "none",
    count: int = 0,
    reason: str = "none",
) -> None:
    # Stored data is untrusted too: close every logged field over known values.
    stages = {
        "submit",
        "duplicate",
        "import",
        "storage",
        "recovery",
        "catalog_persist",
        "catalog_read",
    }
    outcomes = {
        "received",
        "importing",
        "saved",
        "rejected",
        "failed",
        "queued",
        "started",
        "observed",
    }
    reasons = {
        "none",
        "invalid_url",
        "no_url",
        "cancelled",
        "not_recipe",
        "unreadable",
        "incomplete",
        "ambiguous",
        "unsafe_url",
        "unavailable",
        "timeout",
        "network",
        "storage",
        "invalid_data",
    }
    stage = stage if isinstance(stage, str) and stage in stages else "other"
    outcome = outcome if isinstance(outcome, str) and outcome in outcomes else "other"
    reason = reason if isinstance(reason, str) and reason in reasons else "other"
    catalog = (
        catalog
        if isinstance(catalog, str)
        and (catalog in {"none", "unavailable"} or re.fullmatch(r"[a-f0-9]{24}", catalog))
        else "unavailable"
    )
    recipe_id = (
        recipe_id
        if isinstance(recipe_id, str) and re.fullmatch(r"[a-f0-9]{64}", recipe_id)
        else None
    )
    count = count if type(count) is int and 0 <= count <= 1_000_000 else 0
    try:
        _LOG.info(
            "recipe stage=%s outcome=%s ref=%s catalog=%s count=%d reason=%s",
            stage,
            outcome,
            recipe_reference(recipe_id) if recipe_id else "none",
            catalog,
            count,
            reason,
        )
    except Exception:
        # Diagnostic output must never change a durable upload or its receipt.
        pass


_REJECTION_MESSAGES = {
    "not_recipe": "Siden blev ikke vurderet som en opskrift",
    "unreadable": "Opskriften kunne ikke læses sikkert",
    "incomplete": "Opskriften mangler ingredienser eller trin og er ikke gemt",
    "ambiguous": "Siden indeholder flere opskrifter og skal gennemgås",
    "unsafe_url": "Linket kan ikke hentes sikkert",
    "unavailable": "Opskriften kunne ikke hentes. Del linket igen for at prøve igen",
}


class RecipeStorageError(OSError):
    """The existing catalog could not be read safely."""


class RecipeRejectedError(ValueError):
    """An administrator has already rejected the submitted URL."""


_SHARED_URL = re.compile(r"https?://[^\s<>\"'`«»“”]+", re.IGNORECASE)

# The version of podvoice/shortcuts/opskrifter-til-podview.plist. Raise both together
# when the shortcut changes; older shortcuts are told to fetch the new one in PodView.
RECIPE_SHORTCUT_VERSION = 1

# Fields a share sheet or shortcut may send, in the order they are trusted for a link.
_SHARED_FIELDS = ("url", "urls", "webpage", "page", "link", "text", "title")
_NESTED_URL_KEYS = ("url", "URL", "href", "link")


def _shared_strings(value: object, depth: int = 0):
    """Strings from a field: text, a list of texts/pages, or a page {"url": …}."""
    if isinstance(value, str):
        if len(value) <= 8192:
            yield value
    elif depth < 2 and isinstance(value, list):
        for item in value[:20]:
            yield from _shared_strings(item, depth + 1)
    elif depth < 2 and isinstance(value, dict):
        for key in _NESTED_URL_KEYS:
            yield from _shared_strings(value.get(key), depth + 1)


def shared_recipe_url(body: dict) -> str | None:
    """The first http(s) link in what a share sheet sent: a bare URL, "Se denne
    opskrift: https://…", title plus link, quotes or <>; a list of URLs, a web page
    {"url": …}; also in text/title fields."""
    for field in _SHARED_FIELDS:
        for value in _shared_strings(body.get(field)):
            match = _SHARED_URL.search(value)
            if match is None:
                continue
            url = match.group(0).rstrip(".,;:!?")
            while url.endswith(")") and url.count(")") > url.count("("):
                url = url[:-1]
            return url
    return None


def shared_recipe_problem(body: dict, *, outdated: bool) -> str:
    """A concrete Danish reason why a share held no usable link (never echoes values)."""
    texts = [
        value.strip()
        for field in _SHARED_FIELDS
        for value in _shared_strings(body.get(field))
        if value.strip()
    ]
    if texts:
        if outdated:
            return "Delingen indeholdt kun sidens titel. Opdatér genvejen i PodView."
        return (
            "Delingen indeholdt kun tekst uden et link. "
            "Brug Kopiér link i appen, og del linket igen."
        )
    if not any(value not in (None, "", [], {}) for key, value in body.items() if key != "shortcut"):
        return "Der kom intet med fra delingen. Del opskriftens link igen."
    return "Der var intet link i det delte. Del opskriftens link igen."


def shortcut_version(header: str | None, body: dict | None) -> int | None:
    """The shortcut's declared version from X-PodView-Shortcut or its body, if valid."""
    candidates: list[object] = [header]
    if body is not None:
        candidates.append(body.get("shortcut"))
    for value in candidates:
        if isinstance(value, bool):
            continue
        if isinstance(value, int) and 0 <= value < 1_000_000:
            return value
        if isinstance(value, str) and re.fullmatch(r"[0-9]{1,6}", value.strip()):
            return int(value.strip())
    return None


def _source_url(value: object) -> str:
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError("invalid recipe URL")
    url = urlsplit(value.strip())
    if url.scheme not in {"http", "https"} or not url.hostname or url.username is not None:
        raise ValueError("invalid recipe URL")
    if any(char.isspace() or char in "/?#%\\" for char in url.hostname):
        raise ValueError("invalid recipe hostname")
    port = url.port
    host = url.hostname.encode("idna").decode("ascii").lower()
    if ":" in host:
        host = f"[{host}]"
    if port is not None and port != {"http": 80, "https": 443}[url.scheme]:
        host = f"{host}:{port}"
    params = [
        (key, item)
        for key, item in parse_qsl(url.query, keep_blank_values=True)
        if not key.startswith("utm_") and key != "fbclid"
    ]
    params.sort(key=lambda param: param[0])
    path = quote(url.path.rstrip("/") or "/", safe="/%:@!$&'()*+,;=-._~")
    query = urlencode(params, safe="*").replace("~", "%7E")
    return urlunsplit((url.scheme, host, path, query, ""))


def _recipe_id(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()


def _now_ms() -> int:
    return time.time_ns() // 1_000_000


def _saved(recipe_id: str) -> dict:
    return {"id": recipe_id, "status": "saved", "message": "Gemt"}


def _receipt(submission: dict) -> dict:
    rejection = submission.get("rejection")
    if rejection:
        return {
            "id": submission["id"],
            "status": "rejected",
            "message": _REJECTION_MESSAGES[rejection["reason"]],
        }
    if (
        submission.get("status") == "importing"
        and _now_ms() - submission.get("updatedAt", 0) >= 30000
    ):
        return {
            "id": submission["id"],
            "status": "failed",
            "message": "Importen blev afbrudt. Del linket igen",
        }
    return {
        "id": submission["id"],
        "status": submission.get("status", "received"),
        "message": submission.get("message", "Modtaget: opskriften afventer import"),
    }


def _strings(values: object) -> bool:
    return (
        isinstance(values, list)
        and bool(values)
        and all(isinstance(value, str) and value.strip() for value in values)
    )


class RecipeSubmissions:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()

    def _read(self) -> dict:
        try:
            state = json.loads(self.path.read_bytes())
        except FileNotFoundError:
            state = {"recipes": {}, "submissions": {}}
        except (ValueError, UnicodeError) as exc:
            raise RecipeStorageError("invalid recipe catalog") from exc
        if not isinstance(state, dict) or not all(
            isinstance(state.get(key), dict) for key in ("recipes", "submissions")
        ):
            raise RecipeStorageError("invalid recipe catalog")

        if state.get("seedVersion") != 1:
            seeds = json.loads(Path(__file__).with_name("podview_recipes.json").read_bytes())
            for recipe in seeds:
                recipe_id = _recipe_id(_source_url(recipe["source"]["url"]))
                state["recipes"].setdefault(recipe_id, recipe)
                state["submissions"].pop(recipe_id, None)
            state["seedVersion"] = 1
        return state

    def _write(self, state: dict) -> None:
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=self.path.parent, delete=False
        ) as temp:
            pending = Path(temp.name)
            try:
                json.dump(state, temp, ensure_ascii=False)
                temp.flush()
                os.fsync(temp.fileno())
                temp.close()
                pending.replace(self.path)
            finally:
                pending.unlink(missing_ok=True)

    def submit(self, url: object) -> dict:
        url = _source_url(url)
        recipe_id = _recipe_id(url)
        with self._lock:
            state = self._read()
            if recipe_id in state["recipes"]:
                state["submissions"].setdefault(
                    recipe_id,
                    {
                        "id": recipe_id,
                        "url": url,
                        "receivedAt": _now_ms(),
                        "updatedAt": _now_ms(),
                        "status": "saved",
                        "message": "Gemt",
                        "title": state["recipes"][recipe_id]["title"],
                    },
                )
                self._write(state)
                return _saved(recipe_id)
            if recipe_id not in state["submissions"]:
                state["submissions"][recipe_id] = {
                    "id": recipe_id,
                    "url": url,
                    "receivedAt": _now_ms(),
                    "updatedAt": _now_ms(),
                }
                self._write(state)
            return _receipt(state["submissions"][recipe_id])

    def receipt(self, recipe_id: object) -> dict:
        if not isinstance(recipe_id, str) or not re.fullmatch(r"[a-f0-9]{64}", recipe_id):
            raise ValueError("invalid recipe receipt")
        with self._lock:
            state = self._read()
            if recipe_id in state["recipes"]:
                return _saved(recipe_id)
            return _receipt(state["submissions"][recipe_id])

    def phone_receipt(self, recipe_id: object) -> dict:
        receipt = self.receipt(recipe_id)
        if receipt["status"] == "saved":
            with self._lock:
                title = self._read()["recipes"][recipe_id]["title"]
            receipt = {**receipt, "title": title, "message": f"Gemt: {title}"}
        return receipt

    def list_submissions(self) -> list[dict]:
        with self._lock:
            return [
                item
                for item in self._read()["submissions"].values()
                if item.get("status") != "saved"
            ]

    def pending_urls(self) -> list[str]:
        """Recover durable links after upgrade/restart; terminal failures require an explicit retry."""
        with self._lock:
            state = self._read()
            pending = []
            for item in state["submissions"].values():
                if (
                    item["id"] not in state["recipes"]
                    and not item.get("rejection")
                    and item.get("status", "received") in {"received", "importing"}
                ):
                    item["updatedAt"] = 0
                    item["status"] = "received"
                    pending.append(item["url"])
            if pending:
                self._write(state)
                for url in pending:
                    recipe_event("recovery", "queued", recipe_id=_recipe_id(url))
            return pending

    def begin_import(self, recipe_id: str) -> bool:
        with self._lock:
            state = self._read()
            item = state["submissions"][recipe_id]
            if item.get("rejection") or (
                item.get("status") == "importing" and _now_ms() - item.get("updatedAt", 0) < 30000
            ):
                return False
            item.update(
                status="importing", message="Modtaget: importerer opskriften", updatedAt=_now_ms()
            )
            self._write(state)
            return True

    def import_failed(self, recipe_id: str, reason: str, rejected: bool) -> dict:
        with self._lock:
            state = self._read()
            item = state["submissions"][recipe_id]
            if recipe_id in state["recipes"]:
                return _saved(recipe_id)
            item.update(
                status="rejected" if rejected else "failed",
                message=_REJECTION_MESSAGES[reason],
                updatedAt=_now_ms(),
            )
            if rejected:
                item["rejection"] = {"reason": reason, "at": _now_ms()}
            self._write(state)
            return _receipt(item)

    def upload_history(self) -> list[dict]:
        with self._lock:
            state = self._read()
            items = []
            for item in state["submissions"].values():
                receipt = _receipt(item)
                if item["id"] in state["recipes"]:
                    receipt = _saved(item["id"])
                elif (
                    item.get("status") == "importing"
                    and _now_ms() - item.get("updatedAt", 0) >= 30000
                ):
                    receipt = {
                        "id": item["id"],
                        "status": "failed",
                        "message": "Importen blev afbrudt. Del linket igen",
                    }
                items.append({**item, **receipt})
            return sorted(
                items, key=lambda item: item.get("updatedAt", item["receivedAt"]), reverse=True
            )[:100]

    def reject(self, url: object, reason: object) -> dict:
        recipe_id = _recipe_id(_source_url(url))
        if not isinstance(reason, str) or reason not in _REJECTION_MESSAGES:
            raise ValueError("invalid rejection reason")
        with self._lock:
            state = self._read()
            submission = state["submissions"][recipe_id]
            if "rejection" not in submission:
                submission["rejection"] = {"reason": reason, "at": _now_ms()}
                self._write(state)
            return _receipt(submission)

    def publish(self, recipe: dict) -> dict:
        source = recipe.get("source")
        url = _source_url(source.get("url") if isinstance(source, dict) else None)
        groups = recipe.get("groups")
        if (
            not _strings([recipe.get("title"), recipe.get("publisher")])
            or not _strings(recipe.get("steps"))
            or not _strings(recipe.get("categories"))
            or not isinstance(groups, list)
            or not groups
            or any(
                not isinstance(group, dict)
                or not _strings([group.get("title")])
                or not _strings(group.get("lines"))
                for group in groups
            )
        ):
            raise ValueError("recipe requires reviewed fields")
        images = recipe.get("images", [])
        if not isinstance(images, list):
            raise ValueError("invalid recipe images")
        for image in [recipe.get("image"), *images]:
            if image:
                _source_url(image)
        recipe_id = _recipe_id(url)
        with self._lock:
            state = self._read()
            if state["submissions"].get(recipe_id, {}).get("rejection"):
                raise RecipeRejectedError("rejected recipe cannot be published")
            existing = state["recipes"].get(recipe_id, {})
            state["recipes"][recipe_id] = {
                **recipe,
                "source": {"url": existing.get("source", {}).get("url", url), "files": []},
                "createdAt": existing.get("createdAt", _now_ms()),
            }
            item = state["submissions"].get(recipe_id)
            if item:
                item.update(
                    status="saved", message="Gemt", title=recipe["title"], updatedAt=_now_ms()
                )
                state["recipes"][recipe_id]["source"]["uploadedAt"] = item["receivedAt"]
            self._write(state)
            try:
                catalog = recipe_catalog_reference(list(state["recipes"].values()))
            except (TypeError, ValueError, KeyError):
                catalog = "unavailable"
            recipe_event(
                "catalog_persist",
                "saved",
                recipe_id=recipe_id,
                catalog=catalog,
                count=len(state["recipes"]),
            )
        return _saved(recipe_id)
