import json

import httpx
import pytest

from crawl_server import fetch, sitemap
from crawl_server.fetch import fetch_page
from crawl_server.render import RenderError, chrome_binary, render_html
from crawl_server.sitemap import Fetcher


@pytest.fixture(autouse=True)
def fast_policy(monkeypatch):
    monkeypatch.setattr(fetch, "RETRY_BACKOFF_SECONDS", (0.0, 0.0))
    monkeypatch.setattr(sitemap, "MIN_INTERVAL_SECONDS", 0.0)


def _page(site, path, **kwargs):
    with httpx.Client() as client:
        return fetch_page(Fetcher(client), site.url(path), **kwargs)


def _has_faq(record) -> bool:
    return any("FAQPage" in json.dumps(item) for item in record["structured_data"])


needs_chrome = pytest.mark.skipif(chrome_binary() is None, reason="Chrome not installed (set CHROME_PATH)")


def test_static_fetch_does_not_run_javascript_and_misses_js_added_faq(local_site):
    # Given: a page whose FAQ markup is only added by JavaScript

    # When: rendering is not requested
    record = _page(local_site, "/js-faq.html")

    # Then
    assert record["rendered"] is False
    assert not _has_faq(record)
    assert record["errors"] == []


@needs_chrome
def test_render_extracts_faq_markup_added_by_javascript(local_site):
    # Given: the same page

    # When
    record = _page(local_site, "/js-faq.html", render=True)

    # Then
    assert record["rendered"] is True
    assert record["errors"] == []
    assert _has_faq(record)
    assert record["title"] == "SSS"


def test_render_failure_keeps_static_html_and_records_render_failed(local_site, monkeypatch):
    # Given: Chrome cannot be started
    monkeypatch.setenv("CHROME_PATH", "/nonexistent/chrome")

    # When
    record = _page(local_site, "/js-faq.html", render=True)

    # Then
    assert record["rendered"] is False
    assert [e["code"] for e in record["errors"]] == ["RENDER_FAILED"]
    assert record["title"] == "SSS"


def test_render_refuses_non_http_schemes_without_starting_a_browser(monkeypatch):
    # Given: a browser that would fail if it were started
    monkeypatch.setenv("CHROME_PATH", "/nonexistent/chrome")

    # When / Then
    with pytest.raises(RenderError, match="only http"):
        render_html("file:///etc/passwd")


def test_render_reports_a_missing_binary_as_render_error(monkeypatch):
    # Given: CHROME_PATH points nowhere
    monkeypatch.setenv("CHROME_PATH", "/nonexistent/chrome")

    # When / Then
    with pytest.raises(RenderError, match="Chrome not found"):
        render_html("http://127.0.0.1:9/")


def test_render_never_loads_a_page_robots_disallows(local_site, monkeypatch):
    # Given: a robots-disallowed page and a renderer that must not be called
    def must_not_render(url, timeout=60):
        raise AssertionError(f"rendered a disallowed URL: {url}")

    monkeypatch.setattr(fetch, "render_html", must_not_render)

    # When: rendering is requested for it
    record = _page(local_site, "/private/secret.html", render=True)

    # Then: robots decides first; the browser is never started
    assert record["rendered"] is False
    assert record["robots_allowed"] is False
    assert [e["code"] for e in record["errors"]] == ["ROBOTS_DISALLOWED"]
