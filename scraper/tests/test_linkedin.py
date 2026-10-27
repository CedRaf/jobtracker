import pytest

import linkedin_api as api
import LinkedIn_Scraper as li


# ---- the client: one short retry, then RateLimited ------------------------------


class FakeResponse:
    def __init__(self, status, headers=None, text="<html></html>"):
        self.status_code, self.headers, self.text = status, headers or {}, text


class FakeSession:
    def __init__(self, *responses):
        self.responses, self.calls = list(responses), 0

    def get(self, url, params=None, timeout=None):
        self.calls += 1
        return self.responses.pop(0)


@pytest.fixture
def sleeps(monkeypatch):
    waited = []
    monkeypatch.setattr(api.time, "sleep", waited.append)
    monkeypatch.setattr(li.time, "sleep", waited.append)
    return waited


def test_a_429_is_retried_once_after_retry_after(sleeps):
    session = FakeSession(FakeResponse(429, {"Retry-After": "12"}), FakeResponse(200))
    api._get(session, "https://example.test")
    assert session.calls == 2 and sleeps == [12]


@pytest.mark.parametrize("header, wait", [
    ({}, api.RETRY_WAIT),
    ({"Retry-After": "600"}, 60),
    ({"Retry-After": "1"}, 5),
    ({"Retry-After": "soon"}, api.RETRY_WAIT),
])
def test_retry_wait_uses_retry_after_within_limits(header, wait):
    assert api._retry_wait(FakeResponse(429, header)) == wait


def test_a_second_429_raises_rate_limited(sleeps):
    session = FakeSession(FakeResponse(429), FakeResponse(429))
    with pytest.raises(api.RateLimited):
        api._get(session, "https://example.test")
    assert session.calls == 2


# ---- the scraper: stop early, keep what was found -------------------------------------


CFG = {"keywords": ["junior developer", "ai engineer"], "cebu_distance_kms": 50,
       "search_remote_outside_cebu": True, "listed_within_days": 3, "sort": "listedAt",
       "min_match_score": 0, "linkedin": {"max_pages_per_search": 2, "delay_seconds": 0}}


def card(job_id, title="Junior Developer"):
    return {"id": job_id, "title": title, "company": "Acme", "location": "Cebu City, Cebu",
            "posted": None, "salary_text": ""}


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def fresh_cfg(**linkedin):
    return {**CFG, "linkedin": {**CFG["linkedin"], **linkedin}}


def test_searches_stop_at_rate_limit_but_keep_results(monkeypatch, sleeps):
    calls = []

    def search(session, keyword, page, **kw):
        calls.append(keyword)
        if len(calls) > 2:
            raise api.RateLimited("HTTP 429")
        return [card(f"{keyword}-{page}")]

    monkeypatch.setattr(api, "search", search)
    jobs = li.collect(None, fresh_cfg())
    assert len(jobs) == 2
    assert len(calls) == 3  # no further searches after the rate limit


def test_rate_limited_before_any_result_fails_the_run(monkeypatch, sleeps):
    def search(*a, **kw):
        raise api.RateLimited("HTTP 429")

    monkeypatch.setattr(api, "search", search)
    with pytest.raises(RuntimeError, match="rate-limiting"):
        li.collect(None, fresh_cfg())


def test_searches_respect_pages_per_search(monkeypatch, sleeps):
    pages = []
    def search(session, keyword, page, **kw):
        pages.append(page)
        return [card(f"{keyword}{page}")] * 10  # full pages, so it would keep going

    monkeypatch.setattr(api, "search", search)
    li.collect(None, fresh_cfg(max_pages_per_search=2))
    assert max(pages) == 2


def test_time_budget_stops_searching_and_checking(monkeypatch, sleeps):
    clock = Clock()
    cfg = fresh_cfg()
    cfg["_linkedin_budget"] = li.Budget(1, clock=clock)  # 1 minute

    def search(session, keyword, page, **kw):
        clock.now += 40  # each search takes 40 s
        return [card(f"{keyword}-{page}")]

    monkeypatch.setattr(api, "search", search)
    jobs = li.collect(None, cfg)
    assert len(jobs) == 2  # the third search would start after the budget

    monkeypatch.setattr(api, "job_details", lambda *a: pytest.fail("no details after the budget"))
    kept, filtered, expired = li.evaluate_jobs(None, cfg, list(jobs.values()), {})
    assert (kept, filtered, expired) == ([], [], [])  # left unseen for the next run


def test_details_stop_at_rate_limit_leaving_the_rest_unseen(monkeypatch, sleeps):
    details = {"isExpired": False, "description_html": "<p>React and TypeScript, remote</p>",
               "criteria": {}, "isLinkOut": False}
    calls = []

    def job_details(session, job_id):
        calls.append(job_id)
        if len(calls) > 1:
            raise api.RateLimited("HTTP 429")
        return details

    monkeypatch.setattr(api, "job_details", job_details)
    candidates = [{**card(str(i), f"Junior Developer {i}"), "work_arrangements": [], "work_type": "",
                   "url": "u", "search_terms": ["junior developer"]} for i in range(3)]
    kept, filtered, expired = li.evaluate_jobs(None, fresh_cfg(), candidates, {})
    assert [k["id"] for k in kept] == ["0"]
    assert calls == ["0", "1"]  # job 2 was never requested
