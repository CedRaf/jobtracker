"""
Where scraped jobs go: the Google Sheet (Apps Script web app) and/or Supabase.

config.json "outputs" lists the active sinks, e.g. ["sheet", "supabase"].
Every sink gets every run's results. Both are idempotent (the sheet skips ids
it already has; Supabase ignores duplicate keys), so a failed run can simply
be retried.

Supabase is written through its REST API (PostgREST) with the secret key,
which bypasses row-level security. Never use that key in the frontend.
"""

import logging
import os
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import requests

import settings as settings_module

log = logging.getLogger("scraper")

MANILA = timezone(timedelta(hours=8))
BATCH_SIZE = 500

# Fields in the scraper's records that the sheet doesn't have columns for.
NOT_IN_SHEET = ("repost_key", "description")


# ===== Record -> database row ================================================

def split_list(value, sep=", "):
    """'React, C#' -> ['React', 'C#']; '' -> []."""
    return [part.strip() for part in (value or "").split(sep.strip()) if part.strip()]


def parse_manila(value):
    """'2026-09-29 10:24' or '2026-09-29' (Manila time) -> ISO timestamp, else None."""
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime((value or "").strip(), fmt).replace(tzinfo=MANILA).isoformat()
        except ValueError:
            pass
    return None


def job_row(record, source):
    """A kept record from evaluate_jobs() -> a row for public.jobs."""
    return {
        "source": source,
        "external_id": str(record["id"]),
        "repost_key": record.get("repost_key"),
        "search_terms": split_list(record.get("search_term")),
        "title": record["title"],
        "company": record.get("company") or None,
        "location": record.get("location") or None,
        "work_arrangements": split_list(record.get("work_arrangement")),
        "work_type": record.get("work_type") or None,
        "salary_text": record.get("salary_text") or None,
        "seniority": record.get("seniority") or None,
        "posted_at": parse_manila(record.get("posted")),
        "apply_type": record.get("apply_type") or None,
        "apply_link": record.get("apply_link") or None,
        "match_score": int(record.get("match_score") or 0),
        "matched_skills": split_list(record.get("matched_skills")),
        "missing_skills": split_list(record.get("missing_skills")),
        "flags": split_list(record.get("flags"), "; "),
        "emails": split_list(record.get("email")),
        "email_source": record.get("email_source") or None,
        "url": record["url"],
        "description": record.get("description") or None,
    }


def filtered_row(record, source):
    """A filtered record from filtered_record() -> a row for public.filtered_jobs."""
    return {
        "source": source,
        "external_id": str(record["id"]),
        "search_terms": split_list(record.get("search_term")),
        "title": record["title"],
        "company": record.get("company") or None,
        "location": record.get("location") or None,
        "work_arrangements": split_list(record.get("work_arrangement")),
        "reason": record["reason"],
        "url": record["url"],
    }


# ===== Supabase REST client ==================================================

