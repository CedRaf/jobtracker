"""
Thin client for Himalayas' public job search API (https://himalayas.app/api).

- search(): one page of search results, 20 jobs a page. Each job already has
  its full description, so there's no separate details request.

Himalayas only lists remote jobs. country= limits results to jobs open to that
country, which includes "worldwide" jobs (no location restriction).
"""

import time

import requests

SEARCH_URL = "https://himalayas.app/jobs/api/search"
PAGE_SIZE = 20

# A rate-limited (HTTP 429) request is retried once, after the Retry-After hint
# (clamped) or RETRY_WAIT seconds; a second 429 raises RateLimited.
RETRY_WAIT = 30
RETRY_WAIT_RANGE = (5, 60)

HEADERS = {
    "accept": "application/json",
    "user-agent": "jobtracker (personal job search; github.com/CedRaf/jobtracker)",
}


class HimalayasError(Exception):
    pass


class RateLimited(HimalayasError):
    """Himalayas keeps answering HTTP 429: stop sending requests for this run."""


def new_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    return session


def _retry_wait(resp):
    """Seconds to wait after a 429: Retry-After if sent, kept within RETRY_WAIT_RANGE."""
    low, high = RETRY_WAIT_RANGE
    try:
        return min(max(int(resp.headers.get("Retry-After", "")), low), high)
    except ValueError:
        return RETRY_WAIT


def _get(session, url, params=None):
    resp = session.get(url, params=params, timeout=30)
    if resp.status_code == 429:
        time.sleep(_retry_wait(resp))
        resp = session.get(url, params=params, timeout=30)
    if resp.status_code == 429:
        raise RateLimited("HTTP 429: rate limited by Himalayas")
    if resp.status_code != 200:
        raise HimalayasError(f"HTTP {resp.status_code}: {resp.text[:300]}")
    try:
        return resp.json()
    except ValueError:
        raise HimalayasError(f"Response isn't JSON: {resp.text[:200]!r}") from None


def search(session, query, page, country="PH"):
    """
    Returns (jobs, total): one page of raw job dicts as the API sends them
    (title, companyName, description, locationRestrictions, timezoneRestrictions,
    pubDate, expiryDate, guid, ...) and the total number of matches.
    """
    data = _get(session, SEARCH_URL, {"q": query, "country": country, "page": page})
    if not isinstance(data.get("jobs"), list):
        raise HimalayasError(f"Unexpected response: {str(data)[:200]}")
    return data["jobs"], int(data.get("totalCount") or 0)
