import json

import pytest

import sinks

KEPT = {
    "repost_key": "tc:junior developer acme",
    "id": "123",
    "search_term": "junior developer, junior developer [remote]",
    "title": "Junior Developer",
    "company": "Acme",
    "location": "Cebu City, Cebu",
    "work_arrangement": "Hybrid, Remote",
    "work_type": "Full time",
    "salary_text": "",
    "posted": "2026-10-22 09:30",
    "apply_type": "JobStreet",
    "apply_link": "",
    "match_score": 8,
    "matched_skills": "TypeScript, React, Python",
    "missing_skills": "",
    "flags": "!3+ yrs exp; +fresh grads OK",
    "email": "hr@acme.test, jobs@acme.test",
    "email_source": "description",
    "url": "https://ph.jobstreet.com/job/123",
    "description": "We use React.",
}
FILTERED = {
    "id": "456", "search_term": "ai engineer", "title": "Senior AI Engineer", "company": "Acme",
    "location": "Makati", "work_arrangement": "On-site", "reason": "seniority title (Senior)",
    "url": "https://ph.jobstreet.com/job/456",
}


# ---- record -> row -----------------------------------------------------------


def test_job_row_converts_lists_and_dates():
    row = sinks.job_row(KEPT, "jobstreet")
    assert row["source"] == "jobstreet" and row["external_id"] == "123"
    assert row["search_terms"] == ["junior developer", "junior developer [remote]"]
    assert row["work_arrangements"] == ["Hybrid", "Remote"]
    assert row["matched_skills"] == ["TypeScript", "React", "Python"]
    assert row["missing_skills"] == []
    assert row["flags"] == ["!3+ yrs exp", "+fresh grads OK"]
    assert row["emails"] == ["hr@acme.test", "jobs@acme.test"]
    assert row["posted_at"] == "2026-10-22T09:30:00+08:00"
    assert row["salary_text"] is None  # blanks become NULL
    assert row["description"] == "We use React."


def test_rows_always_have_the_same_keys():
    # PostgREST bulk inserts require it.
    minimal = {"id": 1, "title": "Dev", "url": "u"}
    assert sinks.job_row(minimal, "linkedin").keys() == sinks.job_row(KEPT, "jobstreet").keys()


@pytest.mark.parametrize("value, expected", [
    ("2026-10-22", "2026-10-22T00:00:00+08:00"),  # LinkedIn: date only
    ("", None),
    ("3 days ago", None),
])
def test_parse_manila(value, expected):
    assert sinks.parse_manila(value) == expected


def test_filtered_row():
    row = sinks.filtered_row(FILTERED, "jobstreet")
    assert row["work_arrangements"] == ["On-site"]
    assert row["reason"] == "seniority title (Senior)"


# ---- Supabase client -----------------------------------------------------------


class FakeResponse:
    def __init__(self, status=201, body=None):
        self.status_code = status
        self.ok = status < 400
        self.text = str(body)
        self._body = body
        self.content = b"x" if body is not None else b""

    def json(self):
        return self._body


class FakeSession:
    def __init__(self, responses):
        self.headers = {}
        self.calls = []
        self.responses = list(responses)

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return self.responses.pop(0)


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(sinks.time, "sleep", lambda s: None)


def test_new_style_key_goes_in_apikey_header_only():
    session = FakeSession([])
    sinks.SupabaseClient("https://x.supabase.co/", "sb_secret_abc", session)
    assert session.headers == {"apikey": "sb_secret_abc"}


@pytest.mark.parametrize("url", [
    "https://x.supabase.co",
    "https://x.supabase.co/",
    "https://x.supabase.co/rest/v1",
    "https://x.supabase.co/rest/v1/ ",
])
def test_url_with_or_without_rest_path(url):
    client = sinks.SupabaseClient(url, "sb_secret_abc", FakeSession([]))
    assert client.base == "https://x.supabase.co/rest/v1"


