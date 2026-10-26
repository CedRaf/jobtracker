"""
LinkedIn junior developer scraper -> Google Sheet ("LinkedIn" tab) and/or Supabase.

Personal and educational use only. LinkedIn's User Agreement prohibits
scraping, whatever the purpose. This reads public, logged-out job listings at
low volume (twice a day, with delays between requests) for one person's job
search; nothing it collects is published or redistributed. It isn't offered
as a feature or a product, and the public demo leaves LinkedIn out.

Uses the same config.json searches and outputs, rules.py filters and secrets
as scraper.py (JobStreet); only the job source and the sheet tabs differ.

Usage:
    python LinkedIn_Scraper.py              # normal run
    python LinkedIn_Scraper.py --dry-run    # don't send anywhere; write CSVs to output/
    python LinkedIn_Scraper.py --dry-run --limit 10   # quick test: only evaluate 10 new jobs

Log: logs/linkedin.log
"""

import sys
from datetime import datetime, timedelta

import requests

import linkedin_api as api
import rules
import scraper
from scraper import MANILA, ROOT, filtered_record, log, pause, repost_key

SEEN_FILE = ROOT / "data" / "linkedin_seen_ids.json"
LOG_FILE = ROOT / "logs" / "linkedin.log"


def collect(session, cfg):
    """Run every search; returns {job_id: summary} with all search terms that found it."""
    searches = []
    for kw in cfg["keywords"]:
        searches.append((kw, kw, {"location": api.CEBU,
                                  "distance_kms": cfg["cebu_distance_kms"]}))
        if cfg["search_remote_outside_cebu"]:
            # Logged out, LinkedIn ignores its remote filter; the keyword nudges
            # results that way and evaluate_jobs() drops non-remote ones.
            searches.append((f"{kw} remote", f"{kw} [remote]", {"location": api.PHILIPPINES}))

    days = cfg.get("listed_within_days")
    # Safety net in case LinkedIn ever ignores the date filter (cards only have a date).
    oldest = (datetime.now(MANILA) - timedelta(days=days)).date().isoformat() if days else None
    # Same number of results per search as JobStreet (its pages are 30, LinkedIn's 10).
    max_pages = -(-cfg["max_pages_per_search"] * scraper.PAGE_SIZE // api.PAGE_SIZE)

    jobs, failures, too_old = {}, 0, 0
    for keyword, label, opts in searches:
        found = 0
        for page in range(1, max_pages + 1):
            try:
                results = api.search(session, keyword, page, sort=cfg["sort"],
                                     listed_within_days=days, **opts)
            except (api.LinkedInError, requests.RequestException) as e:
                log.warning("Search '%s' page %d failed: %s", label, page, e)
                failures += 1
                break
            for card in results:
                if oldest and card["posted"] and card["posted"] < oldest:
                    too_old += 1
                    continue
                entry = jobs.setdefault(card["id"], {
                    **card,
                    "work_arrangements": [],
                    "work_type": "",
                    "url": f"https://www.linkedin.com/jobs/view/{card['id']}",
                    "search_terms": [],
                })
                if label not in entry["search_terms"]:
                    entry["search_terms"].append(label)
            found += len(results)
            pause(cfg)
            if len(results) < api.PAGE_SIZE:
                break
        log.info("Search '%s': %d results", label, found)

    if too_old:
        log.info("Skipped %d results listed more than %d days ago", too_old, days)
    if searches and failures >= len(searches):
        raise RuntimeError("Every search failed; LinkedIn may be blocking requests or changed its pages.")
    return jobs


def evaluate_jobs(session, cfg, candidates, seen):
    """
    Returns (kept_records, filtered_records, expired_ids). Jobs whose details
    couldn't be fetched are left out of all three so the next run retries them.
    """
    kept, filtered, expired = [], [], []
    failures_in_a_row = 0
    posted_keys = {k for k in seen if k.startswith("tc:")}
    min_score = cfg.get("min_match_score", 0)
    for n, job in enumerate(candidates, 1):
        key = repost_key(job)
        if key in posted_keys:
            filtered.append(filtered_record(job, "duplicate posting (same title & company)"))
            continue
        reason = rules.title_drop_reason(job)
        if reason:
            filtered.append(filtered_record(job, reason))
            continue

        try:
            details = api.job_details(session, job["id"])
            failures_in_a_row = 0
        except (api.LinkedInError, requests.RequestException) as e:
            log.warning("Details for %s failed: %s", job["id"], e)
            details = None
            failures_in_a_row += 1
        pause(cfg)
        if details is None:
            if failures_in_a_row >= 3:
                log.warning("Stopping early; %d jobs left for the next run", len(candidates) - n)
                break
            continue

        if details["isExpired"]:
            expired.append(job["id"])
            continue

        raw_html = details["description_html"]
        criteria = details["criteria"]
        job["work_type"] = criteria.get("Employment type", "")
        description = rules.html_to_text(raw_html)
        job["work_arrangements"] = rules.guess_work_arrangements(
            f"{job['title']}\n{job['location']}\n{description}")
        reason = rules.location_drop_reason(job)
        if not reason:
            reason, extra = rules.evaluate(job, description)
        if not reason and extra["match_score"] < min_score:
            reason = f"low skill match (score {extra['match_score']})"
        if reason:
            filtered.append(filtered_record(job, reason))
            continue

        emails = rules.extract_emails(description, raw_html)
        form_link = rules.extract_form_link(description, raw_html)
        if details["isLinkOut"]:
            apply_type = "External site"
        else:
            apply_type = "LinkedIn"
        if form_link:
            apply_type += " + form in description"

        posted_keys.add(key)
        kept.append({
            "repost_key": key,
            "id": job["id"],
            "search_term": ", ".join(job["search_terms"]),
            "title": job["title"],
            "company": job["company"],
            "location": job["location"],
            "work_arrangement": ", ".join(job["work_arrangements"]),
            "work_type": job["work_type"],
            "salary_text": job["salary_text"],
            "posted": job["posted"],
            "apply_type": apply_type,
            "apply_link": form_link,
            **extra,
            "email": ", ".join(emails),
            "email_source": "description" if emails else "",
            "url": job["url"],
            "seniority": criteria.get("Seniority level", ""),
            "description": description,
        })
        if n % 20 == 0:
            log.info("Evaluated %d/%d new jobs", n, len(candidates))

    kept.sort(key=lambda r: r["match_score"], reverse=True)
    return kept, filtered, expired


def run(args):
    scraper.scrape(args, "linkedin", api, collect, evaluate_jobs, SEEN_FILE, prefix="linkedin_")


if __name__ == "__main__":
    sys.exit(scraper.main(run, LOG_FILE, __doc__))
