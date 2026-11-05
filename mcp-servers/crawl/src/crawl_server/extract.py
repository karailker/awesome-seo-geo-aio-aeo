"""HTML extraction for crawl records (P4): on-page fields, heading outline, content hash, structured data.

Structured data (JSON-LD, microdata, RDFa) uses extruct. Visible-page fields use selectolax.
The content hash covers visible text only, so the same page gives the same hash on every run.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any
from urllib.parse import urljoin

import extruct
from selectolax.lexbor import LexborHTMLParser as HTMLParser  # Modest backend is deprecated in selectolax 1.0

_WHITESPACE = re.compile(r"\s+")
_HEADING_TAGS = ("h1", "h2", "h3", "h4", "h5", "h6")
_NON_CONTENT = "script, style, noscript, template"


def _attr(node: Any, name: str) -> str | None:
    if node is None:
        return None
    value = node.attributes.get(name)
    return value.strip() if isinstance(value, str) and value.strip() else None


def extract_page(html: str, url: str) -> dict[str, Any]:
    tree = HTMLParser(html)

    title_node = tree.css_first("title")
    title = _WHITESPACE.sub(" ", title_node.text()).strip() if title_node else None
    title = title or None

    meta_description = _attr(tree.css_first('meta[name="description" i]'), "content")

    canonical_href = _attr(tree.css_first('link[rel="canonical" i]'), "href")
    canonical = urljoin(url, canonical_href) if canonical_href else None

    html_node = tree.css_first("html")
    lang = _attr(html_node, "lang")

    hreflang = [
        {"lang": _attr(node, "hreflang"), "href": urljoin(url, _attr(node, "href") or "")}
        for node in tree.css('link[rel="alternate" i][hreflang]')
        if _attr(node, "hreflang") and _attr(node, "href")
    ]

    headings = []
    for node in tree.css(", ".join(_HEADING_TAGS)):
        text = _WHITESPACE.sub(" ", node.text()).strip()
        if text:
            headings.append({"level": int(node.tag[1]), "text": text})

    for node in tree.css(_NON_CONTENT):
        node.decompose()
    body = tree.body
    visible = _WHITESPACE.sub(" ", body.text(separator=" ")).strip() if body else ""
    word_count = len(visible.split()) if visible else 0
    content_hash = "sha256:" + hashlib.sha256(visible.encode("utf-8")).hexdigest()

    return {
        "title": title,
        "meta_description": meta_description,
        "canonical": canonical,
        "lang": lang,
        "hreflang": hreflang,
        "headings": headings,
        "word_count": word_count,
        "content_hash": content_hash,
        "structured_data": structured_data(html, url),
    }


def structured_data(html: str, url: str) -> list[dict[str, Any]]:
    raw = extruct.extract(html, base_url=url, syntaxes=["json-ld", "microdata", "rdfa"], uniform=True)
    items: list[dict[str, Any]] = []
    for syntax in ("json-ld", "microdata", "rdfa"):
        for item in raw.get(syntax, []) or []:
            items.append({"syntax": syntax, "type": _item_type(item), "item": item})
    return items


def _item_type(item: Any) -> str | None:
    if isinstance(item, dict):
        value = item.get("@type") or item.get("type")
        if isinstance(value, list):
            return ",".join(str(v) for v in value) or None
        return str(value) if value else None
    return None
