"""
JobStreet PH junior developer scraper -> Google Sheet and/or Supabase.

Usage:
    python scraper.py              # normal run
    python scraper.py --dry-run    # don't send anywhere; write CSVs to output/
    python scraper.py --dry-run --limit 10   # quick test: only evaluate 10 new jobs

Settings:
- Search terms and filter rules: edited in the dashboard (Settings page) and
  loaded from Supabase each run; defaults in default_settings.json (settings.py).
- config.json: operational settings, and "outputs" (where jobs go).
- secrets.json or environment variables (GitHub Actions): SHEET_WEBAPP_URL /
  SHEET_TOKEN for the sheet, SUPABASE_URL / SUPABASE_SECRET_KEY for Supabase.
Log: logs/scraper.log
"""

import argparse
import csv
import json
import logging
import os
import random
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

import requests

import jobstreet_api as api
import rules
import settings as settings_module
import sinks

ROOT = Path(__file__).resolve().parent
CONFIG_FILE = ROOT / "config.json"
SECRETS_FILE = ROOT / "secrets.json"
SEEN_FILE = ROOT / "data" / "seen_ids.json"
LOG_FILE = ROOT / "logs" / "scraper.log"
OUTPUT_DIR = ROOT / "output"

MANILA = timezone(timedelta(hours=8))
PAGE_SIZE = 30

log = logging.getLogger("scraper")


