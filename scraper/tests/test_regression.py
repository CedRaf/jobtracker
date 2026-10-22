"""
Replays the title and location rules on real jobs labelled in the sheet.

fixtures/labelled_jobs.json holds jobs from the sheet export marked "Skip"
(label "skip") or "Applied"/"Rejected" (label "wanted"), with only title,
location and work arrangement kept. The export has no descriptions, so the
description rules in evaluate() are covered by test_rules.py instead.
"""

import json
from pathlib import Path

import pytest

import rules

JOBS = json.loads((Path(__file__).parent / "fixtures" / "labelled_jobs.json").read_text(encoding="utf-8"))

# Skipped jobs the title/location rules caught when the fixture was made.
# Raise this when the rules improve; it should never go down.
MIN_SKIPS_CAUGHT = 20


def drop_reason(job):
    return rules.title_drop_reason(job) or rules.location_drop_reason(job)


@pytest.mark.parametrize("job", [j for j in JOBS if j["label"] == "wanted"], ids=lambda j: j["title"])
def test_wanted_jobs_are_never_dropped(job):
    assert drop_reason(job) is None


def test_skipped_jobs_still_caught():
    caught = [j["title"] for j in JOBS if j["label"] == "skip" and drop_reason(j)]
    assert len(caught) >= MIN_SKIPS_CAUGHT, f"only {len(caught)} skipped jobs dropped"