class SupabaseClient:
    def __init__(self, url, key, session=None):
        # Accept the project URL with or without the /rest/v1 suffix the
        # dashboard's Data API page shows.
        url = url.strip().rstrip("/")
        self.base = url if url.endswith("/rest/v1") else url + "/rest/v1"
        self.session = session or requests.Session()
        self.session.headers["apikey"] = key
        # New-style keys (sb_secret_...) go in the apikey header only; legacy
        # service_role keys are JWTs and also go in Authorization.
        if not key.startswith("sb_"):
            self.session.headers["Authorization"] = f"Bearer {key}"

    def _request(self, method, table, **kwargs):
        # Retry connection problems and 5xx errors; PostgREST writes are
        # idempotent here (inserts ignore duplicates, updates match by id).
        for wait in [5, 20, None]:
            try:
                resp = self.session.request(method, f"{self.base}/{table}", timeout=60, **kwargs)
                error = None if resp.ok else f"HTTP {resp.status_code}: {resp.text[:300]}"
                retry = resp.status_code >= 500
            except requests.RequestException as e:
                error, retry = str(e), True
            if not error:
                return resp.json() if resp.content else None
            if not retry or wait is None:
                raise RuntimeError(f"Supabase {method} {table} failed: {error}")
            log.warning("Supabase %s %s failed (%s); retrying in %ds", method, table, error, wait)
            time.sleep(wait)

    def insert(self, table, rows, on_conflict, merge=False):
        """
        Inserts rows in batches. Existing keys are skipped (merge=False) or
        updated with the given columns (merge=True). Returns how many rows
        were new (merge=False) or written (merge=True).
        """
        resolution = "merge-duplicates" if merge else "ignore-duplicates"
        written = 0
        for i in range(0, len(rows), BATCH_SIZE):
            result = self._request(
                "POST", table,
                params={"on_conflict": on_conflict, "select": on_conflict},
                headers={"Prefer": f"resolution={resolution},return=representation"},
                json=rows[i:i + BATCH_SIZE],
            )
            written += len(result or [])
        return written

    def insert_one(self, table, row, select="id"):
        result = self._request("POST", table, params={"select": select},
                               headers={"Prefer": "return=representation"}, json=row)
        return result[0]

    def update(self, table, match, values):
        params = {column: f"eq.{value}" for column, value in match.items()}
        self._request("PATCH", table, params=params, json=values)

    def select(self, table, params):
        return self._request("GET", table, params=params) or []


def load_settings(secrets):
    """
    The scraper settings to use: (settings, version). The newest version saved
    from the dashboard, or the defaults (version None) when there are no
    Supabase credentials, nothing is saved, it can't be fetched, or the saved
    version is invalid. Problems are logged; they never stop the run.
    """
    client = supabase_client(secrets)
    if client:
        try:
            rows = client.select("scraper_settings_versions",
                                 {"select": "version,settings", "order": "version.desc", "limit": "1"})
        except Exception as e:
            log.warning("Couldn't load the scraper settings (%s); using the defaults", e)
            rows = []
        if rows:
            version = rows[0]["version"]
            try:
                settings = settings_module.validate(rows[0]["settings"])
                log.info("Using scraper settings version %s", version)
                return settings, version
            except settings_module.SettingsError as e:
                log.error("Scraper settings version %s is invalid (%s); using the defaults", version, e)
    else:
        log.info("No Supabase credentials; using the default scraper settings")
    return settings_module.validate({}), None


# ===== Sinks =================================================================

class SheetSink:
    """
    prefix picks the tabs: "" = Jobs/Filtered, "linkedin_" = LinkedIn/LinkedIn
    Filtered. doPost reads <prefix>jobs / <prefix>filtered and answers with
    <prefix>added / <prefix>skipped / <prefix>filtered_added.
    """
    name = "sheet"

    def __init__(self, secrets, prefix, post):
        self.secrets = secrets
        self.prefix = prefix
        self.post = post

    def write(self, kept, filtered):
        if not kept and not filtered:
            return
        p = self.prefix
        jobs = [{k: v for k, v in r.items() if k not in NOT_IN_SHEET} for r in kept]
        result = self.post(self.secrets, **{f"{p}jobs": jobs, f"{p}filtered": filtered})
        if f"{p}added" not in result:
            # Either an older Code.gs that ignores these keys, or the request
            # reached doGet instead of doPost (a redirect turned the POST into a
            # GET, e.g. an http:// or /dev URL). Nothing was written either way.
            raise RuntimeError(
                f"The Apps Script web app's reply has no '{p}added' count, so nothing was written. "
                "Check SHEET_WEBAPP_URL is exactly https://script.google.com/macros/s/<id>/exec, "
                f"and that the deployed Code.gs is the latest. Reply: {str(result)[:200]}")
        log.info("Sheet updated: %s added, %s already there; filtered tab: %s added",
                 result.get(f"{p}added"), result.get(f"{p}skipped"), result.get(f"{p}filtered_added"))


