from pathlib import Path

from crawl_server.extract import extract_page

FIXTURES = Path(__file__).parent / "fixtures" / "site"
BASE = "https://example.com"


def _html(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_extracts_on_page_fields_with_relative_links_resolved():
    fields = extract_page(_html("index.html"), f"{BASE}/index.html")

    assert fields["title"] == "Home page"
    assert fields["meta_description"] == "Home page description"
    assert fields["canonical"] == f"{BASE}/"
    assert fields["lang"] == "en"
    assert fields["hreflang"] == [{"lang": "tr", "href": f"{BASE}/tr/"}]
    assert fields["headings"] == [{"level": 1, "text": "Welcome"}, {"level": 2, "text": "About us"}]


def test_script_text_is_not_counted_as_content():
    fields = extract_page(_html("index.html"), f"{BASE}/index.html")

    # "Welcome" + "Some visible text for the home page." + "About us" = 10 words, script excluded.
    assert fields["word_count"] == 10


def test_content_hash_ignores_script_changes_but_not_visible_text_changes():
    base = _html("index.html")
    with_other_script = base.replace('var hidden = "not content";', 'var other = 42;')
    changed_text = base.replace("Some visible text", "Different visible text")

    h = lambda html: extract_page(html, f"{BASE}/x")["content_hash"]  # noqa: E731
    assert h(base) == h(with_other_script)
    assert h(base) != h(changed_text)


def test_json_ld_and_microdata_are_extracted():
    jsonld = extract_page(_html("jsonld.html"), f"{BASE}/jsonld.html")["structured_data"]
    micro = extract_page(_html("microdata.html"), f"{BASE}/microdata.html")["structured_data"]

    assert [(d["syntax"], d["type"]) for d in jsonld] == [("json-ld", "Article")]
    assert jsonld[0]["item"]["headline"] == "Structured headline"
    assert [(d["syntax"], d["type"]) for d in micro] == [("microdata", "Product")]


def test_missing_canonical_is_none():
    fields = extract_page(_html("no-canonical.html"), f"{BASE}/no-canonical.html")

    assert fields["canonical"] is None
    assert fields["title"] == "Same title"


def test_counts_invalid_json_ld_blocks_separately_from_valid_ones():
    html = (
        '<html><head><script type="application/ld+json">{"@type": "Article"}</script>'
        '<script type="application/ld+json">{"@type": "Article",}</script></head><body></body></html>'
    )

    fields = extract_page(html, f"{BASE}/bad")

    # Strict JSON check counts the trailing-comma block. extruct parses it leniently, so it still appears.
    assert fields["jsonld_syntax_errors"] == 1
