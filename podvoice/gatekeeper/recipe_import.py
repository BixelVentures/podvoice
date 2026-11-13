"""Import source-owned Recipe JSON-LD without inventing ingredients or instructions."""

from __future__ import annotations

import asyncio
import ipaddress
import json
import re
import socket
from html import unescape
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit

from aiohttp import (
    ClientError,
    ClientSession,
    ClientTimeout,
    DummyCookieJar,
    TCPConnector,
)
from aiohttp.abc import AbstractResolver

from .recipe_submissions import (
    _REJECTION_MESSAGES,
    RECEIVED_MESSAGE,
    _recipe_id,
    _source_url,
    recipe_event,
)

MAX_HTML = 5 * 1024 * 1024
FETCH_SECONDS = 12
_IMPORT_SLOTS = asyncio.Semaphore(2)


class ImportRejected(ValueError):
    """A source cannot be published without a human checking it."""


def public_url(url: str) -> str:
    parts = urlsplit(url)
    if (
        parts.scheme not in {"http", "https"}
        or not parts.hostname
        or parts.username is not None
        or parts.password is not None
        or parts.port not in {None, 80, 443}
        or len(url) > 2048
    ):
        raise ImportRejected("unsafe_url")
    host = parts.hostname.lower()
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        raise ImportRejected("unsafe_url")
    try:
        if not ipaddress.ip_address(host).is_global or ipaddress.ip_address(host).is_multicast:
            raise ImportRejected("unsafe_url")
    except ValueError as exc:
        if isinstance(exc, ImportRejected):
            raise
    return url


class PublicResolver(AbstractResolver):
    """Check every DNS answer; connector connects to these exact IPs, without re-resolution."""

    async def resolve(self, host, port=0, family=socket.AF_INET):
        answers = await asyncio.get_running_loop().getaddrinfo(
            host, port, type=socket.SOCK_STREAM, family=family
        )
        if not answers or any(
            not ipaddress.ip_address(answer[4][0]).is_global
            or ipaddress.ip_address(answer[4][0]).is_multicast
            for answer in answers
        ):
            raise ImportRejected("unsafe_url")
        return [
            dict(
                hostname=host,
                host=answer[4][0],
                port=port,
                family=answer[0],
                proto=answer[2],
                flags=socket.AI_NUMERICHOST,
            )
            for answer in answers
        ]

    async def close(self):
        pass


# Honest identification; a site that refuses it gets a clear "Siden afviste" message.
USER_AGENT = (
    "Mozilla/5.0 (compatible; PodView-opskrifter/1.0; +https://github.com/BixelVentures/podvoice)"
)
_REFUSED = {
    401: "blocked",
    403: "blocked",
    451: "blocked",
    402: "paywall",
    404: "not_found",
    410: "not_found",
}


async def fetch_html(url: str) -> tuple[str, str]:
    """Follow at most five redirects, each target checked before connecting. A page larger
    than MAX_HTML is read up to the limit; the recipe data is normally near the top."""
    connector = TCPConnector(resolver=PublicResolver(), use_dns_cache=False, limit=2)
    async with ClientSession(
        connector=connector,
        cookie_jar=DummyCookieJar(),
        trust_env=False,
        auto_decompress=True,
        max_field_size=65536,
        max_line_size=65536,
        timeout=ClientTimeout(total=FETCH_SECONDS),
    ) as session:
        async with asyncio.timeout(FETCH_SECONDS):
            for _ in range(6):
                public_url(url)
                async with session.get(
                    url,
                    allow_redirects=False,
                    headers={
                        "User-Agent": USER_AGENT,
                        "Accept": "text/html,application/xhtml+xml",
                        "Accept-Language": "da, en;q=0.8",
                        "Accept-Encoding": "gzip, deflate",
                    },
                ) as response:
                    if response.status in {301, 302, 303, 307, 308}:
                        location = response.headers.get("Location")
                        if not location:
                            raise ImportRejected("unreadable")
                        url = urljoin(url, location)
                        continue
                    if response.status in _REFUSED:
                        raise ImportRejected(_REFUSED[response.status])
                    if response.status != 200:
                        raise OSError("source unavailable")
                    if response.content_type not in {"text/html", "application/xhtml+xml"}:
                        raise ImportRejected("not_recipe")
                    if response.headers.get("Content-Encoding", "identity").lower() not in {
                        "",
                        "identity",
                        "gzip",
                        "x-gzip",
                        "deflate",
                    }:
                        raise ImportRejected("unreadable")
                    data = bytearray()
                    async for chunk in response.content.iter_chunked(16384):
                        data.extend(chunk)
                        if len(data) >= MAX_HTML:
                            del data[MAX_HTML:]
                            break
                    try:
                        return data.decode(response.charset or "utf-8", errors="strict"), url
                    except UnicodeDecodeError as exc:
                        if len(data) >= MAX_HTML and exc.start >= MAX_HTML - 4:
                            return data[: exc.start].decode(response.charset or "utf-8"), url
                        raise ImportRejected("unreadable") from exc
                    except LookupError as exc:
                        raise ImportRejected("unreadable") from exc
    raise ImportRejected("unreadable")


class SourceParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.scripts = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        if tag == "script" and dict(attrs).get("type", "").lower() == "application/ld+json":
            self.current = []

    def handle_data(self, text):
        if self.current is not None:
            self.current.append(text)

    def handle_endtag(self, tag):
        if tag == "script" and self.current is not None:
            self.scripts.append("".join(self.current))
            self.current = None


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def handle_starttag(self, tag, attrs):
        if tag in {"br", "p", "li"}:
            self.parts.append(" ")


def text(value) -> str:
    if not isinstance(value, str):
        return ""
    parser = PlainText()
    parser.feed(unescape(value))
    return " ".join("".join(parser.parts).split())


def typed(node, kind):
    kinds = node.get("@type", []) if isinstance(node, dict) else []
    return (
        kind in ([kinds] if isinstance(kinds, str) else kinds)
        if isinstance(kinds, (str, list))
        else False
    )


def duration(value):
    import re

    if not isinstance(value, str):
        return ""
    match = re.fullmatch(r"P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", value or "")
    if not match:
        return ""
    days, hours, minutes, seconds = (int(part or 0) for part in match.groups())
    minutes += days * 1440 + hours * 60
    return (f"{minutes} min." if minutes else "") or (f"{seconds} sek." if seconds else "")


# Deliberately narrow schema.org microdata support. This is not a general
# microdata processor: external itemref and unsupported instruction blocks fail closed.
class RecipeMicrodata(HTMLParser):
    _void = frozenset(
        "area base br col embed hr img input link meta param source track wbr".split()
    )
    _ignored = frozenset(("script", "style", "template", "iframe", "noscript"))

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root: dict[str, Any] = {"tag": "", "attrs": {}, "children": []}
        self.stack: list[dict[str, Any]] = [self.root]
        self.recipes = []
        self.invalid = False

    @classmethod
    def ignored(cls, node):
        if node["tag"] in cls._ignored:
            return True
        marker = " ".join(node["attrs"].get(key, "") for key in ("class", "id", "role"))
        return bool(
            re.search(
                r"(?:^|[\s_-])(?:ad|ads|advert|advertisement|advertising|sponsored)(?:$|[\s_-])",
                marker,
                re.I,
            )
        )

    def handle_starttag(self, tag, attrs):
        keys = [key for key, _ in attrs]
        if any(
            keys.count(key) > 1
            for key in (
                "itemprop",
                "itemscope",
                "itemtype",
                "itemref",
                "content",
                "datetime",
                "src",
                "href",
            )
        ):
            self.invalid = True
        attributes = {key: value or "" for key, value in attrs}
        node = {"tag": tag, "attrs": attributes, "children": []}
        self.stack[-1]["children"].append(node)
        if (
            "itemscope" in attributes
            and not self.ignored(node)
            and not any(self.ignored(parent) for parent in self.stack)
            and any(
                token in {"http://schema.org/Recipe", "https://schema.org/Recipe"}
                for token in attributes.get("itemtype", "").split()
            )
        ):
            self.recipes.append(node)
        if tag not in self._void:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self._void:
            self.handle_endtag(tag)

    def handle_data(self, value):
        self.stack[-1]["children"].append(value)

    def handle_endtag(self, tag):
        indices = [i for i, node in enumerate(self.stack) if node["tag"] == tag]
        if not indices:
            return
        index = indices[-1]
        # A mismatched close must not silently close a recipe or one of its
        # property/item scopes. Unrelated malformed document markup is ignored.
        for node in self.stack[index + 1 :]:
            if "itemscope" in node["attrs"] or "itemprop" in node["attrs"]:
                self.invalid = True
        del self.stack[index:]

    def finish(self):
        if any(
            "itemscope" in node["attrs"] or "itemprop" in node["attrs"] for node in self.stack[1:]
        ):
            self.invalid = True
        if self.invalid:
            raise ImportRejected("unreadable")
        if len(self.recipes) > 1:
            raise ImportRejected("ambiguous")
        if not self.recipes:
            return None
        return self.project(self.recipes[0])

    @classmethod
    def project(cls, root):
        allowed = {
            "name",
            "headline",
            "author",
            "publisher",
            "image",
            "description",
            "recipeYield",
            "recipeCategory",
            "cookTime",
            "totalTime",
            "recipeIngredient",
            "recipeInstructions",
        }
        values: dict[str, list[Any]] = {}
        inline = frozenset("a abbr b br code em i mark small span strong sub sup time".split())

        def scalar(node):
            attrs = node["attrs"]
            if "itemscope" in attrs or "itemref" in attrs:
                raise ImportRejected("unreadable")
            for key in ("content", "datetime", "src", "href"):
                if key in attrs:
                    return attrs[key]
            parts = []

            def collect(item):
                if isinstance(item, str):
                    parts.append(item)
                elif item["tag"] in cls._ignored:
                    return
                elif cls.ignored(item) or "itemref" in item["attrs"]:
                    raise ImportRejected("unreadable")
                elif "itemscope" in item["attrs"] or item["tag"] not in inline:
                    raise ImportRejected("unreadable")
                else:
                    if item["tag"] == "br":
                        parts.append(" ")
                    for child in item["children"]:
                        collect(child)

            for child in node["children"]:
                collect(child)
            return " ".join("".join(parts).split())

        def nested(node, prop):
            permitted = {
                "author": {"Person", "Organization"},
                "publisher": {"Person", "Organization"},
                "image": {"ImageObject"},
            }
            kinds = set(node["attrs"].get("itemtype", "").split())
            allowed_kinds = {
                scheme + kind
                for kind in permitted.get(prop, ())
                for scheme in ("https://schema.org/", "http://schema.org/")
            }
            if not kinds & allowed_kinds:
                raise ImportRejected("unreadable")
            key = "url" if prop == "image" else "name"
            found = []

            def descend(item):
                for child in item["children"]:
                    if not isinstance(child, dict) or cls.ignored(child):
                        continue
                    attrs = child["attrs"]
                    if "itemref" in attrs:
                        raise ImportRejected("unreadable")
                    if "itemscope" in attrs:
                        continue
                    if key in attrs.get("itemprop", "").split():
                        found.append(scalar(child))
                    else:
                        descend(child)

            descend(node)
            if len(set(found)) != 1 or not found[0]:
                raise ImportRejected("unreadable")
            return {key: found[0]}

        def instructions(node):
            if any(isinstance(child, str) and child.strip() for child in node["children"]):
                if any(
                    isinstance(child, dict) and child["tag"] in {"p", "li", "ol", "ul", "div"}
                    for child in node["children"]
                ):
                    raise ImportRejected("unreadable")
                return [scalar(node)]
            blocks = []
            for child in node["children"]:
                if isinstance(child, str):
                    continue
                if child["tag"] in cls._ignored:
                    continue
                if (
                    cls.ignored(child)
                    or "itemscope" in child["attrs"]
                    or "itemref" in child["attrs"]
                ):
                    raise ImportRejected("unreadable")
                if child["tag"] in {"p", "li"}:
                    blocks.append(scalar(child))
                elif child["tag"] in {"ol", "ul"}:
                    for item in child["children"]:
                        if isinstance(item, str) and not item.strip():
                            continue
                        if (
                            not isinstance(item, dict)
                            or item["tag"] != "li"
                            or cls.ignored(item)
                            or "itemscope" in item["attrs"]
                            or "itemref" in item["attrs"]
                        ):
                            raise ImportRejected("unreadable")
                        blocks.append(scalar(item))
                else:
                    raise ImportRejected("unreadable")
            return blocks

        def visit(node):
            if "itemref" in node["attrs"]:
                raise ImportRejected("unreadable")
            for child in node["children"]:
                if not isinstance(child, dict) or cls.ignored(child):
                    continue
                attrs = child["attrs"]
                if "itemref" in attrs:
                    raise ImportRejected("unreadable")
                props = set(attrs.get("itemprop", "").split()) & allowed
                if "itemscope" in attrs:
                    for prop in props:
                        values.setdefault(prop, []).append(nested(child, prop))
                    continue
                # Description is optional and can contain page chrome or even
                # other recipe properties; never flatten it into recipe text.
                if props == {"description"}:
                    visit(child)
                    continue
                if props:
                    for prop in props:
                        value = (
                            instructions(child) if prop == "recipeInstructions" else scalar(child)
                        )
                        values.setdefault(prop, []).extend(
                            value if prop == "recipeInstructions" else [value]
                        )
                else:
                    visit(child)

        visit(root)
        result: dict[str, Any] = {"@type": "Recipe"}
        for prop, items in values.items():
            if prop in {"recipeIngredient", "recipeInstructions", "recipeCategory"}:
                result[prop] = items
            elif any(item != items[0] for item in items[1:]):
                raise ImportRejected("ambiguous")
            else:
                result[prop] = items[0]
        if "name" not in result and "headline" in result:
            result["name"] = result["headline"]
        return result


