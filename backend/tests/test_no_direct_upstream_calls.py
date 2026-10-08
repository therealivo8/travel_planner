"""Every paid upstream call must live in app/services so it can be budgeted at the API
layer (Phase 14). A direct `gmaps.` or `httpx.post` call anywhere else would bypass
the ledger."""

import re
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"
PATTERN = re.compile(r"\bgmaps\.|\bhttpx\.post\b")


def test_upstream_calls_only_in_services() -> None:
    offenders = []
    for path in APP.rglob("*.py"):
        if "services" in path.relative_to(APP).parts:
            continue
        for lineno, line in enumerate(path.read_text().splitlines(), 1):
            if PATTERN.search(line):
                offenders.append(f"{path.relative_to(APP)}:{lineno}: {line.strip()}")
    assert not offenders, "upstream calls outside app/services:\n" + "\n".join(offenders)
