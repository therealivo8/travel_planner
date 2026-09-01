"""Structured logging for security-relevant events.

Every event goes through the stdlib `logging` module under a dedicated
"security" logger name (configured in `app.core.logging_config`), so these
events can be filtered independently of general application logs in
whatever log aggregator the deploy target uses (e.g. Railway's log view,
or any platform that can filter/alert on structured JSON fields).

Each event is a single log line carrying a fixed set of fields — `event`,
`ip`, `user_id`, `path` — via the stdlib `extra=` mechanism, so the JSON
formatter in production (see `logging_config.py`) can render each as a flat,
queryable object rather than a free-text message that has to be re-parsed.

Failed logins are additionally sent to Sentry as a `warning`-level message
(not an exception — this is a security *signal*, not an error) tagged with
the source IP. This is what the Sentry alert rule described in
`docs/security-alerting.md` watches: 20+ of these sharing an IP tag within
5 minutes fires a spike alert. If Sentry is not configured (no DSN set),
`capture_message` is a no-op, so this module works unchanged in local dev.
"""

import logging
import uuid

from fastapi import Request
from sentry_sdk import capture_message

security_logger = logging.getLogger("security")


def _client_ip(request: Request) -> str:
    # Mirrors slowapi's own address resolution (app.core.limiter) so the IP
    # logged here always matches the IP a rate limit would have keyed on.
    return request.client.host if request.client else "unknown"


def _log(event: str, request: Request, *, user_id: uuid.UUID | str | None = None) -> str:
    ip = _client_ip(request)
    security_logger.warning(
        event,
        extra={
            "event": event,
            "ip": ip,
            "user_id": str(user_id) if user_id else None,
            "path": request.url.path,
        },
    )
    return ip


def log_login_failed(request: Request, *, email: str) -> None:
    """A login attempt failed credential verification (unknown email or bad password).

    Deliberately does not log which of the two failed (unknown email vs.
    wrong password) — that distinction is exactly what a credential-stuffing
    attacker would use logs to infer if they were ever exposed. Does not log
    the password itself, and logs the attempted email only at `info` scope
    inside the message, never as a structured/indexed field, since email
    address is the identifier being brute-forced, not the security signal.
    """
    ip = _log("auth.login_failed", request)
    capture_message(
        f"Failed login attempt for {email}",
        level="warning",
        tags={"event": "auth.login_failed", "ip": ip},
    )


def log_unauthorized(request: Request) -> None:
    """A request was rejected with 401 (missing, invalid, or expired credentials)."""
    _log("auth.unauthorized", request)


def log_forbidden(request: Request, *, user_id: uuid.UUID) -> None:
    """A request was rejected with 403 (authenticated, but not permitted).

    Currently no route in this codebase raises a bare 403 — ownership
    mismatches return 404 instead, by design, to avoid confirming a
    resource's existence to a non-owner (see the Phase 10 PRD's
    authorization audit appendix). This hook exists so that if a future
    endpoint does need a real 403, it's covered by security logging from
    day one instead of that gap being found in a future audit.
    """
    _log("auth.forbidden", request, user_id=user_id)


def log_rate_limited(request: Request) -> None:
    """A request was rejected with 429 (rate limit exceeded)."""
    _log("rate_limit.exceeded", request)