def test_legacy_key_also_goes_in_authorization():
    session = FakeSession([])
    sinks.SupabaseClient("https://x.supabase.co", "eyJlegacy", session)
    assert session.headers["Authorization"] == "Bearer eyJlegacy"


def test_insert_ignores_duplicates_and_counts_new_rows():
    session = FakeSession([FakeResponse(201, [{"source": "jobstreet", "external_id": "123"}])])
    client = sinks.SupabaseClient("https://x.supabase.co", "sb_secret_abc", session)
    assert client.insert("jobs", [{"a": 1}, {"a": 2}], on_conflict="source,external_id") == 1
    method, url, kwargs = session.calls[0]
    assert (method, url) == ("POST", "https://x.supabase.co/rest/v1/jobs")
    assert kwargs["params"]["on_conflict"] == "source,external_id"
    assert "resolution=ignore-duplicates" in kwargs["headers"]["Prefer"]


def test_insert_batches(monkeypatch):
    monkeypatch.setattr(sinks, "BATCH_SIZE", 2)
    session = FakeSession([FakeResponse(201, []) for _ in range(3)])
    client = sinks.SupabaseClient("https://x.supabase.co", "sb_secret_abc", session)
    client.insert("jobs", [{"a": i} for i in range(5)], on_conflict="id")
    assert [len(kwargs["json"]) for _, _, kwargs in session.calls] == [2, 2, 1]


def test_server_errors_are_retried():
    session = FakeSession([FakeResponse(503, "busy"), FakeResponse(201, [{"id": 1}])])
    client = sinks.SupabaseClient("https://x.supabase.co", "sb_secret_abc", session)
    assert client.insert("jobs", [{"a": 1}], on_conflict="id") == 1
    assert len(session.calls) == 2


def test_client_errors_are_not_retried():
    session = FakeSession([FakeResponse(400, {"message": "bad column"})])
    client = sinks.SupabaseClient("https://x.supabase.co", "sb_secret_abc", session)
    with pytest.raises(RuntimeError, match="HTTP 400"):
        client.insert("jobs", [{"a": 1}], on_conflict="id")
    assert len(session.calls) == 1


# ---- sinks and delivery ----------------------------------------------------------


def test_build_sinks_reports_missing_credentials():
    found, missing = sinks.build_sinks({"outputs": ["supabase"]}, {}, "jobstreet")
    assert found == [] and missing == ["supabase"]


def test_build_sinks_explains_the_retired_sheet_output():
    with pytest.raises(ValueError, match="retired"):
        sinks.build_sinks({"outputs": ["sheet", "supabase"]}, {}, "jobstreet")


def test_select_all_pages_past_the_row_limit():
    session = FakeSession([FakeResponse(200, [{"n": 1}, {"n": 2}]), FakeResponse(200, [{"n": 3}])])
    client = sinks.SupabaseClient("https://x.supabase.co", "sb_secret_x", session)
    assert client.select_all("jobs", {"select": "n"}, page_size=2) == [{"n": 1}, {"n": 2}, {"n": 3}]
    assert [kw["params"]["offset"] for _, _, kw in session.calls] == [0, 2]


def test_recent_jobs_returns_other_sources_since_the_lookback(monkeypatch):
    rows = [{"source": "jobstreet", "title": "A", "company": "X"},
            {"source": "himalayas", "title": "B", "company": "Y"}]
    session = FakeSession([FakeResponse(200, rows)])
    monkeypatch.setattr(sinks, "supabase_client",
                        lambda secrets: sinks.SupabaseClient("https://x.supabase.co", "sb_secret_x", session))
    assert sinks.recent_jobs({}, 60, "himalayas") == rows[:1]
    params = session.calls[0][2]["params"]
    assert "source" not in params  # works before the enum has the source
    assert params["first_seen"].startswith("gte.") and params["select"] == "source,title,company"


def test_recent_jobs_without_a_key_returns_none():
    assert sinks.recent_jobs({}, 60, "himalayas") is None


