"""
The scraper workflow's last step: closes this GitHub run's scrape_runs rows.

Runs whatever happened before it (`if: always()`). It replays run-log writes a
scraper couldn't send (data/pending_runs.json), then marks this run's rows
still "running" as "interrupted": their step was cancelled or timed out before
the scraper could record how it ended.

    python close_runs.py

Uses GITHUB_RUN_ID and the same Supabase credentials as the scrapers; without
either it does nothing.
"""

import logging
import os
import sys

import sinks
from scraper import load_secrets

log = logging.getLogger("scraper")


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    github_run_id = os.environ.get("GITHUB_RUN_ID")
    client = sinks.supabase_client(load_secrets())
    if not github_run_id or not client:
        log.info("No GitHub run or Supabase credentials; nothing to close.")
        return 0
    try:
        interrupted = sinks.close_unfinished_runs(client, github_run_id)
    except Exception:
        log.exception("Couldn't close this run's scrape_runs rows")
        return 1
    log.info("Marked %d unfinished run(s) as interrupted.", interrupted)
    return 0


if __name__ == "__main__":
    sys.exit(main())
