"""Loads the project's .env for the crawler process.

The plugin sets AWESOME_SEO_ENV_FILE to the project's .env. The crawler reads only the names it uses, and the
project file wins over the shell, so one site's contact URL never leaks into another project. Values are never
printed. A missing file changes nothing.
"""

from __future__ import annotations

import os
import re

ENV_FILE_VAR = "AWESOME_SEO_ENV_FILE"
ALLOWED_NAMES = ("AWESOME_SEO_CONTACT_URL", "CHROME_PATH")
_LINE = re.compile(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")


def load_project_env(environ: dict[str, str] | None = None) -> list[str]:
    """Set the allowed names from the project .env. Returns the names that were set."""
    env = os.environ if environ is None else environ
    path = env.get(ENV_FILE_VAR)
    if not path:
        return []
    try:
        with open(path, encoding="utf-8") as handle:
            lines = handle.read().splitlines()
    except OSError:
        return []
    loaded: list[str] = []
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = _LINE.match(line)
        if not match or match.group(1) not in ALLOWED_NAMES:
            continue
        value = match.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if value:
            env[match.group(1)] = value
            loaded.append(match.group(1))
    return loaded