class SupabaseSink:
    name = "supabase"

    def __init__(self, client, source):
        self.client = client
        self.source = source

    def write(self, kept, filtered):
        jobs_added = self.client.insert(
            "jobs", [job_row(r, self.source) for r in kept], on_conflict="source,external_id")
        filtered_added = self.client.insert(
            "filtered_jobs", [filtered_row(r, self.source) for r in filtered],
            on_conflict="source,external_id")
        log.info("Supabase updated: %d of %d jobs new; %d of %d filtered new",
                 jobs_added, len(kept), filtered_added, len(filtered))


def supabase_client(secrets):
    if secrets.get("supabase_url") and secrets.get("supabase_secret_key"):
        return SupabaseClient(secrets["supabase_url"], secrets["supabase_secret_key"])
    return None


def output_names(cfg, source):
    """
    The outputs for one source: its own "outputs" in config.json if it has one
    (e.g. "himalayas": {"outputs": ["supabase"]}), otherwise the shared list.
    """
    return cfg.get(source, {}).get("outputs") or cfg.get("outputs", ["sheet"])


def build_sinks(cfg, secrets, source, sheet_prefix, post_to_sheet):
    """
    Returns (sinks, missing): the configured outputs that have credentials,
    and the names of those that don't.
    """
    sinks, missing = [], []
    for name in output_names(cfg, source):
        if name == "sheet":
            if secrets.get("webapp_url") and secrets.get("token"):
                sinks.append(SheetSink(secrets, sheet_prefix, post_to_sheet))
            else:
                missing.append(name)
        elif name == "supabase":
            client = supabase_client(secrets)
            if client:
                sinks.append(SupabaseSink(client, source))
            else:
                missing.append(name)
        else:
            raise ValueError(f"Unknown output in config.json: {name!r}")
    return sinks, missing


def deliver(sinks, missing, kept, filtered):
    """
    Writes to every sink, even if an earlier one fails, then raises if any
    failed or had no credentials. The caller only marks jobs as seen when this
    returns, so failed jobs are retried next run.
    """
    errors = [f"{name}: credentials missing" for name in missing]
    for sink in sinks:
        try:
            sink.write(kept, filtered)
        except Exception as e:
            log.exception("Writing to %s failed", sink.name)
            errors.append(f"{sink.name}: {e}")
    if errors:
        raise RuntimeError("Some outputs failed: " + "; ".join(errors))


# ===== Run log (public.scrape_runs) ==========================================

@contextmanager
def run_log(cfg, secrets, source, dry_run=False):
    """
    Records the run in scrape_runs: a row when it starts, then counts (or the
    error) when it ends. Yields a dict for the caller to fill with counts.
    Does nothing for dry runs or when Supabase isn't an output. A problem
    writing the log never fails the run itself.
    """
    stats = {}
    client = None if dry_run or "supabase" not in output_names(cfg, source) else supabase_client(secrets)
    run_id = None
    if client:
        try:
            run_id = client.insert_one("scrape_runs", {
                "source": source, "github_run_id": os.environ.get("GITHUB_RUN_ID")})["id"]
        except Exception as e:
            log.warning("Couldn't record the run in scrape_runs: %s", e)

    def finish(error=None):
        if run_id is None:
            return
        values = {**stats, "error": error, "finished_at": datetime.now(timezone.utc).isoformat()}
        try:
            client.update("scrape_runs", {"id": run_id}, values)
        except Exception as e:
            # A database without the settings migration has no settings_version
            # column; keep the counts rather than losing the whole update.
            if "settings_version" in values:
                values.pop("settings_version")
                try:
                    client.update("scrape_runs", {"id": run_id}, values)
                    log.warning("scrape_runs has no settings_version column yet (%s); push the migrations", e)
                    return
                except Exception as retry_error:
                    e = retry_error
            log.warning("Couldn't update the run in scrape_runs: %s", e)

    try:
        yield stats
    except Exception as e:
        finish(f"{type(e).__name__}: {e}"[:2000])
        raise
    finish()
