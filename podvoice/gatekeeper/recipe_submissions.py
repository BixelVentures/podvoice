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
        "phone",
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
        "duplicate",
        "replied",
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
        "blocked",
        "not_found",
        "paywall",
        "duplicate",
        "denied",
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
    "not_recipe": "Ingen opskrift fundet på siden",
    "unreadable": "Opskriften kunne ikke læses sikkert",
    "incomplete": "Opskriften mangler ingredienser eller trin og er ikke gemt",
    "ambiguous": "Siden indeholder flere opskrifter og skal gennemgås",
    "unsafe_url": "Linket kan ikke hentes sikkert",
    "blocked": "Siden afviste at blive hentet af PodView",
    "not_found": "Siden findes ikke (fejl 404). Tjek linket",
    "paywall": "Siden kræver login eller abonnement",
    "unavailable": "Opskriften kunne ikke hentes. Del linket igen for at prøve igen",
    "timeout": "Siden svarede ikke i tide. Del linket igen for at prøve igen",
}

RECEIVED_MESSAGE = "Modtaget \u2013 vises i PodView om lidt"


class RecipeStorageError(OSError):
    """The existing catalog could not be read safely."""


class RecipeRejectedError(ValueError):
    """An administrator has already rejected the submitted URL."""


_SHARED_URL = re.compile(r"https?://[^\s<>\"'`«»“”]+", re.IGNORECASE)

# The version of podvoice/shortcuts/opskrifter-til-podview.plist. Raise both together
# when the shortcut changes; older shortcuts are told to fetch the new one in PodView.
RECIPE_SHORTCUT_VERSION = 2

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


# Query parameters that only say where a link was shared from, never which recipe it is.
_TRACKING_PARAM = re.compile(
    r"utm_.*|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|igsh|_ga|_gl"
    r"|yclid|twclid|ttclid|li_fat_id|ref|ref_src|si|share|shared|cmpid|amp|outputtype|output",
    re.IGNORECASE,
)
_MOBILE_HOST = re.compile(r"^(?:www|m|mobile|amp)\.", re.IGNORECASE)
_AMP_CACHE = re.compile(r"^/(?:amp/s/|c/s/)([^/]+)(/.*)?$")


def recipe_match_key(url: object) -> str:
    """One page, however it was shared: https/http, www/m/amp host, /amp path, trailing slash,
    Google AMP cache and tracking parameters all give the same key. Only used to find an
    existing recipe; the stored identity stays _source_url."""
    parts = urlsplit(_source_url(url))
    host = (parts.hostname or "").lower()
    path = parts.path
    amp = _AMP_CACHE.match(path)
    if (host.endswith(".cdn.ampproject.org") or host in {"www.google.com", "google.com"}) and amp:
        host, path = amp.group(1).lower(), amp.group(2) or "/"
    while _MOBILE_HOST.match(host) and host.count(".") > 1:
        host = _MOBILE_HOST.sub("", host, count=1)
    path = re.sub(r"(?:/amp)+/?$", "", path.rstrip("/"))
    path = re.sub(r"^/amp(?=/)", "", path) or "/"
    params = sorted(
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if not _TRACKING_PARAM.fullmatch(key)
    )
    return host + path.rstrip("/") + ("?" + urlencode(params) if params else "")


def _title_key(title: object) -> str:
    return (
        " ".join(re.sub(r"[^\w]+", " ", title.casefold()).split()) if isinstance(title, str) else ""
    )


def _now_ms() -> int:
    return time.time_ns() // 1_000_000


def _saved(recipe_id: str) -> dict:
    return {"id": recipe_id, "status": "saved", "message": "Gemt"}


