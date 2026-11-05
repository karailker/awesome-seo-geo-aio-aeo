import json

import pytest

from crawl_server import fetch, sitemap
from crawl_server import server as tools


@pytest.fixture(autouse=True)
def fast_policy(monkeypatch, tmp_path):
    monkeypatch.setenv("AWESOME_SEO_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(sitemap, "MIN_INTERVAL_SECONDS", 0.0)
    monkeypatch.setattr(fetch, "RETRY_BACKOFF_SECONDS", (0.0, 0.0))


def test_fetch_pages_rejects_output_outside_data_dir(tmp_path):
    (tmp_path / "in.jsonl").write_text(json.dumps({"url": "http://127.0.0.1:1/x"}) + "\n")

    result = tools.crawl_fetch_pages("in.jsonl", "../escape.jsonl")

    assert result["ok"] is False
    assert result["errors"][0]["code"] == "INVALID_INPUT"


def test_fetch_pages_rejects_url_cap_out_of_range(tmp_path):
    result = tools.crawl_fetch_pages("in.jsonl", "out.jsonl", url_cap=0)

    assert result["errors"][0]["code"] == "INVALID_INPUT"


def test_fetch_pages_reports_input_without_http_urls(tmp_path):
    (tmp_path / "in.jsonl").write_text(json.dumps({"url": "ftp://example.com/x"}) + "\n")

    result = tools.crawl_fetch_pages("in.jsonl", "out.jsonl")

    assert result["ok"] is False
    assert "no http(s) URLs" in result["errors"][0]["message"]


def test_fetch_pages_reads_urls_from_discovery_jsonl_and_writes_records(local_site, tmp_path):
    (tmp_path / "in.jsonl").write_text(
        "\n".join(json.dumps({"url": local_site.url(p)}) for p in ["/index.html", "/index.html", "/jsonld.html"]) + "\n"
    )

    result = tools.crawl_fetch_pages("in.jsonl", "crawl/out.jsonl", url_cap=10)

    assert result["ok"] is True
    assert result["data"]["urlCount"] == 2  # duplicate removed before fetching
    rows = [json.loads(line) for line in (tmp_path / "crawl" / "out.jsonl").read_text().splitlines()]
    assert [r["url"] for r in rows] == [local_site.url("/index.html"), local_site.url("/jsonld.html")]


def test_extract_structured_data_returns_fields_for_one_url(local_site):
    result = tools.crawl_extract_structured_data(local_site.url("/jsonld.html"))

    assert result["ok"] is True
    assert result["data"]["title"] == "Article page"
    assert result["data"]["structured_data"][0]["type"] == "Article"


def test_check_access_validates_sample_size_and_scheme(local_site):
    assert tools.crawl_check_access(local_site.base, [])["errors"][0]["code"] == "INVALID_INPUT"
    assert tools.crawl_check_access("ftp://x", ["https://x/a"])["errors"][0]["code"] == "INVALID_INPUT"
    assert tools.crawl_check_access(local_site.base, ["file:///etc/passwd"])["errors"][0]["code"] == "INVALID_INPUT"
