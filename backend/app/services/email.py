"""Transactional email via Resend. With no RESEND_API_KEY the message is logged instead,
so local development and tests need no account."""

import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"


def send_email(to: str, subject: str, text: str) -> None:
    if not settings.resend_api_key:
        logger.info("email.console", extra={"event": "email.console", "to": to, "subject": subject})
        if settings.environment == "production":
            # The body holds a live reset link. A production deploy that forgot the key must
            # not write it to logs anyone with log access could read — log the failure instead.
            logger.error("RESEND_API_KEY is not set; email to a user was not sent")
        else:
            # Printed in full so a developer can click the reset link.
            logger.warning("EMAIL to=%s subject=%s\n%s", to, subject, text)
        return
    try:
        resp = httpx.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={"from": settings.email_from, "to": [to], "subject": subject, "text": text},
            timeout=10,
        )
        resp.raise_for_status()
    except httpx.HTTPError:
        # Runs as a background task: nothing to tell the caller, and the endpoint must
        # answer identically whether or not sending worked.
        logger.exception("email send failed")


def password_reset_email(link: str) -> tuple[str, str]:
    return (
        "Reset your Road Trip Planner password",
        "Someone asked to reset the password for your Road Trip Planner account.\n\n"
        f"Choose a new password here (the link works once and expires in 1 hour):\n{link}\n\n"
        "If this wasn't you, you can ignore this email — your password hasn't changed.",
    )
