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


def test_sheet_sink_strips_db_only_fields_and_uses_prefix():
    sent = {}

    def post(secrets, **records):
        sent.update(records)
        return {"linkedin_added": 1, "linkedin_skipped": 0, "linkedin_filtered_added": 1}

    sinks.SheetSink({}, "linkedin_", post).write([KEPT], [FILTERED])
    assert set(sent) == {"linkedin_jobs", "linkedin_filtered"}
    assert "description" not in sent["linkedin_jobs"][0]
    assert "repost_key" not in sent["linkedin_jobs"][0]


def test_sheet_sink_detects_old_apps_script():
    with pytest.raises(RuntimeError, match="Code.gs"):
        sinks.SheetSink({}, "linkedin_", lambda secrets, **r: {"added": 0}).write([KEPT], [])


def test_build_sinks_reports_missing_credentials():
    cfg = {"outputs": ["sheet", "supabase"]}
    found, missing = sinks.build_sinks(cfg, {"webapp_url": "u", "token": "t"}, "jobstreet", "", None)
    assert [s.name for s in found] == ["sheet"]
    assert missing == ["supabase"]


def test_build_sinks_rejects_unknown_output():
    with pytest.raises(ValueError):
        sinks.build_sinks({"outputs": ["excel"]}, {}, "jobstreet", "", None)


class RecordingSink:
    def __init__(self, name, fail=False):
        self.name, self.fail, self.calls = name, fail, 0

    def write(self, kept, filtered):
        self.calls += 1
        if self.fail:
            raise RuntimeError("down")


def test_deliver_writes_to_every_sink_even_if_one_fails():
    broken, healthy = RecordingSink("sheet", fail=True), RecordingSink("supabase")
    with pytest.raises(RuntimeError, match="sheet: down"):
        sinks.deliver([broken, healthy], [], [KEPT], [])
    assert healthy.calls == 1


def test_deliver_fails_when_an_output_has_no_credentials():
    with pytest.raises(RuntimeError, match="supabase: credentials missing"):
        sinks.deliver([RecordingSink("sheet")], ["supabase"], [], [])


# ---- run log -----------------------------------------------------------------


class FakeClient:
    def __init__(self):
        self.inserted, self.updates = [], []

    def insert_one(self, table, row, select="id"):
        self.inserted.append((table, row))
        return {"id": 7}

    def update(self, table, match, values):
        self.updates.append((table, match, values))


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
    assert values["finished_at"]


def test_run_log_records_errors_and_reraises(fake_client):
    with pytest.raises(ValueError), sinks.run_log(CFG, {}, "jobstreet"):
        raise ValueError("JobStreet changed its API")
    assert fake_client.updates[0][2]["error"] == "ValueError: JobStreet changed its API"


def test_run_log_skips_dry_runs_and_sheet_only(fake_client):
    with sinks.run_log(CFG, {}, "jobstreet", dry_run=True):
        pass
    with sinks.run_log({"outputs": ["sheet"]}, {}, "jobstreet"):
        pass
    assert fake_client.inserted == [] and fake_client.updates == []


def test_run_log_problems_never_fail_the_run(monkeypatch):
    class BrokenClient(FakeClient):
        def insert_one(self, *a, **k):
            raise RuntimeError("supabase down")

    monkeypatch.setattr(sinks, "supabase_client", lambda secrets: BrokenClient())
    with sinks.run_log(CFG, {}, "jobstreet") as stats:
        stats["found"] = 1  # the run itself carries on
