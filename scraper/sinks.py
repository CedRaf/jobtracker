"""
Where scraped jobs go: Supabase.

config.json "outputs" lists the active sinks (["supabase"]). Every sink gets
every run's results. Supabase ignores duplicate keys, so a failed run can
simply be retried. (The Google Sheet output was retired on 2026-11-03.)

Supabase is written through its REST API (PostgREST) with the secret key,
which bypasses row-level security. Never use that key in the frontend.
"""

import json
import logging
import os
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

import settings as settings_module

log = logging.getLogger("scraper")

MANILA = timezone(timedelta(hours=8))
BATCH_SIZE = 500



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

    def rpc(self, function, params):
        """Calls a database function (POST /rpc/<function>) and returns its result."""
        return self._request("POST", f"rpc/{function}", json=params)

    def select_all(self, table, params, page_size=1000):
        """select() past PostgREST's row limit, a page at a time (give an "order" so pages don't shift)."""
        rows = []
        while True:
            page = self.select(table, {**params, "limit": page_size, "offset": len(rows)})
            rows += page
            if len(page) < page_size:
                return rows


def recent_jobs(secrets, days, exclude_source):
    """
    Kept jobs from the other sources first seen in the last `days` days, as
    [{"source", "title", "company"}], for the cross-site duplicate check.
    Returns None when there's no Supabase key to read with.
    """
    client = supabase_client(secrets)
    if not client:
        return None
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = client.select_all("jobs", {
        "select": "source,title,company",
        "first_seen": f"gte.{since}",
        "order": "first_seen.asc",
    })
    # Filtered here rather than with source=neq.<source>: that fails on a
    # source the job_source enum doesn't have yet (migration not pushed).
    return [row for row in rows if row.get("source") != exclude_source]


def known_listings(secrets, source):
    """
    What the database already knows about this site's listings, for the seen
    check: (external ids in jobs, filtered_jobs and expired_listings; the repost
    keys of its kept jobs). Nothing ages out of it, unlike the cache file.
    None when there's no Supabase key to read with; a failed read raises, so a
    run never judges old listings again by mistake.
    """
    client = supabase_client(secrets)
    if not client:
        return None
    ids = set()
    for table in ("jobs", "filtered_jobs", "expired_listings"):
        rows = client.select_all(table, {"select": "external_id", "source": f"eq.{source}",
                                         "order": "external_id.asc"})
        ids.update(row["external_id"] for row in rows)
    rows = client.select_all("jobs", {"select": "external_id,repost_key", "source": f"eq.{source}",
                                      "repost_key": "not.is.null", "order": "external_id.asc"})
    return ids, {row["repost_key"] for row in rows}


def jobs_to_recheck(secrets, source, min_days, max_days):
    """This site's jobs still in New, aged min_days to max_days, oldest first (public.jobs_to_recheck)."""
    client = supabase_client(secrets)
    if not client:
        return []
    return client.rpc("jobs_to_recheck", {
        "p_source": source, "p_min_days": min_days, "p_max_days": max_days}) or []


def expire_closed_jobs(secrets, source, external_ids):
    """Moves these jobs from New to Expired, their posting having closed. Returns how many moved."""
    client = supabase_client(secrets)
    if not client or not external_ids:
        return 0
    return client.rpc("expire_closed_jobs", {"p_source": source, "p_external_ids": list(external_ids)}) or 0


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

