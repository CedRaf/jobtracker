"""The listing lifecycle (docs/STATE_MACHINE_PLAN.md, rollout 2): the database as
the seen list, expired listings, and re-checking New jobs for closed postings."""
from datetime import datetime, timedelta, timezone

import pytest

import Himalayas_Scraper as hm
import LinkedIn_Scraper as li
import scraper
import sinks


def job(job_id, title="Junior Developer", company="Acme"):
    return {"id": job_id, "title": title, "company": company, "location": "Cebu",
            "work_arrangements": [], "search_terms": ["dev"], "url": f"https://x/{job_id}"}


# ---- the seen check -----------------------------------------------------------------


def test_the_database_joins_the_cache_file():
    lookup = scraper.seen_lookup({"1": "2026-11-01"}, ({"2", "3"}, {"tc:dev|acme"}))
    assert set(lookup) == {"1", "2", "3", "tc:dev|acme"}


def test_without_credentials_the_cache_file_is_used_alone():
    seen = {"1": "2026-11-01"}
    assert scraper.seen_lookup(seen, None) is seen


class Args:
    dry_run, limit = True, 0


def run_once(monkeypatch, tmp_path, known, collected):
    """A dry run of scrape() with an empty cache file; returns what was evaluated, and the lookup."""
    monkeypatch.setattr(scraper, "load_json", lambda path, default=None: (
        {"outputs": [], "seen_ids_retention_days": 30} if path == scraper.CONFIG_FILE else default))
    monkeypatch.setattr(sinks, "load_settings", lambda secrets: (sinks.settings_module.validate({}), None))
    monkeypatch.setattr(sinks, "known_listings", lambda secrets, source: known)
    monkeypatch.setattr(sinks, "recent_jobs", lambda *a: [])
    monkeypatch.setattr(scraper, "write_csvs", lambda *a: None)
    got = {}

    class Api:
        @staticmethod
        def new_session():
            return None

    def evaluate(session, cfg, candidates, seen):
        got.update(evaluated=[j["id"] for j in candidates], lookup=seen)
        return [], [], []

    scraper.scrape(Args(), "jobstreet", Api, lambda s, c: collected, evaluate, tmp_path / "seen.json")
    return got


def test_listings_the_database_has_are_never_judged_again(monkeypatch, tmp_path):
    # The cache file is empty (evicted), but the database knows 1 and 2.
    got = run_once(monkeypatch, tmp_path, ({"1", "2"}, set()), {i: job(i) for i in ("1", "2", "3")})
    assert got["evaluated"] == ["3"]


def test_repost_keys_come_from_the_database(monkeypatch, tmp_path):
    got = run_once(monkeypatch, tmp_path, (set(), {"tc:junior developer acme"}), {"9": job("9")})
    assert "tc:junior developer acme" in got["lookup"]


def test_a_failed_database_read_fails_the_run_before_searching(monkeypatch, tmp_path):
    def broken(secrets, source):
        raise RuntimeError("Supabase GET jobs failed: HTTP 503")

    monkeypatch.setattr(scraper, "load_json", lambda path, default=None: (
        {"outputs": [], "seen_ids_retention_days": 30} if path == scraper.CONFIG_FILE else default))
    monkeypatch.setattr(sinks, "load_settings", lambda secrets: (sinks.settings_module.validate({}), None))
    monkeypatch.setattr(sinks, "known_listings", broken)

    def collect(session, cfg):
        pytest.fail("no searching without the seen list")

    with pytest.raises(RuntimeError, match="503"):
        scraper.scrape(Args(), "jobstreet", None, collect, None, tmp_path / "seen.json")


# ---- re-checking New jobs -----------------------------------------------------------


def test_closed_postings_are_expired(monkeypatch):
    calls = {}
    monkeypatch.setattr(sinks, "jobs_to_recheck", lambda secrets, source, lo, hi: calls.update(
        window=(lo, hi)) or ["1", "2", "3"])
    monkeypatch.setattr(sinks, "expire_closed_jobs", lambda secrets, source, ids: calls.update(
        expired=(source, ids)) or len(ids))
    moved = scraper.recheck_closed({}, {}, "jobstreet", None, {}, lambda s, cfg, ids, collected: ["2"])
    assert moved == 1
    assert calls == {"window": (3, scraper.EXPIRE_AFTER_DAYS), "expired": ("jobstreet", ["2"])}


def test_the_recheck_is_limited_per_run(monkeypatch):
    asked = []
    monkeypatch.setattr(sinks, "jobs_to_recheck", lambda *a: [str(i) for i in range(50)])
    monkeypatch.setattr(sinks, "expire_closed_jobs", lambda *a: 0)
    scraper.recheck_closed({"recheck_limit": 5}, {}, "jobstreet", None, {},
                           lambda s, cfg, ids, collected: asked.extend(ids) or [])
    assert asked == ["0", "1", "2", "3", "4"]


