import gzip
import json

import httpx
import pytest

from crawl_server import fetch, sitemap
from crawl_server.fetch import crawl_pages, fetch_page
from crawl_server.sitemap import Fetcher


@pytest.fixture(autouse=True)
def fast_policy(monkeypatch):
    # Keep tests fast. The rate-limit test sets its own interval.
    monkeypatch.setattr(fetch, "RETRY_BACKOFF_SECONDS", (0.0, 0.0))
    monkeypatch.setattr(sitemap, "MIN_INTERVAL_SECONDS", 0.0)


def _client():
    return httpx.Client()


def _page(site, path):
    with _client() as client:
        return fetch_page(Fetcher(client), site.url(path))


def test_follows_redirect_chain_and_extracts_final_page(local_site):
    record = _page(local_site, "/redirect/start")

    assert record["status"] == 200
    assert [hop["status"] for hop in record["redirect_chain"]] == [301, 302]
    assert record["final_url"] == local_site.url("/index.html")
    assert record["title"] == "Home page"
    assert record["errors"] == []


def test_disallowed_path_is_not_requested(local_site):
    record = _page(local_site, "/private/secret.html")

    assert record["robots_allowed"] is False
    assert [e["code"] for e in record["errors"]] == ["ROBOTS_DISALLOWED"]
    assert all(path != "/private/secret.html" for path, _ in local_site.hits)


def test_404_is_recorded_without_extraction(local_site):
    record = _page(local_site, "/missing.html")

    assert record["status"] == 404
    assert [e["code"] for e in record["errors"]] == ["NOT_FOUND"]
    assert record["title"] is None and record["content_hash"] is None


def test_500_is_retried_then_reported_as_retryable(local_site):
    record = _page(local_site, "/broken")

    attempts = [path for path, _ in local_site.hits if path == "/broken"]
    assert len(attempts) == fetch.RETRY_ATTEMPTS + 1
    assert record["status"] == 500
    assert record["errors"][0] == {"code": "HTTP_ERROR", "message": "HTTP 500", "retryable": True}


def test_non_html_is_recorded_without_extraction(local_site):
    record = _page(local_site, "/plain.txt")

    assert [e["code"] for e in record["errors"]] == ["NOT_HTML"]
    assert record["content_hash"] is None


def test_per_host_interval_holds_for_every_request(local_site, monkeypatch, tmp_path):
    monkeypatch.setattr(sitemap, "MIN_INTERVAL_SECONDS", 0.2)
    urls = [local_site.url(p) for p in ["/index.html", "/jsonld.html", "/microdata.html", "/no-canonical.html"]]

    with _client() as client:
        crawl_pages(urls, tmp_path / "run.jsonl", tmp_path, client)

    times = [t for _, t in local_site.hits]
    gaps = [b - a for a, b in zip(times, times[1:])]
    assert len(times) >= 5  # robots.txt plus four pages
    assert min(gaps) >= 0.19  # server-observed spacing, allowing timer jitter


def test_identical_pages_give_identical_content_hashes_across_runs(local_site, tmp_path):
    urls = [local_site.url(p) for p in ["/index.html", "/jsonld.html"]]

    with _client() as client:
        crawl_pages(urls, tmp_path / "a.jsonl", tmp_path, client)
        crawl_pages(urls, tmp_path / "b.jsonl", tmp_path, client)

    def hashes(path):
        return [json.loads(line)["content_hash"] for line in path.read_text().splitlines()]

    first, second = hashes(tmp_path / "a.jsonl"), hashes(tmp_path / "b.jsonl")
    assert first == second
    assert all(h and h.startswith("sha256:") for h in first)


def test_jsonl_record_has_documented_fields_and_flags_missing_canonical_and_duplicate_titles(local_site, tmp_path):
    urls = [local_site.url(p) for p in ["/no-canonical.html", "/dup-a.html", "/dup-b.html"]]

    with _client() as client:
        result = crawl_pages(urls, tmp_path / "run.jsonl", tmp_path, client)

    rows = [json.loads(line) for line in (tmp_path / "run.jsonl").read_text().splitlines()]
    expected = {
        "run_id", "url", "fetched_at", "status", "final_url", "redirect_chain", "content_type", "title",
        "meta_description", "canonical", "lang", "hreflang", "headings", "word_count", "content_hash",
        "structured_data", "jsonld_syntax_errors", "robots_allowed", "rendered", "raw_html_path", "errors",
    }
    assert set(rows[0]) == expected
    assert rows[0]["canonical"] is None
    assert rows[1]["title"] == rows[2]["title"] == "Same title"
    assert result["data"]["urlCount"] == 3


def test_raw_html_is_off_by_default_and_gzipped_when_enabled(local_site, tmp_path):
    url = [local_site.url("/index.html")]

    with _client() as client:
        crawl_pages(url, tmp_path / "off.jsonl", tmp_path, client)
        crawl_pages(url, tmp_path / "on.jsonl", tmp_path, client, want_raw=True)

    off = json.loads((tmp_path / "off.jsonl").read_text())
    on = json.loads((tmp_path / "on.jsonl").read_text())
    assert off["raw_html_path"] is None
    assert on["raw_html_path"].endswith(".html.gz")
    with gzip.open(on["raw_html_path"], "rt", encoding="utf-8") as handle:
        assert "Welcome" in handle.read()


def test_robots_unreadable_marks_access_unknown_not_allowed(local_site):
    local_site.robots_status = 503

    record = _page(local_site, "/index.html")

    assert record["robots_allowed"] is None
    assert [e["code"] for e in record["errors"]] == ["ROBOTS_UNAVAILABLE"]


def test_429_is_retried_after_the_server_asks_and_then_succeeds(local_site, monkeypatch):
    # Given: a page that answers 429 once, then 200
    waits = []
    monkeypatch.setattr(fetch.time, "sleep", lambda seconds: waits.append(seconds))

    # When
    record = _page(local_site, "/rate-limited-once")

    # Then: the retry waited for the server's Retry-After and the page was extracted
    assert record["status"] == 200
    assert record["errors"] == []
    assert record["title"] == "ok"
    assert waits == [0.0]


def test_persistent_429_is_recorded_as_retryable_rate_limit(local_site, monkeypatch):
    # Given: a page that always answers 429
    monkeypatch.setattr(fetch.time, "sleep", lambda seconds: None)

    # When
    record = _page(local_site, "/rate-limited-always")

    # Then: the error is RATE_LIMITED, retryable, and the page is not extracted
    assert record["status"] == 429
    assert record["errors"] == [{"code": "RATE_LIMITED", "message": "HTTP 429", "retryable": True}]
    assert record["title"] is None