class SupabaseSink:
    name = "supabase"

    def __init__(self, client, source):
        self.client = client
        self.source = source

    def write(self, kept, filtered, expired=()):
        jobs_added = self.client.insert(
            "jobs", [job_row(r, self.source) for r in kept], on_conflict="source,external_id")
        filtered_added = self.client.insert(
            "filtered_jobs", [filtered_row(r, self.source) for r in filtered],
            on_conflict="source,external_id")
        # Already closed when first seen: recorded so later runs skip them too.
        self.client.insert(
            "expired_listings", [{"source": self.source, "external_id": str(i)} for i in expired],
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
    (e.g. "jobstreet": {"outputs": [...]}), otherwise the shared list.
    """
    return cfg.get(source, {}).get("outputs") or cfg.get("outputs", ["supabase"])


def build_sinks(cfg, secrets, source):
    """
    Returns (sinks, missing): the configured outputs that have credentials,
    and the names of those that don't.
    """
    sinks, missing = [], []
    for name in output_names(cfg, source):
        if name == "supabase":
            client = supabase_client(secrets)
            if client:
                sinks.append(SupabaseSink(client, source))
            else:
                missing.append(name)
        elif name == "sheet":
            raise ValueError('The Google Sheet output was retired; remove "sheet" from config.json outputs.')
        else:
            raise ValueError(f"Unknown output in config.json: {name!r}")
    return sinks, missing


def deliver(sinks, missing, kept, filtered, expired=()):
    """
    Writes to every sink, even if an earlier one fails, then raises if any
    failed or had no credentials. Jobs that fail to reach the database aren't
    in it, so the next run judges them again.
    """
    errors = [f"{name}: credentials missing" for name in missing]
    for sink in sinks:
        try:
            sink.write(kept, filtered, expired)
        except Exception as e:
            log.exception("Writing to %s failed", sink.name)
            errors.append(f"{sink.name}: {e}")
    if errors:
        raise RuntimeError("Some outputs failed: " + "; ".join(errors))


# ===== Run log (public.scrape_runs) ==========================================

# Run-log writes that failed, for the workflow's last step to replay
# (close_runs.py): a failed write must not leave a finished run "running".
PENDING_RUNS_FILE = Path(__file__).resolve().parent / "data" / "pending_runs.json"

# Columns a database without the latest migrations may lack; dropped and
# retried rather than losing the whole write.
NEWER_COLUMNS = ("settings_version", "status", "warning")


def run_start_row(source):
    """A new scrape_runs row: this GitHub run, and the dispatch that started it (if any)."""
    row = {"source": source, "github_run_id": os.environ.get("GITHUB_RUN_ID")}
    dispatch_id = os.environ.get("DISPATCH_ID", "").strip()
    if dispatch_id.isdigit():
        row["dispatch_id"] = int(dispatch_id)
    return row


def save_pending_run(entry, path=None):
    """Adds a run-log write ({"id": ..., "values": ...} or {"insert": row}) to the pending file."""
    path = path or PENDING_RUNS_FILE
    try:
        pending = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps(pending + [entry]), encoding="utf-8")
    except Exception as e:
        log.warning("Couldn't save the run-log write for later either: %s", e)


def write_run(client, run_id, row):
    """
    Updates (run_id) or inserts the run's row, without the newer columns if the
    database lacks them. Raises if it still fails.
    """
    def attempt(values):
        if run_id is None:
            client.insert_one("scrape_runs", values)
        else:
            client.update("scrape_runs", {"id": run_id}, values)

    try:
        attempt(row)
    except Exception as e:
        older = {k: v for k, v in row.items() if k not in NEWER_COLUMNS}
        if older == row:
            raise
        attempt(older)
        log.warning("scrape_runs lacks newer columns (%s); push the migrations", e)


@contextmanager
def run_log(cfg, secrets, source, dry_run=False):
    """
    Records the run in scrape_runs: a row when it starts (status running), then
    counts and status when it ends. Yields a dict for the caller to fill with
    counts; set "delivered" once the jobs reached every output, and "warning"
    for a problem after that.

    Ends as failed (with the error) if the run raised before delivering; as ok
    otherwise, with an error after delivering kept as a warning instead of
    failing the run. Does nothing for dry runs or when Supabase isn't an
    output. A problem writing the log never fails the run: a start that
    couldn't be written is inserted whole at the end, and an end that couldn't
    be written is saved for the workflow's last step (close_runs.py).
    """
    stats = {}
    client = None if dry_run or "supabase" not in output_names(cfg, source) else supabase_client(secrets)
    run_id = None
    start = run_start_row(source)
    started_at = datetime.now(timezone.utc).isoformat()
    if client:
        try:
            run_id = client.insert_one("scrape_runs", start)["id"]
        except Exception as e:
            log.warning("Couldn't record the run's start in scrape_runs (%s); it's written at the end", e)

    def finish(error=None):
        if not client:
            return
        delivered = stats.pop("delivered", False)
        if error and delivered:
            log.warning("The jobs were delivered, so the run counts as ok; problem after that: %s", error)
            stats["warning"] = "; ".join(filter(None, [stats.get("warning"), error]))[:2000]
            error = None
        values = {**stats, "status": "failed" if error else "ok", "error": error,
                  "finished_at": datetime.now(timezone.utc).isoformat()}
        row = values if run_id is not None else {**start, "started_at": started_at, **values}
        try:
            write_run(client, run_id, row)
        except Exception as e:
            log.warning("Couldn't record the run's end in scrape_runs (%s); the workflow's last step "
                        "retries it", e)
            save_pending_run({"id": run_id, "values": values} if run_id is not None else {"insert": row})

    try:
        yield stats
    except Exception as e:
        delivered = stats.get("delivered", False)
        finish(f"{type(e).__name__}: {e}"[:2000])
        if not delivered:
            raise
        log.exception("Problem after the jobs were delivered")
        return
    finish()


def record_skipped(cfg, secrets, source, settings_version):
    """A row for a run that did nothing because the site is switched off (status skipped)."""
    if "supabase" not in output_names(cfg, source):
        return
    client = supabase_client(secrets)
    if not client:
        return
    now = datetime.now(timezone.utc).isoformat()
    try:
        write_run(client, None, {**run_start_row(source), "status": "skipped", "finished_at": now,
                                 "settings_version": settings_version})
    except Exception as e:
        log.warning("Couldn't record the skipped run in scrape_runs: %s", e)


def close_unfinished_runs(client, github_run_id, path=None):
    """
    The workflow's last step: replays run-log writes that failed (the pending
    file), then marks this GitHub run's rows still running as interrupted (a
    step was cancelled or timed out before its scraper could finish). Returns
    how many were interrupted.
    """
    path = path or PENDING_RUNS_FILE
    if path.exists():
        for entry in json.loads(path.read_text(encoding="utf-8")):
            if "insert" in entry:
                write_run(client, None, entry["insert"])
            else:
                write_run(client, entry["id"], entry["values"])
        path.unlink()
    running = client.select("scrape_runs", {
        "select": "id", "github_run_id": f"eq.{github_run_id}", "status": "eq.running"})
    for row in running:
        client.update("scrape_runs", {"id": row["id"]},
                      {"status": "interrupted", "finished_at": datetime.now(timezone.utc).isoformat()})
    return len(running)