def test_a_source_can_have_its_own_outputs():
    cfg = {"outputs": ["supabase"], "himalayas": {"outputs": ["elsewhere"]}}
    assert sinks.output_names(cfg, "himalayas") == ["elsewhere"]
    assert sinks.output_names(cfg, "jobstreet") == ["supabase"]
    assert sinks.output_names({}, "jobstreet") == ["supabase"]


def test_build_sinks_rejects_unknown_output():
    with pytest.raises(ValueError):
        sinks.build_sinks({"outputs": ["excel"]}, {}, "jobstreet")


class RecordingSink:
    def __init__(self, name, fail=False):
        self.name, self.fail, self.calls = name, fail, 0

    def write(self, kept, filtered, expired=()):
        self.calls += 1
        if self.fail:
            raise RuntimeError("down")


def test_deliver_writes_to_every_sink_even_if_one_fails():
    broken, healthy = RecordingSink("first", fail=True), RecordingSink("supabase")
    with pytest.raises(RuntimeError, match="first: down"):
        sinks.deliver([broken, healthy], [], [KEPT], [])
    assert healthy.calls == 1


def test_deliver_fails_when_an_output_has_no_credentials():
    with pytest.raises(RuntimeError, match="supabase: credentials missing"):
        sinks.deliver([RecordingSink("first")], ["supabase"], [], [])


# ---- run log -----------------------------------------------------------------


class FakeClient:
    def __init__(self, running=()):
        self.inserted, self.updates, self.running = [], [], list(running)

    def insert_one(self, table, row, select="id"):
        self.inserted.append((table, row))
        return {"id": 7}

    def update(self, table, match, values):
        self.updates.append((table, match, values))

    def select(self, table, params):
        return [{"id": i} for i in self.running]


@pytest.fixture(autouse=True)
def pending_file(monkeypatch, tmp_path):
    """Run-log writes saved for later go to a temporary file, never scraper/data/."""
    path = tmp_path / "pending_runs.json"
    monkeypatch.setattr(sinks, "PENDING_RUNS_FILE", path)
    monkeypatch.delenv("DISPATCH_ID", raising=False)
    return path


@pytest.fixture
def fake_client(monkeypatch):
    client = FakeClient()
    monkeypatch.setattr(sinks, "supabase_client", lambda secrets: client)
    monkeypatch.setenv("GITHUB_RUN_ID", "999")
    return client


CFG = {"outputs": ["supabase"]}


def test_run_log_records_counts(fake_client):
    with sinks.run_log(CFG, {}, "jobstreet") as stats:
        stats.update(found=10, kept=2)
    assert fake_client.inserted == [("scrape_runs", {"source": "jobstreet", "github_run_id": "999"})]
    table, match, values = fake_client.updates[0]
    assert match == {"id": 7}
    assert values["found"] == 10 and values["kept"] == 2 and values["error"] is None
    assert values["status"] == "ok" and values["finished_at"]


def test_run_log_records_the_dispatch_that_started_it(fake_client, monkeypatch):
    monkeypatch.setenv("DISPATCH_ID", "42")
    with sinks.run_log(CFG, {}, "jobstreet"):
        pass
    assert fake_client.inserted[0][1]["dispatch_id"] == 42


def test_run_log_records_errors_and_reraises(fake_client):
    with pytest.raises(ValueError), sinks.run_log(CFG, {}, "jobstreet"):
        raise ValueError("JobStreet changed its API")
    values = fake_client.updates[0][2]
    assert values["error"] == "ValueError: JobStreet changed its API" and values["status"] == "failed"


def test_a_problem_after_delivery_is_a_warning_not_a_failure(fake_client):
    with sinks.run_log(CFG, {}, "jobstreet") as stats:
        stats["delivered"] = True
        raise OSError("disk full")  # e.g. saving the cache file
    values = fake_client.updates[0][2]
    assert values["status"] == "ok" and values["error"] is None
    assert values["warning"] == "OSError: disk full" and "delivered" not in values


