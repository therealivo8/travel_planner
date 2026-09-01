"""Root logging configuration, called once from `app.main` at import time.

Two output formats, chosen by `settings.environment`:

- **production**: one-line JSON per log record, so a log aggregator (Railway's
  log view, or anything downstream of it) can filter/query on structured
  fields like `event`, `ip`, or `user_id` without parsing free text. This is
  what `app.core.security_log` relies on for its `extra=` fields to be
  queryable rather than just appended to the message string.
- **development / anything else**: plain human-readable lines, since nobody
  is running a JSON log aggregator against their own laptop.

This mirrors the existing dev/prod branching pattern already used in
`app.config.Settings` for the production secret-key guard and in
`app.api.auth` for the refresh-cookie `secure`/`samesite` attributes — one
more place where "production" and "everything else" get deliberately
different behavior instead of a single compromise setting.
"""

import json
import logging
from datetime import UTC, datetime
from typing import Any

from app.config import settings

# Fields every structured security-event log line carries (see
# app.core.security_log). Pulled out via record.__dict__ rather than a fixed
# attrgetter list so any future field added to a `_log(..., extra={...})`
# call is picked up automatically without editing this formatter.
_RESERVED_LOG_RECORD_FIELDS = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {
    "message",
    "asctime",
}


class _JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        # Merge in any extra=... fields the caller attached (event, ip,
        # user_id, path, etc.) without hardcoding their names here.
        for key, value in record.__dict__.items():
            if key not in _RESERVED_LOG_RECORD_FIELDS:
                payload[key] = value
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging() -> None:
    root = logging.getLogger()
    # Idempotent: FastAPI's --reload / test fixtures can trigger app import
    # more than once per process; avoid stacking duplicate handlers.
    if root.handlers:
        return

    handler = logging.StreamHandler()
    if settings.environment == "production":
        handler.setFormatter(_JSONFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)-8s %(name)s: %(message)s")
        )

    root.addHandler(handler)
    root.setLevel(logging.INFO)
