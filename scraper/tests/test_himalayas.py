import time
from datetime import datetime, timezone

import pytest

import himalayas_api as api
import Himalayas_Scraper as hm

NOW = int(time.time())
DAY = 86_400
ALL_ZONES = [-11, -10, -9.5, -8, -5, 0, 1, 5.5, 8, 9, 12, 14]


def raw_job(slug="junior-developer", company="Acme", title="Junior Developer", **overrides):
    """A search result shaped like the API's (made-up content)."""
    job = {
        "title": title,
        "companyName": company,
        "companySlug": company.lower(),
        "employmentType": "Full Time",
        "minSalary": None,
        "maxSalary": None,
        "currency": None,
        "salaryPeriod": "annual",
        "seniority": ["Entry-level"],
        "locationRestrictions": ["Philippines"],
        "timezoneRestrictions": [8],
        "description": "<p>We use React and TypeScript. Fresh graduates welcome.</p>",
        "pubDate": NOW - DAY,
        "expiryDate": NOW + 30 * DAY,
        "guid": f"https://himalayas.app/companies/{company.lower()}/jobs/{slug}",
        "applicationLink": f"https://himalayas.app/companies/{company.lower()}/jobs/{slug}?utm_source=api",
    }
    return {**job, **overrides}


# ---- the client --------------------------------------------------------------------


class FakeResponse:
    def __init__(self, status, payload=None, headers=None, text=""):
        self.status_code, self.payload, self.headers, self.text = status, payload, headers or {}, text

    def json(self):
        if self.payload is None:
            raise ValueError("not json")
        return self.payload


class FakeSession:
    def __init__(self, *responses):
        self.responses, self.calls = list(responses), []

    def get(self, url, params=None, timeout=None):
        self.calls.append(params)
        return self.responses.pop(0)


@pytest.fixture
def sleeps(monkeypatch):
    waited = []
    monkeypatch.setattr(api.time, "sleep", waited.append)
    monkeypatch.setattr(hm.time, "sleep", waited.append)
    return waited


def test_search_sends_query_country_and_page():
    session = FakeSession(FakeResponse(200, {"jobs": [raw_job()], "totalCount": 1}))
    jobs, total = api.search(session, "junior developer", 2)
    assert session.calls == [{"q": "junior developer", "country": "PH", "page": 2}]
    assert total == 1 and jobs[0]["title"] == "Junior Developer"


def test_a_429_is_retried_once_then_raises_rate_limited(sleeps):
    session = FakeSession(FakeResponse(429, headers={"Retry-After": "7"}), FakeResponse(429))
    with pytest.raises(api.RateLimited):
        api.search(session, "x", 1)
    assert len(session.calls) == 2 and sleeps == [7]


@pytest.mark.parametrize("response", [
    FakeResponse(500, text="oops"),
    FakeResponse(200, None, text="<html>"),
    FakeResponse(200, {"error": "bad"}),
])
def test_bad_responses_raise_himalayas_error(response):
    with pytest.raises(api.HimalayasError):
        api.search(FakeSession(response), "x", 1)


# ---- mapping a search result --------------------------------------------------------


def test_summarize_maps_the_api_fields():
    job = hm.summarize(raw_job(minSalary=30000, maxSalary=45000, currency="USD"))
    assert job["id"] == "acme/jobs/junior-developer"
    assert job["url"] == "https://himalayas.app/companies/acme/jobs/junior-developer"
    assert job["work_arrangements"] == ["Remote"]
    assert job["location"] == "Remote (Philippines)"
    assert job["salary_text"] == "USD 30,000–45,000 / annual"
    assert job["seniority"] == "Entry-level"
    assert job["posted"] == datetime.fromtimestamp(NOW - DAY, hm.MANILA).strftime("%Y-%m-%d %H:%M")


def test_summarize_skips_jobs_without_a_guid():
    assert hm.summarize(raw_job(guid="")) is None


@pytest.mark.parametrize("countries, text", [
    ([], "Remote (Worldwide)"),
    (["Philippines", "Vietnam"], "Remote (Philippines)"),
    (["United States", "Canada"], "Remote (United States, Canada)"),
])
def test_location_text(countries, text):
    assert hm.location_text(countries) == text


@pytest.mark.parametrize("fields, text", [
    ({}, ""),
    ({"minSalary": 1000, "currency": "USD", "salaryPeriod": "monthly"}, "USD 1,000+ / monthly"),
    ({"maxSalary": 1000, "currency": "USD", "salaryPeriod": None}, "USD 1,000"),
    ({"minSalary": 900, "maxSalary": 900, "currency": "PHP"}, "PHP 900 / annual"),
])
def test_salary_text(fields, text):
    assert hm.salary_text(raw_job(**fields)) == text


# ---- who may apply ----------------------------------------------------------------


@pytest.mark.parametrize("countries, zones, dropped", [
    (["Philippines"], [8], None),
    ([], ALL_ZONES, None),                      # worldwide
    ([], [], None),                             # no restrictions at all
    (["United States"], [-8, -5], "not open to the Philippines (United States only)"),
    (["A", "B", "C", "D"], [], "not open to the Philippines (A, B, C, … only)"),
    ([], [-8, -5], "not open to UTC+8 (timezone restriction)"),
    (["Philippines"], [8.0], None),
])
def test_eligibility(countries, zones, dropped):
    job = hm.summarize(raw_job(locationRestrictions=countries, timezoneRestrictions=zones))
    assert hm.eligibility_drop_reason(job) == dropped


