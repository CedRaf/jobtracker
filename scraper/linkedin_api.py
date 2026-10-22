"""
Thin client for LinkedIn's public (logged-out) job pages.

- search(): one page of search results (the "see more jobs" endpoint the
  public search page calls while scrolling; 10 cards per page)
- job_details(): description, criteria and whether applying goes off-site

No login or cookies: only what anyone can see without an account. Logged out,
LinkedIn ignores the On-site/Hybrid/Remote filter and doesn't show a job's
work arrangement, so the scraper reads it from the job text instead.
"""

import re
import time

import requests
from bs4 import BeautifulSoup

SEARCH_URL = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
DETAILS_URL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{}"
PAGE_SIZE = 10

# LinkedIn location ids (geoId).
CEBU = ("Cebu, Central Visayas, Philippines", "105344578")
PHILIPPINES = ("Philippines", "103121230")

# Waits (seconds) before retrying a rate-limited (HTTP 429) request.
RETRY_WAITS = [15, 45, 90]

HEADERS = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    ),
}


class LinkedInError(Exception):
    pass


def new_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    return session


def _get(session, url, params=None):
    for wait in RETRY_WAITS + [None]:
        resp = session.get(url, params=params, timeout=30)
        if resp.status_code != 429 or wait is None:
            break
        time.sleep(wait)
    if resp.status_code == 429:
        raise LinkedInError("HTTP 429: rate limited by LinkedIn")
    if resp.status_code != 200:
        raise LinkedInError(f"HTTP {resp.status_code}: {resp.text[:300]}")
    resp.encoding = "utf-8"
    return BeautifulSoup(resp.text, "html.parser")


def _text(node):
    return node.get_text(" ", strip=True) if node else ""


def _job_id(card):
    urn = card.get("data-entity-urn") or ""
    if urn:
        return urn.rsplit(":", 1)[-1]
    link = card.select_one("a.base-card__full-link")
    m = re.search(r"-(\d+)(?:\?|$)", link.get("href", "")) if link else None
    return m.group(1) if m else None


def search(session, keywords, page, location, distance_kms=None,
           sort="listedAt", listed_within_days=None):
    """
    Returns a list of cards: {"id", "title", "company", "location", "posted"
    (YYYY-MM-DD), "salary_text"}. location is a (name, geoId) pair.
    """
    name, geo_id = location
    params = {
        "keywords": keywords,
        "location": name,
        "geoId": geo_id,
        "sortBy": "DD" if sort == "listedAt" else "R",   # date posted / relevance
        "start": (page - 1) * PAGE_SIZE,
    }
    if distance_kms:
        params["distance"] = round(distance_kms / 1.609)   # LinkedIn uses miles
    if listed_within_days:
        params["f_TPR"] = f"r{listed_within_days * 86400}"   # "Past X seconds"

    cards = []
    for card in _get(session, SEARCH_URL, params).select("div.base-search-card"):
        job_id = _job_id(card)
        if not job_id:
            continue
        posted = card.select_one("time")
        cards.append({
            "id": job_id,
            "title": _text(card.select_one("h3.base-search-card__title")),
            "company": _text(card.select_one("h4.base-search-card__subtitle")),
            "location": _text(card.select_one("span.job-search-card__location")),
            "posted": posted.get("datetime", "") if posted else "",
            "salary_text": _text(card.select_one("span.job-search-card__salary-info")),
        })
    return cards


def job_details(session, job_id):
    """
    Returns {"description_html", "criteria" ({"Employment type": ...}),
    "isLinkOut", "isExpired"}. A job that was taken down counts as expired.
    """
    try:
        soup = _get(session, DETAILS_URL.format(job_id))
    except LinkedInError as e:
        if str(e).startswith(("HTTP 404", "HTTP 410")):
            return {"description_html": "", "criteria": {}, "isLinkOut": False, "isExpired": True}
        raise

    description = soup.select_one("div.show-more-less-html__markup")
    criteria = {}
    for item in soup.select("li.description__job-criteria-item"):
        criteria[_text(item.select_one("h3"))] = _text(item.select_one("span"))
    page = str(soup)
    return {
        "description_html": description.decode_contents() if description else "",
        "criteria": criteria,
        # Off-site = "Apply on company website"; otherwise LinkedIn's Easy Apply.
        "isLinkOut": "apply-link-offsite" in page,
        "isExpired": "No longer accepting applications" in page,
    }
