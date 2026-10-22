import sys
from pathlib import Path

import pytest

# The scraper modules import each other by plain name (import rules), so the
# scraper folder has to be on the path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import rules  # noqa: E402


@pytest.fixture(autouse=True)
def reset_rules_config():
    """Every test starts with no config applied."""
    rules.configure({})
    yield
    rules.configure({})


@pytest.fixture
def make_job():
    def make(title="Junior Developer", company="Acme Corp", location="Cebu City, Cebu",
             work_arrangements=("On-site",)):
        return {"title": title, "company": company, "location": location,
                "work_arrangements": list(work_arrangements)}
    return make
