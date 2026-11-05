from crawl_server.server import capabilities_payload, health_payload


def test_health_reports_ok_without_secrets():
    payload = health_payload({"SOME_TOKEN": "secret-value"})
    assert payload["ok"] is True
    assert payload["server"] == "crawl"
    assert "secret-value" not in str(payload)


def test_capabilities_lists_all_read_only_tools():
    payload = capabilities_payload()
    names = [tool["name"] for tool in payload["tools"]]
    assert names == ["crawl_health", "crawl_capabilities", "crawl_discover_sitemap"]
    assert all(tool["access"] == "read" for tool in payload["tools"])
