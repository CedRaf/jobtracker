import pytest

import scraper
import sinks


# ---- the cross-site key -------------------------------------------------------------


@pytest.mark.parametrize("a, b", [
    # Same job, formatted the way different sites do it.
    (("1182 - Junior Frontend Developer (Part-Time)", "GoFasti"),
     ("Junior Frontend Developer", "GoFasti Inc.")),
    (("Junior Software Engineer - Remote (Global), Full-Time", "Mixrank"),
     ("Junior Software Engineer", "MixRank")),
    (("Junior Web Developer | Work From Home", "Sourcefit Philippines Inc."),
     ("Junior Web Developer", "Sourcefit")),
    (("Junior Web Developer (Cebu City)", "Acme Corporation"),
     ("JUNIOR WEB DEVELOPER", "Acme Corp.")),
    (("Associate Software Engineer [Urgent Hiring]", "The Company Ltd"),
     ("Associate Software Engineer", "Company")),
    (("C# Developer - REQ12345", "Acme"), ("C# Developer", "Acme")),
])
def test_same_job_on_two_sites_gets_the_same_key(a, b):
    assert scraper.cross_site_key(*a) == scraper.cross_site_key(*b)


@pytest.mark.parametrize("a, b", [
    # Different jobs: these must never be treated as duplicates.
    (("Developer (RPA)", "Acme"), ("Developer (QA)", "Acme")),
    (("Software Engineer - Python", "Acme"), ("Software Engineer - Java", "Acme")),
    (("Junior Developer", "Acme"), ("Junior Developer", "Acme Labs")),
    (("Junior Developer", "Acme"), ("Senior Developer", "Acme")),
    (("C# Developer", "Acme"), ("C++ Developer", "Acme")),
    (("Developer - Web3", "Acme"), ("Developer", "Acme")),
    (("Frontend Developer", "Acme"), ("Frontend Developer Intern", "Acme")),
])
def test_different_jobs_get_different_keys(a, b):
    assert scraper.cross_site_key(*a) != scraper.cross_site_key(*b)


@pytest.mark.parametrize("title, company", [
    ("Junior Developer", ""),
    ("Junior Developer", None),
    ("", "Acme"),
    ("Remote - Full Time", "Acme"),   # nothing left of the title
])
def test_no_key_without_a_title_and_company(title, company):
    assert scraper.cross_site_key(title, company) is None


def test_a_one_word_company_named_like_a_suffix_is_kept():
    assert scraper.cross_site_key("Developer", "Company") == "developer|company"


# ---- dropping duplicates --------------------------------------------------------------


def job(job_id, title, company="Acme"):
    return {"id": job_id, "title": title, "company": company, "location": "", "work_arrangements": [],
            "search_terms": ["junior developer"], "url": f"u/{job_id}"}


def test_jobs_another_site_has_are_filtered_with_the_site_name(monkeypatch):
    rows = [{"source": "jobstreet", "title": "Junior Web Developer", "company": "Sourcefit Philippines Inc."},
            {"source": "linkedin", "title": "QA Tester", "company": "Acme"}]
    monkeypatch.setattr(sinks, "recent_jobs", lambda secrets, days, source: rows)
    known = scraper.other_site_jobs({}, {}, "himalayas")

    remaining, filtered = scraper.drop_cross_site_duplicates(
        [job("1", "Junior Web Developer (Remote)", "Sourcefit"), job("2", "Junior Python Developer")], known)
    assert [j["id"] for j in remaining] == ["2"]
    assert filtered[0]["id"] == "1"
    assert filtered[0]["reason"] == "duplicate posting (also on JobStreet)"


def test_the_first_site_to_keep_a_job_is_named(monkeypatch):
    rows = [{"source": "jobstreet", "title": "Dev", "company": "Acme"},
            {"source": "linkedin", "title": "Dev", "company": "Acme"}]
    monkeypatch.setattr(sinks, "recent_jobs", lambda *a: rows)
    assert scraper.other_site_jobs({}, {}, "himalayas") == {"dev|acme": "JobStreet"}


def test_lookback_comes_from_config(monkeypatch):
    seen = []
    monkeypatch.setattr(sinks, "recent_jobs", lambda secrets, days, source: seen.append((days, source)) or [])
    scraper.other_site_jobs({"duplicate_lookback_days": 14}, {}, "linkedin")
    scraper.other_site_jobs({}, {}, "linkedin")
    assert seen == [(14, "linkedin"), (60, "linkedin")]


@pytest.mark.parametrize("lookup", [
    lambda *a: (_ for _ in ()).throw(RuntimeError("Supabase GET jobs failed")),
    lambda *a: None,   # no Supabase key
])
def test_no_lookup_means_no_cross_site_check(monkeypatch, lookup):
    monkeypatch.setattr(sinks, "recent_jobs", lookup)
    known = scraper.other_site_jobs({}, {}, "himalayas")
    assert known == {}
    remaining, filtered = scraper.drop_cross_site_duplicates([job("1", "Junior Developer")], known)
    assert len(remaining) == 1 and filtered == []


# ---- in a run --------------------------------------------------------------------------


class Args:
    dry_run, limit = True, 0


def test_scrape_filters_duplicates_before_evaluating(monkeypatch, tmp_path):
    monkeypatch.setattr(scraper, "CONFIG_FILE", tmp_path / "missing.json")
    monkeypatch.setattr(scraper, "load_json", lambda path, default=None: (
        {"outputs": [], "seen_ids_retention_days": 30} if path.name == "missing.json" else default))
    monkeypatch.setattr(sinks, "load_settings", lambda secrets: (sinks.settings_module.validate({}), None))
    monkeypatch.setattr(sinks, "recent_jobs", lambda *a: [
        {"source": "jobstreet", "title": "Junior Web Developer", "company": "Acme Inc."}])
    written = {}
    monkeypatch.setattr(scraper, "write_csvs", lambda kept, filtered, prefix: written.update(
        kept=kept, filtered=filtered))

    class Api:
        @staticmethod
        def new_session():
            return None

    evaluated = []

    def evaluate(session, cfg, candidates, seen):
        evaluated.extend(j["id"] for j in candidates)
        return [], [], []

    def collect(session, cfg):
        return {"1": job("1", "Junior Web Developer - Remote", "Acme"), "2": job("2", "Junior QA")}

    scraper.scrape(Args(), "himalayas", Api, collect, evaluate, tmp_path / "seen.json")
    assert evaluated == ["2"]
    assert [(f["id"], f["reason"]) for f in written["filtered"]] == [
        ("1", "duplicate posting (also on JobStreet)")]