_INGREDIENTS = re.compile(
    r"(?:ingredienser|ingrediens|ingredients?|du skal bruge|det skal du bruge|indkøbsliste)\b",
    re.IGNORECASE,
)
_STEPS = re.compile(
    r"(?:fremgangsmåde|sådan gør du|sådan laver du|tilberedning|instructions?|method"
    r"|directions|preparation|trin for trin)\b",
    re.IGNORECASE,
)


class PageOutline(HTMLParser):
    """The visible headings, list items and paragraphs of a page, in source order.

    Used only when a page has no structured recipe data: the page's own headings
    ("Ingredienser", "Fremgangsmåde") decide what is copied; nothing is invented."""

    _skip = frozenset(
        "script style noscript template svg nav footer aside form button iframe".split()
    )
    _blocks = frozenset("h1 h2 h3 h4 h5 h6 li p dt".split())

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks: list[tuple[str, str]] = []
        self.meta: dict[str, str] = {}
        self.skipping = 0
        self.open: list[tuple[str, list[str]]] = []
        self.in_title = False
        self.title: list[str] = []

    def handle_starttag(self, tag, attrs):
        values = {key: value or "" for key, value in attrs}
        if tag == "meta":
            key = (values.get("property") or values.get("name") or "").lower()
            if key in {"og:title", "og:url", "og:image", "og:description"}:
                self.meta.setdefault(key, values.get("content", ""))
            return
        if tag == "link" and "canonical" in values.get("rel", "").lower().split():
            self.meta.setdefault("canonical", values.get("href", ""))
            return
        if tag in self._skip:
            self.skipping += 1
            return
        if tag == "title":
            self.in_title = True
        if self.skipping:
            return
        if tag == "br" and self.open:
            self.open[-1][1].append("\n")
        elif tag in self._blocks and not (tag == "p" and any(t == "li" for t, _ in self.open)):
            self.open.append((tag, []))

    def handle_endtag(self, tag):
        if tag in self._skip:
            self.skipping = max(0, self.skipping - 1)
            return
        if tag == "title":
            self.in_title = False
        if self.skipping:
            return
        for index in range(len(self.open) - 1, -1, -1):
            if self.open[index][0] == tag:
                for name, parts in reversed(self.open[index:]):
                    self._close(name, parts)
                del self.open[index:]
                return

    def _close(self, tag, parts):
        value = "\n".join(" ".join(line.split()) for line in "".join(parts).split("\n"))
        value = value.strip()
        if value:
            self.blocks.append((tag, value))

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)
        if not self.skipping and self.open:
            self.open[-1][1].append(data)

    def close(self):
        super().close()
        for name, parts in reversed(self.open):
            self._close(name, parts)
        self.open = []


