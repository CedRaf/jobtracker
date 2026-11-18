"""
Emails you when a site blocked a scraper run (LinkedIn rate-limiting before
any search returned jobs). The scraper workflow runs this only when the
LinkedIn step set its `blocked` output (scraper.report_blocked).

    python notify_blocked.py

Sends from your Gmail to the same address, over Gmail's SMTP server, using
the standard library only. Reads from the environment:
  GMAIL_ADDRESS, GMAIL_APP_PASSWORD  repository secrets (an app password from
                                     myaccount.google.com/apppasswords)
  BLOCKED                            the reason the scraper gave
  RUN_URL                            link to the GitHub run
Without the Gmail secrets it logs a warning and sends nothing. It never fails
the workflow: a missed email isn't worth a failed run (and its own email).
"""

import logging
import os
import smtplib
import sys
from datetime import datetime
from email.message import EmailMessage
from zoneinfo import ZoneInfo

log = logging.getLogger("notify")

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465  # SSL
MANILA = ZoneInfo("Asia/Manila")


def build_message(address, reason, run_url, now=None):
    when = (now or datetime.now(MANILA)).strftime("%Y-%m-%d %H:%M")
    msg = EmailMessage()
    msg["From"] = address
    msg["To"] = address
    msg["Subject"] = f"LinkedIn rate-limited the scraper ({when} Manila)"
    msg.set_content(
        "LinkedIn rate-limited the scraper before any search returned jobs, so this run "
        "found no LinkedIn jobs.\n\n"
        f"When: {when} (Manila)\n"
        f"Reason: {reason or 'not given'}\n"
        f"Run: {run_url or 'not available'}\n\n"
        "JobStreet and Himalayas were not affected. The next scheduled run tries LinkedIn "
        "again. The dashboard's run history shows this LinkedIn run as failed.\n"
    )
    return msg


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    address = os.environ.get("GMAIL_ADDRESS", "").strip()
    password = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
    if not address or not password:
        log.warning("GMAIL_ADDRESS or GMAIL_APP_PASSWORD isn't set; no rate-limit email sent.")
        return 0
    msg = build_message(address, os.environ.get("BLOCKED", ""), os.environ.get("RUN_URL", ""))
    try:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=30) as smtp:
            smtp.login(address, password)
            smtp.send_message(msg)
    except (smtplib.SMTPException, OSError) as e:
        log.warning("Couldn't send the rate-limit email: %s", e)
        return 0
    log.info("Rate-limit email sent to %s", address)
    return 0


if __name__ == "__main__":
    sys.exit(main())
