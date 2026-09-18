"""Structured logging for upstream API quota and rate-limit events.

Separate from `app.core.security_log` on purpose: that module logs
request-scoped *security* signals (who, from what IP, on what path) and its
helpers all take a `Request`. Upstream quota exhaustion is neither — it happens
in the service layer, which has no request in scope, and it's an operational
event, not a security one.

Events go through a dedicated "upstream" logger so they can be filtered
independently of both application and security logs, and carry `provider`,
`event`, and (when the provider reports them) quota counters as structured
fields via `extra=`.

Quota exhaustion is also sent to Sentry as a `warning` — it's an operational
signal, not an exception. Without this, a provider cutting you off surfaces
only as a generic upstream failure, which is slow to trace: ORS in particular
returns **403 for daily quota exhaustion**, the same status as a bad key, so
the two are indistinguishable without the rate-limit headers this module reads.
`capture_message` is a no-op when no Sentry DSN is set, so local dev is
unaffected.
"""

import logging

import httpx
from sentry_sdk import capture_message

upstream_logger = logging.getLogger("upstream")

# ORS documents 403 for daily quota exhaustion and 429 for the per-minute rate
# limit. 403 is ambiguous on its own (a revoked or malformed key returns it
# too), so quota is only inferred from it when the rate-limit headers agree.
_QUOTA_STATUSES = frozenset({403, 429})


def _quota_headers(response: httpx.Response) -> dict[str, int]:
    fields = {}
    for header, key in (
        ("x-ratelimit-remaining", "quota_remaining"),
        ("x-ratelimit-limit", "quota_limit"),
        ("x-ratelimit-reset", "quota_reset"),
    ):
        raw = response.headers.get(header)
        if raw is not None:
            try:
                fields[key] = int(raw)
            except ValueError:
                # Provider changed the format; the response is still usable, so
                # don't fail the request over an unparseable telemetry header.
                pass
    return fields


def log_quota_state(provider: str, response: httpx.Response) -> None:
    """Record remaining quota from a successful upstream call.

    Logged at INFO on every call so exhaustion is visible as a downward trend
    in logs before it becomes an outage, rather than only at the moment it
    breaks.
    """
    fields = _quota_headers(response)
    if not fields:
        return

    upstream_logger.info(
        "upstream.quota_state",
        extra={"event": "upstream.quota_state", "provider": provider, **fields},
    )


def is_quota_error(response: httpx.Response) -> bool:
    """Whether a failed response looks like quota/rate-limit exhaustion.

    429 is unambiguous. 403 is only treated as quota when the provider's own
    rate-limit header confirms nothing is left — otherwise it's far more likely
    to be an auth failure.
    """
    if response.status_code == 429:
        return True
    if response.status_code != 403:
        return False
    remaining = _quota_headers(response).get("quota_remaining")
    return remaining is not None and remaining <= 0


def log_quota_exceeded(provider: str, response: httpx.Response) -> None:
    """Record a confirmed quota/rate-limit rejection, and signal it to Sentry."""
    fields = _quota_headers(response)
    upstream_logger.warning(
        "upstream.quota_exceeded",
        extra={
            "event": "upstream.quota_exceeded",
            "provider": provider,
            "status_code": response.status_code,
            **fields,
        },
    )
    capture_message(
        f"{provider} quota exceeded (HTTP {response.status_code})",
        level="warning",
    )
