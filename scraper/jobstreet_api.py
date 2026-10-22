"""
Thin client for the GraphQL endpoint the JobStreet PH website uses.

- search(): one page of search results (JobSearchV7, same query the site sends)
- job_details(): full description + whether applying goes to an external site
"""

import uuid

import requests

URL = "https://ph.jobstreet.com/graphql"

# Work arrangement ids used by the site's "Remote options" filter.
WORK_ARRANGEMENT_REMOTE = "3"

SESSION_ID = str(uuid.uuid4())
VISITOR_ID = str(uuid.uuid4())

# Headers copied from a real browser request (minus login/cookies).
HEADERS = {
    "accept": "application/graphql-response+json,application/json;q=0.9",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json",
    "origin": "https://ph.jobstreet.com",
    "referer": "https://ph.jobstreet.com/",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    ),
    "seek-request-brand": "jobstreet",
    "seek-request-country": "PH",
    "x-seek-site": "chalice",
    "x-custom-features": "application/features.seek.all+json",
    "x-seek-ec-sessionid": SESSION_ID,
    "x-seek-ec-visitorid": VISITOR_ID,
}

# Exact query string the website sends (copied from the browser payload).
QUERY = "query JobSearchV7($params: JobSearchV7QueryInput!, $locale: Locale!, $zone: Zone!, $country: JobSearchV7Country!, $timezone: Timezone!, $tagsSubType: [JobSearchV7TagsSubType!]) {\n  jobSearchV7(params: $params) {\n    results {\n      jobs {\n        id\n        title\n        abstract\n        adDisplay\n        advertiser {\n          id\n          name\n          __typename\n        }\n        organisation {\n          id\n          name\n          companyProfileId\n          companyProfileUrl\n          companyProfileRelativeUrlToBeUsedWithZone\n          __typename\n        }\n        categories {\n          id\n          label(locale: $locale)\n          __typename\n        }\n        location {\n          id\n          countryCode\n          displayName {\n            text\n            __typename\n          }\n          seoHierarchy {\n            contextualName {\n              text\n              __typename\n            }\n            __typename\n          }\n          __typename\n        }\n        cjs {\n          workTypes {\n            sourceId\n            name(locale: $locale)\n            __typename\n          }\n          source {\n            isAutoIncluded\n            __typename\n          }\n          salary {\n            hideSalary\n            minimum\n            maximum\n            currency\n            period\n            displayValue\n            __typename\n          }\n          roleTitles {\n            shortId\n            isDistinct\n            __typename\n          }\n          product {\n            branding {\n              companyLogoURL\n              __typename\n            }\n            bullets\n            adType {\n              sourceId\n              __typename\n            }\n            __typename\n          }\n          externalReferences {\n            id\n            sourceSystem\n            type\n            metadata {\n              name\n              assets {\n                profilePhotoUrl\n                __typename\n              }\n              __typename\n            }\n            __typename\n          }\n          __typename\n        }\n        listedAt {\n          dateTimeUtc\n          label(context: JOB_POSTED, length: SHORT, timezone: $timezone, locale: $locale)\n          __typename\n        }\n        salary {\n          period\n          min\n          max\n          currency\n          __typename\n        }\n        sol\n        tags(subType: $tagsSubType) {\n          type\n          label(locale: $locale)\n          __typename\n        }\n        url\n        workArrangements {\n          id\n          label {\n            lang\n            text\n            __typename\n          }\n          __typename\n        }\n        activity {\n          visitedApplicationSite {\n            count\n            mostRecent {\n              dateTimeUtc\n              __typename\n            }\n            __typename\n          }\n          applicationEnds {\n            count\n            mostRecent {\n              dateTimeUtc\n              __typename\n            }\n            __typename\n          }\n          applicationStarts {\n            count\n            mostRecent {\n              dateTimeUtc\n              __typename\n            }\n            __typename\n          }\n          impressions {\n            count\n            mostRecent {\n              dateTimeUtc\n              __typename\n            }\n            __typename\n          }\n          jobDetails {\n            count\n            mostRecent {\n              dateTimeUtc\n              __typename\n            }\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      pagination {\n        page\n        pageSize\n        resultCount\n        __typename\n      }\n      __typename\n    }\n    enrichment {\n      facets {\n        categoryV1 {\n          id\n          label {\n            lang\n            text\n            __typename\n          }\n          count\n          __typename\n        }\n        distinctTitleV1 {\n          id\n          label\n          count\n          __typename\n        }\n        __typename\n      }\n      suggestions {\n        queryParamLabelsV1 {\n          text\n          where {\n            id\n            kind\n            label {\n              lang\n              text\n              __typename\n            }\n            contextualName {\n              lang\n              text\n              __typename\n            }\n            contextualNameLocalisations(siteKey: $country) {\n              lang\n              text\n              __typename\n            }\n            isGranular\n            defaultDistanceKms\n            __typename\n          }\n          locationsHierarchy {\n            id\n            kind\n            label {\n              lang\n              text\n              __typename\n            }\n            contextualName {\n              lang\n              text\n              __typename\n            }\n            isGranular\n            defaultDistanceKms\n            __typename\n          }\n          __typename\n        }\n        relatedSearchesV1 {\n          totalJobs\n          text\n          __typename\n        }\n        organisationV1 {\n          organisationId\n          organisationName\n          totalJobs\n          __typename\n        }\n        locationV1 {\n          local {\n            sequence\n            completions {\n              id\n              label(locale: $locale, zone: $zone, context: CONTEXTUAL_NAME, labelType: SHORT)\n              __typename\n            }\n            __typename\n          }\n          international {\n            sequence\n            completions {\n              id\n              label(locale: $locale, zone: $zone, context: CONTEXTUAL_NAME, labelType: SHORT)\n              __typename\n            }\n            __typename\n          }\n          __typename\n        }\n        sabFilterV1 {\n          showSABFilter\n          __typename\n        }\n        canonicalV1 {\n          text\n          where {\n            id\n            name\n            __typename\n          }\n          __typename\n        }\n        spellingCorrectionV1 {\n          type\n          count\n          searchToken\n          label {\n            lang\n            defaultText\n            __typename\n          }\n          intent {\n            country\n            locale\n            text\n            where\n            whereId\n            sort\n            distanceKms\n            filter {\n              advertiserId\n              categoryId\n              listedAt\n              organisationId\n              organisationName\n              salaryMin\n              salaryMax\n              tags\n              workTypeId\n              workArrangementId\n              __typename\n            }\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    context {\n      searchToken\n      filterNewSince\n      representations {\n        uiV1 {\n          country\n          locale\n          text\n          where\n          whereId\n          sort\n          distanceKms\n          filter {\n            advertiserId\n            categoryId\n            categoryName\n            listedAt\n            organisationId\n            organisationName\n            salaryMin\n            salaryMax\n            tags\n            workTypeId\n            workArrangementId\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    metadata {\n      flight\n      request {\n        correlationId\n        __typename\n      }\n      sol\n      __typename\n    }\n    __typename\n  }\n}"