def _duplicate(recipe_id: str, title: str) -> dict:
    return {
        "id": recipe_id,
        "status": "duplicate",
        "title": title,
        "message": f"Findes allerede: {title}",
    }


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
        "message": submission.get("message", RECEIVED_MESSAGE),
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

    @staticmethod
    def _match(state: dict, urls: list[str], title: str = "") -> str | None:
        """An already published recipe for these links, or with this title on the same site."""
        wanted = set()
        for url in urls:
            try:
                wanted.add(recipe_match_key(url))
            except (ValueError, TypeError):
                continue
        hosts = {key.split("/", 1)[0] for key in wanted}
        title = _title_key(title)
        aliases = state.get("aliases", {})
        for key in wanted:
            if isinstance(aliases, dict) and aliases.get(key) in state["recipes"]:
                return aliases[key]
        for recipe_id, recipe in state["recipes"].items():
            try:
                key = recipe_match_key(recipe["source"]["url"])
            except (ValueError, TypeError, KeyError):
                continue
            if key in wanted or (
                title and key.split("/", 1)[0] in hosts and _title_key(recipe.get("title")) == title
            ):
                return recipe_id
        return None

    @staticmethod
    def _record_duplicate(state: dict, recipe_id: str, url: str, existing: str) -> dict:
        title = state["recipes"][existing]["title"]
        now = _now_ms()
        item = state["submissions"].setdefault(
            recipe_id, {"id": recipe_id, "url": url, "receivedAt": now}
        )
        item.pop("rejection", None)
        item.update(
            status="duplicate",
            message="Findes allerede",
            title=title,
            duplicateOf=existing,
            updatedAt=now,
        )
        return _duplicate(existing, title)

    def submit(self, url: object) -> dict:
        url = _source_url(url)
        recipe_id = _recipe_id(url)
        with self._lock:
            state = self._read()
            if recipe_id in state["recipes"]:
                if recipe_id not in state["submissions"]:
                    state["submissions"][recipe_id] = {
                        "id": recipe_id,
                        "url": url,
                        "receivedAt": _now_ms(),
                        "updatedAt": _now_ms(),
                        "status": "saved",
                        "message": "Gemt",
                        "title": state["recipes"][recipe_id]["title"],
                    }
                    self._write(state)
                return _duplicate(recipe_id, state["recipes"][recipe_id]["title"])
            existing = self._match(state, [url])
            if existing is not None:
                receipt = self._record_duplicate(state, recipe_id, url, existing)
                self._write(state)
                return receipt
            item = state["submissions"].get(recipe_id)
            if item is None or item.get("status") == "duplicate":
                # A link whose earlier match was since deleted is a new upload.
                state["submissions"][recipe_id] = {
                    "id": recipe_id,
                    "url": url,
                    "receivedAt": _now_ms(),
                    "updatedAt": _now_ms(),
                    "status": "received",
                    "message": RECEIVED_MESSAGE,
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
                if item.get("status") not in {"saved", "duplicate"}
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
                status="importing", message="Henter opskriften fra siden", updatedAt=_now_ms()
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

    def import_interrupted(self, recipe_id: str) -> None:
        """Shutdown during an import: the link stays queued and is resumed after restart."""
        with self._lock:
            state = self._read()
            item = state["submissions"].get(recipe_id)
            if item is None or recipe_id in state["recipes"] or item.get("rejection"):
                return
            item.update(status="received", message=RECEIVED_MESSAGE, updatedAt=_now_ms())
            self._write(state)

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

    def publish(self, recipe: dict, aliases: list[str] | None = None) -> dict:
        """aliases (automatic imports only): the page's own other links (redirect target,
        canonical). A recipe already in the catalog under any of them, or with the same
        title on the same site, is reported as a duplicate and not stored again."""
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
            if aliases is not None and recipe_id not in state["recipes"]:
                existing = self._match(state, [url, *aliases], recipe["title"])
                if existing is not None:
                    receipt = self._record_duplicate(state, recipe_id, url, existing)
                    self._write(state)
                    recipe_event("duplicate", "duplicate", recipe_id=recipe_id)
                    return receipt
                keys = state.setdefault("aliases", {})
                for alias in aliases:
                    try:
                        keys.setdefault(recipe_match_key(alias), recipe_id)
                    except (ValueError, TypeError):
                        continue
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