def setup_logging(log_file=LOG_FILE):
    log_file.parent.mkdir(exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S")
    handlers = [RotatingFileHandler(log_file, maxBytes=1_000_000, backupCount=3, encoding="utf-8")]
    if sys.stdout is not None:  # pythonw.exe (scheduled runs) has no console
        handlers.append(logging.StreamHandler(sys.stdout))
    for h in handlers:
        h.setFormatter(fmt)
        log.addHandler(h)
    log.setLevel(logging.INFO)


def load_json(path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def load_secrets():
    secrets = load_json(SECRETS_FILE, {})
    # GitHub Actions passes these as environment variables instead of secrets.json.
    secrets["webapp_url"] = os.environ.get("SHEET_WEBAPP_URL") or secrets.get("webapp_url")
    secrets["token"] = os.environ.get("SHEET_TOKEN") or secrets.get("token")
    secrets["supabase_url"] = os.environ.get("SUPABASE_URL") or secrets.get("supabase_url")
    secrets["supabase_secret_key"] = (os.environ.get("SUPABASE_SECRET_KEY")
                                      or secrets.get("supabase_secret_key"))
    return secrets


def pause(cfg):
    time.sleep(cfg["delay_seconds"] + random.uniform(0, 1))


def parse_utc(utc_string):
    try:
        return datetime.fromisoformat(utc_string.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None


def to_manila(utc_string):
    dt = parse_utc(utc_string)
    if dt is None:
        return utc_string or ""
    return dt.astimezone(MANILA).strftime("%Y-%m-%d %H:%M")


def summarize(job):
    """The fields we use from a search result."""
    cjs = job.get("cjs") or {}
    salary = cjs.get("salary") or {}
    return {
        "id": str(job.get("id")),
        "title": job.get("title") or "",
        "company": (job.get("advertiser") or {}).get("name") or "",
        "location": ((job.get("location") or {}).get("displayName") or {}).get("text") or "",
        "work_arrangements": [
            (w.get("label") or {}).get("text", "") for w in job.get("workArrangements") or []
        ],
        "work_type": ", ".join(w.get("name", "") for w in cjs.get("workTypes") or []),
        "salary_text": "" if salary.get("hideSalary") else (salary.get("displayValue") or ""),
        "posted": to_manila((job.get("listedAt") or {}).get("dateTimeUtc")),
        "listed_at": parse_utc((job.get("listedAt") or {}).get("dateTimeUtc")),
        "url": f"https://ph.jobstreet.com/job/{job.get('id')}",
        "search_terms": [],
    }


def collect(session, cfg):
    """Run every search; returns {job_id: summary} with all search terms that found it."""
    searches = []
    for kw in cfg["keywords"]:
        searches.append((kw, kw, {"location": cfg["cebu_location"],
                                  "distance_kms": cfg["cebu_distance_kms"]}))
        if cfg["search_remote_outside_cebu"]:
            searches.append((kw, f"{kw} [remote]", {"remote_only": True}))

    days = cfg.get("listed_within_days")
    # Safety net in case JobStreet ever ignores the date filter.
    oldest = datetime.now(timezone.utc) - timedelta(days=days) if days else None

    jobs, failures, too_old = {}, 0, 0
    for keyword, label, opts in searches:
        token, found = None, 0
        for page in range(1, cfg["max_pages_per_search"] + 1):
            try:
                results, total, token = api.search(
                    session, keyword, page, sort=cfg["sort"], listed_within_days=days,
                    search_token=token, **opts)
            except (api.JobStreetError, requests.RequestException, ValueError) as e:
                log.warning("Search '%s' page %d failed: %s", label, page, e)
                failures += 1
                break
            for raw in results:
                job = summarize(raw)
                if oldest and job["listed_at"] and job["listed_at"] < oldest:
                    too_old += 1
                    continue
                entry = jobs.setdefault(job["id"], job)
                if label not in entry["search_terms"]:
                    entry["search_terms"].append(label)
            found += len(results)
            pause(cfg)
            if not results or page * PAGE_SIZE >= total:
                break
        log.info("Search '%s': %d results", label, found)

    if too_old:
        log.info("Skipped %d results listed more than %d days ago", too_old, days)
    if searches and failures >= len(searches):
        raise RuntimeError("Every search failed; JobStreet may be blocking requests or changed its API.")
    return jobs


def filtered_record(job, reason):
    return {
        "id": job["id"],
        "search_term": ", ".join(job["search_terms"]),
        "title": job["title"],
        "company": job["company"],
        "location": job["location"],
        "work_arrangement": ", ".join(job["work_arrangements"]),
        "reason": reason,
        "url": job["url"],
    }


def repost_key(job):
    """Same title + company = same job reposted under another location/ID."""
    return "tc:" + re.sub(r"\W+", " ", f"{job['title']}|{job['company']}".lower()).strip()


# ---- the same job on another site --------------------------------------------
#
# Each site formats titles and company names its own way, so the cross-site
# key strips what only says *how* a job is posted. It's deliberately cautious:
# a missed duplicate costs a few seconds of review, a wrong match hides a real
# job. Only title parts made entirely of these words (or of reference codes)
# are dropped; "Developer (RPA)" and "Developer (QA)" stay different.

SOURCE_LABELS = {"jobstreet": "JobStreet", "linkedin": "LinkedIn", "himalayas": "Himalayas"}

TITLE_NOISE = {
    "remote", "hybrid", "onsite", "on", "site", "wfh", "work", "from", "home", "office", "based",
    "full", "part", "time", "fulltime", "parttime", "contract", "contractual", "freelance",
    "permanent", "temporary", "project", "urgent", "hiring", "immediate", "start", "now",
    "global", "worldwide", "anywhere", "international", "philippines", "ph", "cebu", "manila",
    "city", "metro", "makati", "taguig", "pasig", "ortigas", "bgc", "apac", "asia", "only",
    "day", "shift", "night", "mid", "and", "or", "to", "in", "the", "a", "for", "with",
}
COMPANY_SUFFIXES = {
    "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "llc",
    "opc", "pte", "plc", "gmbh", "pty", "philippines", "phils", "phil", "ph",
}
TITLE_PARTS = re.compile(r"\s+[-–—|:/]\s+|[()\[\]]")
REFERENCE_CODE = re.compile(r"^[a-z]{0,4}\d{3,}\w*$")   # "1182", "080426", "req12345"


def _words(text):
    return re.sub(r"[^\w#+]+", " ", text.lower()).split()


def _title_core(title):
    parts = [_words(part) for part in TITLE_PARTS.split(title or "")]
    kept = [part for part in parts
            if part and not all(w in TITLE_NOISE or REFERENCE_CODE.match(w) for w in part)]
    return " ".join(w for part in kept for w in part)


def _company_core(company):
    words = _words(company or "")
    if len(words) > 1 and words[0] == "the":
        words.pop(0)
    while len(words) > 1 and words[-1] in COMPANY_SUFFIXES:
        words.pop()
    return " ".join(words)


def cross_site_key(title, company):
    """
    '1182 - Junior Frontend Developer (Part-Time)' at 'GoFasti Inc.'
    -> 'junior frontend developer|gofasti'. None without a title or company.
    """
    title, company = _title_core(title), _company_core(company)
    return f"{title}|{company}" if title and company else None


def other_site_jobs(cfg, secrets, source):
    """
    {cross_site_key: source label} for jobs the other sites kept recently.
    Empty if Supabase can't be read: the run then relies on its own repost
    check, as before.
    """
    days = cfg.get("duplicate_lookback_days", 60)
    try:
        rows = sinks.recent_jobs(secrets, days, source)
    except Exception as e:
        log.warning("Couldn't load other sites' jobs for the duplicate check: %s", e)
        return {}
    known = {}
    for row in rows or []:
        key = cross_site_key(row.get("title"), row.get("company"))
        if key:
            known.setdefault(key, SOURCE_LABELS.get(row.get("source"), row.get("source")))
    return known


def drop_cross_site_duplicates(candidates, known):
    """Returns (remaining candidates, filtered records for jobs another site already has)."""
    remaining, filtered = [], []
    for job in candidates:
        site = known.get(cross_site_key(job["title"], job["company"]))
        if site:
            filtered.append(filtered_record(job, f"duplicate posting (also on {site})"))
        else:
            remaining.append(job)
    return remaining, filtered


def evaluate_jobs(session, cfg, candidates, seen):
    """Returns (kept_records, filtered_records, expired_ids)."""
    kept, filtered, expired = [], [], []
    posted_keys = {k for k in seen if k.startswith("tc:")}
    min_score = cfg.get("min_match_score", 0)
    for n, job in enumerate(candidates, 1):
        key = repost_key(job)
        if key in posted_keys:
            filtered.append(filtered_record(job, "duplicate posting (same title & company)"))
            continue
        reason = rules.title_drop_reason(job) or rules.location_drop_reason(job)
        if reason:
            filtered.append(filtered_record(job, reason))
            continue

        try:
            details = api.job_details(session, job["id"])
        except (api.JobStreetError, requests.RequestException, ValueError) as e:
            log.warning("Details for %s failed: %s", job["id"], e)
            details = None
        pause(cfg)

        if details and details.get("isExpired"):
            expired.append(job["id"])
            continue

        raw_html = (details or {}).get("content") or ""
        description = rules.html_to_text(raw_html)
        reason, extra = rules.evaluate(job, description)
        # Only judge the score when the description was actually fetched.
        if not reason and details is not None and extra["match_score"] < min_score:
            reason = f"low skill match (score {extra['match_score']})"
        if reason:
            filtered.append(filtered_record(job, reason))
            continue

        emails = rules.extract_emails(description, raw_html)
        form_link = rules.extract_form_link(description, raw_html)
        if details is None:
            apply_type = "unknown (details failed)"
            extra["flags"] = "; ".join(filter(None, [extra["flags"], "!details unavailable"]))
        elif details.get("isLinkOut"):
            apply_type = "External site"
        else:
            apply_type = "JobStreet"
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
            "description": description,
        })
        if n % 20 == 0:
            log.info("Evaluated %d/%d new jobs", n, len(candidates))

    kept.sort(key=lambda r: r["match_score"], reverse=True)
    return kept, filtered, expired


def post_to_sheet(secrets, **records):
    """records: lists keyed by what doPost expects, e.g. jobs=..., filtered=..."""
    # Google's redirect to the response sometimes 404s or times out. Retrying is
    # safe: the sheet skips ids it already has.
    for wait in [15, 45, None]:
        try:
            resp = requests.post(
                secrets["webapp_url"],
                json={"token": secrets["token"], **records},
                timeout=120,
            )
            resp.raise_for_status()
            break
        except requests.RequestException as e:
            if wait is None:
                raise
            log.warning("Posting to the sheet failed (%s); retrying in %ds", e, wait)
            time.sleep(wait)
    try:
        data = resp.json()
    except ValueError:
        raise RuntimeError(
            "Web app did not return JSON. Check the deployment's access is 'Anyone'. "
            f"Response starts with: {resp.text[:200]!r}") from None
    if not data.get("ok"):
        raise RuntimeError(f"Web app error: {data.get('error')}")
    return data


def write_csvs(kept, filtered, prefix=""):
    OUTPUT_DIR.mkdir(exist_ok=True)
    stamp = datetime.now(MANILA).strftime("%Y%m%d_%H%M")
    for name, rows in (("jobs", kept), ("filtered", filtered)):
        if not rows:
            continue
        rows = [{k: v for k, v in r.items() if k not in sinks.NOT_IN_SHEET} for r in rows]
        path = OUTPUT_DIR / f"{prefix}{name}_{stamp}.csv"
        with path.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        log.info("Wrote %s", path)


def save_seen(seen, new_ids, retention_days, path=SEEN_FILE):
    today = datetime.now(MANILA).date()
    for job_id in new_ids:
        seen[job_id] = today.isoformat()
    cutoff = (today - timedelta(days=retention_days)).isoformat()
    seen = {k: v for k, v in seen.items() if v >= cutoff}
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(seen, indent=0), encoding="utf-8")


