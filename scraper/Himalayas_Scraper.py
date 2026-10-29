"""
Himalayas junior developer scraper -> Supabase.

Himalayas (himalayas.app) is a remote-only job board with a public JSON API.
Uses the same searches, rules.py filters and secrets as scraper.py (JobStreet).
Writes to Supabase only (config.json "himalayas" -> "outputs"); the Sheet has
no Himalayas tabs.

Search results already include each job's description and its allowed
countries and timezones, so there are no per-job requests: a job is dropped
if it isn't open to the Philippines or to UTC+8.

Usage:
    python Himalayas_Scraper.py              # normal run
    python Himalayas_Scraper.py --dry-run    # don't send anywhere; write CSVs to output/
    python Himalayas_Scraper.py --dry-run --limit 10   # quick test: only evaluate 10 new jobs

Log: logs/himalayas.log
"""

import random
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

import himalayas_api as api
import rules
import scraper
from scraper import MANILA, ROOT, filtered_record, log, repost_key

SEEN_FILE = ROOT / "data" / "himalayas_seen_ids.json"
LOG_FILE = ROOT / "logs" / "himalayas.log"

COUNTRY = ("PH", "Philippines")
UTC_OFFSET = 8
GUID_PREFIX = "https://himalayas.app/companies/"

# config.json "himalayas" overrides these.
HIMALAYAS_DEFAULTS = {"delay_seconds": 1}


def himalayas_settings(cfg):
    return {**HIMALAYAS_DEFAULTS, **cfg.get("himalayas", {})}


def pause(cfg):
    time.sleep(himalayas_settings(cfg)["delay_seconds"] + random.uniform(0, 0.5))


def from_unix(seconds):
    try:
        return datetime.fromtimestamp(int(seconds), timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def location_text(countries):
    if not countries:
        return "Remote (Worldwide)"
    if COUNTRY[1] in countries:
        return f"Remote ({COUNTRY[1]})"
    return f"Remote ({', '.join(countries)})"


def salary_text(raw):
    low, high = raw.get("minSalary"), raw.get("maxSalary")
    if not low and not high:
        return ""
    amount = (f"{low:,.0f}–{high:,.0f}" if low and high and low != high
              else f"{(low or high):,.0f}" + ("+" if low and not high else ""))
    currency = raw.get("currency") or ""
    period = raw.get("salaryPeriod") or ""
    return " ".join(filter(None, [currency, amount])) + (f" / {period}" if period else "")


def summarize(raw):
    """The fields we use from a search result, or None if it has no guid to key it by."""
    guid = raw.get("guid") or ""
    if not guid:
        return None
    published = from_unix(raw.get("pubDate"))
    countries = raw.get("locationRestrictions") or []
    return {
        "id": guid.removeprefix(GUID_PREFIX),
        "title": raw.get("title") or "",
        "company": raw.get("companyName") or "",
        "location": location_text(countries),
        "work_arrangements": ["Remote"],
        "work_type": raw.get("employmentType") or "",
        "salary_text": salary_text(raw),
        "posted": published.astimezone(MANILA).strftime("%Y-%m-%d %H:%M") if published else "",
        "listed_at": published,
        "expires_at": from_unix(raw.get("expiryDate")),
        "countries": countries,
        "timezones": raw.get("timezoneRestrictions") or [],
        "seniority": ", ".join(raw.get("seniority") or []),
        "description_html": raw.get("description") or "",
        "url": guid,
        "search_terms": [],
    }


def eligibility_drop_reason(job):
    """Remote, but only for some countries or timezones: is the Philippines (UTC+8) in?"""
    countries, zones = job["countries"], job["timezones"]
    if countries and COUNTRY[1] not in countries:
        shown = ", ".join(countries[:3]) + (", …" if len(countries) > 3 else "")
        return f"not open to the Philippines ({shown} only)"
    if zones and not any(float(z) == UTC_OFFSET for z in zones):
        return "not open to UTC+8 (timezone restriction)"
    return None


def collect(session, cfg):
    """Run every search; returns {job_id: summary} with all search terms that found it."""
    days = cfg.get("listed_within_days")
    # The search API has no date filter, so this is the only one.
    oldest = datetime.now(timezone.utc) - timedelta(days=days) if days else None

    jobs, failures, too_old, stopped = {}, 0, 0, None
    keywords = cfg["keywords"]
    for keyword in keywords:
        if stopped:
            break
        found = 0
        for page in range(1, cfg["max_pages_per_search"] + 1):
            try:
                results, total = api.search(session, keyword, page, country=COUNTRY[0])
            except api.RateLimited:
                stopped = "Himalayas is rate-limiting requests"
                break
            except (api.HimalayasError, requests.RequestException, ValueError) as e:
                log.warning("Search '%s' page %d failed: %s", keyword, page, e)
                failures += 1
                break
            for raw in results:
                job = summarize(raw)
                if job is None:
                    continue
                if oldest and job["listed_at"] and job["listed_at"] < oldest:
                    too_old += 1
                    continue
                entry = jobs.setdefault(job["id"], job)
                if keyword not in entry["search_terms"]:
                    entry["search_terms"].append(keyword)
            found += len(results)
            pause(cfg)
            if not results or page * api.PAGE_SIZE >= total:
                break
        log.info("Search '%s': %d results", keyword, found)

    if stopped:
        log.warning("Stopped searching early: %s (%d jobs found so far)", stopped, len(jobs))
        if not jobs:
            raise RuntimeError(f"No Himalayas results this run: {stopped} before any search returned jobs.")
    if too_old:
        log.info("Skipped %d results listed more than %d days ago", too_old, days)
    if keywords and failures >= len(keywords):
        raise RuntimeError("Every search failed; Himalayas may be down or changed its API.")
    return jobs


def evaluate_jobs(session, cfg, candidates, seen):
    """Returns (kept_records, filtered_records, expired_ids). No requests: search results are complete."""
    kept, filtered, expired = [], [], []
    posted_keys = {k for k in seen if k.startswith("tc:")}
    min_score = cfg.get("min_match_score", 0)
    now = datetime.now(timezone.utc)
    for n, job in enumerate(candidates, 1):
        if job["expires_at"] and job["expires_at"] < now:
            expired.append(job["id"])
            continue
        key = repost_key(job)
        if key in posted_keys:
            filtered.append(filtered_record(job, "duplicate posting (same title & company)"))
            continue
        reason = rules.title_drop_reason(job) or eligibility_drop_reason(job)
        if reason:
            filtered.append(filtered_record(job, reason))
            continue

        raw_html = job["description_html"]
        description = rules.html_to_text(raw_html)
        reason, extra = rules.evaluate(job, description)
        if not reason and extra["match_score"] < min_score:
            reason = f"low skill match (score {extra['match_score']})"
        if reason:
            filtered.append(filtered_record(job, reason))
            continue

        emails = rules.extract_emails(description, raw_html)
        form_link = rules.extract_form_link(description, raw_html)
        apply_type = "Himalayas" + (" + form in description" if form_link else "")

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
            "seniority": job["seniority"],
            "description": description,
        })
        if n % 20 == 0:
            log.info("Evaluated %d/%d new jobs", n, len(candidates))

    kept.sort(key=lambda r: r["match_score"], reverse=True)
    return kept, filtered, expired


def run(args):
    scraper.scrape(args, "himalayas", api, collect, evaluate_jobs, SEEN_FILE, prefix="himalayas_")


if __name__ == "__main__":
    sys.exit(scraper.main(run, LOG_FILE, __doc__))
