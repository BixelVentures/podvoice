"""Store shared recipe links until an administrator reviews them."""

import hashlib
import json
import os
import re
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

_REJECTION_MESSAGES = {
    "not_recipe": "Siden blev ikke vurderet som en opskrift",
    "unreadable": "Opskriften kunne ikke læses sikkert",
}


class RecipeStorageError(OSError):
    """The existing catalog could not be read safely."""


class RecipeRejectedError(ValueError):
    """An administrator has already rejected the submitted URL."""


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
    return {
        "id": submission["id"],
        "status": "received",
        "message": "Modtaget til gennemgang",
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
                return _saved(recipe_id)
            if recipe_id not in state["submissions"]:
                state["submissions"][recipe_id] = {
                    "id": recipe_id,
                    "url": url,
                    "receivedAt": _now_ms(),
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

    def list_submissions(self) -> list[dict]:
        with self._lock:
            return list(self._read()["submissions"].values())

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
            state["submissions"].pop(recipe_id, None)
            self._write(state)
        return _saved(recipe_id)
