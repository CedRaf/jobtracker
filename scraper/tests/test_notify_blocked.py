import smtplib
from datetime import datetime

import pytest

import notify_blocked as notify


class FakeSMTP:
    """Records what would be sent instead of talking to Gmail."""
    sent = []
    fail = None

    def __init__(self, host, port, timeout):
        assert (host, port) == ("smtp.gmail.com", 465)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def login(self, user, password):
        if FakeSMTP.fail:
            raise FakeSMTP.fail
        self.user = user

    def send_message(self, msg):
        FakeSMTP.sent.append(msg)


@pytest.fixture
def smtp(monkeypatch):
    FakeSMTP.sent, FakeSMTP.fail = [], None
    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSMTP)
    monkeypatch.setenv("BLOCKED", "No LinkedIn results this run: LinkedIn is rate-limiting requests")
    monkeypatch.setenv("RUN_URL", "https://github.com/me/jobtracker/actions/runs/1")
    return FakeSMTP


def test_message_names_the_time_reason_and_run():
    msg = notify.build_message("me@gmail.com", "rate-limited", "https://run",
                               now=datetime(2026, 11, 18, 11, 0, tzinfo=notify.MANILA))
    assert msg["To"] == msg["From"] == "me@gmail.com"
    assert msg["Subject"] == "LinkedIn rate-limited the scraper (2026-11-18 11:00 Manila)"
    body = msg.get_content()
    assert "Reason: rate-limited" in body and "Run: https://run" in body


def test_sends_to_your_own_address(monkeypatch, smtp):
    monkeypatch.setenv("GMAIL_ADDRESS", "me@gmail.com")
    monkeypatch.setenv("GMAIL_APP_PASSWORD", "app-password")
    assert notify.main() == 0
    assert [m["To"] for m in smtp.sent] == ["me@gmail.com"]
    assert "rate-limiting requests" in smtp.sent[0].get_content()


@pytest.mark.parametrize("address, password", [("", "x"), ("me@gmail.com", ""), ("", "")])
def test_without_the_secrets_nothing_is_sent_and_the_step_passes(monkeypatch, smtp, address, password):
    monkeypatch.setenv("GMAIL_ADDRESS", address)
    monkeypatch.setenv("GMAIL_APP_PASSWORD", password)
    assert notify.main() == 0
    assert smtp.sent == []


def test_a_gmail_error_never_fails_the_step(monkeypatch, smtp):
    monkeypatch.setenv("GMAIL_ADDRESS", "me@gmail.com")
    monkeypatch.setenv("GMAIL_APP_PASSWORD", "wrong")
    smtp.fail = smtplib.SMTPAuthenticationError(535, b"Username and Password not accepted")
    assert notify.main() == 0
    assert smtp.sent == []