def test_a_failed_recheck_never_fails_the_run(monkeypatch):
    def broken(*a):
        raise RuntimeError("down")

    monkeypatch.setattr(sinks, "jobs_to_recheck", broken)
    assert scraper.recheck_closed({}, {}, "jobstreet", None, {}, None) == 0


def test_jobstreet_asks_the_details_and_skips_failures(monkeypatch):
    answers = {"1": {"isExpired": True}, "2": {"isExpired": False}, "4": None}

    def details(session, job_id):
        if job_id == "3":
            raise scraper.api.JobStreetError("boom")
        return answers[job_id]

    monkeypatch.setattr(scraper.api, "job_details", details)
    monkeypatch.setattr(scraper, "pause", lambda cfg: None)
    assert scraper.check_closed(None, {}, ["1", "2", "3", "4"], {}) == ["1"]


def test_linkedin_stops_at_a_rate_limit(monkeypatch):
    def details(session, job_id):
        if job_id == "2":
            raise li.api.RateLimited("HTTP 429")
        return {"isExpired": True}

    monkeypatch.setattr(li.api, "job_details", details)
    monkeypatch.setattr(li, "pause", lambda cfg: None)
    assert li.check_closed(None, {}, ["1", "2", "3"], {}) == ["1"]


def test_linkedin_rechecks_only_a_few_a_run(monkeypatch):
    asked = []
    monkeypatch.setattr(li.api, "job_details", lambda s, job_id: asked.append(job_id) or {"isExpired": False})
    monkeypatch.setattr(li, "pause", lambda cfg: None)
    li.check_closed(None, {}, [str(i) for i in range(30)], {})
    assert len(asked) == li.LINKEDIN_DEFAULTS["recheck_limit"]


def test_himalayas_uses_the_expiry_dates_in_this_runs_results():
    now = datetime.now(timezone.utc)
    collected = {"past": {"expires_at": now - timedelta(days=1)},
                 "future": {"expires_at": now + timedelta(days=1)},
                 "undated": {"expires_at": None}}
    # "missing" isn't in the results: that proves nothing.
    assert hm.check_closed(None, {}, ["past", "future", "undated", "missing"], collected) == ["past"]


# ---- sinks ----------------------------------------------------------------------------


class FakeClient:
    def __init__(self, tables=None, rpc_result=None):
        self.tables, self.rpc_result = tables or {}, rpc_result
        self.selects, self.rpcs, self.inserted = [], [], {}

    def select_all(self, table, params):
        self.selects.append((table, params))
        return self.tables.get((table, params["select"]), [])

    def rpc(self, function, params):
        self.rpcs.append((function, params))
        return self.rpc_result

    def insert(self, table, rows, on_conflict):
        self.inserted[table] = rows
        return len(rows)


def test_known_listings_reads_all_three_tables_and_the_repost_keys(monkeypatch):
    fake = FakeClient({
        ("jobs", "external_id"): [{"external_id": "1"}],
        ("filtered_jobs", "external_id"): [{"external_id": "2"}],
        ("expired_listings", "external_id"): [{"external_id": "3"}],
        ("jobs", "external_id,repost_key"): [{"external_id": "1", "repost_key": "tc:a"}],
    })
    monkeypatch.setattr(sinks, "supabase_client", lambda secrets: fake)
    assert sinks.known_listings({}, "linkedin") == ({"1", "2", "3"}, {"tc:a"})
    assert all(params["source"] == "eq.linkedin" and "order" in params for _, params in fake.selects)


def test_known_listings_without_a_key_is_none():
    assert sinks.known_listings({}, "jobstreet") is None


def test_the_recheck_calls_go_to_the_database_functions(monkeypatch):
    fake = FakeClient(rpc_result=["7"])
    monkeypatch.setattr(sinks, "supabase_client", lambda secrets: fake)
    assert sinks.jobs_to_recheck({}, "jobstreet", 3, 15) == ["7"]
    fake.rpc_result = 1
    assert sinks.expire_closed_jobs({}, "jobstreet", ["7"]) == 1
    assert sinks.expire_closed_jobs({}, "jobstreet", []) == 0  # nothing to send
    assert fake.rpcs == [
        ("jobs_to_recheck", {"p_source": "jobstreet", "p_min_days": 3, "p_max_days": 15}),
        ("expire_closed_jobs", {"p_source": "jobstreet", "p_external_ids": ["7"]}),
    ]


def test_already_closed_listings_are_recorded():
    fake = FakeClient()
    sinks.SupabaseSink(fake, "linkedin").write([], [], ["5", 6])
    assert fake.inserted["expired_listings"] == [
        {"source": "linkedin", "external_id": "5"}, {"source": "linkedin", "external_id": "6"}]