def scrape(args, source, api_module, collect_fn, evaluate_fn, seen_file, prefix=""):
    """
    One full run for one job source: search, evaluate, send to the outputs,
    then mark the jobs as seen. prefix picks the sheet tabs and CSV names.
    """
    cfg = load_json(CONFIG_FILE)
    secrets = load_secrets()
    seen = load_json(seen_file, {})

    with sinks.run_log(cfg, secrets, source, dry_run=args.dry_run) as stats:
        # Search terms and filter rules come from the settings edited in the
        # dashboard; config.json keeps the operational settings.
        scraper_settings, version = sinks.load_settings(secrets)
        rules.configure(scraper_settings)
        cfg = {**cfg, **settings_module.search_config(scraper_settings)}
        stats["settings_version"] = version

        session = api_module.new_session()
        jobs = collect_fn(session, cfg)
        candidates = [j for j in jobs.values() if j["id"] not in seen]
        log.info("%d unique jobs found, %d not seen before", len(jobs), len(candidates))
        candidates, duplicates = drop_cross_site_duplicates(
            candidates, other_site_jobs(cfg, secrets, source))
        if duplicates:
            log.info("%d already found on another site", len(duplicates))
        if args.limit:
            candidates = candidates[:args.limit]

        kept, filtered, expired = evaluate_fn(session, cfg, candidates, seen)
        filtered = duplicates + filtered
        log.info("New jobs kept: %d, filtered out: %d, expired: %d",
                 len(kept), len(filtered), len(expired))
        stats.update(found=len(jobs), evaluated=len(candidates), kept=len(kept),
                     filtered=len(filtered), expired=len(expired))

        if args.dry_run:
            write_csvs(kept, filtered, prefix)
            log.info("Dry run: nothing sent anywhere, seen list not updated.")
            return
        outputs, missing = sinks.build_sinks(cfg, secrets, source, prefix, post_to_sheet)
        if not outputs:
            write_csvs(kept, filtered, prefix)
            log.warning("No credentials for any output (%s); wrote CSVs instead.", ", ".join(missing))
            return
        sinks.deliver(outputs, missing, kept, filtered)
        save_seen(seen, [r["id"] for r in kept + filtered] + expired + [r["repost_key"] for r in kept],
                  cfg["seen_ids_retention_days"], seen_file)


def run(args):
    scrape(args, "jobstreet", api, collect, evaluate_jobs, SEEN_FILE)


def main(run_fn=run, log_file=LOG_FILE, doc=__doc__):
    parser = argparse.ArgumentParser(description=doc.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true",
                        help="write CSVs to output/ instead of sending to the outputs")
    parser.add_argument("--limit", type=int, default=0,
                        help="only evaluate this many new jobs (for testing)")
    args = parser.parse_args()

    setup_logging(log_file)
    log.info("=== Run started%s ===", " (dry run)" if args.dry_run else "")
    try:
        run_fn(args)
    except Exception:
        log.exception("Run failed")
        return 1
    log.info("=== Run finished ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