DETAILS_QUERY = """query jobDetails($jobId: ID!, $sessionId: String!, $correlationId: String!) {
  jobDetails(id: $jobId, tracking: {channel: "WEB", jobDetailsViewedCorrelationId: $correlationId, sessionId: $sessionId}) {
    job {
      id
      isLinkOut
      isExpired
      content(platform: WEB)
    }
  }
}"""


class JobStreetError(Exception):
    pass


def new_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    return session


def _post(session, payload):
    resp = session.post(URL, json=payload, timeout=30)
    if resp.status_code != 200:
        raise JobStreetError(f"HTTP {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    if data.get("errors"):
        raise JobStreetError(f"GraphQL errors: {data['errors']}")
    return data["data"]


def search(session, keywords, page, location=None, distance_kms=50,
           remote_only=False, sort="listedAt", listed_within_days=None, search_token=None):
    """Returns (jobs, result_count, next_search_token)."""
    intent = {
        "country": "PH",
        "locale": "en-PH",
        "text": keywords,
        "sort": sort,
    }
    if location:
        intent["where"] = [location]
        intent["distanceKms"] = distance_kms
    search_filter = {}
    if remote_only:
        search_filter["workArrangementId"] = [WORK_ARRANGEMENT_REMOTE]
    if listed_within_days:
        search_filter["listedAt"] = f"{listed_within_days}d"   # site's "Listed in last X days"
    if search_filter:
        intent["filter"] = search_filter

    params = {
        "searchIntent": intent,
        "searchContext": {
            "brand": "jobstreet",
            "channel": "web",
            "solVisitorId": VISITOR_ID,
            "intent": "SEARCH",
            "source": "FE_SERP",
        },
        "responseConfig": {
            "results": ["jobs"],
            "representations": ["uiV1"],
            "page": page,
            "pageSize": 30,
            "enrichment": {
                "suggestions": [
                    "locationV1",
                    "queryParamLabelsV1",
                    "sabFilterV1",
                    "organisationV1",
                    "relatedSearchesV1",
                ],
                "relatedSearchesCount": 12,
            },
        },
        "sessionId": SESSION_ID,
    }
    if search_token:
        params["searchToken"] = search_token

    payload = {
        "operationName": "JobSearchV7",
        "variables": {
            "params": params,
            "locale": "en-PH",
            "zone": "asia-6",
            "timezone": "Asia/Manila",
            "country": "PH",
            "tagsSubType": ["VSAB"],
        },
        "extensions": {"clientLibrary": {"name": "@apollo/client", "version": "4.2.9"}},
        "query": QUERY,
    }

    result = _post(session, payload)["jobSearchV7"]
    token = (result.get("context") or {}).get("searchToken") or search_token
    results = result["results"]
    total = (results.get("pagination") or {}).get("resultCount") or 0
    return results.get("jobs") or [], total, token


def job_details(session, job_id):
    """Returns {"id", "isLinkOut", "isExpired", "content" (HTML)} or None."""
    payload = {
        "operationName": "jobDetails",
        "query": DETAILS_QUERY,
        "variables": {
            "jobId": str(job_id),
            "sessionId": SESSION_ID,
            "correlationId": str(uuid.uuid4()),
        },
    }
    return (_post(session, payload).get("jobDetails") or {}).get("job")