def _heading(tag: str, value: str, pattern: re.Pattern) -> bool:
    return (
        len(value) <= 60
        and "\n" not in value
        and pattern.match(value.lstrip("0123456789. ")) is not None
        and (tag.startswith("h") or tag == "dt" or len(value) <= 40)
    )


def outline_recipe(html: str) -> dict | None:
    """A recipe from the page's own "Ingredienser" and "Fremgangsmåde" sections, or None."""
    page = PageOutline()
    page.feed(html)
    page.close()
    blocks = page.blocks
    start = next((i for i, (t, v) in enumerate(blocks) if _heading(t, v, _INGREDIENTS)), None)
    steps_at = next(
        (
            i
            for i, (t, v) in enumerate(blocks)
            if start is not None and i > start and _heading(t, v, _STEPS)
        ),
        None,
    )
    if start is None or steps_at is None:
        return None
    level = int(blocks[start][0][1]) if blocks[start][0].startswith("h") else 7
    groups: list[dict[str, Any]] = [{"title": "Ingredienser", "lines": []}]
    for tag, value in blocks[start + 1 : steps_at]:
        if tag.startswith("h") and int(tag[1]) <= level:
            break
        if tag.startswith("h") or (tag == "p" and value.endswith(":") and len(value) <= 40):
            groups.append({"title": value.rstrip(":"), "lines": []})
        elif tag == "li" or tag == "p":
            groups[-1]["lines"].extend(line for line in value.split("\n") if line.strip())
    groups = [group for group in groups if group["lines"]]
    steps_level = int(blocks[steps_at][0][1]) if blocks[steps_at][0].startswith("h") else 7
    items: list[str] = []
    paragraphs: list[str] = []
    for tag, value in blocks[steps_at + 1 :]:
        if tag.startswith("h") and int(tag[1]) <= steps_level:
            break
        if _heading(tag, value, _INGREDIENTS):
            break
        if tag.startswith("h"):
            continue
        (items if tag == "li" else paragraphs).append(" ".join(value.split()))
    steps = items or paragraphs
    lines = sum(len(group["lines"]) for group in groups)
    title = page.meta.get("og:title") or next((v for t, v in blocks if t == "h1"), "")
    title = title or "".join(page.title)
    if lines < 2 or not steps or lines > 200 or len(steps) > 60 or not text(title):
        return None
    return {
        "@type": "Recipe",
        "name": " ".join(title.split()),
        "recipeIngredient": [line for group in groups for line in group["lines"]],
        "recipeInstructions": steps,
        "image": page.meta.get("og:image", ""),
        "description": page.meta.get("og:description", ""),
        "_groups": groups,
    }


