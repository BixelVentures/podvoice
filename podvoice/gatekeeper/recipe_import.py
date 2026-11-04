"""Import source-owned Recipe JSON-LD without inventing ingredients or instructions."""

from __future__ import annotations

import asyncio
import ipaddress
import json
import socket
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

from aiohttp import (
    ClientError,
    ClientSession,
    ClientTimeout,
    DummyCookieJar,
    TCPConnector,
)
from aiohttp.abc import AbstractResolver

from .recipe_submissions import _source_url

MAX_HTML = 2 * 1024 * 1024
FETCH_SECONDS = 12
_IMPORT_SLOTS = asyncio.Semaphore(2)


class ImportRejected(ValueError):
    """A source cannot be published without a human checking it."""


def public_url(url: str) -> str:
    parts = urlsplit(url)
    if (parts.scheme not in {"http", "https"} or not parts.hostname
        or parts.username is not None or parts.password is not None
        or parts.port not in {None, 80, 443} or len(url) > 2048):
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
            host, port, type=socket.SOCK_STREAM, family=family)
        if not answers or any(not ipaddress.ip_address(answer[4][0]).is_global or ipaddress.ip_address(answer[4][0]).is_multicast for answer in answers):
            raise ImportRejected("unsafe_url")
        return [dict(hostname=host, host=answer[4][0], port=port, family=answer[0],
                     proto=answer[2], flags=socket.AI_NUMERICHOST) for answer in answers]

    async def close(self):
        pass


async def fetch_html(url: str) -> tuple[str, str]:
    connector = TCPConnector(resolver=PublicResolver(), use_dns_cache=False, limit=2)
    async with ClientSession(connector=connector, cookie_jar=DummyCookieJar(), trust_env=False,
                             auto_decompress=False, max_field_size=65536, max_line_size=65536, timeout=ClientTimeout(total=FETCH_SECONDS)) as session:
        async with asyncio.timeout(FETCH_SECONDS):
            for _ in range(5):
                public_url(url)
                async with session.get(url, allow_redirects=False, headers={
                    "User-Agent": "PodView recipe importer", "Accept": "text/html", "Accept-Encoding": "identity"}) as response:
                    if response.status in {301, 302, 303, 307, 308}:
                        location = response.headers.get("Location")
                        if not location:
                            raise ImportRejected("unreadable")
                        url = urljoin(url, location)
                        continue
                    if response.status != 200:
                        raise OSError("source unavailable")
                    if response.content_type not in {"text/html", "application/xhtml+xml"}:
                        raise ImportRejected("not_recipe")
                    if response.headers.get("Content-Encoding", "identity").lower() not in {"", "identity"}:
                        raise ImportRejected("unreadable")
                    data = bytearray()
                    async for chunk in response.content.iter_chunked(16384):
                        data.extend(chunk)
                        if len(data) > MAX_HTML:
                            raise ImportRejected("unreadable")
                    try:
                        return data.decode(response.charset or "utf-8"), url
                    except (LookupError, UnicodeError) as exc:
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
    return kind in ([kinds] if isinstance(kinds, str) else kinds) if isinstance(kinds, (str, list)) else False


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

    for script in parser.scripts:
        try:
            walk(json.loads(script, object_pairs_hook=unique_object))
        except ImportRejected:
            raise
        except (ValueError, RecursionError):
            continue
    recipes = [node for node in nodes if typed(node, "Recipe")]
    unique = {json.dumps(node, sort_keys=True): node for node in recipes}
    if not unique:
        raise ImportRejected("not_recipe")
    if len(unique) != 1:
        raise ImportRejected("ambiguous")
    recipe = next(iter(unique.values()))
    title = text(recipe.get("name"))
    if len(title) > 256:
        raise ImportRejected("unreadable")
    ingredients = recipe.get("recipeIngredient")
    if (not title or not isinstance(ingredients, list) or not ingredients
        or any(not text(line) for line in ingredients)):
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
    categories = list(dict.fromkeys(part.strip() for value in categories
                                   for part in text(value).split(",") if part.strip())) or ["Øvrige"]
    portions = recipe.get("recipeYield", "")
    if isinstance(portions, list):
        portions = next((text(value) for value in portions if text(value)), "")
    return {"title": title, "publisher": publisher, "description": text(recipe.get("description")),
            "portions": text(str(portions)) if portions else "", "categories": categories,
            "groups": [{"title": "Ingredienser", "lines": [text(line) for line in ingredients]}],
            "steps": steps, "phases": headings, "image": next(iter(photos), ""), "images": photos,
            "cookingTime": duration(recipe.get("cookTime")), "totalTime": duration(recipe.get("totalTime")),
            "source": {"url": source_url, "files": []}}


async def import_link(store, url):
    """An accepted upload is durable before fetching; only a durable publication says Gemt."""
    url = _source_url(url)
    receipt = await asyncio.to_thread(store.submit, url)
    if receipt["status"] in {"saved", "rejected"}:
        return await asyncio.to_thread(store.phone_receipt, receipt["id"])
    claimed = await asyncio.to_thread(store.begin_import, receipt["id"])
    if not claimed:
        return await asyncio.to_thread(store.receipt, receipt["id"])
    try:
        async with asyncio.timeout(FETCH_SECONDS + 1), _IMPORT_SLOTS:
            html, final_url = await fetch_html(url)
            recipe = extract_recipe(html, final_url)
        # Original shared URL stays the stable identity even after publisher redirects.
        recipe["source"]["url"] = url
        await asyncio.to_thread(store.publish, recipe)
        return await asyncio.to_thread(store.phone_receipt, receipt["id"])
    except asyncio.CancelledError:
        await asyncio.shield(asyncio.to_thread(store.import_failed, receipt["id"], "unavailable", False))
        raise
    except ImportRejected as exc:
        return await asyncio.to_thread(store.import_failed, receipt["id"], str(exc), True)
    except (ClientError, OSError, TimeoutError, ValueError, RecursionError):
        return await asyncio.to_thread(store.import_failed, receipt["id"], "unavailable", False)
