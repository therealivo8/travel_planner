"""Regression tests for review fixes: non-ASCII download names and reset-link logging."""

import logging

import pytest
from starlette.responses import Response

from app.api.export import _attachment_header
from app.config import settings
from app.services import email


def test_attachment_header_ascii_title_has_no_extended_filename() -> None:
    assert _attachment_header("Road Trip 2026", "ics") == 'attachment; filename="Road Trip 2026.ics"'


@pytest.mark.parametrize("title", ["Tokyo 東京 trip", "Café ☕ run", "東京", "a" * 200])
def test_attachment_header_is_latin1_safe_for_any_title(title: str) -> None:
    header = _attachment_header(title, "gpx")
    # Starlette encodes header values as latin-1; this used to raise UnicodeEncodeError.
    Response(b"x", headers={"Content-Disposition": header})
    header.encode("latin-1")


def test_attachment_header_keeps_real_title_in_filename_star() -> None:
    header = _attachment_header("Tokyo 東京", "pdf")
    assert 'filename="Tokyo __.pdf"' in header
    assert "filename*=UTF-8''Tokyo%20%E6%9D%B1%E4%BA%AC.pdf" in header


def test_attachment_header_blank_title_falls_back() -> None:
    assert _attachment_header("   ", "pdf") == 'attachment; filename="trip.pdf"'


def test_reset_link_is_logged_outside_production(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(settings, "resend_api_key", "")
    monkeypatch.setattr(settings, "environment", "development")
    with caplog.at_level(logging.INFO):
        email.send_email("a@example.com", "Reset", "link: https://x/reset-password?token=SECRET")
    assert "token=SECRET" in caplog.text


def test_reset_link_is_never_logged_in_production(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(settings, "resend_api_key", "")
    monkeypatch.setattr(settings, "environment", "production")
    with caplog.at_level(logging.DEBUG):
        email.send_email("a@example.com", "Reset", "link: https://x/reset-password?token=SECRET")
    assert "SECRET" not in caplog.text
    assert "RESEND_API_KEY is not set" in caplog.text