def page_links(html: str, page_url: str) -> list[str]:
    """The links a page gives for itself (redirect target, canonical, og:url)."""
    page = PageOutline()
    page.feed(html[:262144])
    links = [page_url]
    for key in ("canonical", "og:url"):
        value = page.meta.get(key, "").strip()
        if value:
            links.append(urljoin(page_url, value))
    return list(dict.fromkeys(links))


def _paywalled(nodes: list) -> bool:
    return any(
        isinstance(node, dict) and str(node.get("isAccessibleForFree", "")).lower() == "false"
        for node in nodes
    )


def extract_recipe(html: str, source_url: str) -> dict:
    parser = SourceParser()
    parser.feed(html)
    nodes = []

    def walk(value):
        if isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, dict):
            nodes.append(value)
            for child in value.values():
                if isinstance(child, (dict, list)):
                    walk(child)

    def unique_object(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ImportRejected("unreadable")
            value[key] = item
        return value

    malformed_jsonld = False
    for script in parser.scripts:
        try:
            walk(json.loads(script, object_pairs_hook=unique_object))
        except ImportRejected:
            raise
        except (ValueError, RecursionError):
            malformed_jsonld = True
            continue
    recipes = [node for node in nodes if typed(node, "Recipe")]
    unique = {json.dumps(node, sort_keys=True): node for node in recipes}
    if not unique:
        if malformed_jsonld:
            raise ImportRejected("not_recipe")
        microdata = RecipeMicrodata()
        microdata.feed(html)
        recipe = microdata.finish() or outline_recipe(html)
        if recipe is None:
            raise ImportRejected("paywall" if _paywalled(nodes) else "not_recipe")
        unique = {"page": recipe}
    if len(unique) != 1:
        raise ImportRejected("ambiguous")
    recipe = next(iter(unique.values()))
    title = text(recipe.get("name"))
    if len(title) > 256:
        raise ImportRejected("unreadable")
    ingredients = recipe.get("recipeIngredient")
    if (
        not title
        or not isinstance(ingredients, list)
        or not ingredients
        or any(not text(line) for line in ingredients)
    ):
        raise ImportRejected("incomplete")
    steps = []
    headings = []

    def instruction(value, heading=""):
        if isinstance(value, list):
            if not value:
                raise ImportRejected("incomplete")
            for index, item in enumerate(value):
                instruction(item, heading if index == 0 else "")
        elif isinstance(value, str) and text(value):
            steps.append(text(value))
            headings.append(heading)
        elif typed(value, "HowToSection"):
            instruction(value.get("itemListElement"), text(value.get("name")))
        elif typed(value, "HowToStep") and text(value.get("text")):
            steps.append(text(value["text"]))
            name = text(value.get("name"))
            headings.append(" · ".join(part for part in [heading, name] if part))
        else:
            raise ImportRejected("incomplete")

    instruction(recipe.get("recipeInstructions"))
    if not steps or len(steps) > 200 or len(ingredients) > 200:
        raise ImportRejected("incomplete")
    publisher = recipe.get("author") or recipe.get("publisher")
    if isinstance(publisher, list):
        publisher = publisher[0] if len(publisher) == 1 else None
    publisher = text(publisher.get("name")) if isinstance(publisher, dict) else text(publisher)
    publisher = publisher or urlsplit(source_url).hostname
    images = recipe.get("image", [])
    images = images if isinstance(images, list) else [images]
    photos = []
    for image in images[:30]:
        image = image.get("url") or image.get("contentUrl") if isinstance(image, dict) else image
        if isinstance(image, str):
            try:
                image = public_url(urljoin(source_url, image))
            except (ValueError, TypeError):
                continue
            if image not in photos:
                photos.append(image)
    categories = recipe.get("recipeCategory", [])
    categories = categories if isinstance(categories, list) else [categories]
    categories = list(
        dict.fromkeys(
            part.strip() for value in categories for part in text(value).split(",") if part.strip()
        )
    ) or ["Øvrige"]
    portions = recipe.get("recipeYield", "")
    if isinstance(portions, list):
        portions = next((text(value) for value in portions if text(value)), "")
    return {
        "title": title,
        "publisher": publisher,
        "description": text(recipe.get("description")),
        "portions": text(str(portions)) if portions else "",
        "categories": categories,
        "groups": [
            {"title": text(group["title"]), "lines": [text(line) for line in group["lines"]]}
            for group in recipe.get("_groups") or [{"title": "Ingredienser", "lines": ingredients}]
        ],
        "steps": steps,
        "phases": headings,
        "image": next(iter(photos), ""),
        "images": photos,
        "cookingTime": duration(recipe.get("cookTime")),
        "totalTime": duration(recipe.get("totalTime")),
        "source": {"url": source_url, "files": []},
    }


# The phone always gets an answer this fast; a slower import continues in the background
# and its outcome is shown in PodView's upload history.
REPLY_SECONDS = 6.0
_RUNNING: dict[str, asyncio.Task] = {}


async def import_link(store, url, *, reply_within: float | None = None):
    """An accepted upload is durable before fetching; only a durable publication says Gemt.

    reply_within (phone uploads): answer "Modtaget" if the import is not done by then. The
    import itself is never cancelled by a caller that stops waiting."""
    try:
        url = _source_url(url)
    except (ValueError, TypeError):
        recipe_event("submit", "rejected", reason="invalid_url")
        raise
    recipe_id = _recipe_id(url)
    try:
        receipt = await asyncio.to_thread(store.submit, url)
        recipe_event("submit", receipt["status"], recipe_id=recipe_id)
        if receipt["status"] == "duplicate":
            recipe_event("duplicate", "duplicate", recipe_id=recipe_id)
            return receipt
        if receipt["status"] in {"saved", "rejected"}:
            recipe_event("duplicate", receipt["status"], recipe_id=recipe_id)
            return await asyncio.to_thread(store.phone_receipt, receipt["id"])
        # Check and register with no await in between: a second share of the same link
        # waits for the same import instead of starting another.
        task = _RUNNING.get(recipe_id)
        if task is None:
            task = asyncio.create_task(_claim_and_import(store, url, recipe_id))
            _RUNNING[recipe_id] = task
            task.add_done_callback(_forget(recipe_id))
        if reply_within is None:
            return await asyncio.shield(task)
        done, _ = await asyncio.wait({task}, timeout=reply_within)
        if task in done:
            return task.result()
        recipe_event("submit", "replied", recipe_id=recipe_id)
        return {"id": recipe_id, "status": "importing", "message": RECEIVED_MESSAGE}
    except OSError:
        recipe_event("storage", "failed", recipe_id=recipe_id, reason="unavailable")
        raise


def _forget(recipe_id: str):
    def done(task: asyncio.Task) -> None:
        if _RUNNING.get(recipe_id) is task:
            del _RUNNING[recipe_id]
        if not task.cancelled():
            task.exception()  # Retrieved: a storage failure is already journaled.

    return done


async def _claim_and_import(store, url: str, recipe_id: str) -> dict:
    if not await asyncio.to_thread(store.begin_import, recipe_id):
        # Another add-on process holds the lease, or an administrator rejected it meanwhile.
        pending = await asyncio.to_thread(store.receipt, recipe_id)
        recipe_event("duplicate", pending["status"], recipe_id=recipe_id)
        return pending
    return await _run_import(store, url, recipe_id)


async def _run_import(store, url: str, recipe_id: str) -> dict:
    recipe_event("import", "started", recipe_id=recipe_id)
    phase = "fetch"
    try:
        async with asyncio.timeout(FETCH_SECONDS + 1), _IMPORT_SLOTS:
            html, final_url = await fetch_html(url)
            phase = "parse"
            recipe = extract_recipe(html, final_url)
            aliases = page_links(html, final_url)
        # Original shared URL stays the stable identity even after publisher redirects.
        recipe["source"]["url"] = url
        phase = "storage"
        result = await asyncio.to_thread(store.publish, recipe, aliases)
        if result["status"] == "duplicate":
            return result
        return await asyncio.to_thread(store.phone_receipt, recipe_id)
    except asyncio.CancelledError:
        await asyncio.shield(asyncio.to_thread(store.import_interrupted, recipe_id))
        recipe_event("import", "failed", recipe_id=recipe_id, reason="cancelled")
        raise
    except ImportRejected as exc:
        reason = str(exc) if str(exc) in _REJECTION_MESSAGES else "unreadable"
        result = await asyncio.to_thread(store.import_failed, recipe_id, reason, True)
        recipe_event("import", "rejected", recipe_id=recipe_id, reason=reason)
        return result
    except (ClientError, OSError, TimeoutError, ValueError, RecursionError) as exc:
        timeout = isinstance(exc, TimeoutError) and phase != "storage"
        result = await asyncio.to_thread(
            store.import_failed, recipe_id, "timeout" if timeout else "unavailable", False
        )
        reason = (
            "storage"
            if phase == "storage"
            else "timeout"
            if timeout
            else "network"
            if phase == "fetch"
            else "invalid_data"
        )
        recipe_event("import", "failed", recipe_id=recipe_id, reason=reason)
        return result