# ---- collect() ------------------------------------------------------------------------


CFG = {"keywords": ["junior developer", "web developer"], "listed_within_days": 3,
       "max_pages_per_search": 3, "min_match_score": 0, "himalayas": {"delay_seconds": 0}}


def test_collect_merges_searches_and_skips_old_jobs(monkeypatch, sleeps):
    pages = {
        "junior developer": [raw_job("a"), raw_job("old", pubDate=NOW - 10 * DAY)],
        "web developer": [raw_job("a"), raw_job("b")],
    }
    monkeypatch.setattr(api, "search", lambda s, q, page, country: (pages[q], len(pages[q])))
    jobs = hm.collect(None, CFG)
    assert sorted(jobs) == ["acme/jobs/a", "acme/jobs/b"]
    assert jobs["acme/jobs/a"]["search_terms"] == ["junior developer", "web developer"]


def test_collect_pages_until_the_total_or_the_page_limit(monkeypatch, sleeps):
    calls = []

    def search(session, q, page, country):
        calls.append((q, page))
        return [raw_job(f"{q}-{page}-{i}") for i in range(api.PAGE_SIZE)], 45

    monkeypatch.setattr(api, "search", search)
    hm.collect(None, {**CFG, "keywords": ["x"]})
    assert calls == [("x", 1), ("x", 2), ("x", 3)]  # 45 jobs = 3 pages

    calls.clear()
    hm.collect(None, {**CFG, "keywords": ["x"], "max_pages_per_search": 2})
    assert calls == [("x", 1), ("x", 2)]


def test_collect_stops_at_rate_limit_but_keeps_results(monkeypatch, sleeps):
    def search(session, q, page, country):
        if q == "web developer":
            raise api.RateLimited("HTTP 429")
        return [raw_job("a")], 1

    monkeypatch.setattr(api, "search", search)
    assert list(hm.collect(None, CFG)) == ["acme/jobs/a"]


def test_rate_limited_before_any_result_fails_the_run(monkeypatch, sleeps):
    def search(*a, **kw):
        raise api.RateLimited("HTTP 429")

    monkeypatch.setattr(api, "search", search)
    with pytest.raises(RuntimeError, match="rate-limiting"):
        hm.collect(None, CFG)


def test_every_search_failing_fails_the_run(monkeypatch, sleeps):
    def search(*a, **kw):
        raise api.HimalayasError("HTTP 500")

    monkeypatch.setattr(api, "search", search)
    with pytest.raises(RuntimeError, match="Every search failed"):
        hm.collect(None, CFG)


# ---- evaluate_jobs() ------------------------------------------------------------------


def candidates(*raws):
    jobs = [hm.summarize(r) for r in raws]
    for job in jobs:
        job["search_terms"] = ["junior developer"]
    return jobs


def test_evaluate_keeps_filters_and_expires():
    jobs = candidates(
        raw_job("keep"),
        raw_job("senior", title="Senior Developer"),
        raw_job("us", title="Junior Web Developer", locationRestrictions=["United States"],
                timezoneRestrictions=[-5]),
        raw_job("gone", expiryDate=NOW - DAY),
    )
    kept, filtered, expired = hm.evaluate_jobs(None, CFG, jobs, {})
    reasons = {f["id"]: f["reason"] for f in filtered}
    assert [k["id"] for k in kept] == ["acme/jobs/keep"]
    assert reasons["acme/jobs/us"] == "not open to the Philippines (United States only)"
    assert reasons["acme/jobs/senior"].startswith("seniority title")
    assert expired == ["acme/jobs/gone"]


def test_kept_record_has_what_the_outputs_need():
    kept, _, _ = hm.evaluate_jobs(None, CFG, candidates(raw_job()), {})
    record = kept[0]
    assert record["apply_type"] == "Himalayas"
    assert record["work_arrangement"] == "Remote"
    assert record["seniority"] == "Entry-level"
    assert "React" in record["description"]
    assert record["repost_key"] == "tc:junior developer acme"


def test_evaluate_drops_jobs_already_posted_under_another_id():
    jobs = candidates(raw_job("a"), raw_job("b"))
    kept, filtered, _ = hm.evaluate_jobs(None, CFG, jobs, {})
    assert [k["id"] for k in kept] == ["acme/jobs/a"]
    assert filtered[0]["reason"] == "duplicate posting (same title & company)"


def test_from_unix_handles_bad_values():
    assert hm.from_unix(None) is None
    assert hm.from_unix("x") is None
    assert hm.from_unix(0) == datetime(1970, 1, 1, tzinfo=timezone.utc)


def test_run_uses_the_himalayas_source(monkeypatch):
    calls = []
    monkeypatch.setattr(hm.scraper, "scrape", lambda *a, **kw: calls.append((a, kw)))
    hm.run(None)
    (args, kwargs), = calls
    assert args[1] == "himalayas" and args[2] is api and kwargs == {"prefix": "himalayas_"}
