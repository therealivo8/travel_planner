"""Sentry error-tracking initialization.

Called once from `app.main` before the `FastAPI` app is constructed, so
Sentry's FastAPI/ASGI integration can instrument the app as it's built.
No-ops entirely when `settings.sentry_dsn` is empty (the default), so local
dev and CI never need a Sentry account or DSN — see `app.config.Settings`.
"""

import logging

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.logging import LoggingIntegration

from app.config import settings


def init_sentry() -> None:
    if not settings.sentry_dsn:
        return

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        integrations=[
            FastApiIntegration(),
            # Forward our own "security" logger's warning-level structured
            # events (app.core.security_log) to Sentry as breadcrumbs/events,
            # in addition to the explicit capture_message call login-failure
            # logging already makes — this catches any future security_log
            # event type without needing a matching capture_message call.
            LoggingIntegration(level=None, event_level=logging.WARNING),
        ],
        # This app is a low-traffic personal project — full trace sampling
        # would add cost/noise with no real performance-debugging benefit.
        # Error capture (the actual goal of this integration) is unaffected
        # by the trace sample rate; this only controls perf transaction volume.
        traces_sample_rate=0.1,
    )
