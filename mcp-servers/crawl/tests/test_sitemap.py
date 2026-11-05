import json
from pathlib import Path

import httpx
import pytest

from crawl_server import sitemap
from crawl_server.sitemap import discover_sitemap, resolve_output_path

FIXTURES = Path(__file__).parent / "fixtures" / "sitemaps"
BASE = "https://example.com"


@pytest.fixture(autouse=True)
def no_rate_limit_wait(monkeypatch):
    # Tests must not sleep; the per-host interval is covered by the default constant.
    monkeypatch.setattr(sitemap, "MIN_INTERVAL_SECONDS", 0.0)


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def serve(routes: dict[str, tuple[int, bytes]], seen: list[httpx.Request] | None = None) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        status, body = routes.get(str(request.url), (404, b"not found"))
        return httpx.Response(status, content=body, request=request)

    return httpx.Client(transport=httpx.MockTransport(handler))


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_lists_urls_with_lastmod_and_skips_other_hosts(tmp_path):
    client = serve({f"{BASE}/plain.xml": (200, fixture_bytes("plain.xml"))})
    out = tmp_path / "plain.jsonl"

    result = discover_sitemap(f"{BASE}/plain.xml", out, client=client)

    assert result["ok"] is True
    assert result["data"]["urlCount"] == 2
    rows = {row["url"]: row for row in read_jsonl(out)}
    assert set(rows) == {f"{BASE}/", f"{BASE}/about"}
    assert rows[f"{BASE}/"]["lastmod"] == "2026-10-01"
    assert any("other hosts" in w for w in result["warnings"])


def test_follows_sitemap_index_into_plain_and_gzip_children(tmp_path):
    client = serve(
        {
            f"{BASE}/index.xml": (200, fixture_bytes("index.xml")),
            f"{BASE}/child-a.xml": (200, fixture_bytes("child-a.xml")),
            f"{BASE}/child-b.xml.gz": (200, fixture_bytes("child-b.xml.gz")),
        }
    )
    out = tmp_path / "index.jsonl"

    result = discover_sitemap(f"{BASE}/index.xml", out, client=client)

    assert result["ok"] is True
    assert result["data"]["urlCount"] == 3
    rows = {row["url"]: row for row in read_jsonl(out)}
    assert rows[f"{BASE}/products/widget"]["sitemap_url"] == f"{BASE}/child-b.xml.gz"
    assert rows[f"{BASE}/blog/post-1"]["lastmod"] == "2026-09-15T08:00:00+00:00"


def test_unreachable_child_is_reported_and_other_children_still_collected(tmp_path):
    client = serve(
        {
            f"{BASE}/index.xml": (200, fixture_bytes("index.xml")),
            f"{BASE}/child-a.xml": (200, fixture_bytes("child-a.xml")),
            f"{BASE}/child-b.xml.gz": (200, fixture_bytes("child-b.xml.gz")),
        }
    )
    out = tmp_path / "index.jsonl"

    result = discover_sitemap(f"{BASE}/index.xml", out, client=client)

    codes = [e["code"] for e in result["errors"]]
    assert codes == ["HTTP_ERROR"]
    assert result["errors"][0]["message"].startswith(f"{BASE}/child-missing.xml")
    assert result["data"]["urlCount"] == 3


def test_malformed_xml_fails_without_writing_output(tmp_path):
    client = serve({f"{BASE}/malformed.xml": (200, fixture_bytes("malformed.xml"))})
    out = tmp_path / "malformed.jsonl"

    result = discover_sitemap(f"{BASE}/malformed.xml", out, client=client)

    assert result["ok"] is False
    assert [e["code"] for e in result["errors"]] == ["MALFORMED_XML"]
    assert not out.exists()


def test_refuses_doctype_and_entity_declarations(tmp_path):
    client = serve({f"{BASE}/entity.xml": (200, fixture_bytes("entity.xml"))})

    result = discover_sitemap(f"{BASE}/entity.xml", tmp_path / "e.jsonl", client=client)

    assert result["ok"] is False
    assert [e["code"] for e in result["errors"]] == ["UNSUPPORTED_DTD"]


def test_stops_at_url_cap_and_warns(tmp_path):
    client = serve({f"{BASE}/plain.xml": (200, fixture_bytes("plain.xml"))})
    out = tmp_path / "capped.jsonl"

    result = discover_sitemap(f"{BASE}/plain.xml", out, url_cap=1, client=client)

    assert result["data"]["urlCount"] == 1
    assert len(read_jsonl(out)) == 1
    assert any("URL cap reached" in w for w in result["warnings"])


def test_sitemap_disallowed_by_robots_is_not_fetched(tmp_path):
    seen: list[httpx.Request] = []
    client = serve(
        {
            f"{BASE}/robots.txt": (200, fixture_bytes("robots-private.txt")),
            f"{BASE}/private/sitemap.xml": (200, fixture_bytes("plain.xml")),
        },
        seen,
    )

    result = discover_sitemap(f"{BASE}/private/sitemap.xml", tmp_path / "p.jsonl", client=client)

    assert result["ok"] is False
    assert [e["code"] for e in result["errors"]] == ["ROBOTS_DISALLOWED"]
    assert all(str(r.url) != f"{BASE}/private/sitemap.xml" for r in seen)


def test_unreadable_robots_txt_fails_closed(tmp_path):
    client = serve(
        {
            f"{BASE}/robots.txt": (503, b""),
            f"{BASE}/plain.xml": (200, fixture_bytes("plain.xml")),
        }
    )

    result = discover_sitemap(f"{BASE}/plain.xml", tmp_path / "r.jsonl", client=client)

    assert result["ok"] is False
    assert [e["code"] for e in result["errors"]] == ["ROBOTS_UNAVAILABLE"]


def test_sends_identifiable_user_agent(tmp_path, monkeypatch):
    monkeypatch.setenv("AWESOME_SEO_CONTACT_URL", "https://example.org/about-the-crawler")
    seen: list[httpx.Request] = []
    client = serve({f"{BASE}/plain.xml": (200, fixture_bytes("plain.xml"))}, seen)

    discover_sitemap(f"{BASE}/plain.xml", tmp_path / "ua.jsonl", client=client)

    agents = {r.headers["user-agent"] for r in seen}
    assert agents == {"awesome-seo-geo-aio-aeo/0.0.1 (+https://example.org/about-the-crawler)"}


def test_output_path_must_stay_inside_data_dir_and_end_with_jsonl(tmp_path, monkeypatch):
    monkeypatch.setenv("AWESOME_SEO_DATA_DIR", str(tmp_path))

    assert resolve_output_path("snapshots/run.jsonl") == (tmp_path / "snapshots" / "run.jsonl").resolve()
    with pytest.raises(ValueError):
        resolve_output_path("../escape.jsonl")
    with pytest.raises(ValueError):
        resolve_output_path("/etc/passwd.jsonl")
    with pytest.raises(ValueError):
        resolve_output_path("snapshots/run.json")
