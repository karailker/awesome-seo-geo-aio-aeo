from crawl_server import sitemap
from crawl_server.env import load_project_env


def test_project_env_sets_the_contact_url_used_in_the_user_agent(tmp_path, monkeypatch):
    # Given: a project .env that defines the contact URL and an unrelated secret
    env_file = tmp_path / ".env"
    env_file.write_text("# comment\nAWESOME_SEO_CONTACT_URL=https://example.com/crawler\nSHOPIFY_TOKEN=secret-value\n")
    monkeypatch.delenv("AWESOME_SEO_CONTACT_URL", raising=False)
    monkeypatch.delenv("SHOPIFY_TOKEN", raising=False)
    monkeypatch.setenv("AWESOME_SEO_ENV_FILE", str(env_file))

    # When
    loaded = load_project_env()

    # Then: only the allowed name is loaded, and the User-Agent carries it
    assert loaded == ["AWESOME_SEO_CONTACT_URL"]
    assert sitemap.user_agent().endswith("(+https://example.com/crawler)")
    import os

    assert "SHOPIFY_TOKEN" not in os.environ


def test_project_env_overrides_a_value_exported_in_the_shell(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text('AWESOME_SEO_CONTACT_URL="https://project.example/bot"\n')
    monkeypatch.setenv("AWESOME_SEO_CONTACT_URL", "https://other-site.example/bot")
    monkeypatch.setenv("AWESOME_SEO_ENV_FILE", str(env_file))

    load_project_env()

    assert sitemap.user_agent().endswith("(+https://project.example/bot)")


def test_missing_project_env_file_changes_nothing(tmp_path, monkeypatch):
    monkeypatch.setenv("AWESOME_SEO_CONTACT_URL", "https://shell.example/bot")
    monkeypatch.setenv("AWESOME_SEO_ENV_FILE", str(tmp_path / "missing.env"))

    assert load_project_env() == []
    assert sitemap.user_agent().endswith("(+https://shell.example/bot)")


def test_no_env_file_variable_changes_nothing(monkeypatch):
    monkeypatch.delenv("AWESOME_SEO_ENV_FILE", raising=False)

    assert load_project_env() == []
