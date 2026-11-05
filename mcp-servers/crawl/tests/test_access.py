import httpx
import pytest

from crawl_server import sitemap
from crawl_server.access import AI_USER_AGENTS, check_access


@pytest.fixture(autouse=True)
def no_wait(monkeypatch):
    monkeypatch.setattr(sitemap, "MIN_INTERVAL_SECONDS", 0.0)


def _agents(result):
    return {a["user_agent"]: a for a in result["data"]["agents"]}


def test_reports_per_agent_rules_against_sample_urls(local_site):
    samples = [local_site.url("/index.html"), local_site.url("/private/secret.html")]

    with httpx.Client() as client:
        result = check_access(local_site.base, samples, client)

    agents = _agents(result)
    assert set(agents) == set(AI_USER_AGENTS)
    # robots.txt: GPTBot is disallowed everywhere; other agents only under /private/.
    assert agents["GPTBot"]["allowed"] == 0 and agents["GPTBot"]["blocked"] == 2
    assert agents["ClaudeBot"]["allowed"] == 1
    assert agents["ClaudeBot"]["blocked_urls"] == [local_site.url("/private/secret.html")]
    assert result["data"]["robots"] == "readable"
    assert result["data"]["sampleSize"] == 2


def test_valid_llms_txt_is_reported_present_and_valid(local_site):
    with httpx.Client() as client:
        result = check_access(local_site.base, [local_site.url("/index.html")], client)

    assert result["data"]["llmsTxt"] == {"present": True, "valid": True, "status": 200, "note": None}


def test_unreadable_robots_txt_gives_unknown_not_allowed(local_site):
    local_site.robots_status = 503

    with httpx.Client() as client:
        result = check_access(local_site.base, [local_site.url("/index.html")], client)

    assert result["data"]["robots"] == "unavailable"
    assert all(a["allowed"] is None and a["blocked"] is None for a in result["data"]["agents"])
    assert result["warnings"] and "unknown" in result["warnings"][0]