def test_a_warning_set_during_the_run_is_kept(fake_client):
    with sinks.run_log(CFG, {}, "jobstreet") as stats:
        stats.update(delivered=True, warning="Closed-posting re-check failed: 503")
    values = fake_client.updates[0][2]
    assert values["status"] == "ok" and values["warning"] == "Closed-posting re-check failed: 503"


def test_a_start_that_couldnt_be_written_is_inserted_at_the_end(fake_client):
    calls = []

    def insert_one(table, row, select="id"):
        calls.append(row)
        if len(calls) == 1:
            raise RuntimeError("supabase down")
        return {"id": 8}

    fake_client.insert_one = insert_one
    with sinks.run_log(CFG, {}, "jobstreet") as stats:
        stats["kept"] = 3
    assert len(calls) == 2
    assert calls[1]["source"] == "jobstreet" and calls[1]["status"] == "ok" and calls[1]["kept"] == 3
    assert calls[1]["started_at"] < calls[1]["finished_at"]


def test_an_end_that_couldnt_be_written_is_saved_for_the_last_step(fake_client, pending_file):
    def update(table, match, values):
        raise RuntimeError("supabase down")

    fake_client.update = update
    with sinks.run_log(CFG, {}, "jobstreet") as stats:
        stats["kept"] = 3
    (entry,) = json.loads(pending_file.read_text(encoding="utf-8"))
    assert entry["id"] == 7 and entry["values"]["status"] == "ok" and entry["values"]["kept"] == 3


def test_an_older_database_gets_the_end_without_the_newer_columns(fake_client):
    def update(table, match, values):
        if "status" in values:
            raise RuntimeError("HTTP 400: column status does not exist")
        fake_client.updates.append((table, match, values))

    fake_client.update = update
    with sinks.run_log(CFG, {}, "jobstreet") as stats:
        stats.update(kept=2, settings_version=3)
    (_, _, values), = fake_client.updates
    assert values["kept"] == 2 and "status" not in values and "settings_version" not in values


def test_a_switched_off_site_gets_a_skipped_row(fake_client):
    sinks.record_skipped(CFG, {}, "linkedin", 4)
    (table, row), = fake_client.inserted
    assert row["status"] == "skipped" and row["finished_at"] and row["settings_version"] == 4
    sinks.record_skipped({"outputs": ["elsewhere"]}, {}, "linkedin", 4)
    assert len(fake_client.inserted) == 1


def test_the_last_step_replays_saved_writes_then_interrupts_what_is_left(pending_file):
    pending_file.write_text(json.dumps([
        {"id": 7, "values": {"status": "ok", "kept": 1}},
        {"insert": {"source": "himalayas", "status": "failed", "error": "boom"}},
    ]), encoding="utf-8")
    client = FakeClient(running=[9])
    assert sinks.close_unfinished_runs(client, "999") == 1
    assert client.updates[0] == ("scrape_runs", {"id": 7}, {"status": "ok", "kept": 1})
    assert client.inserted == [("scrape_runs", {"source": "himalayas", "status": "failed", "error": "boom"})]
    table, match, values = client.updates[1]
    assert match == {"id": 9} and values["status"] == "interrupted" and values["finished_at"]
    assert not pending_file.exists()


def test_run_log_skips_dry_runs_and_runs_without_supabase(fake_client):
    with sinks.run_log(CFG, {}, "jobstreet", dry_run=True):
        pass
    with sinks.run_log({"outputs": ["elsewhere"]}, {}, "jobstreet"):
        pass
    assert fake_client.inserted == [] and fake_client.updates == []


def test_run_log_problems_never_fail_the_run(monkeypatch):
    class BrokenClient(FakeClient):
        def insert_one(self, *a, **k):
            raise RuntimeError("supabase down")

    monkeypatch.setattr(sinks, "supabase_client", lambda secrets: BrokenClient())
    with sinks.run_log(CFG, {}, "jobstreet") as stats:
        stats["found"] = 1  # the run itself carries on
